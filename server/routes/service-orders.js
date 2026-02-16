import express from "express";
import createError from "http-errors";
import { randomUUID } from "crypto";

import { authenticate, requireRole } from "../middleware/auth.js";
import { authorizePermission } from "../middleware/permissions.js";
import { resolveClientId } from "../middleware/client.js";
import { getClientById, updateClient } from "../models/client.js";
import { findDeviceByUniqueId, getDeviceById, listDevices, updateDevice } from "../models/device.js";
import { getModelById } from "../models/model.js";
import { getVehicleById, updateVehicle } from "../models/vehicle.js";
import prisma, { isPrismaAvailable } from "../services/prisma.js";
import {
  collectServiceOrderMedia,
  paginateMedia,
  syncTaskStatusesFromServiceOrder,
} from "../services/service-order-workflow.js";
import { getEffectiveVehicleIds } from "../utils/mirror-scope.js";
import { createTechnicianNameMatcher } from "../utils/technician-scope.js";
import { DEFAULT_EQUIPMENT_STATUS_LINKED } from "../utils/equipment-status.js";
import { generateServiceOrderPdf } from "../utils/service-order-pdf.js";

let serviceOrderRouteMocks = {};

export function __setServiceOrderRouteMocks(mocks = {}) {
  serviceOrderRouteMocks = { ...serviceOrderRouteMocks, ...mocks };
}

export function __resetServiceOrderRouteMocks() {
  serviceOrderRouteMocks = {};
}

const router = express.Router();

router.use(authenticate);

const STATUS_FALLBACK = "SOLICITADA";
const CHECKLIST_STATUS_VALUES = new Set(["OK", "NOK"]);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTALLATION_CHECKLIST_ITEMS = [
  "Ignição",
  "Rádio",
  "Setas",
  "Farol Alto",
  "Luz Painel",
  "Farol Baixo",
  "Lanternas Traseiras",
  "Lanternas Dianteiras",
  "Limpador Pára-brisa",
  "Iluminação Interna",
  "Ar",
  "Lataria",
  "Inst. Elétrica",
];
const STATUS_EM_RETRABALHO = "EM_RETRABALHO";
const STATUS_PENDENTE_APROVACAO = "PENDENTE_APROVACAO_ADMIN";
const STATUS_REENVIADA_APROVACAO = "REENVIADA_PARA_APROVACAO";
const STATUS_APROVADA = "APROVADA";
const STATUS_CONCLUIDA = "CONCLUIDA";
const ADMIN_DECISION_APPROVED = "APPROVED";
const ADMIN_DECISION_REWORK = "REWORK_REQUIRED";

function ensurePrisma() {
  if (!isPrismaAvailable()) {
    throw createError(503, "Banco de dados indisponível");
  }
}

function buildServiceUnavailablePayload(message, retryAfterSeconds) {
  const payload = {
    code: "SERVICE_UNAVAILABLE",
    message: message || "Serviço indisponível no momento",
  };
  if (Number.isFinite(retryAfterSeconds)) {
    payload.retryAfterSeconds = retryAfterSeconds;
  }
  return payload;
}

function parseNullableDate(value) {
  if (!value) return null;
  return parseApiDate(value);
}

function parseNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseApiDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  let normalized = raw;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(normalized)) {
    normalized = normalized.replace(" ", "T");
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(normalized)) {
    normalized = `${normalized}Z`;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeStatusValue(value) {
  return String(value || "").trim().toUpperCase();
}

function toTrimmedString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeChecklistKey(value) {
  return normalizeComparableText(value)
    .replace(/[.\-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMediaReference(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    if (text.startsWith("data:image/")) return text;
    if (text.startsWith("data:video/")) return text;
    if (text.startsWith("http://") || text.startsWith("https://")) return text;
    if (text.startsWith("/")) return text;
    if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|mp4|mov|avi|mkv|webm)(\?|#|$)/i.test(text)) return text;
    return null;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return (
      normalizeMediaReference(value.url) ||
      normalizeMediaReference(value.src) ||
      normalizeMediaReference(value.href) ||
      normalizeMediaReference(value.path) ||
      normalizeMediaReference(value.value) ||
      normalizeMediaReference(value.mediaUrl)
    );
  }
  return null;
}

function normalizeMediaList(value) {
  const queue = Array.isArray(value) ? [...value] : value ? [value] : [];
  const media = [];
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    if (Array.isArray(current)) {
      queue.unshift(...current);
      continue;
    }
    const direct = normalizeMediaReference(current);
    if (direct) {
      media.push(direct);
      continue;
    }
    if (typeof current === "object") {
      ["items", "files", "list", "urls", "sources", "images", "videos"].forEach((key) => {
        if (Array.isArray(current[key])) {
          queue.unshift(...current[key]);
        }
      });
    }
  }
  return Array.from(new Set(media));
}

function resolveFirstMedia(...values) {
  for (const value of values) {
    const list = normalizeMediaList(value);
    if (list.length) return list[0];
  }
  return null;
}

function ensureWorkflowObject(signatures) {
  if (!signatures || typeof signatures !== "object" || Array.isArray(signatures)) {
    return {};
  }
  if (!signatures.workflow || typeof signatures.workflow !== "object" || Array.isArray(signatures.workflow)) {
    return {};
  }
  return signatures.workflow;
}

function formatYearMonth(date) {
  const year = date.getFullYear() % 100;
  const month = date.getMonth() + 1;
  return `${String(year).padStart(2, "0")}${String(month).padStart(2, "0")}`;
}

function parseSequence(value) {
  if (!value) return null;
  const parsed = Number.parseInt(String(value).replace(/\D/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSequence(value) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 1;
  const raw = String(numeric);
  return raw.length >= 4 ? raw : raw.padStart(4, "0");
}

async function generateOsInternalId(tx, { clientId, referenceDate }) {
  const prefix = formatYearMonth(referenceDate);
  const lastOrder = await tx.serviceOrder.findFirst({
    where: {
      clientId,
      osInternalId: { startsWith: prefix },
    },
    orderBy: { createdAt: "desc" },
    select: { osInternalId: true },
  });

  const lastSequence = lastOrder?.osInternalId?.slice(prefix.length) || null;
  const lastNumber = parseSequence(lastSequence);
  const nextNumber = lastNumber ? lastNumber + 1 : 1;
  return `${prefix}${buildSequence(nextNumber)}`;
}

function normalizeComparableText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isUuidLike(value) {
  const normalized = toTrimmedString(value);
  if (!normalized) return false;
  return UUID_REGEX.test(normalized);
}

function resolveRegisteredCodeFromDevice(device) {
  if (!device || typeof device !== "object") return null;
  const attributes = device.attributes && typeof device.attributes === "object" ? device.attributes : {};
  const candidates = [
    device.uniqueId,
    attributes.imei,
    attributes.serial,
    attributes.internalCode,
    attributes.codigoInterno,
    attributes.code,
    attributes.equipmentCode,
    attributes.deviceCode,
  ];
  for (const candidate of candidates) {
    const normalized = toTrimmedString(candidate);
    if (!normalized) continue;
    if (isUuidLike(normalized)) continue;
    return normalized;
  }
  return null;
}

function resolveRegisteredCodeFromEquipmentEntry(entry, { clientId = null, clientDevices = null } = {}) {
  const candidates = [
    entry?.uniqueId,
    entry?.imei,
    entry?.serial,
    entry?.equipmentCode,
    entry?.displayId,
    entry?.code,
    entry?.internalCode,
  ];
  for (const candidate of candidates) {
    const normalized = toTrimmedString(candidate);
    if (!normalized) continue;
    if (isUuidLike(normalized)) continue;
    return normalized;
  }
  const resolvedDevice = resolveDeviceByEquipmentEntry(entry, { clientId, clientDevices });
  const codeFromDevice = resolveRegisteredCodeFromDevice(resolvedDevice);
  if (codeFromDevice) return codeFromDevice;
  const fallbackId = toTrimmedString(entry?.equipmentId || entry?.id);
  if (fallbackId && !isUuidLike(fallbackId)) {
    return fallbackId;
  }
  return null;
}

function looksLikeEquipmentIdentifier(value) {
  const normalized = toTrimmedString(value);
  if (!normalized) return true;
  if (isUuidLike(normalized)) return true;
  return /^\d{6,}$/.test(normalized);
}

function resolveEquipmentModelLabel(entry, index, { clientId = null, clientDevices = null } = {}) {
  const fromEntry = toTrimmedString(entry?.model || entry?.name || entry?.label);
  if (fromEntry && !looksLikeEquipmentIdentifier(fromEntry)) return fromEntry;

  const resolvedDevice = resolveDeviceByEquipmentEntry(entry, { clientId, clientDevices });
  const attributes = resolvedDevice?.attributes && typeof resolvedDevice.attributes === "object" ? resolvedDevice.attributes : {};
  const fromDevice = toTrimmedString(
    attributes.modelName ||
      attributes.model ||
      attributes.equipmentModel ||
      attributes.deviceModel ||
      resolvedDevice?.model,
  );
  if (fromDevice && !looksLikeEquipmentIdentifier(fromDevice)) return fromDevice;

  const modelId = toTrimmedString(attributes.modelId || resolvedDevice?.modelId);
  if (modelId) {
    const modelRecord = getModelById(modelId);
    const modelName = toTrimmedString(modelRecord?.name);
    if (modelName && !looksLikeEquipmentIdentifier(modelName)) {
      return modelName;
    }
  }

  const fromDeviceName = toTrimmedString(resolvedDevice?.name);
  if (fromDeviceName && !looksLikeEquipmentIdentifier(fromDeviceName)) return fromDeviceName;

  if (fromEntry) return fromEntry;

  return `Equipamento ${index + 1}`;
}

function buildEquipmentDisplayLabel(entry, index, { clientId = null, clientDevices = null } = {}) {
  const modelLabel = resolveEquipmentModelLabel(entry, index, { clientId, clientDevices });
  const codeLabel = resolveRegisteredCodeFromEquipmentEntry(entry, { clientId, clientDevices });
  if (modelLabel && codeLabel) {
    if (normalizeComparableText(modelLabel) === normalizeComparableText(codeLabel)) {
      return codeLabel;
    }
    return `${modelLabel} ${codeLabel}`;
  }
  if (codeLabel) return codeLabel;
  if (modelLabel) return `${modelLabel} Código não cadastrado`;
  return `Equipamento ${index + 1} Código não cadastrado`;
}

function sanitizeEquipmentTextValue(value) {
  if (!value) return null;
  const lines = String(value)
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .map((line) => (isUuidLike(line) ? "Código não cadastrado" : line));
  return lines.length ? lines.join("\n") : null;
}

function isInstallationServiceType(type) {
  const normalized = normalizeComparableText(type);
  return normalized.includes("instalacao");
}

function normalizeKitEquipmentIds(value) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );
}

function normalizeKitEquipmentLinks(value, fallbackEquipmentIds = [], { fallbackTimestamp = null } = {}) {
  const list = Array.isArray(value) ? value : [];
  const defaultTimestamp = fallbackTimestamp || new Date().toISOString();
  const normalized = new Map();

  list.forEach((entry) => {
    if (!entry) return;
    const source = typeof entry === "object" ? entry : { equipmentId: entry };
    const equipmentId = String(source.equipmentId || source.deviceId || source.id || "").trim();
    if (!equipmentId) return;
    const observationRaw = source.observation ?? source.note ?? source.notes ?? null;
    const observation =
      observationRaw === null || observationRaw === undefined ? null : String(observationRaw).trim() || null;
    const linkedAt = source.linkedAt || source.createdAt || defaultTimestamp;
    normalized.set(equipmentId, {
      equipmentId,
      linkedAt,
      observation,
      note: observation,
      createdAt: source.createdAt || linkedAt || defaultTimestamp,
      updatedAt: source.updatedAt || linkedAt || defaultTimestamp,
    });
  });

  normalizeKitEquipmentIds(fallbackEquipmentIds).forEach((equipmentId) => {
    if (normalized.has(equipmentId)) return;
    normalized.set(equipmentId, {
      equipmentId,
      linkedAt: defaultTimestamp,
      observation: null,
      note: null,
      createdAt: defaultTimestamp,
      updatedAt: defaultTimestamp,
    });
  });

  return Array.from(normalized.values());
}

function normalizeClientKits(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const createdAt = item.createdAt || new Date().toISOString();
      const baseEquipmentIds = normalizeKitEquipmentIds(item.equipmentIds);
      const equipmentLinks = normalizeKitEquipmentLinks(item.equipmentLinks, baseEquipmentIds, {
        fallbackTimestamp: createdAt,
      });
      return {
        ...item,
        id: item.id ? String(item.id) : null,
        clientId: item.clientId ? String(item.clientId) : null,
        equipmentIds: normalizeKitEquipmentIds(equipmentLinks.map((entry) => entry.equipmentId)),
        equipmentLinks,
        createdAt,
        updatedAt: item.updatedAt || createdAt,
      };
    })
    .filter(Boolean);
}

function resolveEquipmentIdsFromServiceOrder(equipmentsData) {
  if (!Array.isArray(equipmentsData)) return [];
  return normalizeKitEquipmentIds(
    equipmentsData.flatMap((equipment) => [
      equipment?.equipmentId || null,
      equipment?.id || null,
      equipment?.uniqueId || null,
      equipment?.displayId || null,
      equipment?.imei || null,
      equipment?.serial || null,
    ]),
  );
}

function normalizeEquipmentIdentifier(value) {
  const normalized = toTrimmedString(value);
  return normalized || null;
}

