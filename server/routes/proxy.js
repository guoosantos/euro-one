// server/routes/proxy.js
import express from "express";
import createError from "http-errors";
import { randomUUID } from "node:crypto";

import { authenticate, requireRole } from "../middleware/auth.js";
import { resolveClientId } from "../middleware/client.js";
import { getDeviceById, listDevices } from "../models/device.js";
import { listVehicles } from "../models/vehicle.js";
import { getClientById } from "../models/client.js";
import { getEventResolution, markEventResolved } from "../models/resolved-event.js";
import { buildTraccarUnavailableError, traccarProxy, traccarRequest } from "../services/traccar.js";
import { getProtocolCommands, getProtocolList, normalizeProtocolKey } from "../services/protocol-catalog.js";
import { getGroupIdsForGeofence } from "../models/geofence-group.js";
import {
  fetchDevicesMetadata,
  fetchEventsWithFallback,
  fetchLatestPositions,
  fetchLatestPositionsWithFallback,
  fetchPositions,
  fetchPositionsByIds,
  fetchTrips,
} from "../services/traccar-db.js";
import {
  enforceClientGroupInQuery,
  enforceDeviceFilterInBody,
  enforceDeviceFilterInQuery,
  extractDeviceIds,
  normalizeReportDeviceIds,
  resolveClientGroupId,
  resolveAllowedDeviceIds,
  normaliseJsonList,
} from "../utils/report-helpers.js";
import { enrichPositionsWithAddresses, formatAddress, resolveShortAddress } from "../utils/address.js";
import { stringifyCsv } from "../utils/csv.js";
import { computeRouteSummary, computeTripMetrics } from "../utils/report-metrics.js";
import { createTtlCache } from "../utils/ttl-cache.js";
import prisma, { isPrismaAvailable } from "../services/prisma.js";
import { buildCriticalVehicleSummary } from "../utils/critical-vehicles.js";
import { generatePositionsReportPdf } from "../utils/positions-report-pdf.js";

const router = express.Router();
router.use(authenticate);

function enforceClientGroupInBody(req, target = req.body) {
  const groupId = resolveClientGroupId(req);
  if (!groupId) return;

  const body = target || (req.body = {});
  if (body.groupId === undefined && body.groupIds === undefined) {
    body.groupId = groupId;
  }
}

function resolveTraccarDeviceId(req, allowed = null) {
  const requested = extractDeviceIds(req.body);
  if (!requested.length) return null;

  const allowedIds = allowed ?? resolveAllowedDeviceIds(req);
  const first = String(requested[0]);

  if (/^\d+$/.test(first) && (!allowedIds || allowedIds.includes(first))) {
    return first;
  }

  const direct = getDeviceById(first);
  const devices = direct ? [direct] : listDevices({});
  const match = devices.find((device) =>
    [device?.traccarId, device?.id, device?.uniqueId].some((value) => value && String(value) === first),
  );

  if (!match?.traccarId) {
    throw createError(404, "Equipamento não encontrado");
  }

  if (allowedIds && !allowedIds.includes(String(match.traccarId))) {
    throw createError(403, "Dispositivo não autorizado para este cliente");
  }

  return String(match.traccarId);
}

function resolveErrorStatusCode(error) {
  const status = Number(error?.status || error?.statusCode || error?.response?.status || error?.details?.status);
  return Number.isFinite(status) ? status : null;
}

function resolveTraccarErrorMessage(payload, fallback = null) {
  if (!payload) return fallback;
  const cause = payload?.error?.cause ?? payload?.cause;
  if (typeof cause === "string" && cause.trim()) {
    return cause;
  }
  if (cause && typeof cause?.message === "string" && cause.message.trim()) {
    return cause.message;
  }
  const message = payload?.error?.message ?? payload?.message;
  if (typeof message === "string" && message.trim()) {
    return message;
  }
  return fallback;
}

function logResolveTraccarDeviceFailure(context, error) {
  const status = resolveErrorStatusCode(error);
  const code =
    error?.code ||
    error?.response?.data?.error?.code ||
    error?.response?.data?.code ||
    error?.error?.code ||
    null;
  console.warn("[commands] Falha ao resolver dispositivo", {
    vehicleId: context?.vehicleId ?? null,
    deviceId: context?.deviceId ?? null,
    clientId: context?.clientId ?? null,
    status: status ?? undefined,
    code: code ?? undefined,
    message: error?.message || error,
  });
}

function resolveCommandPayload(req) {
  const commandKey = req.body?.commandKey;
  const protocol = req.body?.protocol;
  if (!commandKey || !protocol) {
    return {
      type: req.body?.type,
      attributes: req.body?.attributes || {},
      textChannel: req.body?.textChannel,
      description: req.body?.description,
    };
  }

  const protocolKey = normalizeProtocolKey(protocol);
  const commands = getProtocolCommands(protocolKey);
  if (!commands) {
    throw createError(404, "Protocolo não encontrado");
  }

  const match = commands.find((command) => command?.id === commandKey || command?.code === commandKey);
  if (!match) {
    throw createError(404, "Comando não encontrado para o protocolo");
  }

  if (protocolKey === "iotm" && match?.id === "outputControl") {
    return buildIotmOutputPayload(req.body?.params || {});
  }

  if (match?.type === "custom" || match?.code === "custom" || match?.id === "custom") {
    const params = req.body?.params || {};
    const data = params.data ?? params.payload ?? params.command ?? params.text;
    if (data !== undefined) {
      return {
        type: "custom",
        attributes: { data },
        textChannel: req.body?.textChannel,
        description: req.body?.description,
      };
    }
  }

  return {
    type: match.type || match.code || match.id,
    attributes: req.body?.params || {},
    textChannel: req.body?.textChannel,
    description: req.body?.description,
  };
}

function resolveDirectCustomPayload(body) {
  if (!body || typeof body !== "object") return null;
  const payload = body.payload ?? body.data;
  if (payload === undefined || payload === null) return null;
  if (typeof payload === "string" && !payload.trim()) return null;
  return {
    type: body?.type || "custom",
    attributes: { data: payload },
    textChannel: false,
    description: body?.description,
  };
}

function buildIotmOutputPayload(params = {}) {
  const rawOutput = params.output ?? params.outputId ?? params.outputIndex ?? 1;
  const outputNumber = Number(rawOutput);
  if (!Number.isFinite(outputNumber) || outputNumber < 1 || outputNumber > 4) {
    throw createError(400, "Saída inválida para comando IOTM");
  }

  const actionRaw = String(params.action ?? params.state ?? params.mode ?? "on").toLowerCase();
  const action = actionRaw === "on" || actionRaw === "ligar" ? "on" : actionRaw === "off" || actionRaw === "desligar" ? "off" : null;
  if (!action) {
    throw createError(400, "Ação inválida para comando IOTM");
  }

  const rawDuration = params.durationMs ?? params.duration ?? params.timeMs ?? 0;
  const durationMs = Number(rawDuration);
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw createError(400, "Tempo inválido para comando IOTM");
  }

  const ticks = Math.round(durationMs / 10);
  if (!Number.isFinite(ticks) || ticks < 0 || ticks > 0xffff) {
    throw createError(400, "Tempo inválido para comando IOTM");
  }

  const buffer = Buffer.alloc(4);
  buffer.writeUInt8(outputNumber - 1, 0);
  buffer.writeUInt8(action === "on" ? 0x00 : 0x01, 1);
  buffer.writeUInt16BE(ticks, 2);

  return {
    type: "custom",
    attributes: {
      data: buffer.toString("hex").toUpperCase(),
    },
  };
}

const BUILTIN_CUSTOM_COMMANDS = [
  {
    id: "builtin:iotm-output1-500ms",
    name: "Acionar saída 1 (500ms)",
    description: "Template IOTM baseado no payload 00 80 00 (Output control OUT1 por 500ms).",
    protocol: "iotm",
    kind: "HEX",
    payload: { data: "00 80 00" },
    visible: false,
    sortOrder: -100,
    readonly: true,
    createdAt: new Date().toISOString(),
  },
];

function getBuiltinCustomCommands(protocol = null) {
  if (!protocol) return [...BUILTIN_CUSTOM_COMMANDS];
  const protocolKey = normalizeProtocolKey(protocol);
  return BUILTIN_CUSTOM_COMMANDS.filter((command) => normalizeProtocolKey(command.protocol) === protocolKey);
}

function findBuiltinCustomCommand(commandId) {
  return BUILTIN_CUSTOM_COMMANDS.find((command) => command.id === commandId) || null;
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const commandFallbackModels = new Map();
const commandFallbackWarnings = new Set();
function getCommandFallbackModel(modelName) {
  if (commandFallbackModels.has(modelName)) {
    return commandFallbackModels.get(modelName);
  }
  const fallback = {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    create: async () => null,
    update: async () => null,
    delete: async () => null,
  };
  commandFallbackModels.set(modelName, fallback);
  return fallback;
}

function ensureCommandPrismaModel(modelName) {
  const model = prisma?.[modelName];
  if (!model || typeof model.findMany !== "function") {
    if (!commandFallbackWarnings.has(modelName)) {
      commandFallbackWarnings.add(modelName);
      console.warn(`[commands] Prisma indisponível para ${modelName}, usando fallback seguro.`);
    }
    return getCommandFallbackModel(modelName);
  }
  return model;
}

async function resolveNextCustomCommandOrder(model, clientId, protocol) {
  if (!model?.findFirst) return 0;
  const latest = await model.findFirst({
    where: {
      clientId,
      ...(protocol ? { protocol } : { protocol: null }),
    },
    orderBy: { sortOrder: "desc" },
  });
  const current = Number(latest?.sortOrder);
  return Number.isFinite(current) ? current + 1 : 0;
}

async function fetchCommandResultEvents(traccarId, from, to, limit) {
  const params = {
    deviceId: [String(traccarId)],
    from,
    to,
    type: "commandResult",
  };

  const response = await requestReportWithFallback("/reports/events", params, "application/json", false);
  if (!response?.ok) {
    const statusCandidate = Number(response?.error?.code || response?.status);
    const status =
      Number.isFinite(statusCandidate) && statusCandidate >= 400 ? statusCandidate : 502;
    const message = response?.error?.message || "Falha ao consultar eventos do Traccar";
    throw createError(status, message);
  }

  const payload = response.data;
  const events = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.events)
    ? payload.events
    : Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.items)
    ? payload.items
    : normaliseJsonList(payload, ["events", "data", "items"]);

  if (!Array.isArray(events)) {
    return [];
  }

  if (Number.isFinite(limit) && limit > 0 && events.length > limit) {
    return events.slice(0, limit);
  }

  return events;
}

async function resolveTraccarDeviceFromVehicle(req, vehicleId) {
  const resolvedClientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: false });
  if (resolvedClientId) {
    const localDevices = listDevices({ clientId: resolvedClientId });
    const localMatch = localDevices.find((device) => device?.vehicleId && String(device.vehicleId) === String(vehicleId));
    if (localMatch?.traccarId) {
      return { ...localMatch };
    }
  }

  const protocol = req.get("x-forwarded-proto") || req.protocol || "http";
  const host = req.get("x-forwarded-host") || req.get("host");
  if (!host) {
    throw createError(500, "Host indisponível para resolver veículo");
  }

  const url = new URL(`/api/core/vehicles/${vehicleId}/traccar-device`, `${protocol}://${host}`);
  const clientIdForQuery = req.body?.clientId || req.query?.clientId;
  if (clientIdForQuery) {
    url.searchParams.set("clientId", String(clientIdForQuery));
  }

  const headers = { Accept: "application/json" };
  if (req.headers.authorization) {
    headers.Authorization = req.headers.authorization;
  }
  if (req.headers.cookie) {
    headers.Cookie = req.headers.cookie;
  }

  const coreResponse = await fetch(url, { method: "GET", headers });
  let payload = null;
  try {
    payload = await coreResponse.json();
  } catch (_error) {
    payload = null;
  }

  if (!coreResponse.ok || payload?.ok === false || payload?.error) {
    const message = payload?.message || "Erro ao resolver veículo";
    throw createError(coreResponse.status || 500, message);
  }

  return payload?.device || null;
}