function collectEquipmentLookupCandidates(entry) {
  if (!entry || typeof entry !== "object") return [];
  return Array.from(
    new Set(
      [
        entry?.equipmentId,
        entry?.id,
        entry?.uniqueId,
        entry?.displayId,
        entry?.imei,
        entry?.serial,
        entry?.internalCode,
        entry?.deviceId,
      ]
        .map((value) => normalizeEquipmentIdentifier(value))
        .filter(Boolean),
    ),
  );
}

function findDeviceByInternalCode(clientDevices, candidate) {
  const normalizedCandidate = normalizeEquipmentIdentifier(candidate);
  if (!normalizedCandidate) return null;
  const scopedDevices = Array.isArray(clientDevices) ? clientDevices : [];
  return (
    scopedDevices.find((device) => {
      const attrs = device?.attributes && typeof device.attributes === "object" ? device.attributes : {};
      const internalCode = normalizeEquipmentIdentifier(attrs.internalCode || attrs.codigoInterno || attrs.code);
      return internalCode && internalCode.toLowerCase() === normalizedCandidate.toLowerCase();
    }) || null
  );
}

function resolveDeviceByEquipmentEntry(entry, { clientId = null, clientDevices = null } = {}) {
  const candidates = collectEquipmentLookupCandidates(entry);
  if (!candidates.length) return null;

  for (const candidate of candidates) {
    const byId = getDeviceById(candidate);
    if (byId) {
      if (!clientId || String(byId.clientId || "") === String(clientId)) return byId;
    }

    const byUnique = findDeviceByUniqueId(candidate);
    if (byUnique) {
      if (!clientId || String(byUnique.clientId || "") === String(clientId)) return byUnique;
    }
  }

  if (Array.isArray(clientDevices) && clientDevices.length) {
    for (const candidate of candidates) {
      const byInternalCode = findDeviceByInternalCode(clientDevices, candidate);
      if (byInternalCode) return byInternalCode;
    }
  }

  // Retorna um match fora do client, se existir, para diagnóstico de CLIENT_MISMATCH.
  for (const candidate of candidates) {
    const byId = getDeviceById(candidate);
    if (byId) return byId;
    const byUnique = findDeviceByUniqueId(candidate);
    if (byUnique) return byUnique;
  }

  return null;
}

function resolveCandidateKitForEquipments(kits, equipmentIds) {
  if (!Array.isArray(kits) || !kits.length || !equipmentIds.length) return null;
  const requiredIds = new Set(equipmentIds.map(String));
  const fullMatches = kits.filter((kit) => {
    const kitIds = new Set(normalizeKitEquipmentIds(kit.equipmentIds).map(String));
    if (!kitIds.size) return false;
    return Array.from(requiredIds).every((equipmentId) => kitIds.has(equipmentId));
  });
  if (!fullMatches.length) return null;
  if (fullMatches.length === 1) return fullMatches[0];
  const exactMatches = fullMatches.filter((kit) => {
    const kitIds = normalizeKitEquipmentIds(kit.equipmentIds);
    return kitIds.length === requiredIds.size;
  });
  if (exactMatches.length === 1) return exactMatches[0];
  return null;
}

function autoLinkEquipmentsToVehicle({ clientId, vehicleId, equipmentsData }) {
  if (!vehicleId || !Array.isArray(equipmentsData) || equipmentsData.length === 0) {
    return { linked: 0 };
  }

  const vehicle = getVehicleById(vehicleId);
  if (!vehicle || String(vehicle.clientId) !== String(clientId)) {
    return { linked: 0 };
  }

  let linked = 0;
  const scopedDevices = clientId ? listDevices({ clientId }) : [];
  equipmentsData.forEach((equipment) => {
    const device = resolveDeviceByEquipmentEntry(equipment, {
      clientId,
      clientDevices: scopedDevices,
    });
    if (!device || String(device.clientId) !== String(clientId)) return;
    if (String(device.vehicleId || "") === String(vehicleId)) return;
    updateDevice(device.id, {
      vehicleId,
      equipmentStatus: DEFAULT_EQUIPMENT_STATUS_LINKED,
    });
    linked += 1;
  });

  return { linked };
}

async function autoLinkKitToVehicleFromServiceOrder({ clientId, vehicleId, equipmentsData }) {
  try {
    if (!clientId || !vehicleId || !Array.isArray(equipmentsData) || equipmentsData.length === 0) {
      return { linked: 0 };
    }

    const equipmentIds = resolveEquipmentIdsFromServiceOrder(equipmentsData);
    if (!equipmentIds.length) {
      return { linked: 0 };
    }

    const client = await getClientById(clientId).catch(() => null);
    if (!client) {
      return { linked: 0 };
    }
    const attributes = client.attributes && typeof client.attributes === "object" ? client.attributes : {};
    const kits = normalizeClientKits(attributes.kits);
    if (!kits.length) {
      return { linked: 0 };
    }

    const matchedKit = resolveCandidateKitForEquipments(kits, equipmentIds);
    if (!matchedKit?.id) {
      return { linked: 0 };
    }

    const now = new Date().toISOString();
    const nextKits = kits.map((kit) => {
      if (String(kit.id) !== String(matchedKit.id)) return kit;
      const nextLinks = normalizeKitEquipmentLinks(kit.equipmentLinks, kit.equipmentIds, {
        fallbackTimestamp: kit.createdAt || now,
      }).map((entry) => {
        if (!equipmentIds.includes(String(entry.equipmentId))) return entry;
        return {
          ...entry,
          linkedAt: entry.linkedAt || now,
          updatedAt: now,
        };
      });
      return {
        ...kit,
        equipmentIds: normalizeKitEquipmentIds(nextLinks.map((entry) => entry.equipmentId)),
        equipmentLinks: nextLinks,
        lastLinkedVehicleId: String(vehicleId),
        lastLinkedAt: now,
        updatedAt: now,
      };
    });

    await updateClient(clientId, {
      attributes: {
        ...attributes,
        kits: nextKits,
      },
    });

    return { linked: 1, kitId: String(matchedKit.id) };
  } catch (error) {
    console.warn("[service-orders] falha ao vincular kit automaticamente", {
      clientId,
      vehicleId,
      message: error?.message || error,
    });
    return { linked: 0 };
  }
}

function resolveEquipmentLabel(entry, index, { clientId = null, clientDevices = null } = {}) {
  return buildEquipmentDisplayLabel(entry, index, { clientId, clientDevices });
}

function buildEquipmentBindingSnapshot({ clientId, vehicleId, equipmentsData, clientDevices = null }) {
  const expectedVehicleId = toTrimmedString(vehicleId);
  const list = Array.isArray(equipmentsData) ? equipmentsData : [];
  const scopedDevices = Array.isArray(clientDevices)
    ? clientDevices
    : clientId
      ? listDevices({ clientId })
      : [];
  const items = list.map((entry, index) => {
    const equipmentId = toTrimmedString(entry?.equipmentId || entry?.id || entry?.uniqueId || entry?.displayId);
    const label = resolveEquipmentLabel(entry, index, { clientId, clientDevices: scopedDevices });
    if (!equipmentId) {
      return {
        equipmentId: null,
        label,
        status: "MISSING_IDENTIFIER",
        linked: false,
        linkedVehicleId: null,
        error: "Equipamento sem identificador para vínculo.",
      };
    }

    const device = resolveDeviceByEquipmentEntry(entry, {
      clientId,
      clientDevices: scopedDevices,
    });
    if (!device) {
      return {
        equipmentId,
        label,
        status: "NOT_FOUND",
        linked: false,
        linkedVehicleId: null,
        error: `Equipamento ${equipmentId} não encontrado.`,
      };
    }
    if (clientId && String(device.clientId) !== String(clientId)) {
      return {
        equipmentId,
        label,
        status: "CLIENT_MISMATCH",
        linked: false,
        linkedVehicleId: toTrimmedString(device.vehicleId),
        error: `Equipamento ${equipmentId} não pertence ao cliente da OS.`,
      };
    }

    const linkedVehicleId = toTrimmedString(device.vehicleId);
    const linked = Boolean(expectedVehicleId && linkedVehicleId && String(linkedVehicleId) === String(expectedVehicleId));
    return {
      equipmentId,
      label,
      status: linked ? "LINKED" : "NOT_LINKED",
      linked,
      linkedVehicleId: linkedVehicleId || null,
      error: linked ? null : `Equipamento ${equipmentId} não está vinculado ao veículo da OS.`,
    };
  });

  const linkedCount = items.filter((entry) => entry.linked).length;
  const unresolved = items.filter((entry) => !entry.linked);
  return {
    vehicleId: expectedVehicleId || null,
    total: items.length,
    linkedCount,
    unresolvedCount: unresolved.length,
    items,
  };
}

function attachEquipmentBindingSummaryToServiceOrder(item, { clientDevices = null } = {}) {
  if (!item || typeof item !== "object") return item;
  const list = Array.isArray(item.equipmentsData) ? item.equipmentsData : [];
  const scopedDevices = Array.isArray(clientDevices)
    ? clientDevices
    : item?.clientId
      ? listDevices({ clientId: item.clientId })
      : [];
  const snapshot = buildEquipmentBindingSnapshot({
    clientId: item.clientId,
    vehicleId: item.vehicleId || item?.vehicle?.id || null,
    equipmentsData: list,
    clientDevices: scopedDevices,
  });

  const enrichedEquipmentsData = list.map((entry, index) => {
    const binding = snapshot.items[index] || null;
    const equipmentCode = resolveRegisteredCodeFromEquipmentEntry(entry, {
      clientId: item.clientId,
      clientDevices: scopedDevices,
    });
    const equipmentDisplay = buildEquipmentDisplayLabel(entry, index, {
      clientId: item.clientId,
      clientDevices: scopedDevices,
    });
    const nextEntry = {
      ...entry,
      displayId: equipmentCode || null,
      equipmentCode: equipmentCode || null,
      equipmentDisplay,
    };
    if (!binding) return nextEntry;
    return {
      ...nextEntry,
      bindingStatus: binding.status,
      bindingLinked: Boolean(binding.linked),
      linkedVehicleId: binding.linkedVehicleId || null,
      bindingError: binding.error || null,
    };
  });

  const equipmentDisplay = enrichedEquipmentsData
    .map((entry) => toTrimmedString(entry?.equipmentDisplay))
    .filter(Boolean);
  const resolvedEquipmentsText = equipmentDisplay.length
    ? equipmentDisplay.join("\n")
    : sanitizeEquipmentTextValue(item?.equipmentsText);

  return {
    ...item,
    equipmentsData: enrichedEquipmentsData,
    equipmentsText: resolvedEquipmentsText,
    equipmentDisplay,
    equipmentBindingSummary: snapshot,
  };
}

async function ensureEquipmentBindingForCompletion({ clientId, vehicleId, equipmentsData }) {
  if (!vehicleId) {
    return {
      ok: false,
      code: "VEHICLE_REQUIRED",
      message: "Não é possível concluir a OS sem veículo vinculado.",
      details: [{ reason: "VEHICLE_REQUIRED" }],
    };
  }

  const initialSnapshot = buildEquipmentBindingSnapshot({ clientId, vehicleId, equipmentsData });
  if (!initialSnapshot.total) {
    return {
      ok: false,
      code: "EQUIPMENT_REQUIRED",
      message: "Não é possível concluir a OS sem equipamentos.",
      details: [{ reason: "EQUIPMENT_REQUIRED" }],
    };
  }

  const missingIdentifierItems = initialSnapshot.items.filter((entry) => entry.status === "MISSING_IDENTIFIER");
  if (missingIdentifierItems.length) {
    return {
      ok: false,
      code: "EQUIPMENT_ID_REQUIRED",
      message: "Existem equipamentos sem identificador para vínculo.",
      details: missingIdentifierItems.map((entry) => ({
        equipmentId: entry.equipmentId,
        label: entry.label,
        status: entry.status,
        message: entry.error,
      })),
    };
  }

  if (initialSnapshot.unresolvedCount === 0) {
    return {
      ok: true,
      snapshot: initialSnapshot,
      autoLinked: 0,
      kitLinked: 0,
      linkedKitId: null,
    };
  }

  const autoLinked = autoLinkEquipmentsToVehicle({ clientId, vehicleId, equipmentsData });
  const autoKitLink = await autoLinkKitToVehicleFromServiceOrder({ clientId, vehicleId, equipmentsData });
  const finalSnapshot = buildEquipmentBindingSnapshot({ clientId, vehicleId, equipmentsData });
  const unresolved = finalSnapshot.items.filter((entry) => !entry.linked);

  if (unresolved.length) {
    return {
      ok: false,
      code: "EQUIPMENT_BINDING_FAILED",
      message: "Não foi possível vincular todos os equipamentos ao veículo da OS.",
      details: unresolved.map((entry) => ({
        equipmentId: entry.equipmentId,
        label: entry.label,
        status: entry.status,
        linkedVehicleId: entry.linkedVehicleId,
        message: entry.error,
      })),
      autoLinked: autoLinked.linked || 0,
      kitLinked: autoKitLink.linked || 0,
      linkedKitId: autoKitLink.kitId || null,
      snapshot: finalSnapshot,
    };
  }

  return {
    ok: true,
    snapshot: finalSnapshot,
    autoLinked: autoLinked.linked || 0,
    kitLinked: autoKitLink.linked || 0,
    linkedKitId: autoKitLink.kitId || null,
  };
}