async function hydrateTraccarDevice(req, traccarId, baseDevice = null) {
  let traccarDevice = baseDevice ? { ...baseDevice } : null;
  if (!traccarDevice && traccarId) {
    traccarDevice = { traccarId };
  }

  if (!traccarDevice?.protocol || !traccarDevice?.phone) {
    try {
      const remoteDevice = await traccarProxy("get", `/devices/${traccarId}`, { asAdmin: true, context: req });
      if (remoteDevice && !remoteDevice?.ok) {
        throw createError(502, remoteDevice?.error?.message || "Falha ao buscar device no Traccar");
      }
      traccarDevice = {
        ...traccarDevice,
        ...remoteDevice,
        traccarId: remoteDevice?.id ?? traccarId,
      };
    } catch (error) {
      console.warn("[commands] Falha ao buscar device no Traccar", error?.message || error);
    }
  }

  return traccarDevice;
}

async function resolveTraccarDevice(req, { allowVehicleFallback = true } = {}) {
  const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: false });
  const requestedVehicleId = req.body?.vehicleId || req.query?.vehicleId;
  const requestedDeviceId = req.body?.deviceId || req.query?.deviceId;
  let vehicleId = requestedVehicleId ? String(requestedVehicleId).trim() : "";
  const normalizedDeviceId = requestedDeviceId ? String(requestedDeviceId).trim() : "";

  const context = {
    vehicleId: vehicleId || null,
    deviceId: normalizedDeviceId || null,
    clientId: clientId || null,
  };

  const updateVehicleContext = (value) => {
    if (!value) return;
    vehicleId = String(value).trim();
    context.vehicleId = vehicleId;
  };

  try {
    const resolveByVehicle = async () => {
      if (!vehicleId) return null;

      const localDevices = listDevices({ clientId });
      const localMatch = localDevices.find((device) => device?.vehicleId && String(device.vehicleId) === vehicleId);
      if (localMatch) {
        const resolved = await buildResolved(localMatch, localMatch.traccarId);
        if (resolved) return resolved;
      }

      const traccarDevice = await resolveTraccarDeviceFromVehicle(req, vehicleId);
      const traccarId = Number(traccarDevice?.traccarId);
      if (!Number.isFinite(traccarId)) {
        throw createError(409, "Equipamento vinculado sem traccarId");
      }
      updateVehicleContext(vehicleId);
      return { vehicleId, traccarId, traccarDevice };
    };

    const buildResolved = async (deviceRecord, fallbackDeviceId) => {
      const resolvedTraccarId = Number(deviceRecord?.traccarId ?? fallbackDeviceId);
      if (!Number.isFinite(resolvedTraccarId)) return null;
      const hydrated = await hydrateTraccarDevice(req, resolvedTraccarId, deviceRecord);
      const resolvedVehicleId = vehicleId || (deviceRecord?.vehicleId ? String(deviceRecord.vehicleId) : "");
      updateVehicleContext(resolvedVehicleId);
      return {
        vehicleId: resolvedVehicleId,
        traccarId: resolvedTraccarId,
        traccarDevice: hydrated,
      };
    };

    if (vehicleId && allowVehicleFallback) {
      try {
        const resolved = await resolveByVehicle();
        if (resolved) return resolved;
      } catch (vehicleError) {
        if (!normalizedDeviceId) {
          throw vehicleError;
        }
      }
    }

    if (normalizedDeviceId) {
      const deviceRecord = getDeviceById(normalizedDeviceId);
      if (clientId && deviceRecord?.clientId && String(deviceRecord.clientId) !== String(clientId) && req.user?.role !== "admin") {
        throw createError(403, "Dispositivo não autorizado para este cliente");
      }
      if (deviceRecord && !deviceRecord.vehicleId) {
        throw createError(409, "Equipamento sem veículo vinculado");
      }
      const resolved = await buildResolved(deviceRecord, normalizedDeviceId);
      if (!resolved) {
        throw createError(404, "Equipamento não encontrado");
      }
      if (!resolved.vehicleId) {
        throw createError(409, "Equipamento sem veículo vinculado");
      }
      return resolved;
    }

    if (vehicleId && allowVehicleFallback) {
      const resolved = await resolveByVehicle();
      if (resolved) return resolved;
    }

    throw createError(400, "vehicleId ou deviceId é obrigatório");
  } catch (error) {
    logResolveTraccarDeviceFailure(context, error);
    throw error;
  }
}

function resolveCustomCommandPayload(customCommand) {
  const kind = String(customCommand?.kind || "").toUpperCase();
  const payload = customCommand?.payload && typeof customCommand.payload === "object" ? customCommand.payload : {};

  if (kind === "SMS") {
    if (!payload.message) {
      throw createError(400, "Comando SMS sem mensagem");
    }
    const attributes = { message: payload.message };
    if (payload.phone) {
      attributes.phone = payload.phone;
    }
    return { type: "sendSms", attributes };
  }

  if (kind === "JSON") {
    if (!payload.type) {
      throw createError(400, "Comando JSON sem type definido");
    }
    const attributes = payload.attributes && typeof payload.attributes === "object" ? payload.attributes : {};
    return { type: payload.type, attributes };
  }

  if (kind === "RAW") {
    if (payload.data === undefined || payload.data === null || String(payload.data).trim() === "") {
      throw createError(400, "Comando RAW sem conteúdo");
    }
    return { type: "custom", attributes: { data: payload.data }, textChannel: false };
  }

  if (kind === "HEX") {
    if (payload.data === undefined || payload.data === null || String(payload.data).trim() === "") {
      throw createError(400, "Comando HEX sem conteúdo");
    }
    return { type: "custom", attributes: { data: payload.data }, textChannel: false };
  }

  throw createError(400, "Tipo de comando personalizado inválido");
}

function normalizeCustomCommandInput(body = {}) {
  const name = String(body?.name || "").trim();
  const description = body?.description ? String(body.description).trim() : null;
  const kind = String(body?.kind || "").toUpperCase();
  const visible = body?.visible !== undefined ? Boolean(body.visible) : true;
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};
  const sortOrderRaw = body?.sortOrder;
  const sortOrder = Number.isFinite(Number(sortOrderRaw)) ? Number(sortOrderRaw) : null;
  const protocol = body?.protocol ? normalizeProtocolKey(body.protocol) : null;
  if (protocol) {
    const knownProtocols = getProtocolList().map((item) => normalizeProtocolKey(item?.id));
    if (!knownProtocols.includes(protocol)) {
      throw createError(400, "Protocolo inválido para comando personalizado");
    }
  }

  if (!name) {
    throw createError(400, "Nome do comando é obrigatório");
  }

  if (!["SMS", "JSON", "RAW", "HEX"].includes(kind)) {
    throw createError(400, "Tipo de comando personalizado inválido");
  }

  if (kind === "SMS") {
    if (!payload.message) {
      throw createError(400, "Comando SMS requer mensagem");
    }
  }

  if (kind === "JSON") {
    if (!payload.type) {
      throw createError(400, "Comando JSON requer type");
    }
    if (payload.attributes && typeof payload.attributes !== "object") {
      throw createError(400, "Comando JSON requer attributes como objeto");
    }
  }

  if (kind === "RAW") {
    if (payload.data === undefined || payload.data === null || String(payload.data).trim() === "") {
      throw createError(400, "Comando RAW requer conteúdo");
    }
  }

  if (kind === "HEX") {
    const raw = String(payload.data ?? "").trim();
    if (!raw) {
      throw createError(400, "Comando HEX requer conteúdo");
    }
    const normalised = raw.replace(/\s+/g, "");
    if (!/^[0-9a-fA-F]+$/.test(normalised) || normalised.length % 2 !== 0) {
      throw createError(400, "Conteúdo HEX inválido");
    }
    payload.data = raw;
  }

  return {
    name,
    description,
    kind,
    visible,
    payload,
    protocol,
    sortOrder,
  };
}

function normalizeCommandMatchValue(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized || normalized === "commandresult") return null;
  return normalized;
}

function resolveCommandNameFromEvent(event) {
  const attributes = event?.attributes && typeof event.attributes === "object" ? event.attributes : {};
  const candidates = [
    attributes.commandName,
    attributes.command,
    attributes.commandType,
    attributes.commandId,
    attributes.description,
    attributes.type,
  ];
  const match = candidates.find((value) => normalizeCommandMatchValue(value));
  if (!match) return null;
  return String(match).trim();
}

function resolveCommandResultText(event) {
  const attributes = event?.attributes && typeof event.attributes === "object" ? event.attributes : {};
  if (typeof attributes.result === "string" && attributes.result.trim()) return attributes.result;
  if (typeof attributes.commandResult === "string" && attributes.commandResult.trim()) return attributes.commandResult;
  if (typeof event?.result === "string" && event.result.trim()) return event.result;
  return null;
}

function mapDispatchStatusToApi(status, hasResponse) {
  if (hasResponse) return "RESPONDED";
  if (status === "failed") return "ERROR";
  if (status === "sent") return "SENT";
  return "PENDING";
}

function buildDispatchMatchSignature(dispatch) {
  const payloadSummary = dispatch?.payloadSummary && typeof dispatch.payloadSummary === "object" ? dispatch.payloadSummary : null;
  return {
    commandId: normalizeCommandMatchValue(dispatch?.traccarCommandId),
    commandName: normalizeCommandMatchValue(dispatch?.commandName || dispatch?.commandKey || payloadSummary?.type),
    commandType: normalizeCommandMatchValue(payloadSummary?.type || dispatch?.commandKey),
    commandKey: normalizeCommandMatchValue(dispatch?.commandKey),
  };
}

function buildEventMatchSignature(event) {
  const attributes = event?.attributes && typeof event.attributes === "object" ? event.attributes : {};
  return {
    commandId: normalizeCommandMatchValue(attributes.commandId || attributes.commandID || event?.commandId),
    commandName: normalizeCommandMatchValue(resolveCommandNameFromEvent(event)),
    commandType: normalizeCommandMatchValue(attributes.commandType || attributes.command || attributes.type),
    commandKey: normalizeCommandMatchValue(attributes.commandId),
  };
}

function findMatchingCommandEvent({ dispatch, parsedEvents, usedEventIds, matchWindowMs, allowSkewMs }) {
  const sentTime = new Date(dispatch.sentAt);
  const sentMs = sentTime.getTime();
  if (!Number.isFinite(sentMs)) return null;
  const dispatchSignature = buildDispatchMatchSignature(dispatch);

  let bestCandidate = null;
  let bestMatches = -1;
  let bestDelta = Number.POSITIVE_INFINITY;

  parsedEvents.forEach((event) => {
    if (!event?.parsedTime) return;
    if (usedEventIds.has(event.id)) return;
    const eventMs = event.parsedTime.getTime();
    if (eventMs < sentMs - allowSkewMs) return;
    if (eventMs - sentMs > matchWindowMs) return;

    const eventSignature = buildEventMatchSignature(event);
    let comparisons = 0;
    let matches = 0;
    if (dispatchSignature.commandKey && eventSignature.commandKey) {
      comparisons += 1;
      if (dispatchSignature.commandKey === eventSignature.commandKey) {
        matches += 1;
      }
    }
    if (dispatchSignature.commandId && eventSignature.commandId) {
      comparisons += 1;
      if (dispatchSignature.commandId === eventSignature.commandId) {
        matches += 1;
      }
    }
    if (dispatchSignature.commandName && eventSignature.commandName) {
      comparisons += 1;
      if (dispatchSignature.commandName === eventSignature.commandName) {
        matches += 1;
      }
    }
    if (dispatchSignature.commandType && eventSignature.commandType) {
      comparisons += 1;
      if (dispatchSignature.commandType === eventSignature.commandType) {
        matches += 1;
      }
    }
    if (comparisons > 0 && matches === 0) {
      return;
    }

    const delta = Math.abs(eventMs - sentMs);
    if (matches > bestMatches || (matches === bestMatches && delta < bestDelta)) {
      bestCandidate = event;
      bestMatches = matches;
      bestDelta = delta;
    }
  });

  return bestCandidate || null;
}