function normalizeEquipmentsData(value) {
  if (!value) return null;
  let list = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }
  if (!Array.isArray(list)) return null;

  const normalized = list
    .map((item) => {
      const equipmentId = item?.equipmentId || item?.id || null;
      const uniqueId = item?.uniqueId || item?.imei || item?.serial || null;
      const explicitDisplayId =
        toTrimmedString(item?.displayId || item?.equipmentCode || item?.code || item?.internalCode) || null;
      const nonUuidUniqueId = toTrimmedString(uniqueId);
      const nonUuidEquipmentId = toTrimmedString(equipmentId);
      const displayId =
        (nonUuidUniqueId && !isUuidLike(nonUuidUniqueId) ? nonUuidUniqueId : null) ||
        (explicitDisplayId && !isUuidLike(explicitDisplayId) ? explicitDisplayId : null) ||
        (nonUuidEquipmentId && !isUuidLike(nonUuidEquipmentId) ? nonUuidEquipmentId : null) ||
        null;
      const startPhotos = normalizeMediaList([
        item?.startPhotos,
        item?.photosBefore,
        item?.photos?.before,
        item?.startPhoto,
        item?.beforePhoto,
        item?.photo,
        item?.initialPhoto,
      ]);
      const installationPhotos = normalizeMediaList([
        item?.installationPhotos,
        item?.photosAfter,
        item?.photos?.after,
        item?.installationPhoto,
        item?.installedPhoto,
        item?.afterPhoto,
      ]);
      const installationVideos = normalizeMediaList([
        item?.installationVideos,
        item?.videos?.installation,
        item?.videos,
        item?.installationVideo,
        item?.installedVideo,
        item?.video,
      ]);
      return {
        equipmentId,
        uniqueId: uniqueId || null,
        displayId,
        equipmentCode: displayId,
        model: item?.model || item?.name || item?.label || null,
        installLocation: item?.installLocation || item?.location || null,
        source: toTrimmedString(item?.source || item?.origin) || "PREVISTO_OS",
        planned: item?.planned === undefined ? true : Boolean(item?.planned),
        startPhotos,
        installationPhotos,
        installationVideos,
        startPhoto: startPhotos[0] || null,
        installationPhoto: installationPhotos[0] || null,
        installationVideo: installationVideos[0] || null,
      };
    })
    .filter((item) => item.equipmentId || item.displayId || item.model || item.installLocation);

  return normalized.length ? normalized : null;
}

function buildEquipmentsText(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const scopedDevices = listDevices({});
  return list
    .map((item, index) => {
      const label = buildEquipmentDisplayLabel(item, index, { clientDevices: scopedDevices });
      if (item.installLocation) {
        return `${label} • ${item.installLocation}`;
      }
      return label;
    })
    .join("\n");
}

function normalizeChecklistItems(value) {
  if (!value) return null;
  let list = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }
  if (!Array.isArray(list)) return null;
  const normalized = list
    .map((item) => {
      const before = item?.before ? String(item.before).toUpperCase() : null;
      const after = item?.after ? String(item.after).toUpperCase() : null;
      const beforePhotos = normalizeMediaList([
        item?.beforePhotos,
        item?.photosBefore,
        item?.beforePhoto,
        item?.beforeEvidence,
        item?.photoBefore,
      ]);
      const afterPhotos = normalizeMediaList([
        item?.afterPhotos,
        item?.photosAfter,
        item?.afterPhoto,
        item?.afterEvidence,
        item?.photoAfter,
      ]);
      return {
        item: item?.item ? String(item.item) : null,
        before: CHECKLIST_STATUS_VALUES.has(before) ? before : before ? String(item.before) : null,
        after: CHECKLIST_STATUS_VALUES.has(after) ? after : after ? String(item.after) : null,
        beforePhotos,
        afterPhotos,
        beforePhoto: beforePhotos[0] || null,
        afterPhoto: afterPhotos[0] || null,
      };
    })
    .filter((entry) => entry.item);

  return normalized.length ? normalized : null;
}

function normalizeStatusTimelineEntries(value) {
  const list = Array.isArray(value) ? value : [];
  const normalized = list
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const status = toTrimmedString(entry.status)?.toUpperCase() || null;
      const at = toTrimmedString(entry.at || entry.updatedAt || entry.createdAt);
      if (!status || !at) return null;
      return {
        status,
        at,
        source: toTrimmedString(entry.source) || null,
        by: toTrimmedString(entry.by || entry.userId || entry.userName) || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));

  const deduped = [];
  normalized.forEach((entry) => {
    const previous = deduped[deduped.length - 1];
    if (
      previous &&
      previous.status === entry.status &&
      previous.source === entry.source &&
      Math.abs((Date.parse(previous.at) || 0) - (Date.parse(entry.at) || 0)) <= 60_000
    ) {
      deduped[deduped.length - 1] = entry;
      return;
    }
    deduped.push(entry);
  });
  return deduped;
}

function appendStatusTimelineEntryToWorkflow(workflow, { status, at = null, source = null, by = null } = {}) {
  const normalizedStatus = toTrimmedString(status)?.toUpperCase();
  if (!normalizedStatus) return workflow;
  const entryAt = toTrimmedString(at) || new Date().toISOString();
  const nextEntry = {
    status: normalizedStatus,
    at: entryAt,
    source: toTrimmedString(source) || null,
    by: toTrimmedString(by) || null,
  };
  const currentList = normalizeStatusTimelineEntries(workflow?.statusTimeline);
  const latest = currentList[currentList.length - 1];
  if (
    latest &&
    latest.status === nextEntry.status &&
    Math.abs((Date.parse(latest.at) || 0) - (Date.parse(nextEntry.at) || 0)) <= 5 * 60_000
  ) {
    return {
      ...(workflow || {}),
      statusTimeline: currentList,
      updatedAt: new Date().toISOString(),
    };
  }
  return {
    ...(workflow || {}),
    statusTimeline: normalizeStatusTimelineEntries([...currentList, nextEntry]),
    updatedAt: new Date().toISOString(),
  };
}

function appendStatusTimelineToSignatures(signatures, { status, at = null, source = null, by = null } = {}) {
  const normalizedStatus = toTrimmedString(status)?.toUpperCase();
  if (!normalizedStatus) return signatures;
  const baseSignatures =
    signatures && typeof signatures === "object" && !Array.isArray(signatures) ? signatures : {};
  const workflow = ensureWorkflowObject(baseSignatures);
  return {
    ...baseSignatures,
    workflow: appendStatusTimelineEntryToWorkflow(workflow, {
      status: normalizedStatus,
      at,
      source,
      by,
    }),
  };
}

function appendFinalizationIdempotency(signatures, { key, actor = null, at = null } = {}) {
  const normalizedKey = toTrimmedString(key);
  if (!normalizedKey) return signatures;
  const baseSignatures =
    signatures && typeof signatures === "object" && !Array.isArray(signatures) ? signatures : {};
  const workflow = ensureWorkflowObject(baseSignatures);
  const nowIso = toTrimmedString(at) || new Date().toISOString();
  const current = Array.isArray(workflow?.finalizationOperations) ? workflow.finalizationOperations : [];
  if (current.some((entry) => toTrimmedString(entry?.key) === normalizedKey)) {
    return baseSignatures;
  }
  const next = [
    ...current,
    {
      key: normalizedKey,
      at: nowIso,
      actor: toTrimmedString(actor) || null,
      status: "CONCLUIDA",
    },
  ].slice(-30);
  return {
    ...baseSignatures,
    workflow: {
      ...(workflow || {}),
      finalizationOperations: next,
    },
  };
}

function normalizeSignatures(value) {
  if (value === undefined || value === null || value === "") {
    return { value: null, invalid: false };
  }
  let payload = value;
  if (typeof value === "string") {
    try {
      payload = JSON.parse(value);
    } catch (_error) {
      return { value: null, invalid: true };
    }
  }
  if (typeof payload !== "object" || Array.isArray(payload)) {
    return { value: null, invalid: true };
  }
  const technician = normalizeMediaReference(payload?.technician) || toTrimmedString(payload?.technician);
  const client = normalizeMediaReference(payload?.client) || toTrimmedString(payload?.client);
  const workflowRaw =
    payload?.workflow && typeof payload.workflow === "object" && !Array.isArray(payload.workflow)
      ? payload.workflow
      : {};
  const startAddressRaw = workflowRaw?.startAddress || {};
  const serviceAddressRaw = workflowRaw?.serviceAddress || {};
  const arrivalRaw = workflowRaw?.arrival || {};
  const reviewRaw = workflowRaw?.adminReview || {};
  const reviewItems = Array.isArray(reviewRaw?.items)
    ? reviewRaw.items
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const targetType = toTrimmedString(entry.targetType) || null;
          const targetId = toTrimmedString(entry.targetId) || targetType;
          const decision = toTrimmedString(entry.decision)?.toUpperCase() || ADMIN_DECISION_APPROVED;
          const reason = toTrimmedString(entry.reason);
          if (!targetType || !targetId) return null;
          return {
            targetType,
            targetId,
            decision: decision === ADMIN_DECISION_REWORK ? ADMIN_DECISION_REWORK : ADMIN_DECISION_APPROVED,
            reason: reason || null,
            updatedAt: toTrimmedString(entry.updatedAt) || new Date().toISOString(),
          };
        })
        .filter(Boolean)
    : [];
  const reworkRaw = workflowRaw?.rework || {};
  const reworkTasks = Array.isArray(reworkRaw?.tasks)
    ? reworkRaw.tasks
        .map((task) => {
          if (!task || typeof task !== "object") return null;
          const taskId = toTrimmedString(task.taskId || task.id) || randomUUID();
          const targetType = toTrimmedString(task.targetType) || "GERAL";
          const targetId = toTrimmedString(task.targetId) || targetType;
          const reason = toTrimmedString(task.reason);
          if (!reason) return null;
          const status = toTrimmedString(task.status)?.toUpperCase() === "DONE" ? "DONE" : "OPEN";
          return {
            taskId,
            targetType,
            targetId,
            reason,
            status,
            openedAt: toTrimmedString(task.openedAt) || toTrimmedString(task.createdAt) || new Date().toISOString(),
            resolvedAt: status === "DONE" ? toTrimmedString(task.resolvedAt) || new Date().toISOString() : null,
            resolutionNote: toTrimmedString(task.resolutionNote),
          };
        })
        .filter(Boolean)
    : [];
  const liveLocationRaw = workflowRaw?.liveLocation || {};
  const liveLocation = {
    lat: Number.isFinite(Number(liveLocationRaw?.lat)) ? Number(liveLocationRaw.lat) : null,
    lng: Number.isFinite(Number(liveLocationRaw?.lng)) ? Number(liveLocationRaw.lng) : null,
    accuracy: Number.isFinite(Number(liveLocationRaw?.accuracy)) ? Number(liveLocationRaw.accuracy) : null,
    speed: Number.isFinite(Number(liveLocationRaw?.speed)) ? Number(liveLocationRaw.speed) : null,
    heading: Number.isFinite(Number(liveLocationRaw?.heading)) ? Number(liveLocationRaw.heading) : null,
    capturedAt: toTrimmedString(liveLocationRaw?.capturedAt) || null,
  };
  const statusTimeline = normalizeStatusTimelineEntries(workflowRaw?.statusTimeline);

  const workflow = {
    startAddress: {
      lat: Number.isFinite(Number(startAddressRaw?.lat)) ? Number(startAddressRaw.lat) : null,
      lng: Number.isFinite(Number(startAddressRaw?.lng)) ? Number(startAddressRaw.lng) : null,
      formattedAddress: toTrimmedString(startAddressRaw?.formattedAddress || startAddressRaw?.address),
      confirmed: Boolean(startAddressRaw?.confirmed),
      capturedAt: toTrimmedString(startAddressRaw?.capturedAt) || null,
    },
    serviceAddress: {
      lat: Number.isFinite(Number(serviceAddressRaw?.lat)) ? Number(serviceAddressRaw.lat) : null,
      lng: Number.isFinite(Number(serviceAddressRaw?.lng)) ? Number(serviceAddressRaw.lng) : null,
      formattedAddress: toTrimmedString(serviceAddressRaw?.formattedAddress || serviceAddressRaw?.address),
      confirmed: Boolean(serviceAddressRaw?.confirmed),
      capturedAt: toTrimmedString(serviceAddressRaw?.capturedAt) || null,
    },
    installationVideo: normalizeMediaReference(workflowRaw?.installationVideo),
    installationObservation: toTrimmedString(workflowRaw?.installationObservation),
    arrival: {
      lat: Number.isFinite(Number(arrivalRaw?.lat)) ? Number(arrivalRaw.lat) : null,
      lng: Number.isFinite(Number(arrivalRaw?.lng)) ? Number(arrivalRaw.lng) : null,
      formattedAddress: toTrimmedString(arrivalRaw?.formattedAddress || arrivalRaw?.address),
      distanceMeters: Number.isFinite(Number(arrivalRaw?.distanceMeters)) ? Number(arrivalRaw.distanceMeters) : null,
      validated: Boolean(arrivalRaw?.validated),
      validatedAt: toTrimmedString(arrivalRaw?.validatedAt) || null,
      destinationAddress: toTrimmedString(arrivalRaw?.destinationAddress) || null,
    },
    adminReview: {
      cycle: Number.isFinite(Number(reviewRaw?.cycle)) ? Number(reviewRaw.cycle) : 0,
      reviewedBy: toTrimmedString(reviewRaw?.reviewedBy),
      reviewedAt: toTrimmedString(reviewRaw?.reviewedAt),
      decision: toTrimmedString(reviewRaw?.decision),
      items: reviewItems,
    },
    rework: {
      tasks: reworkTasks,
      lastRequestedAt: toTrimmedString(reworkRaw?.lastRequestedAt),
      requestedBy: toTrimmedString(reworkRaw?.requestedBy),
    },
    liveLocation,
    statusTimeline,
    updatedAt: new Date().toISOString(),
  };

  const hasLiveLocation = Number.isFinite(Number(liveLocation.lat)) && Number.isFinite(Number(liveLocation.lng));
  if (
    !technician &&
    !client &&
    !workflow.installationVideo &&
    !workflow.installationObservation &&
    !reviewItems.length &&
    !reworkTasks.length &&
    !hasLiveLocation &&
    !statusTimeline.length
  ) {
    return { value: null, invalid: false };
  }
  return { value: { technician, client, workflow }, invalid: false };
}