function buildCommandHistoryItem({
  id,
  vehicleId,
  traccarId,
  user,
  command,
  commandName,
  payload,
  status,
  sentAt,
  receivedAt,
  respondedAt,
  result,
  source,
  traccarCommandId,
}) {
  const resolvedCommandName = commandName || command || null;
  const resolvedRespondedAt = respondedAt || receivedAt || null;
  return {
    id,
    vehicleId,
    traccarId,
    user: user || null,
    command: command || resolvedCommandName,
    commandName: resolvedCommandName,
    payload,
    status,
    sentAt,
    receivedAt: receivedAt || resolvedRespondedAt,
    respondedAt: resolvedRespondedAt,
    result,
    source,
    traccarCommandId: traccarCommandId ?? null,
  };
}

const TRIP_CSV_COLUMNS = [
  { key: "device", label: "Dispositivo" },
  { key: "startTime", label: "Início" },
  { key: "endTime", label: "Fim" },
  { key: "durationSeconds", label: "Duração (s)" },
  { key: "distanceMeters", label: "Distância (m)" },
  { key: "averageSpeedKmH", label: "Velocidade média (km/h)" },
  { key: "maxSpeedKmH", label: "Velocidade máxima (km/h)" },
  { key: "startAddress", label: "Endereço inicial" },
  { key: "endAddress", label: "Endereço final" },
  { key: "startLat", label: "Lat. inicial" },
  { key: "startLon", label: "Lon. inicial" },
  { key: "endLat", label: "Lat. final" },
  { key: "endLon", label: "Lon. final" },
];

// Estas rotas usam o banco do Traccar como fonte principal de dados (cenário C).
// A API HTTP do Traccar é usada apenas em endpoints específicos (ex.: comandos para o rastreador), não nestas rotas.

const TRACCAR_DB_ERROR_PAYLOAD = {
  data: null,
  error: {
    message: "Serviço de telemetria indisponível no momento. Tente novamente em instantes.",
    code: "TRACCAR_DB_ERROR",
  },
};

const DEFAULT_REPORT_RADIUS_METERS = 100;

function respondBadRequest(res, message = "Parâmetros inválidos.") {
  return res.status(400).json({
    data: null,
    error: { message, code: "BAD_REQUEST" },
  });
}

function respondDeviceNotFound(res) {
  return res.status(404).json({
    data: null,
    error: { message: "Dispositivo não encontrado para este cliente.", code: "DEVICE_NOT_FOUND" },
  });
}

function extractBatteryLevel(attributes = {}) {
  if (!attributes || typeof attributes !== "object") return null;
  const batteryKeys = ["batteryLevel", "battery", "batteryPercent", "battery_percentage", "bateria"];
  for (const key of batteryKeys) {
    if (attributes[key] === undefined || attributes[key] === null) continue;
    const numeric = Number(attributes[key]);
    return Number.isFinite(numeric) ? numeric : attributes[key];
  }
  return null;
}

function extractIgnition(attributes = {}) {
  if (!attributes || typeof attributes !== "object") return null;
  const raw =
    attributes.ignition ?? attributes.Ignition ?? attributes.ign ?? attributes.keyIgnition ?? attributes["Ignition"];
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    return ["true", "1", "on", "yes"].includes(normalized);
  }
  return null;
}

function extractRssi(attributes = {}) {
  if (!attributes || typeof attributes !== "object") return null;
  const keys = ["rssi", "signal", "gsm", "rssiValue", "signalStrength"];
  for (const key of keys) {
    if (attributes[key] === undefined || attributes[key] === null) continue;
    const numeric = Number(attributes[key]);
    return Number.isFinite(numeric) ? numeric : attributes[key];
  }
  return null;
}

function extractSatellites(attributes = {}) {
  if (!attributes || typeof attributes !== "object") return null;
  const keys = ["satellites", "sat", "satellitesCount", "satCount", "sats"];
  for (const key of keys) {
    if (attributes[key] === undefined || attributes[key] === null) continue;
    const numeric = Number(attributes[key]);
    return Number.isFinite(numeric) ? numeric : attributes[key];
  }
  return null;
}

function parseAddressFilterQuery(query = {}) {
  const lat = Number(query.addressLat ?? query.lat ?? query.latitude);
  const lng = Number(query.addressLng ?? query.lng ?? query.longitude);
  const radius = Number(query.addressRadius ?? query.radius ?? DEFAULT_REPORT_RADIUS_METERS);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    radius: Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_REPORT_RADIUS_METERS,
  };
}