function mergeSignatures(existing, incoming) {
  if (!existing && !incoming) return null;
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  const patch = incoming && typeof incoming === "object" && !Array.isArray(incoming) ? incoming : {};
  const baseWorkflow = ensureWorkflowObject(base);
  const patchWorkflow = ensureWorkflowObject(patch);
  return {
    ...base,
    ...patch,
    workflow: {
      ...baseWorkflow,
      ...patchWorkflow,
      startAddress: { ...(baseWorkflow.startAddress || {}), ...(patchWorkflow.startAddress || {}) },
      serviceAddress: { ...(baseWorkflow.serviceAddress || {}), ...(patchWorkflow.serviceAddress || {}) },
      arrival: { ...(baseWorkflow.arrival || {}), ...(patchWorkflow.arrival || {}) },
      adminReview: { ...(baseWorkflow.adminReview || {}), ...(patchWorkflow.adminReview || {}) },
      rework: { ...(baseWorkflow.rework || {}), ...(patchWorkflow.rework || {}) },
      liveLocation: { ...(baseWorkflow.liveLocation || {}), ...(patchWorkflow.liveLocation || {}) },
      statusTimeline: normalizeStatusTimelineEntries([
        ...(Array.isArray(baseWorkflow.statusTimeline) ? baseWorkflow.statusTimeline : []),
        ...(Array.isArray(patchWorkflow.statusTimeline) ? patchWorkflow.statusTimeline : []),
      ]),
    },
  };
}

function buildMergedServiceOrder(existing, updateData) {
  return {
    ...existing,
    ...updateData,
    signatures: mergeSignatures(existing?.signatures, updateData?.signatures),
  };
}

function validateChecklistEntriesForInstallation(checklistItems) {
  const errors = [];
  const byKey = new Map();
  (Array.isArray(checklistItems) ? checklistItems : []).forEach((entry) => {
    const key = normalizeChecklistKey(entry?.item);
    if (!key) return;
    byKey.set(key, entry);
  });

  INSTALLATION_CHECKLIST_ITEMS.forEach((itemName) => {
    const key = normalizeChecklistKey(itemName);
    const entry = byKey.get(key);
    if (!entry) {
      errors.push(`Checklist obrigatório ausente: ${itemName}.`);
      return;
    }
    const before = toTrimmedString(entry.before)?.toUpperCase();
    const after = toTrimmedString(entry.after)?.toUpperCase();
    const beforePhoto = resolveFirstMedia(
      entry.beforePhoto,
      entry.beforePhotos,
      entry.photosBefore,
      entry.beforeEvidence,
      entry.photoBefore,
    );
    const afterPhoto = resolveFirstMedia(
      entry.afterPhoto,
      entry.afterPhotos,
      entry.photosAfter,
      entry.afterEvidence,
      entry.photoAfter,
    );
    if (!CHECKLIST_STATUS_VALUES.has(before)) {
      errors.push(`Checklist Antes sem status válido no item ${itemName}.`);
    }
    if (!beforePhoto) {
      errors.push(`Checklist Antes sem foto no item ${itemName}.`);
    }
    if (!CHECKLIST_STATUS_VALUES.has(after)) {
      errors.push(`Checklist Depois sem status válido no item ${itemName}.`);
    }
    if (!afterPhoto) {
      errors.push(`Checklist Depois sem foto no item ${itemName}.`);
    }
  });

  return errors;
}

function validateInstallationWorkflowForFinalization(serviceOrder) {
  const errors = [];
  const workflow = ensureWorkflowObject(serviceOrder?.signatures);
  const startAddress = workflow?.startAddress || {};
  const serviceAddress = workflow?.serviceAddress || {};
  const arrival = workflow?.arrival || {};
  const equipmentList = Array.isArray(serviceOrder?.equipmentsData) ? serviceOrder.equipmentsData : [];

  if (!Number.isFinite(Number(startAddress?.lat)) || !Number.isFinite(Number(startAddress?.lng))) {
    errors.push("Partida sem geolocalização válida.");
  }
  if (!toTrimmedString(startAddress?.formattedAddress)) {
    errors.push("Endereço de partida não capturado.");
  }
  if (!Number.isFinite(Number(serviceAddress?.lat)) || !Number.isFinite(Number(serviceAddress?.lng))) {
    errors.push("Endereço do serviço sem geolocalização válida.");
  }
  if (!toTrimmedString(serviceAddress?.formattedAddress)) {
    errors.push("Endereço do serviço não capturado.");
  }
  if (!serviceAddress?.confirmed) {
    errors.push("Endereço do serviço não confirmado.");
  }

  if (!equipmentList.length) {
    errors.push("Nenhum equipamento informado na OS.");
  }
  const scopedDevices = serviceOrder?.clientId ? listDevices({ clientId: serviceOrder.clientId }) : [];
  equipmentList.forEach((equipment, index) => {
    const label = buildEquipmentDisplayLabel(equipment, index, {
      clientId: serviceOrder?.clientId || null,
      clientDevices: scopedDevices,
    });
    const equipmentId = toTrimmedString(equipment?.equipmentId || equipment?.id);
    const startPhoto = resolveFirstMedia(
      equipment?.startPhoto,
      equipment?.startPhotos,
      equipment?.beforePhoto,
      equipment?.photosBefore,
      equipment?.photo,
    );
    const installPhoto = resolveFirstMedia(
      equipment?.installationPhoto,
      equipment?.installationPhotos,
      equipment?.installedPhoto,
      equipment?.photosAfter,
      equipment?.afterPhoto,
    );
    const installationVideo = resolveFirstMedia(
      equipment?.installationVideo,
      equipment?.installationVideos,
      equipment?.installedVideo,
      equipment?.videos?.installation,
      equipment?.video,
    );
    if (!equipmentId) errors.push(`Equipamento ${label} sem identificador para vínculo com o veículo.`);
    if (!startPhoto) errors.push(`Equipamento ${label} sem foto obrigatória inicial.`);
    if (!installPhoto) errors.push(`Equipamento ${label} sem foto obrigatória da instalação.`);
    if (!installationVideo) errors.push(`Equipamento ${label} sem vídeo obrigatório da instalação.`);
  });

  errors.push(...validateChecklistEntriesForInstallation(serviceOrder?.checklistItems));
  if (!toTrimmedString(workflow?.installationObservation) && !toTrimmedString(serviceOrder?.notes)) {
    errors.push("Observação do local de instalação é obrigatória.");
  }

  if (!normalizeMediaReference(serviceOrder?.signatures?.technician)) {
    errors.push("Assinatura do técnico é obrigatória.");
  }
  if (!normalizeMediaReference(serviceOrder?.signatures?.client)) {
    errors.push("Assinatura do cliente é obrigatória.");
  }

  if (!Number.isFinite(Number(serviceOrder?.km)) || Number(serviceOrder?.km) <= 0) {
    errors.push("KM total deve ser informado e maior que zero.");
  }

  if (!arrival?.validated) {
    errors.push("Chegada no último endereço ainda não validada por GPS.");
  }
  if (!Number.isFinite(Number(arrival?.lat)) || !Number.isFinite(Number(arrival?.lng))) {
    errors.push("Chegada sem coordenadas válidas.");
  }
  if (!toTrimmedString(arrival?.formattedAddress)) {
    errors.push("Chegada sem endereço de confirmação.");
  }
  if (!toTrimmedString(serviceOrder?.addressReturn)) {
    errors.push("Endereço Volta (3º endereço) não informado para validar chegada final.");
  }

  return errors;
}

function normalizeAdminReviewItems(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const targetType = toTrimmedString(entry.targetType) || null;
      const targetId = toTrimmedString(entry.targetId) || targetType;
      const decisionRaw = toTrimmedString(entry.decision)?.toUpperCase() || ADMIN_DECISION_APPROVED;
      const decision = decisionRaw === ADMIN_DECISION_REWORK ? ADMIN_DECISION_REWORK : ADMIN_DECISION_APPROVED;
      const reason = toTrimmedString(entry.reason);
      if (!targetType || !targetId) return null;
      if (decision === ADMIN_DECISION_REWORK && !reason) return null;
      return {
        targetType,
        targetId,
        decision,
        reason: reason || null,
      };
    })
    .filter(Boolean);
}

function applyReworkResolutionsToWorkflow(workflow, resolutions) {
  const resolutionList = Array.isArray(resolutions) ? resolutions : [];
  if (!resolutionList.length) return workflow;
  const mapByTaskId = new Map(
    resolutionList
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const taskId = toTrimmedString(entry.taskId);
        const resolutionNote = toTrimmedString(entry.resolutionNote || entry.note || entry.observation);
        if (!taskId || !resolutionNote) return null;
        return [taskId, { resolutionNote }];
      })
      .filter(Boolean),
  );
  const rework = workflow?.rework && typeof workflow.rework === "object" ? workflow.rework : {};
  const tasks = Array.isArray(rework.tasks) ? rework.tasks : [];
  if (!tasks.length) return workflow;
  const nextTasks = tasks.map((task) => {
    const taskId = toTrimmedString(task?.taskId || task?.id);
    if (!taskId || !mapByTaskId.has(taskId)) return task;
    return {
      ...task,
      status: "DONE",
      resolvedAt: new Date().toISOString(),
      resolutionNote: mapByTaskId.get(taskId).resolutionNote,
    };
  });
  return {
    ...workflow,
    rework: {
      ...rework,
      tasks: nextTasks,
    },
  };
}

function computeWarrantyEndDate(startDate, warrantyDays) {
  if (!startDate || warrantyDays === null || warrantyDays === undefined || warrantyDays === "") return null;
  const parsed = new Date(startDate);
  if (Number.isNaN(parsed.getTime())) return null;
  const days = Number(warrantyDays);
  if (!Number.isFinite(days) || days <= 0) return null;
  const end = new Date(parsed);
  end.setDate(end.getDate() + days);
  return end.toISOString().slice(0, 10);
}

function resolveMirrorVehicleScope(req) {
  const vehicleIds = getEffectiveVehicleIds(req);
  if (!req.mirrorContext) return null;
  if (!vehicleIds || vehicleIds.length === 0) return [];
  return vehicleIds.map(String);
}

function resolveTechnicianMatcher(req) {
  if (!req) return null;
  if (Object.prototype.hasOwnProperty.call(req, "_serviceOrderTechnicianMatcher")) {
    return req._serviceOrderTechnicianMatcher;
  }
  const matcher = createTechnicianNameMatcher(req?.user);
  req._serviceOrderTechnicianMatcher = matcher;
  return matcher;
}

function resolveServiceOrderTechnicianId(item) {
  return (
    toTrimmedString(item?.technicianId) ||
    toTrimmedString(item?.assignedTechnicianId) ||
    toTrimmedString(item?.technician?.id) ||
    toTrimmedString(item?.technician?.technicianId) ||
    toTrimmedString(item?.attributes?.technicianId) ||
    toTrimmedString(item?.metadata?.technicianId) ||
    null
  );
}

function canReadServiceOrderByTechnician(req, item) {
  const matcher = resolveTechnicianMatcher(req);
  if (!matcher) return true;
  const requesterTechnicianId = toTrimmedString(req?.user?.id);
  const itemTechnicianId = resolveServiceOrderTechnicianId(item);
  if (requesterTechnicianId && itemTechnicianId) {
    return requesterTechnicianId === itemTechnicianId;
  }
  return matcher(item?.technicianName);
}

function parseOperationTokens(operation) {
  return String(operation || "")
    .split(/[|;,]/)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function appendServiceOrderToken(operation, serviceOrderId) {
  const normalizedServiceOrderId = String(serviceOrderId || "").trim();
  if (!normalizedServiceOrderId) return operation || null;
  const tokens = parseOperationTokens(operation);
  if (tokens.some((token) => token.toLowerCase().startsWith("os:"))) {
    return tokens.join(";");
  }
  tokens.push(`os:${normalizedServiceOrderId}`);
  return tokens.join(";");
}

function normalizeExternalTaskRef(value) {
  const ref = String(value || "").trim();
  if (!ref) return { taskId: "", requestRef: "" };
  if (UUID_REGEX.test(ref)) {
    return { taskId: ref, requestRef: "" };
  }
  if (ref.toLowerCase().startsWith("request:")) {
    const requestId = ref.slice(8).trim();
    if (requestId && UUID_REGEX.test(requestId)) {
      return { taskId: "", requestRef: `request:${requestId}` };
    }
  }
  return { taskId: "", requestRef: "" };
}

async function linkTasksToServiceOrderByExternalRef({ clientId, serviceOrderId, externalRef }) {
  if (!isPrismaAvailable()) return { linked: 0 };
  const { taskId, requestRef } = normalizeExternalTaskRef(externalRef);
  if (!taskId && !requestRef) return { linked: 0 };

  let tasks = [];
  if (taskId) {
    tasks = await prisma.task.findMany({
      where: {
        id: taskId,
        ...(clientId ? { clientId: String(clientId) } : {}),
      },
      select: { id: true, operation: true, workOrderId: true },
    });
  } else if (requestRef) {
    tasks = await prisma.task.findMany({
      where: {
        ...(clientId ? { clientId: String(clientId) } : {}),
        category: "appointment",
        operation: { contains: requestRef, mode: "insensitive" },
      },
      select: { id: true, operation: true, workOrderId: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  }

  if (!tasks.length) return { linked: 0 };

  let linked = 0;
  for (const task of tasks) {
    const nextOperation = appendServiceOrderToken(task.operation, serviceOrderId);
    const nextWorkOrderId = String(serviceOrderId);
    if (String(task.workOrderId || "") === nextWorkOrderId && String(task.operation || "") === String(nextOperation || "")) {
      continue;
    }
    await prisma.task.update({
      where: { id: String(task.id) },
      data: {
        workOrderId: nextWorkOrderId,
        operation: nextOperation,
      },
    });
    linked += 1;
  }

  return { linked };
}

async function listServiceOrders({ where }) {
  if (serviceOrderRouteMocks.listServiceOrders) {
    return serviceOrderRouteMocks.listServiceOrders({ where });
  }
  return prisma.serviceOrder.findMany({
    where,
    include: {
      vehicle: { select: { id: true, plate: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function findServiceOrderById({ id, clientId, include }) {
  if (serviceOrderRouteMocks.findServiceOrderById) {
    return serviceOrderRouteMocks.findServiceOrderById({ id, clientId, include });
  }
  const where = {
    id: String(id),
    ...(clientId ? { clientId } : {}),
  };
  return prisma.serviceOrder.findFirst({
    where,
    include,
  });
}

async function findAccessibleServiceOrder(req, id, { include = undefined } = {}) {
  ensurePrisma();
  const isAdmin = req.user?.role === "admin";
  const isTechnician = req.user?.role === "technician";
  const clientId = isAdmin
    ? resolveClientId(req, req.query?.clientId, { required: false })
    : isTechnician
      ? null
      : resolveClientId(req, req.query?.clientId, { required: true });
  const item = await findServiceOrderById({
    id,
    clientId,
    include,
  });
  if (!item) {
    throw createError(404, "OS não encontrada");
  }
  const mirrorVehicleIds = resolveMirrorVehicleScope(req);
  if (Array.isArray(mirrorVehicleIds) && mirrorVehicleIds.length) {
    if (!item.vehicleId || !mirrorVehicleIds.includes(String(item.vehicleId))) {
      throw createError(404, "OS não encontrada");
    }
  }
  if (!canReadServiceOrderByTechnician(req, item)) {
    throw createError(404, "OS não encontrada");
  }
  return item;
}

function updateInstallationWarranty({ clientId, equipmentsData, serviceDate }) {
  if (!serviceDate || !Array.isArray(equipmentsData) || equipmentsData.length === 0) {
    return { updated: 0 };
  }
  const parsedDate = new Date(serviceDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return { updated: 0 };
  }
  const serviceDateStr = parsedDate.toISOString().slice(0, 10);
  let updated = 0;
  equipmentsData.forEach((equipment) => {
    const equipmentId = equipment?.equipmentId || equipment?.id;
    if (!equipmentId) return;
    const device = getDeviceById(equipmentId);
    if (!device || String(device.clientId) !== String(clientId)) return;
    const attrs = { ...(device.attributes || {}) };
    attrs.installationDate = serviceDateStr;
    attrs.warrantyOrigin = "installation";
    attrs.warrantyStartDate = serviceDateStr;
    const computedEnd = computeWarrantyEndDate(serviceDateStr, attrs.warrantyDays);
    if (computedEnd) {
      attrs.warrantyEndDate = computedEnd;
    }
    updateDevice(device.id, { attributes: attrs });
    updated += 1;
  });
  return { updated };
}

async function resolveVehicleIdByPlate({ clientId, vehiclePlate }) {
  if (!vehiclePlate) return null;
  const plate = String(vehiclePlate).trim();
  if (!plate) return null;
  const vehicle = await prisma.vehicle.findFirst({
    where: {
      clientId,
      plate: { equals: plate, mode: "insensitive" },
    },
    select: { id: true },
  });
  return vehicle?.id || null;
}

router.get(
  "/service-orders",
  authorizePermission({ menuKey: "fleet", pageKey: "services", subKey: "service-orders" }),
  async (req, res, next) => {
  try {
    if (!isPrismaAvailable() && !serviceOrderRouteMocks.listServiceOrders) {
      return res.json({ ok: true, items: [] });
    }
    const isTechnician = req.user?.role === "technician";
    const hasClientFilter = Boolean(req.query?.clientId);
    const clientId =
      req.user?.role === "admin"
        ? hasClientFilter
          ? resolveClientId(req, req.query?.clientId, { required: false })
          : null
        : isTechnician
          ? null
          : resolveClientId(req, req.query?.clientId, { required: true });
    const { status, vehicleId, q } = req.query || {};
    const search = String(q || "").trim();
    const requestedTechnicianId = toTrimmedString(req.query?.technicianId);
    const requesterTechnicianId = toTrimmedString(req.user?.id);
    if (
      isTechnician &&
      requestedTechnicianId &&
      requesterTechnicianId &&
      requestedTechnicianId !== requesterTechnicianId
    ) {
      return res.json({ ok: true, items: [] });
    }
    const mirrorVehicleIds = resolveMirrorVehicleScope(req);
    if (Array.isArray(mirrorVehicleIds) && mirrorVehicleIds.length === 0) {
      return res.json({ ok: true, items: [] });
    }
    if (vehicleId && Array.isArray(mirrorVehicleIds) && !mirrorVehicleIds.includes(String(vehicleId))) {
      return res.json({ ok: true, items: [] });
    }

    const where = {
      ...(clientId ? { clientId } : {}),
      ...(status ? { status: String(status) } : {}),
      ...(vehicleId ? { vehicleId: String(vehicleId) } : {}),
      ...(search
        ? {
            OR: [
              { osInternalId: { contains: search, mode: "insensitive" } },
              { clientName: { contains: search, mode: "insensitive" } },
              { technicianName: { contains: search, mode: "insensitive" } },
              { responsibleName: { contains: search, mode: "insensitive" } },
              { responsiblePhone: { contains: search, mode: "insensitive" } },
              { address: { contains: search, mode: "insensitive" } },
              { reason: { contains: search, mode: "insensitive" } },
              { notes: { contains: search, mode: "insensitive" } },
              { serial: { contains: search, mode: "insensitive" } },
              { externalRef: { contains: search, mode: "insensitive" } },
              { equipmentsText: { contains: search, mode: "insensitive" } },
              { vehicle: { plate: { contains: search, mode: "insensitive" } } },
              { vehicle: { name: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    if (Array.isArray(mirrorVehicleIds) && mirrorVehicleIds.length) {
      where.vehicleId = where.vehicleId
        ? String(where.vehicleId)
        : { in: mirrorVehicleIds.map(String) };
    }

    const requestedPage = Number.parseInt(req.query?.page, 10);
    const requestedPageSize = Number.parseInt(req.query?.pageSize ?? req.query?.limit, 10);
    const usePagination =
      Number.isFinite(requestedPage) || Number.isFinite(requestedPageSize);

    const items = await listServiceOrders({ where });
    const filteredItems =
      Array.isArray(mirrorVehicleIds) && mirrorVehicleIds.length
        ? items.filter((item) => item?.vehicleId && mirrorVehicleIds.includes(String(item.vehicleId)))
        : items;
    const scopedTechnicianId = isTechnician ? requesterTechnicianId : requestedTechnicianId;
    const technicianIdScopedItems = scopedTechnicianId
      ? filteredItems.filter((item) => {
          const itemTechnicianId = resolveServiceOrderTechnicianId(item);
          if (!itemTechnicianId) {
            return isTechnician ? canReadServiceOrderByTechnician(req, item) : true;
          }
          return itemTechnicianId === scopedTechnicianId;
        })
      : filteredItems;
    const technicianScopedItems = technicianIdScopedItems.filter((item) => canReadServiceOrderByTechnician(req, item));
    const totalItems = technicianScopedItems.length;
    const pageSize = usePagination
      ? Math.min(500, Math.max(1, requestedPageSize || 50))
      : Math.max(totalItems, 1);
    const totalPages = usePagination ? Math.max(1, Math.ceil(totalItems / pageSize)) : 1;
    const page = usePagination ? Math.min(Math.max(1, requestedPage || 1), totalPages) : 1;
    const startIndex = usePagination ? (page - 1) * pageSize : 0;
    const pageItems = usePagination
      ? technicianScopedItems.slice(startIndex, startIndex + pageSize)
      : technicianScopedItems;
    const clientDevicesCache = new Map();
    const resolveClientDevices = (clientIdValue) => {
      const key = String(clientIdValue || "").trim();
      if (!key) return [];
      if (!clientDevicesCache.has(key)) {
        clientDevicesCache.set(key, listDevices({ clientId: key }));
      }
      return clientDevicesCache.get(key) || [];
    };
    const enrichedItems = pageItems.map((item) => {
      const scopedDevices = item?.clientId ? resolveClientDevices(item.clientId) : [];
      return attachEquipmentBindingSummaryToServiceOrder(item, { clientDevices: scopedDevices });
    });

    return res.json({
      ok: true,
      items: enrichedItems,
      page,
      pageSize,
      totalItems,
      totalPages,
      pagination: { page, pageSize, totalItems, totalPages },
    });
  } catch (error) {
    if (error?.status && error.status < 500) {
      return res.status(error.status).json({
        ok: false,
        items: [],
        error: {
          message: error.message || "Requisição inválida.",
          code: error.code || "REQUEST_ERROR",
        },
      });
    }
    if (
      error?.status === 503 ||
      error?.statusCode === 503 ||
      error?.code === "P2021" ||
      error?.code === "P2022"
    ) {
      if (error?.code === "P2022") {
        console.error("[service-orders] falha ao listar OS (schema)", {
          code: error?.code,
          message: error?.message,
          meta: error?.meta,
          stack: error?.stack,
        });
      }
      return res.status(503).json(buildServiceUnavailablePayload());
    }
    return next(error);
  }
});

router.get(
  "/service-orders/:id",
  authorizePermission({ menuKey: "fleet", pageKey: "services", subKey: "service-orders" }),
  async (req, res, next) => {
  try {
    const item = await findAccessibleServiceOrder(req, req.params.id, {
      include: {
        vehicle: { select: { id: true, plate: true, name: true } },
      },
    });

    return res.json({ ok: true, item: attachEquipmentBindingSummaryToServiceOrder(item) });
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/service-orders/:id/media",
  authorizePermission({ menuKey: "fleet", pageKey: "services", subKey: "service-orders" }),
  async (req, res, next) => {
    try {
      const item = await findAccessibleServiceOrder(req, req.params.id, {
        include: { vehicle: { select: { id: true } } },
      });
      const typeFilter = toTrimmedString(req.query?.type)?.toLowerCase();
      const originFilter = toTrimmedString(req.query?.origin)?.toUpperCase();
      const phaseFilter = toTrimmedString(req.query?.phase)?.toUpperCase();

      const collected = collectServiceOrderMedia(item)
        .filter((entry) => {
          if (typeFilter && String(entry?.type || "").toLowerCase() !== typeFilter) return false;
          if (originFilter && String(entry?.origin || "").toUpperCase() !== originFilter) return false;
          if (phaseFilter && String(entry?.phase || "").toUpperCase() !== phaseFilter) return false;
          return true;
        })
        .map((entry, index) => ({
          ...entry,
          id: `midia-${index + 1}`,
        }));

      const paged = paginateMedia(collected, {
        page: req.query?.page,
        pageSize: req.query?.pageSize || req.query?.limit,
        cursor: req.query?.cursor,
      });

      return res.json({
        ok: true,
        osId: String(item.id),
        totalItems: paged.totalItems,
        page: paged.page,
        pageSize: paged.pageSize,
        totalPages: paged.totalPages,
        hasMore: paged.hasMore,
        nextCursor: paged.nextCursor,
        items: paged.items,
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/service-orders/:id/checklist-items/:checklistItemId/media",
  authorizePermission({ menuKey: "fleet", pageKey: "services", subKey: "service-orders" }),
  async (req, res, next) => {
    try {
      const item = await findAccessibleServiceOrder(req, req.params.id, {
        include: { vehicle: { select: { id: true } } },
      });
      const checklistItemId = toTrimmedString(req.params.checklistItemId);
      if (!checklistItemId) {
        throw createError(400, "checklistItemId é obrigatório");
      }
      const phaseFilter = toTrimmedString(req.query?.phase)?.toUpperCase();
      const media = collectServiceOrderMedia(item).filter((entry) => {
        if (String(entry?.targetType || "").toUpperCase() !== "CHECKLIST_ITEM") return false;
        if (String(entry?.targetId || "").toLowerCase() !== checklistItemId.toLowerCase()) return false;
        if (phaseFilter && String(entry?.phase || "").toUpperCase() !== phaseFilter) return false;
        return true;
      });
      return res.json({
        ok: true,
        osId: String(item.id),
        checklistItemId,
        phase: phaseFilter || null,
        totalItems: media.length,
        items: media.map((entry, index) => ({ ...entry, id: `midia-${index + 1}` })),
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/service-orders/:id/equipments/:equipmentId/media",
  authorizePermission({ menuKey: "fleet", pageKey: "services", subKey: "service-orders" }),
  async (req, res, next) => {
    try {
      const item = await findAccessibleServiceOrder(req, req.params.id, {
        include: { vehicle: { select: { id: true } } },
      });
      const equipmentId = toTrimmedString(req.params.equipmentId);
      if (!equipmentId) {
        throw createError(400, "equipmentId é obrigatório");
      }
      const media = collectServiceOrderMedia(item).filter((entry) => {
        if (String(entry?.targetType || "").toUpperCase() !== "EQUIPMENT") return false;
        return String(entry?.targetId || "").toLowerCase() === equipmentId.toLowerCase();
      });
      return res.json({
        ok: true,
        osId: String(item.id),
        equipmentId,
        totalItems: media.length,
        items: media.map((entry, index) => ({ ...entry, id: `midia-${index + 1}` })),
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/service-orders/:id/pdf",
  authorizePermission({ menuKey: "fleet", pageKey: "services", subKey: "service-orders" }),
  async (req, res, next) => {
    try {
      ensurePrisma();
      const isAdmin = req.user?.role === "admin";
      const isTechnician = req.user?.role === "technician";
      const clientId = isAdmin
        ? resolveClientId(req, req.query?.clientId, { required: false })
        : isTechnician
          ? null
          : resolveClientId(req, req.query?.clientId, { required: true });
      const item = await findServiceOrderById({
        id: req.params.id,
        clientId,
        include: {
          vehicle: {
            select: {
              id: true,
              plate: true,
              name: true,
              model: true,
              brand: true,
              chassis: true,
              renavam: true,
              color: true,
              modelYear: true,
              manufactureYear: true,
            },
          },
        },
      });

      if (!item) {
        throw createError(404, "OS não encontrada");
      }
      const mirrorVehicleIds = resolveMirrorVehicleScope(req);
      if (Array.isArray(mirrorVehicleIds) && mirrorVehicleIds.length) {
        if (!item.vehicleId || !mirrorVehicleIds.includes(String(item.vehicleId))) {
          throw createError(404, "OS não encontrada");
        }
      }
      if (!canReadServiceOrderByTechnician(req, item)) {
        throw createError(404, "OS não encontrada");
      }

      const enrichedItem = attachEquipmentBindingSummaryToServiceOrder(item);
      const exportedBy = req.user?.name || req.user?.email || req.user?.username || req.user?.id || "Usuário";
      const forceRefresh = String(req.query?.refresh || "").trim() === "1";

      const buffer = await generateServiceOrderPdf({
        item: enrichedItem,
        exportedBy,
        forceRefresh,
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="os-${item.osInternalId || item.id.slice(0, 8)}.pdf"`,
      );
      return res.send(buffer);
    } catch (error) {
      if (error?.code === "PLAYWRIGHT_MISSING" || error?.status === 503 || error?.statusCode === 503) {
        console.warn("[service-orders/pdf] serviço indisponível para exportação", {
          osId: req.params.id,
          code: error?.code || "SERVICE_UNAVAILABLE",
          message: error?.message,
        });
        return res.status(503).json(
          buildServiceUnavailablePayload("Não foi possível exportar o PDF agora. Tente novamente em instantes.", 30),
        );
      }
      console.error("[service-orders/pdf] falha ao exportar OS", {
        osId: req.params.id,
        code: error?.code || "SERVICE_ORDER_PDF_ERROR",
        message: error?.message || error,
      });
      return next(error);
    }
  },
);

router.post(
  "/service-orders",
  authorizePermission({ menuKey: "fleet", pageKey: "services", subKey: "service-orders", requireFull: true }),
  requireRole("manager", "admin"),
  async (req, res, next) => {
  try {
    ensurePrisma();
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    const body = req.body || {};
    const rawType = body.type ? String(body.type).trim() : "";
    const normalizedType = rawType.toLowerCase();
    const isWithdrawal = normalizedType.includes("retirada");
    const conditionValue = body.condition || body.conditionValue || body.conditionStatus || null;
    const conditionNote = body.conditionNote || body.conditionObservation || body.conditionObs || "";
    const conditionAtRaw = body.conditionAt || body.conditionDate || body.conditionTimestamp || null;
    const externalRef = body.externalRef ? String(body.externalRef) : null;

    if (externalRef) {
      const existing = await prisma.serviceOrder.findFirst({
        where: { clientId, externalRef },
        include: { vehicle: { select: { id: true, plate: true, name: true } } },
      });
      if (existing) {
        return res.status(200).json({ ok: true, item: existing, duplicated: true });
      }
    }

    const referenceDate = parseNullableDate(body.startAt) || new Date();
    const normalizedEquipments = normalizeEquipmentsData(body.equipmentsData || body.equipments);
    const normalizedChecklist = normalizeChecklistItems(body.checklistItems || body.checklist);
    const normalizedSignatures = normalizeSignatures(body.signatures);
    if (body.signatures !== undefined && normalizedSignatures.invalid) {
      throw createError(400, "Assinaturas inválidas ou malformadas");
    }
    const equipmentsText = body.equipmentsText
      ? String(body.equipmentsText)
      : buildEquipmentsText(normalizedEquipments);

    if (!body.vehicleId && !body.vehiclePlate) {
      throw createError(400, "Informe o veículo para a OS");
    }
    if (!body.technicianName && !body.technicianId) {
      throw createError(400, "Informe o técnico responsável");
    }
    if ((body.equipmentsData || body.equipments) && !normalizedEquipments) {
      throw createError(400, "Equipamentos inválidos ou malformados");
    }
    if ((body.checklistItems || body.checklist) && !normalizedChecklist) {
      throw createError(400, "Checklist inválido ou malformado");
    }
    if (isWithdrawal && !String(conditionValue || "").trim()) {
      throw createError(400, "Informe a condição para retirada");
    }

    const resolvedVehicleId = body.vehiclePlate
      ? await resolveVehicleIdByPlate({ clientId, vehiclePlate: body.vehiclePlate })
      : null;

    let created = null;
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        created = await prisma.$transaction(async (tx) => {
          const osInternalId = await generateOsInternalId(tx, { clientId, referenceDate });

          return tx.serviceOrder.create({
            data: {
              clientId,
              osInternalId,
              clientName: body.clientName ? String(body.clientName) : null,
              type: body.type ? String(body.type) : null,
              status: body.status ? String(body.status) : STATUS_FALLBACK,
              startAt: parseNullableDate(body.startAt),
              endAt: parseNullableDate(body.endAt),
              technicianName: body.technicianName ? String(body.technicianName) : null,
              address: body.address ? String(body.address) : null,
              addressStart: body.addressStart ? String(body.addressStart) : null,
              addressReturn: body.addressReturn ? String(body.addressReturn) : null,
              km: parseNullableNumber(body.km),
              reason: body.reason ? String(body.reason) : null,
              notes: body.notes ? String(body.notes) : null,
              responsibleName: body.responsibleName ? String(body.responsibleName) : null,
              responsiblePhone: body.responsiblePhone ? String(body.responsiblePhone) : null,
              clientValue: parseNullableNumber(body.clientValue),
              technicianValue: parseNullableNumber(body.technicianValue),
              serial: body.serial ? String(body.serial) : null,
              externalRef: body.externalRef ? String(body.externalRef) : null,
              equipmentsText,
              equipmentsData: normalizedEquipments,
              checklistItems: normalizedChecklist,
              signatures: normalizedSignatures.value,
              vehicleId: resolvedVehicleId || (body.vehicleId ? String(body.vehicleId) : null),
            },
            include: {
              vehicle: { select: { id: true, plate: true, name: true } },
            },
          });
        }, { isolationLevel: "Serializable" });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (error?.code === "P2002" && attempt < 2) {
          continue;
        }
        throw error;
      }
    }

    if (!created && lastError) {
      throw lastError;
    }

    const installationServiceDate = created?.startAt || created?.endAt || null;
    const installationUpdates = isInstallationServiceType(created?.type)
      ? updateInstallationWarranty({
          clientId,
          equipmentsData: created.equipmentsData,
          serviceDate: installationServiceDate,
        })
      : { updated: 0 };

    const shouldAutoLink = Boolean(
      created?.vehicleId && Array.isArray(created?.equipmentsData) && created.equipmentsData.length > 0,
    );
    const autoLinked = shouldAutoLink
      ? autoLinkEquipmentsToVehicle({
          clientId,
          vehicleId: created.vehicleId,
          equipmentsData: created.equipmentsData,
        })
      : { linked: 0 };
    const autoKitLink = shouldAutoLink
      ? await autoLinkKitToVehicleFromServiceOrder({
          clientId,
          vehicleId: created.vehicleId,
          equipmentsData: created.equipmentsData,
        })
      : { linked: 0, kitId: null };
    const taskLink = await linkTasksToServiceOrderByExternalRef({
      clientId,
      serviceOrderId: created.id,
      externalRef: created.externalRef,
    });
    const statusSync = await syncTaskStatusesFromServiceOrder(created, {
      actorId: req.user?.id,
      actorName: req.user?.name,
    }).catch((error) => {
      console.warn("[service-orders] falha ao sincronizar status após criação da OS", {
        serviceOrderId: created.id,
        message: error?.message || error,
      });
      return { appointmentUpdated: 0, requestUpdated: 0, failed: true };
    });

    if (isWithdrawal && created?.vehicleId) {
      const createdAt = parseNullableDate(conditionAtRaw) || new Date();
      const entry = {
        id: randomUUID(),
        condition: String(conditionValue || "").trim(),
        note: String(conditionNote || "").trim(),
        createdAt: createdAt.toISOString(),
        source: "service-order",
        serviceOrderId: created.id,
      };
      const vehicleRecord = getVehicleById(created.vehicleId);
      if (vehicleRecord) {
        const existing = Array.isArray(vehicleRecord.attributes?.conditions) ? vehicleRecord.attributes.conditions : [];
        const nextConditions = [entry, ...existing];
        updateVehicle(vehicleRecord.id, {
          attributes: { ...(vehicleRecord.attributes || {}), conditions: nextConditions },
        });
      } else if (isPrismaAvailable()) {
        try {
          const dbVehicle = await prisma.vehicle.findUnique({
            where: { id: String(created.vehicleId) },
            select: { attributes: true },
          });
          const existing = Array.isArray(dbVehicle?.attributes?.conditions) ? dbVehicle.attributes.conditions : [];
          const nextConditions = [entry, ...existing];
          await prisma.vehicle.update({
            where: { id: String(created.vehicleId) },
            data: { attributes: { ...(dbVehicle?.attributes || {}), conditions: nextConditions } },
          });
        } catch (conditionError) {
          console.warn("[service-orders] falha ao registrar condição de retirada", {
            message: conditionError?.message || conditionError,
            vehicleId: created.vehicleId,
            serviceOrderId: created.id,
          });
        }
      }
    }

    return res.status(201).json({
      ok: true,
      item: attachEquipmentBindingSummaryToServiceOrder(created),
      equipmentsLinked: autoLinked.linked,
      kitLinked: autoKitLink.linked,
      linkedKitId: autoKitLink.kitId || null,
      appointmentLinked: taskLink.linked,
      warrantyUpdated: installationUpdates.updated,
      statusSync,
    });
  } catch (error) {
    if (error?.status && error.status < 500) {
      return res.status(error.status).json({
        ok: false,
        error: {
          message: error.message || "Requisição inválida.",
          code: error.code || "REQUEST_ERROR",
        },
      });
    }
    if (error?.code === "P2021" || error?.code === "P2022") {
      console.error("[service-orders] falha ao criar OS (schema)", {
        code: error?.code,
        message: error?.message,
        meta: error?.meta,
      });
      return next(createError(503, "Falha ao criar OS. Atualize e tente novamente."));
    }
    return next(error);
  }
});

router.patch(
  "/service-orders/:id/technician-progress",
  authorizePermission({ menuKey: "fleet", pageKey: "services", subKey: "service-orders" }),
  requireRole("technician"),
  async (req, res, next) => {
  try {
    ensurePrisma();
    const body = req.body || {};
    const id = String(req.params.id);
    const clientId = null;

    const existing = await prisma.serviceOrder.findFirst({
      where: { id, ...(clientId ? { clientId } : {}) },
      include: { vehicle: { select: { id: true, plate: true, name: true } } },
    });
    if (!existing) {
      throw createError(404, "OS não encontrada");
    }
    if (!canReadServiceOrderByTechnician(req, existing)) {
      throw createError(404, "OS não encontrada");
    }

    const normalizedEquipments = normalizeEquipmentsData(body.equipmentsData || body.equipments);
    const normalizedChecklist = normalizeChecklistItems(body.checklistItems || body.checklist);
    const normalizedSignatures = normalizeSignatures(body.signatures);
    if ((body.equipmentsData || body.equipments) && !normalizedEquipments) {
      throw createError(400, "Equipamentos inválidos ou malformados");
    }
    if ((body.checklistItems || body.checklist) && !normalizedChecklist) {
      throw createError(400, "Checklist inválido ou malformado");
    }
    if (body.signatures !== undefined && normalizedSignatures.invalid) {
      throw createError(400, "Assinaturas inválidas ou malformadas");
    }

    const updateData = {};
    if (body.status !== undefined) updateData.status = String(body.status || existing.status || STATUS_FALLBACK);
    if (body.km !== undefined) updateData.km = parseNullableNumber(body.km);
    if (body.notes !== undefined) updateData.notes = body.notes ? String(body.notes) : null;
    if (body.addressStart !== undefined) updateData.addressStart = body.addressStart ? String(body.addressStart) : null;
    if (body.address !== undefined) updateData.address = body.address ? String(body.address) : null;
    if (body.addressReturn !== undefined) updateData.addressReturn = body.addressReturn ? String(body.addressReturn) : null;
    if (body.startAt !== undefined) updateData.startAt = parseNullableDate(body.startAt);
    if (body.endAt !== undefined) updateData.endAt = parseNullableDate(body.endAt);
    if (body.equipmentsData !== undefined || body.equipments !== undefined) {
      updateData.equipmentsData = normalizedEquipments;
      updateData.equipmentsText = body.equipmentsText
        ? String(body.equipmentsText)
        : normalizedEquipments
          ? buildEquipmentsText(normalizedEquipments)
          : null;
    } else if (body.equipmentsText !== undefined) {
      updateData.equipmentsText = body.equipmentsText ? String(body.equipmentsText) : null;
    }
    if (body.checklistItems !== undefined || body.checklist !== undefined) {
      updateData.checklistItems = normalizedChecklist;
    }
    const incomingSignatures = body.signatures !== undefined ? normalizedSignatures.value : null;
    if (body.signatures !== undefined) {
      updateData.signatures = mergeSignatures(existing.signatures, incomingSignatures);
    }
    if (body.reworkResolutions !== undefined) {
      const mergedSignatures = mergeSignatures(existing.signatures, updateData.signatures || incomingSignatures);
      const mergedWorkflow = ensureWorkflowObject(mergedSignatures);
      updateData.signatures = {
        ...(mergedSignatures || {}),
        workflow: applyReworkResolutionsToWorkflow(mergedWorkflow, body.reworkResolutions),
      };
    }
    if (body.status !== undefined && String(updateData.status || "") && String(updateData.status) !== String(existing.status || "")) {
      updateData.signatures = appendStatusTimelineToSignatures(updateData.signatures ?? existing.signatures, {
        status: updateData.status,
        source: "technician-progress",
        by: toTrimmedString(req.user?.id || req.user?.name) || "technician",
      });
    }

    const updated = await prisma.serviceOrder.update({
      where: { id },
      data: updateData,
      include: { vehicle: { select: { id: true, plate: true, name: true } } },
    });

    return res.json({ ok: true, item: attachEquipmentBindingSummaryToServiceOrder(updated) });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/service-orders/:id/finalization-request",
  authorizePermission({ menuKey: "fleet", pageKey: "services", subKey: "service-orders" }),
  requireRole("technician"),
  async (req, res, next) => {
    try {
      ensurePrisma();
      const body = req.body || {};
      const id = String(req.params.id);

      const existing = await prisma.serviceOrder.findFirst({
        where: { id },
        include: { vehicle: { select: { id: true, plate: true, name: true } } },
      });
      if (!existing) {
        throw createError(404, "OS não encontrada");
      }
      if (!canReadServiceOrderByTechnician(req, existing)) {
        throw createError(404, "OS não encontrada");
      }

      const normalizedEquipments = normalizeEquipmentsData(body.equipmentsData || body.equipments);
      const normalizedChecklist = normalizeChecklistItems(body.checklistItems || body.checklist);
      const normalizedSignatures = normalizeSignatures(body.signatures);
      if ((body.equipmentsData || body.equipments) && !normalizedEquipments) {
        throw createError(400, "Equipamentos inválidos ou malformados");
      }
      if ((body.checklistItems || body.checklist) && !normalizedChecklist) {
        throw createError(400, "Checklist inválido ou malformado");
      }
      if (body.signatures !== undefined && normalizedSignatures.invalid) {
        throw createError(400, "Assinaturas inválidas ou malformadas");
      }

      const updateData = {};
      if (body.km !== undefined) updateData.km = parseNullableNumber(body.km);
      if (body.notes !== undefined) updateData.notes = body.notes ? String(body.notes) : null;
      if (body.addressStart !== undefined) updateData.addressStart = body.addressStart ? String(body.addressStart) : null;
      if (body.address !== undefined) updateData.address = body.address ? String(body.address) : null;
      if (body.addressReturn !== undefined) updateData.addressReturn = body.addressReturn ? String(body.addressReturn) : null;
      if (body.startAt !== undefined) updateData.startAt = parseNullableDate(body.startAt);
      if (body.endAt !== undefined) updateData.endAt = parseNullableDate(body.endAt);
      if (body.equipmentsData !== undefined || body.equipments !== undefined) {
        updateData.equipmentsData = normalizedEquipments;
        updateData.equipmentsText = body.equipmentsText
          ? String(body.equipmentsText)
          : normalizedEquipments
            ? buildEquipmentsText(normalizedEquipments)
            : null;
      } else if (body.equipmentsText !== undefined) {
        updateData.equipmentsText = body.equipmentsText ? String(body.equipmentsText) : null;
      }
      if (body.checklistItems !== undefined || body.checklist !== undefined) {
        updateData.checklistItems = normalizedChecklist;
      }

      const mergedSignatures = mergeSignatures(existing.signatures, body.signatures !== undefined ? normalizedSignatures.value : null);
      const mergedWorkflow = ensureWorkflowObject(mergedSignatures);
      const nextWorkflow = body.reworkResolutions !== undefined
        ? applyReworkResolutionsToWorkflow(mergedWorkflow, body.reworkResolutions)
        : mergedWorkflow;
      updateData.signatures = {
        ...(mergedSignatures || {}),
        workflow: {
          ...nextWorkflow,
          finalizationRequestedAt: new Date().toISOString(),
          finalizationRequestedBy: toTrimmedString(req.user?.id || req.user?.name) || "technician",
        },
      };

      const candidate = buildMergedServiceOrder(existing, updateData);
      if (isInstallationServiceType(candidate?.type)) {
        const validationErrors = validateInstallationWorkflowForFinalization(candidate);
        if (validationErrors.length) {
          return res.status(400).json({
            ok: false,
            error: {
              code: "FINALIZATION_VALIDATION_FAILED",
              message: "A OS não pode ser finalizada sem cumprir todas as etapas obrigatórias.",
              details: validationErrors,
            },
          });
        }
      }

      const pendingReworkTasks = Array.isArray(candidate?.signatures?.workflow?.rework?.tasks)
        ? candidate.signatures.workflow.rework.tasks.filter((task) => String(task?.status || "OPEN").toUpperCase() !== "DONE")
        : [];
      if ((existing.status === STATUS_EM_RETRABALHO || existing.status === STATUS_REENVIADA_APROVACAO) && pendingReworkTasks.length) {
        return res.status(400).json({
          ok: false,
          error: {
            code: "REWORK_PENDING",
            message: "Existem itens de retrabalho pendentes.",
            details: pendingReworkTasks.map((task) => ({
              taskId: task.taskId,
              targetType: task.targetType,
              targetId: task.targetId,
              reason: task.reason,
            })),
          },
        });
      }

      updateData.status =
        existing.status === STATUS_EM_RETRABALHO || existing.status === STATUS_REENVIADA_APROVACAO
          ? STATUS_REENVIADA_APROVACAO
          : STATUS_PENDENTE_APROVACAO;
      if (!candidate.endAt) {
        updateData.endAt = new Date();
      }
      if (String(updateData.status || "") && String(updateData.status) !== String(existing.status || "")) {
        updateData.signatures = appendStatusTimelineToSignatures(updateData.signatures ?? existing.signatures, {
          status: updateData.status,
          source: "finalization-request",
          by: toTrimmedString(req.user?.id || req.user?.name) || "technician",
        });
      }

      const updated = await prisma.serviceOrder.update({
        where: { id },
        data: updateData,
        include: { vehicle: { select: { id: true, plate: true, name: true } } },
      });

      return res.json({ ok: true, item: attachEquipmentBindingSummaryToServiceOrder(updated) });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/service-orders/:id/admin-review",
  authorizePermission({ menuKey: "fleet", pageKey: "services", subKey: "service-orders", requireFull: true }),
  requireRole("manager", "admin"),
  async (req, res, next) => {
    try {
      ensurePrisma();
      const body = req.body || {};
      const id = String(req.params.id);
      const isAdmin = req.user?.role === "admin";
      const clientId = resolveClientId(req, req.body?.clientId, { required: !isAdmin });

      const existing = await prisma.serviceOrder.findFirst({
        where: { id, ...(clientId ? { clientId } : {}) },
        include: { vehicle: { select: { id: true, plate: true, name: true } } },
      });
      if (!existing) {
        throw createError(404, "OS não encontrada");
      }

      const decisionText = toTrimmedString(body.decision)?.toUpperCase();
      const isApproval = ["APPROVE", "APPROVED", "APROVAR", "APROVADA"].includes(decisionText || "");
      const isRework = ["REWORK", "REPROVAR", "REJEITAR", "REWORK_REQUIRED"].includes(decisionText || "");
      if (!isApproval && !isRework) {
        throw createError(400, "Decisão inválida. Use APPROVE ou REWORK.");
      }

      const reviewItems = normalizeAdminReviewItems(body.items);
      if (isRework && !reviewItems.some((entry) => entry.decision === ADMIN_DECISION_REWORK)) {
        throw createError(400, "Informe ao menos um item para retrabalho.");
      }

      const nowIso = new Date().toISOString();
      const baseSignatures = mergeSignatures(existing.signatures, null) || {};
      const baseWorkflow = ensureWorkflowObject(baseSignatures);
      const nextCycle = Number(baseWorkflow?.adminReview?.cycle || 0) + 1;
      const reviewDecision = isApproval ? ADMIN_DECISION_APPROVED : ADMIN_DECISION_REWORK;
      let nextStatus = isApproval ? STATUS_CONCLUIDA : STATUS_EM_RETRABALHO;
      let bindingResult = null;

      if (isApproval && isInstallationServiceType(existing?.type)) {
        bindingResult = await ensureEquipmentBindingForCompletion({
          clientId: existing.clientId,
          vehicleId: existing.vehicleId,
          equipmentsData: existing.equipmentsData,
        });
        if (!bindingResult.ok) {
          return res.status(409).json({
            ok: false,
            error: {
              code: bindingResult.code || "EQUIPMENT_BINDING_FAILED",
              message: bindingResult.message || "Falha ao vincular equipamentos no veículo.",
              details: bindingResult.details || [],
            },
          });
        }
      }

      const workflowPatch = {
        ...baseWorkflow,
        adminReview: {
          cycle: nextCycle,
          reviewedBy: toTrimmedString(req.user?.id || req.user?.name) || "admin",
          reviewedAt: nowIso,
          decision: reviewDecision,
          items: reviewItems,
        },
        updatedAt: nowIso,
      };

      if (isApproval) {
        workflowPatch.approvedAt = nowIso;
        workflowPatch.rework = {
          ...(baseWorkflow?.rework || {}),
          tasks: Array.isArray(baseWorkflow?.rework?.tasks)
            ? baseWorkflow.rework.tasks.map((task) => ({
                ...task,
                status: task?.status || "OPEN",
              }))
            : [],
        };
      } else {
        const reworkTasks = reviewItems
          .filter((entry) => entry.decision === ADMIN_DECISION_REWORK)
          .map((entry) => ({
            taskId: randomUUID(),
            targetType: entry.targetType,
            targetId: entry.targetId,
            reason: entry.reason,
            status: "OPEN",
            openedAt: nowIso,
            resolvedAt: null,
            resolutionNote: null,
          }));
        workflowPatch.rework = {
          tasks: reworkTasks,
          lastRequestedAt: nowIso,
          requestedBy: toTrimmedString(req.user?.id || req.user?.name) || "admin",
        };
      }

      const updated = await prisma.serviceOrder.update({
        where: { id },
        data: {
          status: nextStatus,
          signatures: appendStatusTimelineToSignatures({
            ...baseSignatures,
            workflow: workflowPatch,
          }, {
            status: nextStatus,
            at: nowIso,
            source: "admin-review",
            by: toTrimmedString(req.user?.id || req.user?.name) || "admin",
          }),
        },
        include: { vehicle: { select: { id: true, plate: true, name: true } } },
      });

      const statusSync = await syncTaskStatusesFromServiceOrder(updated, {
        actorId: req.user?.id,
        actorName: req.user?.name,
      }).catch((error) => {
        console.warn("[service-orders] falha ao sincronizar status após revisão admin", {
          serviceOrderId: updated.id,
          message: error?.message || error,
        });
        return { appointmentUpdated: 0, requestUpdated: 0, failed: true };
      });

      return res.json({
        ok: true,
        item: attachEquipmentBindingSummaryToServiceOrder(updated),
        equipmentsLinked: bindingResult?.autoLinked || 0,
        kitLinked: bindingResult?.kitLinked || 0,
        linkedKitId: bindingResult?.linkedKitId || null,
        statusSync,
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/service-orders/:id/finalize",
  authorizePermission({ menuKey: "fleet", pageKey: "services", subKey: "service-orders", requireFull: true }),
  requireRole("manager", "admin"),
  async (req, res, next) => {
    try {
      ensurePrisma();
      const id = String(req.params.id);
      const isAdmin = req.user?.role === "admin";
      const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: !isAdmin });
      const idempotencyKey = toTrimmedString(req.get("idempotency-key") || req.body?.idempotencyKey);

      const existing = await prisma.serviceOrder.findFirst({
        where: { id, ...(clientId ? { clientId } : {}) },
        include: { vehicle: { select: { id: true, plate: true, name: true } } },
      });
      if (!existing) {
        throw createError(404, "OS não encontrada");
      }

      const previousOperations = Array.isArray(existing?.signatures?.workflow?.finalizationOperations)
        ? existing.signatures.workflow.finalizationOperations
        : [];
      if (
        idempotencyKey &&
        previousOperations.some(
          (entry) =>
            toTrimmedString(entry?.key) === idempotencyKey &&
            normalizeStatusValue(entry?.status || "CONCLUIDA") === STATUS_CONCLUIDA,
        )
      ) {
        return res.json({
          ok: true,
          idempotent: true,
          item: attachEquipmentBindingSummaryToServiceOrder(existing),
          statusSync: { appointmentUpdated: 0, requestUpdated: 0 },
        });
      }

      if (normalizeStatusValue(existing.status) === STATUS_CONCLUIDA) {
        const item = attachEquipmentBindingSummaryToServiceOrder(existing);
        return res.json({
          ok: true,
          idempotent: Boolean(idempotencyKey),
          item,
          statusSync: { appointmentUpdated: 0, requestUpdated: 0 },
        });
      }

      if (isInstallationServiceType(existing?.type)) {
        const validationErrors = validateInstallationWorkflowForFinalization(existing);
        if (validationErrors.length) {
          return res.status(400).json({
            ok: false,
            error: {
              code: "FINALIZATION_VALIDATION_FAILED",
              message: "A OS não pode ser finalizada sem cumprir todas as etapas obrigatórias.",
              details: validationErrors,
            },
          });
        }
      }

      const bindingResult = await ensureEquipmentBindingForCompletion({
        clientId: existing.clientId,
        vehicleId: existing.vehicleId,
        equipmentsData: existing.equipmentsData,
      });
      if (!bindingResult.ok) {
        return res.status(409).json({
          ok: false,
          error: {
            code: bindingResult.code || "EQUIPMENT_BINDING_FAILED",
            message: bindingResult.message || "Falha ao vincular equipamentos no veículo.",
            details: bindingResult.details || [],
          },
        });
      }

      const actor = toTrimmedString(req.user?.id || req.user?.name) || "manager";
      const nowIso = new Date().toISOString();
      let nextSignatures = appendStatusTimelineToSignatures(existing.signatures, {
        status: STATUS_CONCLUIDA,
        at: nowIso,
        source: "manual-finalize",
        by: actor,
      });
      nextSignatures = appendFinalizationIdempotency(nextSignatures, {
        key: idempotencyKey,
        actor,
        at: nowIso,
      });

      const updated = await prisma.serviceOrder.update({
        where: { id },
        data: {
          status: STATUS_CONCLUIDA,
          endAt: existing.endAt || new Date(),
          signatures: nextSignatures,
        },
        include: { vehicle: { select: { id: true, plate: true, name: true } } },
      });

      const statusSync = await syncTaskStatusesFromServiceOrder(updated, {
        actorId: req.user?.id,
        actorName: req.user?.name,
      }).catch((error) => {
        console.warn("[service-orders] falha ao sincronizar status de tasks após finalização", {
          serviceOrderId: updated.id,
          message: error?.message || error,
        });
        return { appointmentUpdated: 0, requestUpdated: 0, failed: true };
      });

      return res.json({
        ok: true,
        idempotent: false,
        item: attachEquipmentBindingSummaryToServiceOrder(updated),
        equipmentsLinked: bindingResult?.autoLinked || 0,
        kitLinked: bindingResult?.kitLinked || 0,
        linkedKitId: bindingResult?.linkedKitId || null,
        statusSync,
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/service-orders/status/reconcile",
  authorizePermission({ menuKey: "fleet", pageKey: "services", subKey: "service-orders", requireFull: true }),
  requireRole("manager", "admin"),
  async (req, res, next) => {
    try {
      ensurePrisma();
      const isAdmin = req.user?.role === "admin";
      const scopeClientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: !isAdmin });
      const requestedServiceOrderId = toTrimmedString(req.body?.serviceOrderId || req.query?.serviceOrderId);
      const limitRaw = Number.parseInt(req.body?.limit ?? req.query?.limit ?? "200", 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(1000, Math.max(1, limitRaw)) : 200;

      const where = {
        ...(scopeClientId ? { clientId: scopeClientId } : {}),
        ...(requestedServiceOrderId
          ? { id: requestedServiceOrderId }
          : { status: { in: [STATUS_CONCLUIDA, "CANCELADA", STATUS_EM_RETRABALHO] } }),
      };

      const orders = await prisma.serviceOrder.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: limit,
      });

      let appointmentUpdated = 0;
      let requestUpdated = 0;
      const processed = [];
      for (const order of orders) {
        const sync = await syncTaskStatusesFromServiceOrder(order, {
          actorId: req.user?.id,
          actorName: req.user?.name,
        }).catch((error) => ({
          appointmentUpdated: 0,
          requestUpdated: 0,
          failed: true,
          message: error?.message || String(error),
        }));
        appointmentUpdated += Number(sync?.appointmentUpdated || 0);
        requestUpdated += Number(sync?.requestUpdated || 0);
        processed.push({
          serviceOrderId: String(order.id),
          status: order.status,
          appointmentUpdated: Number(sync?.appointmentUpdated || 0),
          requestUpdated: Number(sync?.requestUpdated || 0),
          failed: Boolean(sync?.failed),
          message: sync?.message || null,
        });
      }

      return res.json({
        ok: true,
        totalOrders: orders.length,
        appointmentUpdated,
        requestUpdated,
        processed,
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.patch(
  "/service-orders/:id",
  authorizePermission({ menuKey: "fleet", pageKey: "services", subKey: "service-orders", requireFull: true }),
  async (req, res, next) => {
  try {
    ensurePrisma();
    const isAdmin = req.user?.role === "admin";
    let clientId = resolveClientId(req, req.body?.clientId, { required: !isAdmin });
    const body = req.body || {};
    const id = String(req.params.id);

    const existing = await prisma.serviceOrder.findFirst({
      where: { id, ...(clientId ? { clientId } : {}) },
      select: {
        id: true,
        clientId: true,
        status: true,
        type: true,
        vehicleId: true,
        equipmentsData: true,
        signatures: true,
      },
    });

    if (!existing) {
      throw createError(404, "OS não encontrada");
    }
    if (!clientId) {
      clientId = existing?.clientId || null;
    }

    const resolvedVehicleId = body.vehiclePlate
      ? await resolveVehicleIdByPlate({ clientId, vehiclePlate: body.vehiclePlate })
      : null;
    const normalizedEquipments = normalizeEquipmentsData(body.equipmentsData || body.equipments);
    const normalizedChecklist = normalizeChecklistItems(body.checklistItems || body.checklist);
    const normalizedSignatures = normalizeSignatures(body.signatures);
    if ((body.equipmentsData || body.equipments) && !normalizedEquipments) {
      throw createError(400, "Equipamentos inválidos ou malformados");
    }
    if ((body.checklistItems || body.checklist) && !normalizedChecklist) {
      throw createError(400, "Checklist inválido ou malformado");
    }
    if (body.signatures !== undefined && normalizedSignatures.invalid) {
      throw createError(400, "Assinaturas inválidas ou malformadas");
    }
    const equipmentsText =
      body.equipmentsText !== undefined
        ? body.equipmentsText
          ? String(body.equipmentsText)
          : null
        : normalizedEquipments
          ? buildEquipmentsText(normalizedEquipments)
          : undefined;
    let nextSignatures;
    if (body.signatures !== undefined) {
      nextSignatures = mergeSignatures(existing.signatures, normalizedSignatures.value);
    } else if (body.reworkResolutions !== undefined) {
      nextSignatures = {
        ...(existing.signatures || {}),
        workflow: applyReworkResolutionsToWorkflow(
          ensureWorkflowObject(existing.signatures),
          body.reworkResolutions,
        ),
      };
    }
    if (body.status !== undefined && String(body.status || "").trim()) {
      const normalizedStatus = String(body.status).trim();
      if (normalizedStatus !== String(existing.status || "")) {
        nextSignatures = appendStatusTimelineToSignatures(nextSignatures ?? existing.signatures, {
          status: normalizedStatus,
          source: "manual-update",
          by: toTrimmedString(req.user?.id || req.user?.name) || "manager",
        });
      }
    }

    const nextType = body.type !== undefined ? (body.type ? String(body.type) : null) : existing.type;
    const nextVehicleId =
      body.vehicleId !== undefined || resolvedVehicleId
        ? resolvedVehicleId || (body.vehicleId ? String(body.vehicleId) : null)
        : existing.vehicleId;
    const nextEquipmentsData =
      body.equipmentsData !== undefined || body.equipments !== undefined ? normalizedEquipments : existing.equipmentsData;
    const nextStatus = body.status !== undefined ? String(body.status) : existing.status;
    const isCompletionTransition =
      String(nextStatus || "").trim().toUpperCase() === STATUS_CONCLUIDA && String(existing.status || "").trim().toUpperCase() !== STATUS_CONCLUIDA;
    let completionBindingResult = null;
    if (isCompletionTransition && isInstallationServiceType(nextType)) {
      completionBindingResult = await ensureEquipmentBindingForCompletion({
        clientId,
        vehicleId: nextVehicleId,
        equipmentsData: nextEquipmentsData,
      });
      if (!completionBindingResult.ok) {
        return res.status(409).json({
          ok: false,
          error: {
            code: completionBindingResult.code || "EQUIPMENT_BINDING_FAILED",
            message: completionBindingResult.message || "Falha ao vincular equipamentos no veículo.",
            details: completionBindingResult.details || [],
          },
        });
      }
    }

    const updated = await prisma.serviceOrder.update({
      where: { id },
      data: {
        osInternalId: body.osInternalId ? String(body.osInternalId) : undefined,
        clientName: body.clientName !== undefined ? (body.clientName ? String(body.clientName) : null) : undefined,
        type: body.type !== undefined ? (body.type ? String(body.type) : null) : undefined,
        status: body.status !== undefined ? String(body.status) : undefined,
        startAt: body.startAt !== undefined ? parseNullableDate(body.startAt) : undefined,
        endAt: body.endAt !== undefined ? parseNullableDate(body.endAt) : undefined,
        technicianName:
          body.technicianName !== undefined ? (body.technicianName ? String(body.technicianName) : null) : undefined,
        address: body.address !== undefined ? (body.address ? String(body.address) : null) : undefined,
        addressStart: body.addressStart !== undefined ? (body.addressStart ? String(body.addressStart) : null) : undefined,
        addressReturn:
          body.addressReturn !== undefined ? (body.addressReturn ? String(body.addressReturn) : null) : undefined,
        km: body.km !== undefined ? parseNullableNumber(body.km) : undefined,
        reason: body.reason !== undefined ? (body.reason ? String(body.reason) : null) : undefined,
        notes: body.notes !== undefined ? (body.notes ? String(body.notes) : null) : undefined,
        responsibleName:
          body.responsibleName !== undefined ? (body.responsibleName ? String(body.responsibleName) : null) : undefined,
        responsiblePhone:
          body.responsiblePhone !== undefined ? (body.responsiblePhone ? String(body.responsiblePhone) : null) : undefined,
        clientValue: body.clientValue !== undefined ? parseNullableNumber(body.clientValue) : undefined,
        technicianValue: body.technicianValue !== undefined ? parseNullableNumber(body.technicianValue) : undefined,
        serial: body.serial !== undefined ? (body.serial ? String(body.serial) : null) : undefined,
        externalRef: body.externalRef !== undefined ? (body.externalRef ? String(body.externalRef) : null) : undefined,
        equipmentsText,
        equipmentsData:
          body.equipmentsData !== undefined || body.equipments !== undefined ? normalizedEquipments : undefined,
        checklistItems:
          body.checklistItems !== undefined || body.checklist !== undefined ? normalizedChecklist : undefined,
        signatures: nextSignatures,
        vehicleId:
          body.vehicleId !== undefined || resolvedVehicleId
            ? resolvedVehicleId || (body.vehicleId ? String(body.vehicleId) : null)
            : undefined,
      },
      include: {
        vehicle: { select: { id: true, plate: true, name: true } },
      },
    });

    const installationServiceDate = updated?.startAt || updated?.endAt || null;
    const installationUpdates = isInstallationServiceType(updated?.type)
      ? updateInstallationWarranty({
          clientId,
          equipmentsData: updated.equipmentsData,
          serviceDate: installationServiceDate,
        })
      : { updated: 0 };
    const shouldAutoLinkNow = Boolean(
      !completionBindingResult &&
        updated?.vehicleId &&
        Array.isArray(updated?.equipmentsData) &&
        updated.equipmentsData.length > 0,
    );
    const autoLinked = shouldAutoLinkNow
      ? autoLinkEquipmentsToVehicle({
          clientId,
          vehicleId: updated.vehicleId,
          equipmentsData: updated.equipmentsData,
        })
      : { linked: 0 };
    const autoKitLink = shouldAutoLinkNow
      ? await autoLinkKitToVehicleFromServiceOrder({
          clientId,
          vehicleId: updated.vehicleId,
          equipmentsData: updated.equipmentsData,
        })
      : { linked: 0, kitId: null };
    const shouldSyncStatus =
      normalizeStatusValue(updated?.status) !== normalizeStatusValue(existing?.status) ||
      normalizeStatusValue(updated?.status) === STATUS_CONCLUIDA ||
      normalizeStatusValue(updated?.status) === "CANCELADA" ||
      normalizeStatusValue(updated?.status) === STATUS_EM_RETRABALHO;
    const statusSync = shouldSyncStatus
      ? await syncTaskStatusesFromServiceOrder(updated, {
          actorId: req.user?.id,
          actorName: req.user?.name,
        }).catch((error) => {
          console.warn("[service-orders] falha ao sincronizar status após atualização de OS", {
            serviceOrderId: updated.id,
            message: error?.message || error,
          });
          return { appointmentUpdated: 0, requestUpdated: 0, failed: true };
        })
      : { appointmentUpdated: 0, requestUpdated: 0 };

    return res.json({
      ok: true,
      item: attachEquipmentBindingSummaryToServiceOrder(updated),
      equipmentsLinked: completionBindingResult?.autoLinked || autoLinked.linked,
      kitLinked: completionBindingResult?.kitLinked || autoKitLink.linked,
      linkedKitId: completionBindingResult?.linkedKitId || autoKitLink.kitId || null,
      warrantyUpdated: installationUpdates.updated,
      statusSync,
    });
  } catch (error) {
    return next(error);
  }
});

router.delete(
  "/service-orders/:id",
  authorizePermission({ menuKey: "fleet", pageKey: "services", subKey: "service-orders", requireFull: true }),
  requireRole("manager", "admin"),
  async (req, res, next) => {
  try {
    ensurePrisma();
    const clientId = resolveClientId(req, req.query?.clientId, { required: true });
    const id = String(req.params.id);
    const existing = await prisma.serviceOrder.findFirst({
      where: { id, clientId },
      select: { id: true },
    });
    if (!existing) {
      throw createError(404, "OS não encontrada");
    }
    await prisma.serviceOrder.delete({ where: { id } });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
  },
);

export default router;