function computeDistanceMeters(from, to) {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad((to.lat ?? 0) - (from.lat ?? 0));
  const dLon = toRad((to.lng ?? 0) - (from.lng ?? 0));
  const lat1 = toRad(from.lat ?? 0);
  const lat2 = toRad(to.lat ?? 0);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function resolveVehicleState(ignition, speedKmh) {
  if (ignition === true && speedKmh > 0) return "Em movimento";
  if (ignition === true) return "Ligado";
  if (ignition === false) return "Desligado";
  return "—";
}

function parseCommandEvents(events = []) {
  return events
    .map((event) => {
      const eventTime = event?.eventTime ?? event?.serverTime ?? event?.deviceTime ?? null;
      const timestamp = eventTime ? new Date(eventTime).getTime() : Number.NaN;
      if (!Number.isFinite(timestamp)) return null;
      const response = resolveCommandResultText(event);
      if (!response) return null;
      return { timestamp, response };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function findLatestCommandResponse(events, targetTime, windowMs) {
  if (!events.length) return null;
  const maxTime = targetTime + windowMs;
  let left = 0;
  let right = events.length - 1;
  let candidate = -1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (events[mid].timestamp <= maxTime) {
      candidate = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  if (candidate === -1) return null;
  for (let i = candidate; i >= 0; i -= 1) {
    if (events[i].timestamp < targetTime - windowMs) break;
    if (events[i].response) return events[i].response;
  }
  return null;
}

function normalisePosition(position) {
  if (!position) return null;
  const attributes = position.attributes || {};
  const fixTime = position.fixTime || position.deviceTime || position.serverTime || null;
  return {
    deviceId: position.deviceId != null ? String(position.deviceId) : null,
    latitude: position.latitude ?? null,
    longitude: position.longitude ?? null,
    speed: position.speed ?? null,
    course: position.course ?? null,
    timestamp: fixTime || position.serverTime || position.deviceTime || null,
    fixTime: position.fixTime || null,
    deviceTime: position.deviceTime || null,
    serverTime: position.serverTime || null,
    address: position.address || "Endereço não disponível",
    attributes,
    batteryLevel: extractBatteryLevel(attributes),
    ignition: extractIgnition(attributes),
  };
}

function parseDeviceIds(raw) {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
    ? raw.split(",")
    : raw != null
    ? [raw]
    : [];

  return values
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function parseDateOrThrow(value, label) {
  if (!value) {
    throw createError(400, `${label} é obrigatório`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createError(400, `Data inválida em ${label}`);
  }
  return parsed.toISOString();
}

const CRITICAL_EVENT_TYPES = new Set([
  "deviceoffline",
  "deviceinactive",
  "deviceunknown",
  "powercut",
  "powerdisconnected",
  "externalpowerdisconnected",
  "jamming",
]);

function normaliseSeverityLabel(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith("crit")) return "critical";
  if (normalized.startsWith("alta") || normalized === "high") return "high";
  if (normalized.startsWith("mod") || normalized === "medium" || normalized === "media" || normalized === "média") {
    return "medium";
  }
  if (normalized.startsWith("baixa") || normalized === "low") return "low";
  return normalized;
}

function resolveEventSeverity(event) {
  const rawSeverity =
    event?.severity ??
    event?.level ??
    event?.attributes?.severity ??
    event?.attributes?.criticality ??
    event?.attributes?.alarm ??
    null;
  const bySeverityField = normaliseSeverityLabel(rawSeverity);
  if (bySeverityField) return bySeverityField;

  const typeKey = String(event?.type || event?.event || event?.attributes?.type || "").toLowerCase();
  if (CRITICAL_EVENT_TYPES.has(typeKey)) return "critical";
  return "normal";
}

function isSeverityMatch(eventSeverity, filter) {
  if (!filter) return true;
  const normalizedFilter = normaliseSeverityLabel(filter);
  if (!normalizedFilter) return true;
  const normalizedEvent = normaliseSeverityLabel(eventSeverity);
  return normalizedEvent === normalizedFilter;
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveDeviceIdsToQuery(req) {
  const clientId = resolveClientId(req, req.query?.clientId, { required: false });
  const devices = listDevices({ clientId });
  const allowedDeviceIds = devices
    .map((device) => (device?.traccarId != null ? String(device.traccarId) : null))
    .filter(Boolean);

  const filteredDeviceIds = parseDeviceIds(req.query?.deviceId || req.query?.deviceIds);
  if (filteredDeviceIds.some((value) => !/^\d+$/.test(value))) {
    throw createError(400, "Parâmetros inválidos.");
  }

  const deviceIdsToQuery = filteredDeviceIds.length
    ? filteredDeviceIds.filter((id) => allowedDeviceIds.includes(id))
    : allowedDeviceIds;

  if (filteredDeviceIds.length && deviceIdsToQuery.length === 0) {
    throw createError(404, "Dispositivo não encontrado para este cliente.");
  }

  return { clientId, deviceIdsToQuery };
}

function buildDeviceLookup(clientDevices = [], metadata = []) {
  const metadataById = new Map((metadata || []).map((item) => [String(item.id), item]));
  const devicesByTraccarId = new Map(
    (clientDevices || [])
      .filter((device) => device?.traccarId != null)
      .map((device) => [String(device.traccarId), device]),
  );
  return { metadataById, devicesByTraccarId };
}

function buildDeviceInfo(device, metadata, fallbackId) {
  if (!device && !metadata && !fallbackId) return null;
  const id = device?.traccarId ? String(device.traccarId) : device?.id ? String(device.id) : String(fallbackId || "");
  const uniqueId = metadata?.uniqueId || device?.uniqueId || null;
  const lastUpdate = metadata?.lastUpdate || null;
  return {
    id,
    name: metadata?.name || device?.name || device?.uniqueId || id,
    uniqueId,
    status: metadata?.status || null,
    lastUpdate,
  };
}

function decoratePositionWithDevice(position, lookup) {
  if (!position) return null;
  const { metadataById, devicesByTraccarId } = lookup || {};
  const metadata = metadataById?.get(String(position.deviceId));
  const device = devicesByTraccarId?.get(String(position.deviceId));
  const batteryLevel = extractBatteryLevel(position.attributes);
  const ignition = extractIgnition(position.attributes);
  const lastCommunication =
    position.serverTime || position.deviceTime || position.fixTime || metadata?.lastUpdate || null;

  return {
    ...position,
    device: buildDeviceInfo(device, metadata, position.deviceId),
    lastCommunication,
    batteryLevel,
    ignition,
  };
}

function pickTripAddress(trip, prefix) {
  const short = trip?.[`${prefix}ShortAddress`];
  const formatted = trip?.[`${prefix}FormattedAddress`];
  const raw = trip?.[`${prefix}Address`];
  const value = short || formatted || raw;
  if (!value) return "";
  const compact = formatAddress(value);
  return compact === "—" ? "" : compact;
}

function buildTripsCsv(trips = []) {
  const rows = trips.map((trip) => {
    const distance = Number.isFinite(Number(trip.distance)) ? Number(trip.distance) : null;
    const duration = Number.isFinite(Number(trip.duration)) ? Number(trip.duration) : null;
    const average = Number.isFinite(Number(trip.averageSpeed)) ? Number(trip.averageSpeed) : null;
    const max = Number.isFinite(Number(trip.maxSpeed)) ? Number(trip.maxSpeed) : null;

    return {
      device: trip.deviceName || trip.deviceId || trip.uniqueId || "",
      startTime: trip.startTime || trip.start || "",
      endTime: trip.endTime || trip.end || "",
      durationSeconds: duration ?? "",
      distanceMeters: distance ?? "",
      averageSpeedKmH: average ?? "",
      maxSpeedKmH: max ?? "",
      startAddress: pickTripAddress(trip, "start"),
      endAddress: pickTripAddress(trip, "end"),
      startLat: trip.startLat ?? trip.startLatitude ?? "",
      startLon: trip.startLon ?? trip.startLongitude ?? "",
      endLat: trip.endLat ?? trip.endLatitude ?? "",
      endLon: trip.endLon ?? trip.endLongitude ?? "",
    };
  });

  return stringifyCsv(rows, TRIP_CSV_COLUMNS);
}

/**
 * === Helpers de serialização/headers para a API do Traccar ===
 */

function appendRepeat(search, key, value) {
  if (value === undefined || value === null) return;
  const arr = Array.isArray(value) ? value : String(value).split(",");
  for (const raw of arr) {
    const v = String(raw).trim();
    if (v) search.append(key, v);
  }
}

function toIsoOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function buildReportSearch(params = {}) {
  const search = new URLSearchParams();

  // devices
  const ids = extractDeviceIds(params);
  if (ids.length) ids.forEach((id) => search.append("deviceId", String(id)));
  else appendRepeat(search, "deviceId", params.deviceId || params.deviceIds);

  // groups
  appendRepeat(search, "groupId", params.groupId || params.groupIds);

  // types (para events)
  appendRepeat(search, "type", params.type || params.types);

  // datas
  const from = toIsoOrNull(params.from);
  const to = toIsoOrNull(params.to);
  if (from) search.set("from", from);
  if (to) search.set("to", to);

  // extras (limit, etc)
  for (const [k, v] of Object.entries(params)) {
    if (["deviceId", "deviceIds", "groupId", "groupIds", "type", "types", "from", "to", "format"].includes(k)) continue;
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      appendRepeat(search, k, v);
    }
  }

  return search;
}

function pickAccept(format = "") {
  const f = String(format).toLowerCase();
  if (f === "csv") return "text/csv";
  if (f === "gpx") return "application/gpx+xml";
  if (f === "xls") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (f === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/json";
}

async function normalizeReportPayload(path, payload) {
  const isObject = payload && typeof payload === "object" && !Array.isArray(payload);
  const base = isObject ? { ...payload } : {};
  const ensureList = (keys = []) => {
    if (Array.isArray(payload)) return payload;
    for (const key of keys) {
      if (Array.isArray(payload?.[key])) return payload[key];
    }
    return normaliseJsonList(payload, keys);
  };

  if (path.includes("/route")) {
    const positions = ensureList(["positions", "route", "routes", "data", "items"]);
    base.positions = await enrichPositionsWithAddresses(positions);
    base.summary = computeRouteSummary({ ...base, positions: base.positions });
    return base;
  }

  if (path.includes("/stops")) {
    base.stops = ensureList(["stops", "data", "items"]);
    return base;
  }

  if (path.includes("/summary")) {
    base.summary = ensureList(["summary", "data", "items"]);
    return base;
  }

  if (path.includes("/trips")) {
    const trips = ensureList(["trips", "data", "items"]);
    base.trips = await Promise.all(
      trips.map(async (trip) => {
        const startLat = trip.startLat ?? trip.startLatitude ?? trip.lat ?? trip.latitude;
        const startLng = trip.startLon ?? trip.startLongitude ?? trip.lon ?? trip.longitude;
        const endLat = trip.endLat ?? trip.endLatitude ?? trip.latTo ?? trip.latitudeTo;
        const endLng = trip.endLon ?? trip.endLongitude ?? trip.lonTo ?? trip.longitudeTo;

        const start = await resolveShortAddress(startLat, startLng, trip.startAddress);
        const end = await resolveShortAddress(endLat, endLng, trip.endAddress);

        const metrics = computeTripMetrics(trip);

        return {
          ...trip,
          ...metrics,
          startAddress: start?.address || trip.startAddress,
          endAddress: end?.address || trip.endAddress,
          startShortAddress: start?.shortAddress || start?.formattedAddress || null,
          endShortAddress: end?.shortAddress || end?.formattedAddress || null,
          startFormattedAddress: start?.formattedAddress || null,
          endFormattedAddress: end?.formattedAddress || null,
        };
      }),
    );
    return base;
  }

  return payload ?? {};
}

/**
 * Tenta GET e, se o Traccar responder 404/405/415, faz fallback em POST.
 */
async function requestReportWithFallback(path, params, accept, wantsBinary) {
  const search = buildReportSearch(params);
  const urlGet = `${path}?${search.toString()}`;

  // 1) GET
  try {
    const res = await traccarRequest(
      {
        method: "get",
        url: urlGet,
        responseType: wantsBinary ? "arraybuffer" : "json",
        headers: { Accept: accept },
      },
      null,
      { asAdmin: true },
    );
    return res;
  } catch (err) {
    const status = err?.response?.status;
    const shouldFallback = status === 404 || status === 405 || status === 415;
    if (!shouldFallback) throw err;

    // 2) POST
    const res = await traccarRequest(
      {
        method: "post",
        url: path,
        data: params,
        responseType: wantsBinary ? "arraybuffer" : "json",
        headers: { Accept: accept },
      },
      null,
      { asAdmin: true },
    );
    return res;
  }
}

/**
 * Proxy genérico de relatórios (/reports/*) com:
 *  - filtro de cliente
 *  - conversão de deviceId interno → traccarId
 *  - datas padrão (últimas 24h)
 *  - fallback GET→POST
 */
async function proxyTraccarReportWithParams(req, res, next, path, paramsIn) {
  try {
    let params = { ...(paramsIn || {}) };

    // converte UUID → traccarId ANTES de ir pro Traccar
    params = normalizeReportDeviceIds(params);

    enforceDeviceFilterInQuery(req, params);
    enforceClientGroupInQuery(req, params);

    if (!params.from || !params.to) {
      const now = new Date();
      const to = params.to ? new Date(params.to) : now;
      const from = params.from ? new Date(params.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
      params.from = from.toISOString();
      params.to = to.toISOString();
    }

    const accept = pickAccept(String(params.format || ""));
    const wantsBinary = accept !== "application/json";

    const response = await requestReportWithFallback(path, params, accept, wantsBinary);

    if (wantsBinary) {
      res.setHeader("Content-Type", accept);
      res.send(Buffer.from(response.data));
    } else {
      res.json(await normalizeReportPayload(path, response?.data));
    }
  } catch (error) {
    if (error?.response) {
      console.error(
        "[traccar report error]",
        path,
        error.response.status,
        typeof error.response.data === "string" ? error.response.data : JSON.stringify(error.response.data),
      );
    } else {
      console.error("[traccar report error]", path, error?.message);
    }
    const status = error?.response?.status ?? 500;
    const message =
      error?.response?.data?.message ||
      (typeof error?.response?.data === "string" ? error.response.data : null) ||
      error?.message ||
      "Erro ao gerar relatório";
    next(createError(status, message));
  }
}

async function proxyTraccarReport(req, res, next, path) {
  return proxyTraccarReportWithParams(req, res, next, path, { ...(req.query || {}) });
}

async function handleEventsReport(req, res, next) {
  const accept = pickAccept(String(req.query?.format || ""));
  const wantsBinary = accept !== "application/json";
  if (wantsBinary) {
    // Exportações pesadas continuam usando a API HTTP do Traccar; leitura online usa o banco (traccarDb).
    return proxyTraccarReport(req, res, next || (() => {}), "/reports/events");
  }

  try {
    const { clientId, deviceIdsToQuery } = resolveDeviceIdsToQuery(req);
    const now = new Date();
    const from = parseDateOrThrow(
      req.query?.from ?? new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      "from",
    );
    const to = parseDateOrThrow(req.query?.to ?? now.toISOString(), "to");
    const limit = req.query?.limit ? Number(req.query.limit) : 50;

    const devices = listDevices({ clientId });
    const metadata = await fetchDevicesMetadata();
    const lookup = buildDeviceLookup(devices, metadata);

    const events = await fetchEventsWithFallback(deviceIdsToQuery, from, to, limit);
    const positionIds = Array.from(new Set(events.map((event) => event.positionId).filter(Boolean)));
    const positions = await fetchPositionsByIds(positionIds);
    const positionMap = new Map(positions.map((position) => [position.id, position]));

    const severityFilter = req.query?.severity;
    const resolvedFilter = req.query?.resolved;

    const eventsWithAddress = events.map((event) => {
      const position = event.positionId ? positionMap.get(event.positionId) : null;
      const formattedAddress = position ? formatAddress(position.address) : null;
      const decoratedPosition = position ? decoratePositionWithDevice(position, lookup) : null;
      const device = buildDeviceInfo(
        lookup.devicesByTraccarId?.get(String(event.deviceId)),
        lookup.metadataById?.get(String(event.deviceId)),
        event.deviceId,
      );
      const batteryLevel =
        decoratedPosition?.batteryLevel ?? extractBatteryLevel(position?.attributes) ?? extractBatteryLevel(event.attributes);
      const ignition =
        decoratedPosition?.ignition ?? extractIgnition(position?.attributes) ?? extractIgnition(event.attributes);
      const lastCommunication =
        decoratedPosition?.lastCommunication || device?.lastUpdate || position?.serverTime || position?.deviceTime || null;
      const resolution = getEventResolution(event.id, { clientId });
      const severity = resolveEventSeverity(event);
      return {
        ...event,
        position: decoratedPosition || position,
        latitude: decoratedPosition?.latitude ?? position?.latitude,
        longitude: decoratedPosition?.longitude ?? position?.longitude,
        address: formattedAddress || decoratedPosition?.address || position?.address || event.address || null,
        device,
        lastCommunication,
        batteryLevel,
        ignition,
        severity,
        resolved: Boolean(resolution),
        resolvedAt: resolution?.resolvedAt || null,
        resolvedBy: resolution?.resolvedBy || null,
        resolvedByName: resolution?.resolvedByName || null,
      };
    });

    const filteredEvents = eventsWithAddress.filter((event) => {
      if (resolvedFilter !== undefined) {
        const wantResolved = !["false", "0", ""].includes(String(resolvedFilter).toLowerCase());
        if (event.resolved !== wantResolved) return false;
      }
      if (severityFilter && !isSeverityMatch(event.severity, severityFilter)) {
        return false;
      }
      return true;
    });

    const data = { clientId: clientId || null, deviceIds: deviceIdsToQuery, from, to, events: filteredEvents };

    return res.status(200).json({ data, events: filteredEvents, error: null });
  } catch (error) {
    if (error?.status === 400) {
      return respondBadRequest(res, error.message || "Parâmetros inválidos.");
    }
    if (error?.status === 404) {
      return respondDeviceNotFound(res);
    }
    return res.status(503).json(TRACCAR_DB_ERROR_PAYLOAD);
  }
}

/**
 * === Helpers /users ===
 */

function sanitizeUserQuery(query = {}) {
  const nextParams = { ...query };
  delete nextParams.target;
  delete nextParams.scope;
  delete nextParams.provider;
  return nextParams;
}

function isTraccarUserRequest(req) {
  const marker = req.query?.target || req.query?.scope || req.query?.provider;
  return marker === "traccar";
}

/**
 * === Telemetria (banco do Traccar) ===
 */

router.get("/telemetry", async (req, res) => {
  try {
    const { clientId, deviceIdsToQuery } = resolveDeviceIdsToQuery(req);



    const positions = await fetchLatestPositionsWithFallback(deviceIdsToQuery, null);


    const data = positions.map((position) => normalisePosition(position)).filter(Boolean);

    return res.status(200).json({ data, positions: data, error: null });
  } catch (error) {
    if (error?.status === 400) {
      return respondBadRequest(res, error.message || "Parâmetros inválidos.");
    }

    if (error?.status === 404) {
      return respondDeviceNotFound(res);
    }

    return res.status(503).json(TRACCAR_DB_ERROR_PAYLOAD);
  }
});

/**
 * === Devices ===
 */

router.get("/devices", async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const devices = listDevices({ clientId });
    let metadata = [];
    let metadataError = null;
    let fallbackDevicesFromTraccar = null;
    try {
      metadata = await fetchDevicesMetadata();
    } catch (error) {
      metadataError = error;
    }

    if (metadataError) {
      try {
        const response = await traccarProxy("get", "/devices", { asAdmin: true, context: req });
        const list = Array.isArray(response?.devices)
          ? response.devices
          : Array.isArray(response?.data)
          ? response.data
          : Array.isArray(response)
          ? response
          : [];

        if (!Array.isArray(list) || response?.ok === false || response?.error) {
          const error = buildTraccarUnavailableError(response?.error || response, { stage: "devices-fallback" });
          return res
            .status(error.status || error.statusCode || 503)
            .json({ code: error.code, message: error.message });
        }

        fallbackDevicesFromTraccar = list;
        metadata = list.map((item) => ({
          id: item.id,
          uniqueId: item.uniqueId ?? null,
          name: item.name ?? null,
          lastUpdate: item.lastUpdate ?? item.lastCommunication ?? null,
          disabled: Boolean(item.disabled),
          status: item.status || null,
        }));
      } catch (fallbackError) {
        const error = buildTraccarUnavailableError(fallbackError, { stage: "devices-fallback" });
        return res
          .status(error.status || error.statusCode || 503)
          .json({ code: error.code, message: error.message });
      }
    }
    const traccarIds = (devices.length ? devices : metadata)
      .map((device) => (device?.traccarId != null ? String(device.traccarId) : device?.id != null ? String(device.id) : null))
      .filter(Boolean);
    const latestPositions = traccarIds.length ? await fetchLatestPositionsWithFallback(traccarIds, null) : [];

    const positionByDevice = new Map((latestPositions || []).map((position) => [String(position.deviceId), position]));

    const traccarById = new Map(metadata.map((item) => [String(item.id), item]));
    const traccarByUniqueId = new Map(metadata.map((item) => [String(item.uniqueId || ""), item]));

    const sourceDevices =
      devices.length || !metadata.length
        ? devices
        : metadata.map((item) => ({
            id: item.id != null ? String(item.id) : null,
            traccarId: item.id != null ? String(item.id) : null,
            name: item.name || item.uniqueId,
            uniqueId: item.uniqueId || null,
          }));

    const data = sourceDevices.map((device) => {
      const metadataMatch =
        (device.traccarId && traccarById.get(String(device.traccarId))) ||
        (device.uniqueId && traccarByUniqueId.get(String(device.uniqueId)));
      const position = positionByDevice.get(String(metadataMatch?.id || device.traccarId));
      const attributes = position?.attributes || {};
      const batteryLevel = extractBatteryLevel(attributes);
      const ignition = extractIgnition(attributes);

      return {
        id: device.traccarId ? String(device.traccarId) : String(device.id),
        name: metadataMatch?.name || device.name || device.uniqueId || String(device.id),
        uniqueId: metadataMatch?.uniqueId || device.uniqueId || null,
        status: metadataMatch?.status || null,
        lastUpdate: metadataMatch?.lastUpdate || null,
        lastCommunication:
          position?.serverTime || position?.deviceTime || position?.fixTime || metadataMatch?.lastUpdate || null,
        lastPosition: (() => {
          if (!position) return null;
          return {
            latitude: position.latitude ?? null,
            longitude: position.longitude ?? null,
            speed: position.speed ?? null,
            course: position.course ?? null,
            fixTime: position.fixTime || null,
            deviceTime: position.deviceTime || null,
            serverTime: position.serverTime || null,
            address: position.address || null,
            attributes,
            batteryLevel,
            ignition,
          };
        })(),
        batteryLevel,
        ignition,
        speed: position?.speed ?? null,
      };
    });

    const responseDevices = !devices.length && metadataError && Array.isArray(fallbackDevicesFromTraccar)
      ? fallbackDevicesFromTraccar
      : data;

    return res.status(200).json({ data, devices: responseDevices, error: null });
  } catch (error) {
    if (error?.status === 400) {
      return respondBadRequest(res, error.message || "Parâmetros inválidos.");
    }

    return res.status(503).json(TRACCAR_DB_ERROR_PAYLOAD);
  }
});

router.get("/devices/:id", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", `/devices/${req.params.id}`, { asAdmin: true, context: req });
    if (data?.ok === false || data?.error) {
      const statusCandidate = Number(data?.status ?? data?.error?.code);
      const status = Number.isFinite(statusCandidate) && statusCandidate >= 400 ? statusCandidate : 502;
      const message = data?.error?.message || "Não foi possível consultar o Traccar.";
      const details = data?.error || data?.details || null;
      return res.status(status).json({ ok: false, message, details });
    }
    res.status(200).json(data);
  } catch (error) {
    const statusCandidate = Number(error?.status || error?.statusCode || error?.response?.status);
    const status = Number.isFinite(statusCandidate) && statusCandidate >= 400 ? statusCandidate : 503;
    const message = error?.message || "Não foi possível consultar o Traccar.";
    const details = error?.details || error?.response?.data || error?.cause || null;
    res.status(status).json({ ok: false, message, details });
  }
});

router.post("/devices", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("post", "/devices", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/devices/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("put", `/devices/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/devices/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    await traccarProxy("delete", `/devices/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * === Positions ===
 */

router.get("/positions", async (req, res, next) => {
  try {
    const { clientId, deviceIdsToQuery } = resolveDeviceIdsToQuery(req);
    const devices = listDevices({ clientId });
    const metadata = await fetchDevicesMetadata();
    const lookup = buildDeviceLookup(devices, metadata);

    const rawFrom = req.query?.from;
    const rawTo = req.query?.to;
    const hasDeviceFilter = req.query?.deviceId !== undefined || req.query?.deviceIds !== undefined;
    const shouldApplyRange = hasDeviceFilter || rawFrom || rawTo;

    const from = shouldApplyRange
      ? parseDateOrThrow(rawFrom || new Date(Date.now() - 24 * 60 * 60 * 1000), "from")
      : null;
    const to = shouldApplyRange ? parseDateOrThrow(rawTo || new Date(), "to") : null;
    const limit = req.query?.limit ? Number(req.query.limit) : null;

    const positions = await fetchPositions(deviceIdsToQuery, from, to, { limit });
    const data = await enrichPositionsWithAddresses(positions);

    const enriched = data.map((position) => decoratePositionWithDevice(position, lookup)).filter(Boolean);

    return res.status(200).json({ data: enriched, positions: enriched, error: null });
  } catch (error) {
    if (error?.status === 400) {
      return respondBadRequest(res, error.message || "Parâmetros inválidos.");
    }
    if (error?.status === 404) {
      return respondDeviceNotFound(res);
    }
    return res.status(503).json(TRACCAR_DB_ERROR_PAYLOAD);
  }
});

// /positions/last (compat)
router.get("/positions/last", async (req, res) => {
  const rawDeviceId = req.query?.deviceId ?? req.query?.deviceIds;
  const requestedIds = parseDeviceIds(rawDeviceId);

  if (requestedIds.length > 1) {
    return respondBadRequest(res, "Parâmetros inválidos.");
  }

  if (requestedIds.some((value) => !/^\d+$/.test(value))) {
    return respondBadRequest(res);
  }

  try {
    const { clientId, deviceIdsToQuery } = resolveDeviceIdsToQuery(req);
    const devices = listDevices({ clientId });
    const metadata = await fetchDevicesMetadata();
    const lookup = buildDeviceLookup(devices, metadata);
    if (requestedIds.length && !deviceIdsToQuery.length) {
      return respondDeviceNotFound(res);
    }

    const positions = await fetchLatestPositionsWithFallback(deviceIdsToQuery, null);

    const data = positions
      .map((position) => decoratePositionWithDevice(normalisePosition(position), lookup))
      .filter(Boolean);

    return res.status(200).json({ data, positions: data, error: null });
  } catch (error) {
    if (error?.status === 400) {
      return respondBadRequest(res, error.message || "Parâmetros inválidos.");
    }

    if (error?.status === 404) {
      return respondDeviceNotFound(res);
    }

    return res.status(503).json(TRACCAR_DB_ERROR_PAYLOAD);
  }
});

/**
 * === Events (usa /reports/events) ===
 */

router.get("/home/critical-vehicles", async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const windowHours = parsePositiveNumber(req.query?.windowHours, 3);
    const minEvents = Math.max(2, Math.floor(parsePositiveNumber(req.query?.minEvents, 2)));
    const includeResolved = ["true", "1", "yes"].includes(String(req.query?.includeResolved || "").toLowerCase());
    const limit = Math.min(2000, Math.floor(parsePositiveNumber(req.query?.limit, 500)));

    const devices = listDevices({ clientId });
    const deviceByTraccarId = new Map(
      devices
        .filter((device) => device?.traccarId != null)
        .map((device) => [String(device.traccarId), device]),
    );
    const deviceIds = Array.from(deviceByTraccarId.keys());
    if (!deviceIds.length) {
      return res.json({ data: [], error: null });
    }

    const now = new Date();
    const from = new Date(now.getTime() - windowHours * 60 * 60 * 1000).toISOString();
    const to = now.toISOString();

    const events = await fetchEventsWithFallback(deviceIds, from, to, limit);
    const vehicles = listVehicles({ clientId });
    const vehicleById = new Map(vehicles.map((vehicle) => [String(vehicle.id), vehicle]));

    const enrichedEvents = events.map((event) => {
      const device = deviceByTraccarId.get(String(event.deviceId));
      const vehicleId = device?.vehicleId ?? null;
      const resolution = getEventResolution(event.id, { clientId });
      return {
        id: event.id,
        type: event.type,
        eventTime: event.eventTime ?? event.serverTime ?? event.deviceTime ?? null,
        severity: resolveEventSeverity(event),
        resolved: Boolean(resolution),
        vehicleId,
      };
    });

    const summaries = buildCriticalVehicleSummary(enrichedEvents, {
      windowMs: windowHours * 60 * 60 * 1000,
      minEvents,
      now,
      includeResolved,
    }).map((summary) => {
      const vehicle = vehicleById.get(String(summary.vehicleId)) || null;
      return {
        ...summary,
        plate: vehicle?.plate ?? null,
      };
    });

    return res.json({ data: summaries, error: null });
  } catch (error) {
    return next(error);
  }
});

router.patch("/events/:id/resolve", async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: false });
    const resolution = markEventResolved(req.params.id, {
      clientId,
      resolvedBy: req.user?.id ?? null,
      resolvedByName: req.user?.name || req.user?.email || null,
    });
    return res.json({ ok: true, data: resolution, error: null });
  } catch (error) {
    return next(error);
  }
});

router.all("/events", (req, res, next) =>
  handleEventsReport(req, res, next),
);

/**
 * === Groups / Drivers ===
 */

router.get("/groups", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", "/groups", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/traccar/groups", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", "/groups", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/groups", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("post", "/groups", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/groups/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("put", `/groups/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/groups/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    await traccarProxy("delete", `/groups/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/drivers", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", "/drivers", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/drivers", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("post", "/drivers", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/drivers/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("put", `/drivers/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/drivers/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    await traccarProxy("delete", `/drivers/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * === Commands ===
 */

router.get("/commands/types", async (req, res, next) => {
  try {
    const params = { ...(req.query || {}) };
    enforceDeviceFilterInQuery(req, params);
    enforceClientGroupInQuery(req, params);
    const data = await traccarProxy("get", "/commands/types", { params, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/commands/send", async (req, res, next) => {
  try {
    const params = { ...(req.query || {}) };
    enforceDeviceFilterInQuery(req, params);
    enforceClientGroupInQuery(req, params);
    const data = await traccarProxy("get", "/commands/send", { params, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/commands/send-sms", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const phone = String(req.body?.phone || "").trim();
    const message = String(req.body?.message || "").trim();
    if (!phone || !message) {
      throw createError(400, "phone e message são obrigatórios");
    }

    const payload = {
      type: "sendSms",
      attributes: { phone, message },
    };

    if (req.body?.vehicleId) {
      const vehicleId = String(req.body.vehicleId).trim();
      if (vehicleId) {
        const traccarDevice = await resolveTraccarDeviceFromVehicle(req, vehicleId);
        const traccarId = Number(traccarDevice?.traccarId);
        if (Number.isFinite(traccarId)) {
          payload.deviceId = traccarId;
        }
      }
    }

    const data = await traccarProxy("post", "/commands/send", { data: payload, asAdmin: true });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
});

router.post("/commands/send", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const commandDispatchModel = ensureCommandPrismaModel("commandDispatch");
    const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: false });
    const resolvedDevice = await resolveTraccarDevice(req, { allowVehicleFallback: true });
    let vehicleId = resolvedDevice.vehicleId;
    const traccarDevice = resolvedDevice.traccarDevice || {};

    const traccarId = Number(traccarDevice?.traccarId);
    if (!Number.isFinite(traccarId)) {
      throw createError(409, "Equipamento vinculado sem traccarId");
    }

    let commandPayload = null;
    let commandName = null;
    let commandKey = null;

    const directPayload = resolveDirectCustomPayload(req.body);
    if (directPayload && !req.body?.customCommandId && !req.body?.commandKey) {
      commandPayload = directPayload;
      commandName = req.body?.commandName || req.body?.description || "Comando personalizado";
      commandKey = req.body?.commandKey || directPayload.type;
    } else if (req.body?.customCommandId) {
      const customCommandModel = ensureCommandPrismaModel("customCommand");
      const customCommandId = String(req.body.customCommandId);
      let customCommand = await customCommandModel.findFirst({
        where: {
          id: customCommandId,
          ...(clientId ? { clientId } : {}),
        },
      });
      if (!customCommand) {
        customCommand = findBuiltinCustomCommand(customCommandId);
      }
      if (!customCommand) {
        throw createError(404, "Comando personalizado não encontrado");
      }
      const deviceProtocol = traccarDevice?.protocol ? normalizeProtocolKey(traccarDevice.protocol) : null;
      if (customCommand.protocol && deviceProtocol && normalizeProtocolKey(customCommand.protocol) !== deviceProtocol) {
        throw createError(400, "Comando personalizado não compatível com o protocolo do dispositivo");
      }
      commandPayload = resolveCustomCommandPayload(customCommand);
      commandName = customCommand.name;
      commandKey = customCommand.id;
    } else {
      if (!req.body?.protocol && traccarDevice?.protocol) {
        req.body.protocol = traccarDevice.protocol;
      }
      commandPayload = resolveCommandPayload(req);
      commandName = req.body?.commandName || req.body?.commandKey || commandPayload?.type || null;
      commandKey = req.body?.commandKey || commandPayload?.type || null;
    }

    const payload = {
      type: commandPayload?.type,
      attributes: commandPayload?.attributes || {},
      deviceId: traccarId,
    };

    const shouldForceDataChannel = payload.type === "custom";
    const resolvedTextChannel =
      shouldForceDataChannel || commandPayload?.textChannel === undefined || commandPayload?.textChannel === null
        ? shouldForceDataChannel
          ? false
          : undefined
        : Boolean(commandPayload.textChannel);

    if (resolvedTextChannel !== undefined) {
      payload.textChannel = resolvedTextChannel;
    }

    payload.description = commandPayload?.description;

    if (payload.type === "sendSms" && !payload.attributes?.phone) {
      const devicePhone =
        traccarDevice?.phone ||
        traccarDevice?.phoneNumber ||
        traccarDevice?.attributes?.phone ||
        traccarDevice?.attributes?.phoneNumber ||
        null;
      if (devicePhone) {
        payload.attributes.phone = devicePhone;
      }
    }

    if (!payload.type) {
      throw createError(400, "type é obrigatório");
    }

    if (payload.type === "sendSms" && !payload.attributes?.phone) {
      throw createError(400, "Telefone do dispositivo não informado para comando SMS");
    }

    const requestId = randomUUID();
    const sentAt = new Date();
    let dispatchStatus = "pending";
    let traccarStatus = null;
    let traccarErrorMessage = null;

    try {
      await commandDispatchModel.create({
        data: {
          id: requestId,
          clientId: clientId || undefined,
          vehicleId,
          traccarId,
          commandKey,
          commandName,
          payloadSummary: { type: payload.type, attributes: payload.attributes },
          sentAt,
          status: dispatchStatus,
          createdBy: req.user?.id || undefined,
        },
      });
    } catch (error) {
      console.warn("[commands] Falha ao registrar dispatch no banco", error?.message || error);
    }

    let traccarResponse = null;
    try {
      traccarResponse = await traccarRequest(
        { method: "POST", url: "/commands/send", data: payload },
        req,
        { asAdmin: true },
      );
    } catch (requestError) {
      dispatchStatus = "failed";
      traccarStatus = resolveErrorStatusCode(requestError);
      traccarErrorMessage =
        resolveTraccarErrorMessage(requestError?.response?.data, requestError?.message) ||
        "Falha ao enviar comando ao Traccar";
    }

    if (traccarResponse && !traccarResponse.ok) {
      dispatchStatus = "failed";
      traccarStatus = Number(traccarResponse?.error?.code) || null;
    } else if (traccarResponse?.ok) {
      dispatchStatus = "sent";
      traccarStatus = traccarResponse?.status ?? 201;
    }

    const warningMessage =
      dispatchStatus === "failed"
        ? resolveTraccarErrorMessage(traccarResponse, traccarErrorMessage) ||
          traccarErrorMessage ||
          "Falha ao enviar comando ao Traccar"
        : null;

    let traccarCommandId = null;
    if (traccarResponse?.ok && traccarResponse?.data?.id) {
      traccarCommandId = traccarResponse.data.id;
    }

    try {
      await commandDispatchModel.update({
        where: { id: requestId },
        data: {
          status: dispatchStatus,
          ...(traccarCommandId ? { traccarCommandId } : {}),
        },
      });
    } catch (error) {
      console.warn("[commands] Falha ao atualizar status do dispatch no banco", error?.message || error);
    }

    console.info("[commands] dispatch", {
      vehicleId,
      euroOneDeviceId: traccarDevice?.id || null,
      traccarId,
      payloadType: payload.type,
      status: dispatchStatus,
      traccarStatus,
    });

    const userLabel = req.user?.name || req.user?.username || req.user?.email || null;
    const historyItem = buildCommandHistoryItem({
      id: requestId,
      vehicleId,
      traccarId,
      user: req.user?.id ? { id: req.user.id, name: userLabel } : null,
      command: commandName || commandKey || payload.type,
      commandName,
      payload: payload,
      status: mapDispatchStatusToApi(dispatchStatus, false),
      sentAt: sentAt.toISOString(),
      receivedAt: null,
      respondedAt: null,
      result: warningMessage,
      source: "EURO_ONE",
      traccarCommandId,
    });

    if (!traccarResponse?.ok) {
      const message = warningMessage || "Falha ao enviar comando ao Traccar";
      return res.status(201).json({
        ok: false,
        warning: message,
        data: historyItem,
      });
    }

    return res.status(201).json({
      ok: true,
      data: historyItem,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/commands", async (req, res, next) => {
  try {
    const params = { ...(req.query || {}) };
    enforceDeviceFilterInQuery(req, params);
    enforceClientGroupInQuery(req, params);
    const data = await traccarProxy("get", "/commands", { params, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/commands/history", async (req, res, next) => {
  try {
    const vehicleId = req.query?.vehicleId ? String(req.query.vehicleId).trim() : "";
    if (!vehicleId) {
      throw createError(400, "vehicleId é obrigatório");
    }
    const clientId = resolveClientId(req, req.query?.clientId, { required: false });

    const now = new Date();
    const from = parseDateOrThrow(
      req.query?.from ?? new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      "from",
    );
    const to = parseDateOrThrow(req.query?.to ?? now.toISOString(), "to");
    const page = req.query?.page ? Number(req.query.page) : 1;
    const pageSize = req.query?.pageSize ? Number(req.query.pageSize) : 10;
    if (!Number.isFinite(page) || page <= 0) {
      throw createError(400, "page inválida");
    }
    if (!Number.isFinite(pageSize) || pageSize <= 0) {
      throw createError(400, "pageSize inválido");
    }

    const traccarDevice = await resolveTraccarDeviceFromVehicle(req, vehicleId);
    const traccarId = Number(traccarDevice?.traccarId);
    if (!Number.isFinite(traccarId)) {
      throw createError(409, "Equipamento vinculado sem traccarId");
    }

    let dispatches = [];
    let userLookup = new Map();
    if (isPrismaAvailable()) {
      try {
        const dispatchModel = ensureCommandPrismaModel("commandDispatch");
        dispatches = await dispatchModel.findMany({
          where: {
            vehicleId,
            ...(clientId ? { clientId } : {}),
            sentAt: {
              gte: from,
              lte: to,
            },
          },
          orderBy: { sentAt: "asc" },
        });

        const userIds = Array.from(new Set(dispatches.map((dispatch) => dispatch.createdBy).filter(Boolean)));
        if (userIds.length && prisma?.user?.findMany) {
          const users = await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true, username: true },
          });
          userLookup = new Map(
            users.map((user) => [
              user.id,
              user.name || user.username || user.email || user.id,
            ]),
          );
        }
      } catch (error) {
        console.warn("[commands] Falha ao buscar histórico no banco, retornando apenas Traccar", error?.message || error);
      }
    }

    let traccarWarning = null;
    let eventItems = [];
    try {
      const events = await fetchCommandResultEvents(traccarId, from, to);
      eventItems = events
        .filter((event) => event?.type === "commandResult")
        .map((event) => {
          return {
            id: event.id ?? null,
            eventTime: event.eventTime ?? null,
            result: resolveCommandResultText(event),
            commandName: resolveCommandNameFromEvent(event),
            attributes: event?.attributes || {},
          };
        });
    } catch (error) {
      traccarWarning = error?.message || "Falha ao consultar eventos do Traccar";
    }

    const parsedEvents = eventItems
      .map((event) => ({
        ...event,
        parsedTime: event.eventTime ? new Date(event.eventTime) : null,
      }))
      .filter((event) => event.parsedTime && Number.isFinite(event.parsedTime.getTime()))
      .sort((a, b) => a.parsedTime - b.parsedTime);

    const usedEventIds = new Set();
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    const matchWindowMs = Number.isFinite(toMs - fromMs)
      ? Math.max(toMs - fromMs, 2 * 60 * 60 * 1000)
      : 2 * 60 * 60 * 1000;
    const allowSkewMs = 15 * 60 * 1000;
    const dispatchItems = dispatches.map((dispatch) => {
      let matched = null;

      if (dispatch.status !== "failed") {
        matched = findMatchingCommandEvent({
          dispatch,
          parsedEvents,
          usedEventIds,
          matchWindowMs,
          allowSkewMs,
        });
      }

      if (matched?.id) {
        usedEventIds.add(matched.id);
      }

      const userName = dispatch.createdBy ? userLookup.get(dispatch.createdBy) || null : null;
      const payloadSummary = dispatch.payloadSummary && typeof dispatch.payloadSummary === "object" ? dispatch.payloadSummary : null;
      const resolvedCommandName = dispatch.commandName || dispatch.commandKey || payloadSummary?.type || null;
      const receivedAt = matched?.eventTime || null;
      const status = mapDispatchStatusToApi(dispatch.status, Boolean(receivedAt));

      return buildCommandHistoryItem({
        id: dispatch.id,
        vehicleId,
        traccarId,
        user: dispatch.createdBy ? { id: dispatch.createdBy, name: userName } : null,
        command: resolvedCommandName,
        commandName: resolvedCommandName,
        payload: payloadSummary,
        status,
        sentAt: dispatch.sentAt?.toISOString ? dispatch.sentAt.toISOString() : dispatch.sentAt,
        receivedAt,
        respondedAt: receivedAt,
        result: matched?.result || null,
        source: "EURO_ONE",
        traccarCommandId: dispatch.traccarCommandId || null,
      });
    });

    const unmatchedEvents = parsedEvents
      .filter((event) => !usedEventIds.has(event.id))
      .map((event) => ({
        id: event.id ? `event-${event.id}` : `event-${event.eventTime}`,
        eventTime: event.eventTime,
        commandName: event.commandName,
        result: event.result,
        attributes: event.attributes || {},
      }));

    const traccarItems = unmatchedEvents.map((event) =>
      buildCommandHistoryItem({
        id: event.id,
        vehicleId,
        traccarId,
        user: null,
        command: event.commandName || null,
        commandName: event.commandName || null,
        payload: event.attributes || null,
        status: "RESPONDED",
        sentAt: null,
        receivedAt: event.eventTime,
        respondedAt: event.eventTime,
        result: event.result,
        source: "TRACCAR",
        traccarCommandId: event.id || null,
      }),
    );

    const merged = [...dispatchItems, ...traccarItems]
      .filter((item) => item.sentAt || item.receivedAt)
      .sort((a, b) => {
        const timeA = new Date(a.receivedAt || a.sentAt).getTime();
        const timeB = new Date(b.receivedAt || b.sentAt).getTime();
        return timeB - timeA;
      });

    const total = merged.length;
    const start = (page - 1) * pageSize;
    const items = merged.slice(start, start + pageSize);

    res.json({
      data: {
        vehicleId,
        traccarId,
        items,
        pagination: { page, pageSize, total },
      },
      warning: traccarWarning,
      error: null,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/commands/history/status", async (req, res, next) => {
  try {
    const vehicleId = req.query?.vehicleId ? String(req.query.vehicleId).trim() : "";
    if (!vehicleId) {
      throw createError(400, "vehicleId é obrigatório");
    }
    const idsParam = req.query?.ids;
    const ids = Array.isArray(idsParam)
      ? idsParam.map((id) => String(id).trim()).filter(Boolean)
      : String(idsParam || "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
    if (ids.length === 0) {
      return res.json({ data: { items: [] }, warning: null, error: null });
    }

    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const uuidIds = ids.filter((id) => isUuid(id));
    const nonUuidItems = ids
      .filter((id) => !isUuid(id))
      .map((id) => ({
        id,
        status: "PENDING",
        receivedAt: null,
        respondedAt: null,
        result: null,
        command: null,
        commandName: null,
        sentAt: null,
        user: null,
        traccarCommandId: null,
      }));

    if (!isPrismaAvailable()) {
      return res.json({
        data: { items: nonUuidItems },
        warning: "Banco indisponível para atualizar status do histórico.",
        error: null,
      });
    }

    const traccarDevice = await resolveTraccarDeviceFromVehicle(req, vehicleId);
    const traccarId = Number(traccarDevice?.traccarId);
    if (!Number.isFinite(traccarId)) {
      throw createError(409, "Equipamento vinculado sem traccarId");
    }

    const dispatchModel = ensureCommandPrismaModel("commandDispatch");
    if (uuidIds.length === 0) {
      return res.json({ data: { items: nonUuidItems }, warning: null, error: null });
    }

    const dispatches = await dispatchModel.findMany({
      where: {
        id: { in: uuidIds },
        vehicleId,
        ...(clientId ? { clientId } : {}),
      },
      orderBy: { sentAt: "asc" },
    });

    if (!dispatches.length) {
      return res.json({ data: { items: nonUuidItems }, warning: null, error: null });
    }

    const sentTimes = dispatches.map((dispatch) => new Date(dispatch.sentAt)).filter((date) => !Number.isNaN(date.getTime()));
    const from = sentTimes.length
      ? new Date(Math.min(...sentTimes.map((date) => date.getTime()))).toISOString()
      : new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const to = new Date().toISOString();

    let traccarWarning = null;
    let eventItems = [];
    try {
      const events = await fetchCommandResultEvents(traccarId, from, to, Math.max(dispatches.length * 2, 20));
      eventItems = events
        .filter((event) => event?.type === "commandResult")
        .map((event) => ({
          id: event.id ?? null,
          eventTime: event.eventTime ?? null,
          result: resolveCommandResultText(event),
          attributes: event?.attributes || {},
        }));
    } catch (error) {
      traccarWarning = error?.message || "Falha ao consultar eventos do Traccar";
    }

    const parsedEvents = eventItems
      .map((event) => ({
        ...event,
        parsedTime: event.eventTime ? new Date(event.eventTime) : null,
      }))
      .filter((event) => event.parsedTime && Number.isFinite(event.parsedTime.getTime()))
      .sort((a, b) => a.parsedTime - b.parsedTime);

    const usedEventIds = new Set();
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    const matchWindowMs = Number.isFinite(toMs - fromMs)
      ? Math.max(toMs - fromMs, 2 * 60 * 60 * 1000)
      : 2 * 60 * 60 * 1000;
    const allowSkewMs = 15 * 60 * 1000;

    let userLookup = new Map();
    if (dispatches.length && prisma?.user?.findMany) {
      const userIds = Array.from(new Set(dispatches.map((dispatch) => dispatch.createdBy).filter(Boolean)));
      if (userIds.length) {
        const users = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, username: true },
        });
        userLookup = new Map(
          users.map((user) => [
            user.id,
            user.name || user.username || user.email || user.id,
          ]),
        );
      }
    }

    const items = dispatches.map((dispatch) => {
      let matched = null;

      if (dispatch.status !== "failed") {
        matched = findMatchingCommandEvent({
          dispatch,
          parsedEvents,
          usedEventIds,
          matchWindowMs,
          allowSkewMs,
        });
      }

      if (matched?.id) {
        usedEventIds.add(matched.id);
      }

      const userName = dispatch.createdBy ? userLookup.get(dispatch.createdBy) || null : null;
      const payloadSummary = dispatch.payloadSummary && typeof dispatch.payloadSummary === "object" ? dispatch.payloadSummary : null;
      const resolvedCommandName = dispatch.commandName || dispatch.commandKey || payloadSummary?.type || null;
      const status = mapDispatchStatusToApi(dispatch.status, Boolean(matched?.eventTime));
      return {
        id: dispatch.id,
        status,
        receivedAt: matched?.eventTime || null,
        respondedAt: matched?.eventTime || null,
        result: matched?.result || null,
        command: resolvedCommandName,
        commandName: resolvedCommandName,
        sentAt: dispatch.sentAt?.toISOString ? dispatch.sentAt.toISOString() : dispatch.sentAt,
        user: dispatch.createdBy ? { id: dispatch.createdBy, name: userName } : null,
        traccarCommandId: dispatch.traccarCommandId || null,
      };
    });

    return res.json({
      data: { items: [...nonUuidItems, ...items] },
      warning: traccarWarning,
      error: null,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/commands/custom", async (req, res, next) => {
  try {
    let clientId = null;
    try {
      clientId = resolveClientId(req, req.query?.clientId, { required: false });
    } catch (error) {
      if (error?.status === 403) {
        throw error;
      }
      return res.status(200).json({
        data: [],
        error: { message: error?.message || "Não foi possível identificar o cliente para listar comandos personalizados." },
      });
    }

    if (!clientId) {
      return res.status(200).json({
        data: [],
        error: { message: "Cliente não identificado para listar comandos personalizados." },
      });
    }

    const includeHidden = String(req.query?.includeHidden || "").toLowerCase() === "true";
    let protocol = req.query?.protocol ? normalizeProtocolKey(req.query.protocol) : null;
    const deviceId = req.query?.deviceId ? String(req.query.deviceId).trim() : "";
    const canSeeHidden = includeHidden && ["manager", "admin"].includes(req.user?.role);
    const customCommandModel = ensureCommandPrismaModel("customCommand");
    const prismaAvailable = isPrismaAvailable();

    if (!protocol && deviceId) {
      try {
        const traccarDevice = await traccarProxy("get", `/devices/${deviceId}`, { asAdmin: true, context: req });
        protocol = traccarDevice?.protocol ? normalizeProtocolKey(traccarDevice.protocol) : null;
      } catch (error) {
        console.warn("[commands] Falha ao resolver protocolo do device", {
          deviceId,
          message: error?.message || error,
        });
      }
    }

    const commands = prismaAvailable
      ? await customCommandModel.findMany({
          where: {
            clientId,
            ...(canSeeHidden ? {} : { visible: true }),
            ...(protocol ? { protocol } : {}),
          },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        })
      : [];

    const builtinCommands = getBuiltinCustomCommands(protocol)
      .filter((command) => canSeeHidden || command.visible)
      .map((command) => ({
        ...command,
        visible: Boolean(command.visible),
      }));

    res.json({
      data: [...builtinCommands, ...commands],
      error: prismaAvailable ? null : { message: "Banco indisponível para listar comandos personalizados." },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/commands/custom", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: true });
    const customCommandModel = ensureCommandPrismaModel("customCommand");
    const input = normalizeCustomCommandInput(req.body);
    if (!isPrismaAvailable()) {
      return res.status(200).json({
        data: null,
        error: { message: "Banco indisponível para salvar o comando personalizado." },
      });
    }

    const sortOrder =
      input.sortOrder !== null
        ? input.sortOrder
        : await resolveNextCustomCommandOrder(customCommandModel, clientId, input.protocol);

    const duplicate = await customCommandModel.findFirst({
      where: {
        clientId,
        name: input.name,
        kind: input.kind,
        protocol: input.protocol ?? null,
        payload: { equals: input.payload },
      },
    });
    if (duplicate) {
      throw createError(409, "Já existe um comando personalizado igual para este cliente");
    }

    const command = await customCommandModel.create({
      data: {
        clientId,
        name: input.name,
        description: input.description,
        kind: input.kind,
        payload: input.payload,
        visible: input.visible,
        protocol: input.protocol,
        sortOrder,
        createdBy: req.user?.id || undefined,
      },
    });

    res.status(201).json({ data: command, error: null });
  } catch (error) {
    next(error);
  }
});

router.put("/commands/custom/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    if (findBuiltinCustomCommand(req.params.id)) {
      throw createError(403, "Comando personalizado de template não pode ser alterado");
    }
    const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: true });
    const customCommandModel = ensureCommandPrismaModel("customCommand");
    const input = normalizeCustomCommandInput(req.body);
    if (!isPrismaAvailable()) {
      return res.status(200).json({
        data: null,
        error: { message: "Banco indisponível para atualizar o comando personalizado." },
      });
    }

    const existing = await customCommandModel.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      throw createError(404, "Comando personalizado não encontrado");
    }
    if (String(existing.clientId) !== String(clientId) && req.user?.role !== "admin") {
      throw createError(403, "Operação não permitida para este cliente");
    }

    const command = await customCommandModel.update({
      where: { id: req.params.id },
      data: {
        name: input.name,
        description: input.description,
        kind: input.kind,
        payload: input.payload,
        visible: input.visible,
        protocol: input.protocol,
        ...(input.sortOrder !== null ? { sortOrder: input.sortOrder } : {}),
      },
    });

    res.json({ data: command, error: null });
  } catch (error) {
    next(error);
  }
});

router.patch("/commands/custom/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    if (findBuiltinCustomCommand(req.params.id)) {
      throw createError(403, "Comando personalizado de template não pode ser alterado");
    }
    const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: true });
    const customCommandModel = ensureCommandPrismaModel("customCommand");
    if (!isPrismaAvailable()) {
      return res.status(200).json({
        data: null,
        error: { message: "Banco indisponível para ajustar o comando personalizado." },
      });
    }

    const existing = await customCommandModel.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      throw createError(404, "Comando personalizado não encontrado");
    }
    if (String(existing.clientId) !== String(clientId) && req.user?.role !== "admin") {
      throw createError(403, "Operação não permitida para este cliente");
    }

    const nextVisible = req.body?.visible !== undefined ? Boolean(req.body.visible) : undefined;
    const nextSortOrderRaw = req.body?.sortOrder;
    const nextSortOrder = Number.isFinite(Number(nextSortOrderRaw)) ? Number(nextSortOrderRaw) : undefined;

    const command = await customCommandModel.update({
      where: { id: req.params.id },
      data: {
        ...(nextVisible !== undefined ? { visible: nextVisible } : {}),
        ...(nextSortOrder !== undefined ? { sortOrder: nextSortOrder } : {}),
      },
    });

    res.json({ data: command, error: null });
  } catch (error) {
    next(error);
  }
});

router.delete("/commands/custom/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    if (findBuiltinCustomCommand(req.params.id)) {
      throw createError(403, "Comando personalizado de template não pode ser removido");
    }
    const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: true });
    const customCommandModel = ensureCommandPrismaModel("customCommand");
    if (!isPrismaAvailable()) {
      return res.status(200).json({
        data: null,
        error: { message: "Banco indisponível para remover o comando personalizado." },
      });
    }

    const normalizedId = String(req.params.id);
    const deletion = await customCommandModel.deleteMany({ where: { id: normalizedId, clientId } });

    if (!deletion?.count) {
      return res.status(404).json({
        data: null,
        error: { code: "NOT_FOUND", message: "Comando não encontrado" },
      });
    }

    res.status(200).json({ data: { id: normalizedId }, error: null });
  } catch (error) {
    next(error);
  }
});

router.post("/commands", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const allowed = resolveAllowedDeviceIds(req);
    const traccarDeviceId = resolveTraccarDeviceId(req, allowed);
    if (!traccarDeviceId) {
      throw createError(400, "deviceId é obrigatório");
    }

    const payload = {
      type: req.body?.type,
      attributes: req.body?.attributes || {},
      deviceId: Number(traccarDeviceId),
    };

    if (!payload.type) {
      throw createError(400, "type é obrigatório");
    }

    const data = await traccarProxy("post", "/commands", { data: payload, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/commands/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("put", `/commands/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/commands/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    await traccarProxy("delete", `/commands/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

async function buildPositionsReportData(req, { vehicleId, from, to, addressFilter }) {
  if (!vehicleId) {
    throw createError(400, "vehicleId é obrigatório");
  }
  if (!from || !to) {
    throw createError(400, "from/to são obrigatórios");
  }

  const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: false });
  const vehicles = listVehicles({ clientId });
  const vehicle = vehicles.find((item) => String(item.id) === String(vehicleId));
  if (!vehicle) {
    throw createError(404, "Veículo não encontrado");
  }

  const devices = listDevices({ clientId });
  const device = devices.find((item) => String(item.vehicleId) === String(vehicleId));
  if (!device?.traccarId) {
    throw createError(409, "Equipamento vinculado sem traccarId");
  }

  const traccarId = String(device.traccarId);
  const positions = await fetchPositions([traccarId], from, to, {});
  const enrichedPositions = await enrichPositionsWithAddresses(positions);

  let filter = null;
  if (addressFilter?.lat != null && addressFilter?.lng != null) {
    const lat = Number(addressFilter.lat);
    const lng = Number(addressFilter.lng);
    const radius = Number(addressFilter.radius ?? DEFAULT_REPORT_RADIUS_METERS);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      filter = {
        lat,
        lng,
        radius: Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_REPORT_RADIUS_METERS,
      };
    }
  }
  const filteredPositions = filter
    ? enrichedPositions.filter((position) => {
        if (position.latitude == null || position.longitude == null) return false;
        const distance = computeDistanceMeters(
          { lat: filter.lat, lng: filter.lng },
          { lat: position.latitude, lng: position.longitude },
        );
        return distance <= (filter.radius ?? DEFAULT_REPORT_RADIUS_METERS);
      })
    : enrichedPositions;

  const commandFrom = new Date(new Date(from).getTime() - 10 * 60 * 1000).toISOString();
  const commandTo = new Date(new Date(to).getTime() + 10 * 60 * 1000).toISOString();
  let commandEvents = [];
  try {
    commandEvents = await fetchCommandResultEvents(Number(traccarId), commandFrom, commandTo);
  } catch (error) {
    console.warn("[reports/positions] falha ao buscar comandos", error?.message || error);
  }
  const parsedEvents = parseCommandEvents(commandEvents);
  const windowMs = 10 * 60 * 1000;

  const mapped = filteredPositions.map((position) => {
    const attributes = position.attributes || {};
    const gpsTime = position.fixTime || position.deviceTime || position.serverTime || null;
    const speedRaw = Number(position.speed ?? 0);
    const speedKmh = Number.isFinite(speedRaw) ? Math.round(speedRaw * 3.6) : null;
    const ignition = extractIgnition(attributes);
    const commandResponse = gpsTime
      ? findLatestCommandResponse(parsedEvents, new Date(gpsTime).getTime(), windowMs)
      : null;

    return {
      id: position.id ?? null,
      gpsTime,
      deviceTime: position.deviceTime || null,
      serverTime: position.serverTime || null,
      latitude: position.latitude ?? null,
      longitude: position.longitude ?? null,
      address: position.address || "Endereço não disponível",
      speed: speedKmh,
      direction: position.course ?? null,
      ignition,
      vehicleState: resolveVehicleState(ignition, speedKmh ?? 0),
      batteryLevel: extractBatteryLevel(attributes),
      rssi: extractRssi(attributes),
      satellites: extractSatellites(attributes),
      geofence: attributes.geofence ?? attributes.geofenceId ?? null,
      accuracy: position.accuracy ?? null,
      commandResponse: commandResponse || null,
    };
  });

  mapped.sort((a, b) => {
    const timeA = a.gpsTime ? new Date(a.gpsTime).getTime() : 0;
    const timeB = b.gpsTime ? new Date(b.gpsTime).getTime() : 0;
    return timeB - timeA;
  });

  const latestPosition = mapped[0] || null;
  const client = vehicle?.clientId ? await getClientById(vehicle.clientId).catch(() => null) : null;
  const ignitionLabel =
    latestPosition?.ignition === true ? "Ligado" : latestPosition?.ignition === false ? "Desligado" : "—";

  const meta = {
    generatedAt: new Date().toISOString(),
    from,
    to,
    vehicle: {
      id: vehicle.id,
      plate: vehicle.plate || null,
      name: vehicle.name || null,
      customer: client?.name || null,
      deviceId: device.uniqueId || device.id || traccarId,
      status: vehicle.status || null,
      lastCommunication: latestPosition?.gpsTime || null,
      ignition: ignitionLabel,
    },
    exportedBy: req.user?.name || req.user?.username || req.user?.email || req.user?.id || null,
  };

  return { positions: mapped, meta };
}

/**
 * === Reports (GET no nosso backend, GET→POST no Traccar) ===
 */

router.get("/reports/positions", async (req, res) => {
  try {
    const vehicleId = req.query?.vehicleId ? String(req.query.vehicleId).trim() : "";
    const from = parseDateOrThrow(req.query?.from, "from");
    const to = parseDateOrThrow(req.query?.to, "to");
    const addressFilter = parseAddressFilterQuery(req.query);

    const report = await buildPositionsReportData(req, { vehicleId, from, to, addressFilter });
    return res.status(200).json({ data: report.positions, meta: report.meta, error: null });
  } catch (error) {
    if (error?.status === 400) {
      return respondBadRequest(res, error.message || "Parâmetros inválidos.");
    }
    if (error?.status === 404) {
      return res.status(404).json({ data: [], error: { message: error.message, code: "NOT_FOUND" } });
    }
    if (error?.status === 409) {
      return res.status(409).json({ data: [], error: { message: error.message, code: "DEVICE_MISSING" } });
    }
    return res.status(503).json(TRACCAR_DB_ERROR_PAYLOAD);
  }
});

router.post("/reports/positions/pdf", async (req, res, next) => {
  try {
    const vehicleId = req.body?.vehicleId ? String(req.body.vehicleId).trim() : "";
    const from = parseDateOrThrow(req.body?.from, "from");
    const to = parseDateOrThrow(req.body?.to, "to");
    const addressFilter = req.body?.addressFilter || null;
    const columns = Array.isArray(req.body?.columns) ? req.body.columns : [];
    if (!columns.length) {
      throw createError(400, "columns é obrigatório");
    }

    const report = await buildPositionsReportData(req, { vehicleId, from, to, addressFilter });
    const pdf = await generatePositionsReportPdf({
      rows: report.positions,
      columns,
      meta: report.meta,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=\"position-report.pdf\"");
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

router.get("/reports/route",   (req, res, next) => proxyTraccarReport(req, res, next, "/reports/route"));
router.get("/reports/summary", (req, res, next) => proxyTraccarReport(req, res, next, "/reports/summary"));
router.get("/reports/stops",   (req, res, next) => proxyTraccarReport(req, res, next, "/reports/stops"));
router.get("/reports/trips", async (req, res) => {
  const accept = pickAccept(String(req.query?.format || ""));
  const wantsBinary = accept !== "application/json";
  if (wantsBinary) {
    // Exportações pesadas continuam usando a API HTTP do Traccar; leitura online usa o banco (traccarDb).
    return proxyTraccarReport(req, res, () => {}, "/reports/trips");
  }

  try {
    const { clientId, deviceIdsToQuery } = resolveDeviceIdsToQuery(req);
    const from = parseDateOrThrow(req.query?.from, "from");
    const to = parseDateOrThrow(req.query?.to, "to");

    const tripsPerDevice = await Promise.all(
      deviceIdsToQuery.map(async (deviceId) => {
        const trips = await fetchTrips(deviceId, from, to);
        return trips.map((trip) => ({ ...trip, deviceId }));
      }),
    );

    const data = {
      clientId: clientId || null,
      deviceIds: deviceIdsToQuery,
      from,
      to,
      trips: tripsPerDevice.flat(),
    };

    return res.status(200).json({ data, error: null });
  } catch (error) {
    if (error?.status === 400) {
      return respondBadRequest(res, error.message || "Parâmetros inválidos.");
    }
    if (error?.status === 404) {
      return respondDeviceNotFound(res);
    }
    return res.status(503).json(TRACCAR_DB_ERROR_PAYLOAD);
  }
});

router.get("/reports/events", (req, res, next) => handleEventsReport(req, res, next));

/**
 * === Notifications ===
 */

router.get("/notifications", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", "/notifications", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/notifications", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("post", "/notifications", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/notifications/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("put", `/notifications/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/notifications/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    await traccarProxy("delete", `/notifications/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * === Users (quando target=traccar) ===
 */

router.get("/users", async (req, res, next) => {
  if (!isTraccarUserRequest(req)) return next();
  try {
    const params = sanitizeUserQuery(req.query);
    const data = await traccarProxy("get", "/users", { params, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/users", requireRole("manager", "admin"), async (req, res, next) => {
  if (!isTraccarUserRequest(req)) return next();
  try {
    const data = await traccarProxy("post", "/users", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/users/:id", requireRole("manager", "admin"), async (req, res, next) => {
  if (!isTraccarUserRequest(req)) return next();
  try {
    const data = await traccarProxy("put", `/users/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/users/:id", requireRole("manager", "admin"), async (req, res, next) => {
  if (!isTraccarUserRequest(req)) return next();
  try {
    await traccarProxy("delete", `/users/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * === Geofences ===
 */

router.get("/geofences", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", "/geofences", { params: req.query, asAdmin: true });
    const withGroups = Array.isArray(data)
      ? data.map((item) => ({
          ...item,
          geofenceGroupIds: getGroupIdsForGeofence(item?.id ?? item?.geofenceId, { clientId: req.user?.clientId }),
        }))
      : data;
    res.json(withGroups);
  } catch (error) {
    next(error);
  }
});

router.post("/geofences", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("post", "/geofences", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/geofences/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("put", `/geofences/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/geofences/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    await traccarProxy("delete", `/geofences/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * === Permissions ===
 */

router.post("/permissions", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("post", "/permissions", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

/**
 * === Compat: POST /api/reports/trips (front antigo) ===
 */

router.post("/reports/trips", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    enforceDeviceFilterInBody(req);
    enforceClientGroupInBody(req);

    let body = { ...(req.body || {}) };
    body = normalizeReportDeviceIds(body);

    if (!body.from || !body.to) {
      const now = new Date();
      const to = body.to ? new Date(body.to) : now;
      const from = body.from ? new Date(body.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
      body.from = from.toISOString();
      body.to = to.toISOString();
    }

    const accept = pickAccept(String(body.format || ""));
    const wantsBinary = accept !== "application/json";

    if (wantsBinary && String(body.format || "").toLowerCase() === "csv") {
      const jsonResponse = await requestReportWithFallback("/reports/trips", body, "application/json", false);
      const normalized = await normalizeReportPayload("/reports/trips", jsonResponse?.data);
      const csv = buildTripsCsv(normalized?.trips || []);
      res.setHeader("Content-Type", "text/csv");
      res.send(csv);
      return;
    }

    const response = await requestReportWithFallback("/reports/trips", body, accept, wantsBinary);

    if (wantsBinary) {
      res.setHeader("Content-Type", accept);
      res.send(Buffer.from(response.data));
    } else {
      res.json(await normalizeReportPayload("/reports/trips", response?.data));
    }
  } catch (error) {
    if (error?.response) {
      console.error(
        "[traccar report error] /reports/trips",
        error.response.status,
        typeof error.response.data === "string" ? error.response.data : JSON.stringify(error.response.data),
      );
    } else {
      console.error("[traccar report error] /reports/trips", error?.message);
    }
    const status = error?.response?.status ?? 500;
    const message =
      error?.response?.data?.message ||
      (typeof error?.response?.data === "string" ? error.response.data : null) ||
      error?.message ||
      "Erro ao gerar relatório";
    next(createError(status, message));
  }
});

export default router;
