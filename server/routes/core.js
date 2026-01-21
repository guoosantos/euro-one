import express from "express";
import createError from "http-errors";
import { randomUUID } from "crypto";

import { authenticate, requireRole } from "../middleware/auth.js";
import * as clientMiddleware from "../middleware/client.js";
import { resolveClientIdMiddleware } from "../middleware/resolve-client.js";
import { authorizePermission } from "../middleware/permissions.js";
import * as clientModel from "../models/client.js";
import * as modelModel from "../models/model.js";
import * as deviceModel from "../models/device.js";
import * as chipModel from "../models/chip.js";
import * as vehicleModel from "../models/vehicle.js";
import * as stockModel from "../models/stock-item.js";
import * as traccarService from "../services/traccar.js";
import * as traccarDbService from "../services/traccar-db.js";
import * as traccarSyncService from "../services/traccar-sync.js";
import { ensureTraccarRegistryConsistency } from "../services/traccar-coherence.js";
import { syncDevicesFromTraccar } from "../services/device-sync.js";
import { recordAuditEvent, resolveRequestIp } from "../services/audit-log.js";
import { ingestSignalStateEvents } from "../services/signal-events.js";
import { listTelemetryFieldMappings } from "../models/tracker-mapping.js";
import { createUser, deleteUser, getUserById, updateUser } from "../models/user.js";
import { listGroups } from "../models/group.js";
import { config } from "../config.js";
import prisma, { isPrismaAvailable } from "../services/prisma.js";
import { getAccessibleVehicles } from "../services/accessible-vehicles.js";
import * as addressUtils from "../utils/address.js";
import { createTtlCache } from "../utils/ttl-cache.js";
import { importEuroXlsx } from "../services/euro-xlsx-import.js";

const router = express.Router();

const TECHNICIAN_ROLE = "technician";
const defaultDeps = {
  authenticate,
  requireRole,
  resolveClientId: clientMiddleware.resolveClientId,
  resolveClientIdMiddleware,
  getClientById: clientModel.getClientById,
  updateClient: clientModel.updateClient,
  listModels: modelModel.listModels,
  createModel: modelModel.createModel,
  getModelById: modelModel.getModelById,
  listDevices: deviceModel.listDevices,
  createDevice: deviceModel.createDevice,
  updateDevice: deviceModel.updateDevice,
  getDeviceById: deviceModel.getDeviceById,
  findDeviceByUniqueId: deviceModel.findDeviceByUniqueId,
  findDeviceByUniqueIdInDb: deviceModel.findDeviceByUniqueIdInDb,
  findDeviceByTraccarId: deviceModel.findDeviceByTraccarId,
  deleteDevice: deviceModel.deleteDevice,
  listChips: chipModel.listChips,
  createChip: chipModel.createChip,
  updateChip: chipModel.updateChip,
  getChipById: chipModel.getChipById,
  deleteChip: chipModel.deleteChip,
  listVehicles: vehicleModel.listVehicles,
  createVehicle: vehicleModel.createVehicle,
  updateVehicle: vehicleModel.updateVehicle,
  getVehicleById: vehicleModel.getVehicleById,
  deleteVehicle: vehicleModel.deleteVehicle,
  listStockItems: stockModel.listStockItems,
  createStockItem: stockModel.createStockItem,
  updateStockItem: stockModel.updateStockItem,
  getStockItemById: stockModel.getStockItemById,
  deleteStockItem: stockModel.deleteStockItem,
  traccarProxy: traccarService.traccarProxy,
  buildTraccarUnavailableError: traccarService.buildTraccarUnavailableError,
  fetchLatestPositions: traccarDbService.fetchLatestPositions,
  fetchLatestPositionsWithFallback: traccarDbService.fetchLatestPositionsWithFallback,
  fetchDevicesMetadata: traccarDbService.fetchDevicesMetadata,
  isTraccarDbConfigured: traccarDbService.isTraccarDbConfigured,
  listTelemetryFieldMappings,
  ensureTraccarRegistryConsistency,
  getCachedTraccarResources: traccarSyncService.getCachedTraccarResources,
  enrichPositionsWithAddresses: addressUtils.enrichPositionsWithAddresses,
  ensureCachedPositionAddress: addressUtils.ensureCachedPositionAddress,
};

const deps = { ...defaultDeps };

const resolveClientMiddleware = (req, res, next) => deps.resolveClientIdMiddleware(req, res, next);

router.use((req, res, next) => deps.authenticate(req, res, next));
router.use(resolveClientMiddleware);

function normaliseList(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function resolveAuditUser(req) {
  const name = req.user?.name || req.user?.username || req.user?.email || req.user?.id || null;
  if (!name) return null;
  return { id: req.user?.id ? String(req.user.id) : null, name };
}

function isTruthyParam(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function parsePagination(query) {
  const page = Math.max(1, Number(query?.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query?.pageSize) || 20));
  const start = (page - 1) * pageSize;
  return { page, pageSize, start };
}

function mergeById(primary = [], secondary = []) {
  const map = new Map(primary.map((item) => [String(item.id), item]));
  secondary.forEach((item) => {
    const key = String(item.id);
    if (!map.has(key)) {
      map.set(key, item);
    }
  });
  return Array.from(map.values());
}

function filterMappingsForDevice(mappings = [], { deviceId = null, protocol = null } = {}) {
  const protocolKey = protocol ? String(protocol).toLowerCase() : null;
  return mappings.filter((mapping) => {
    const deviceMatches = !mapping.deviceId || String(mapping.deviceId) === String(deviceId);
    const protocolMatches =
      !mapping.protocol || !protocolKey || String(mapping.protocol).toLowerCase() === protocolKey;
    return deviceMatches && protocolMatches;
  });
}

function buildMappedAttributes(rawAttributes = {}, mappings = []) {
  if (!rawAttributes || typeof rawAttributes !== "object") return {};
  const result = {};
  mappings.forEach((mapping) => {
    if (!Object.prototype.hasOwnProperty.call(rawAttributes, mapping.key)) return;
    result[mapping.label] = rawAttributes[mapping.key];
  });
  return result;
}

export function resolveTraccarDeviceError(traccarError) {
  const rawStatus = Number(traccarError?.status || traccarError?.error?.code);
  const status = Number.isFinite(rawStatus) ? rawStatus : null;

  if (status === 404) {
    return { status: 404, message: "Device não encontrado no Traccar", code: status };
  }

  if (status === 401 || status === 403) {
    return { status: 502, message: "Falha de autorização ao consultar o Traccar", code: status };
  }

  if (status && status >= 500) {
    return { status: 503, message: "Serviço do Traccar indisponível no momento", code: status };
  }

  return { status: 502, message: "Erro ao buscar device no Traccar", code: status || "UNKNOWN" };
}

export function filterValidPositionIds(positionIds) {
  if (!positionIds || (Array.isArray(positionIds) && positionIds.length === 0)) return [];
  const result = [];
  for (const raw of Array.from(positionIds)) {
    if (raw === null || raw === undefined) continue;
    const id = String(raw).trim();
    if (!id || id === "0" || id.toLowerCase() === "null" || id.toLowerCase() === "undefined") continue;
    result.push(id);
  }
  return result;
}

const telemetryWarnLog = new Map();
const telemetryCache = createTtlCache(3_000);
const eventsCache = createTtlCache(15_000);
const registryCache = createTtlCache(30_000);
const registryCacheKeys = new Set();

function isPrismaReady() {
  return isPrismaAvailable() && Boolean(process.env.DATABASE_URL);
}

// Estas rotas usam o banco do Traccar como fonte principal de dados (cenário C).
// A API HTTP do Traccar é usada apenas em endpoints específicos (ex.: comandos para o rastreador), não nesta rota.

const TELEMETRY_UNAVAILABLE_PAYLOAD = {
  data: null,
  error: {
    message: "Serviço de telemetria indisponível no momento. Tente novamente em instantes.",
    code: "TRACCAR_DB_ERROR",
  },
};

const TRACCAR_DB_UNAVAILABLE = {
  data: null,
  error: {
    message: "Serviço de dados do Traccar indisponível no momento. Tente novamente em instantes.",
    code: "TRACCAR_DB_ERROR",
  },
};

function buildDeviceConflictError(uniqueId, existing) {
  const error = createError(409, "Equipamento já existe no Euro One");
  error.code = "DEVICE_ALREADY_EXISTS";
  error.details = existing?.id
    ? { deviceId: existing.id, uniqueId: existing.uniqueId || uniqueId }
    : { uniqueId };
  return error;
}

async function findTraccarDeviceByUniqueId(uniqueId) {
  if (!uniqueId) return null;
  try {
    const lookup = await deps.traccarProxy("get", "/devices", { params: { uniqueId }, asAdmin: true });
    const list = normaliseList(lookup, ["devices"]);
    return list.find((item) => String(item.uniqueId || "").trim().toLowerCase() === String(uniqueId).trim().toLowerCase()) || null;
  } catch (error) {
    if (error?.response?.status && error.response.status !== 404) {
      console.warn("[devices] falha ao consultar device no Traccar", error?.message || error);
    }
    return null;
  }
}

async function ensureTraccarDeviceExists({ uniqueId, name, groupId, attributes }) {
  const normalizedUniqueId = String(uniqueId || "").trim();
  if (!normalizedUniqueId) return { device: null, created: false };

  const existing = await findTraccarDeviceByUniqueId(normalizedUniqueId);
  if (existing) {
    console.info("[devices] reutilizando device existente no Traccar", { uniqueId: normalizedUniqueId, traccarId: existing.id });
    return { device: existing, created: false, synced: true };
  }

  try {
    const created = await deps.traccarProxy("post", "/devices", {
      data: {
        name: name || normalizedUniqueId,
        uniqueId: normalizedUniqueId,
        groupId,
        attributes,
      },
      asAdmin: true,
    });
    return { device: created, created: true };
  } catch (error) {
    const isConflict = error?.response?.status === 409;
    if (isConflict) {
      const fallback = await findTraccarDeviceByUniqueId(normalizedUniqueId);
      if (fallback) {
        console.warn("[devices] conflito 409 no Traccar; sincronizando device existente", {
          uniqueId: normalizedUniqueId,
          traccarId: fallback.id,
        });
        return { device: fallback, created: false, synced: true };
      }
    }
    throw error;
  }
}

function logTelemetryWarning(stage, error, context = {}) {
  const now = Date.now();
  const previous = telemetryWarnLog.get(stage);
  if (!previous || now - previous > 30_000) {
    telemetryWarnLog.set(stage, now);
    const responseStatus =
      error?.response?.status || error?.details?.status || error?.status || error?.statusCode;
    console.warn(`[telemetry] failed to load ${stage}`, {
      message: error?.message || error,
      status: error?.status || error?.statusCode,
      responseStatus,
      responseData: error?.response?.data || error?.details?.response,
      details: error?.details,
      ...context,
    });
  }
}

function cacheRegistry(key, value, ttl = 30_000) {
  registryCacheKeys.add(key);
  return registryCache.set(key, value, ttl);
}

function getCachedRegistry(key) {
  return registryCache.get(key);
}

function respondBadRequest(res, message = "Parâmetros inválidos.") {
  return res.status(400).json({
    data: null,
    error: { message, code: "BAD_REQUEST" },
  });
}

function normaliseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true" || value === "on") return true;
  if (value === 0 || value === "0" || value === "false" || value === "off") return false;
  return null;
}

function isDependencyFailure(error) {
  const status = Number(error?.status || error?.statusCode || error?.response?.status);
  if ([502, 503, 504].includes(status)) return true;
  if (error?.code === "TRACCAR_UNAVAILABLE" || error?.isTraccarError) return true;
  if (error?.code === "P2021" || error?.code === "P2022") return true;
  if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ETIMEDOUT"].includes(error?.code)) return true;
  return false;
}

function buildServiceUnavailablePayload({ message, details } = {}) {
  return {
    code: "SERVICE_UNAVAILABLE",
    message: message || "Serviço indisponível no momento",
    details,
  };
}

function pickNumber(...candidates) {
  for (const value of candidates) {
    if (value === null || value === undefined) continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function normaliseTelemetryPosition(position) {
  if (!position) return null;
  const attrs = position.attributes || {};
  const rawAddress = position.address;
  const resolvedAddress =
    rawAddress && typeof rawAddress === "object" && !Array.isArray(rawAddress)
      ? rawAddress
      : rawAddress
      ? { formatted: rawAddress }
      : null;

  const altitude = position.altitude ?? attrs.altitude ?? null;
  const speed = pickNumber(position.speed, attrs.speed);
  const course = pickNumber(position.course, attrs.course);
  const accuracy = pickNumber(position.accuracy, attrs.accuracy, attrs.precision);
  const timestamp = position.serverTime || position.deviceTime || position.fixTime || attrs.timestamp || null;
  const serverTime = position.serverTime || attrs.serverTime || null;
  const deviceTime = position.deviceTime || attrs.deviceTime || null;
  const fixTime = position.fixTime || attrs.fixTime || attrs.time || null;

  return {
    deviceId: position.deviceId != null ? String(position.deviceId) : null,
    latitude: position.latitude ?? attrs.latitude ?? attrs.lat ?? null,
    longitude: position.longitude ?? attrs.longitude ?? attrs.lon ?? attrs.lng ?? null,
    speed,
    course,
    timestamp,
    serverTime,
    deviceTime,
    fixTime,
    altitude,
    accuracy,
    valid: position.valid ?? attrs.valid ?? null,
    protocol: position.protocol || attrs.protocol || null,
    network: position.network || null,
    address: resolvedAddress || { formatted: "Endereço não disponível" },

    ignition: normaliseBoolean(attrs.ignition),
    batteryLevel: pickNumber(attrs.batteryLevel, attrs.battery, attrs.battery_level),
    rssi: pickNumber(attrs.rssi, attrs.signal),
    charge: normaliseBoolean(attrs.charge),
    blocked: normaliseBoolean(attrs.blocked ?? attrs.block),
    adc1: pickNumber(attrs.adc1, attrs.analog1),
    totalDistance: pickNumber(position.totalDistance, attrs.totalDistance, attrs.odometer, attrs.distanceTotal),
    hours: pickNumber(attrs.hours, attrs.engineHours),
    motion: normaliseBoolean(attrs.motion),
    status: attrs.status ?? position.status ?? null,
    type: position.type || attrs.type || null,

    attributes: position.attributes || {},
    rawAttributes: position.attributes || {},
  };
}

function invalidateRegistry(prefix) {
  Array.from(registryCacheKeys).forEach((key) => {
    if (!prefix || key.startsWith(prefix)) {
      registryCache.delete(key);
      registryCacheKeys.delete(key);
    }
  });
}

function sanitizePosition(rawPosition) {
  if (!rawPosition || typeof rawPosition !== "object") {
    return { address: null, formattedAddress: null, shortAddress: null };
  }
  const address = rawPosition.address;
  const formattedFromPayload = addressUtils.formatFullAddress(address);
  const normalizedAddress = formattedFromPayload && formattedFromPayload !== "—" ? formattedFromPayload : null;
  const formattedAddress = addressUtils.formatFullAddress(rawPosition.formattedAddress || normalizedAddress);
  const safeFormatted = formattedAddress && formattedAddress !== "—" ? formattedAddress : normalizedAddress;
  const shortAddress = addressUtils.formatAddress(rawPosition.shortAddress || safeFormatted || "");

  return {
    ...rawPosition,
    address: normalizedAddress,
    formattedAddress: safeFormatted,
    shortAddress: shortAddress && shortAddress !== "—" ? shortAddress : null,
  };
}

function ensureClientExists(clientId) {
  const client = deps.getClientById(clientId);
  if (!client) {
    throw createError(404, "Cliente não encontrado");
  }
  return client;
}

async function ensureClientTraccarGroup(clientId) {
  const client = ensureClientExists(clientId);
  const attrs = client.attributes || {};
  if (attrs.traccarGroupId) {
    return attrs.traccarGroupId;
  }
  const desiredName = attrs.traccarGroupName || client.name || `Cliente ${clientId}`;
  try {
    const group = await deps.traccarProxy("post", "/groups", { data: { name: desiredName }, asAdmin: true });
    deps.updateClient(clientId, { attributes: { ...attrs, traccarGroupId: group.id } });
    return group.id;
  } catch (error) {
    if (error.status === 409) {
      const groups = await deps.traccarProxy("get", "/groups", { params: { all: true }, asAdmin: true });
      const match = Array.isArray(groups)
        ? groups.find((item) => item?.name === desiredName)
        : Array.isArray(groups?.groups)
        ? groups.groups.find((item) => item?.name === desiredName)
        : null;
      if (match?.id) {
        deps.updateClient(clientId, { attributes: { ...attrs, traccarGroupId: match.id } });
        return match.id;
      }
    }
    throw error;
  }
}

function safeDate(value) {
  if (!value) return null;
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch (_error) {
    return null;
  }
}

function resolveConnection(traccarDevice) {
  if (!traccarDevice) {
    return {
      connectionStatus: "unknown",
      connectionStatusLabel: "—",
      lastCommunication: null,
    };
  }
  const lastUpdate = safeDate(traccarDevice.lastUpdate || traccarDevice.serverTime || traccarDevice.lastCommunication);
  if (!lastUpdate) {
    return {
      connectionStatus: "never",
      connectionStatusLabel: "Nunca conectado",
      lastCommunication: null,
    };
  }
  const status = String(traccarDevice.status || traccarDevice.deviceStatus || "").toLowerCase();
  if (status === "online") {
    return {
      connectionStatus: "online",
      connectionStatusLabel: "Online",
      lastCommunication: lastUpdate,
    };
  }
  return {
    connectionStatus: "offline",
    connectionStatusLabel: "Offline",
    lastCommunication: lastUpdate,
  };
}

function buildDeviceCacheKey(clientId) {
  return clientId ? `devices:${clientId}` : "devices:all";
}

function invalidateDeviceCache() {
  invalidateRegistry("devices:");
}

function resolveModelPrefix(model) {
  const rawPrefix = model?.prefix ?? model?.internalPrefix ?? model?.codePrefix ?? null;
  if (rawPrefix === null || rawPrefix === undefined) return null;
  if (typeof rawPrefix === "number" && Number.isFinite(rawPrefix)) {
    return String(rawPrefix).padStart(2, "0");
  }
  const normalized = String(rawPrefix).trim();
  return normalized || null;
}

function normalizeWarrantyOrigin(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (["instalacao", "instalação", "installation"].includes(normalized)) return "installation";
  if (["producao", "produção", "production"].includes(normalized)) return "production";
  return null;
}

function computeWarrantyEndDate({ startDate, warrantyDays }) {
  const days = Number(warrantyDays);
  if (!startDate || !Number.isFinite(days) || days <= 0) return null;
  const parsed = new Date(startDate);
  if (Number.isNaN(parsed.getTime())) return null;
  const end = new Date(parsed);
  end.setDate(end.getDate() + days);
  return end.toISOString().slice(0, 10);
}

function resolveNextInternalCode({ clientId, prefix }) {
  if (!clientId || !prefix) return null;
  const devices = deps.listDevices({ clientId });
  const regex = /-(\d+)$/;
  let maxSequence = 0;
  devices.forEach((device) => {
    const internalCode = device.attributes?.internalCode || device.internalCode;
    if (!internalCode) return;
    const match = regex.exec(String(internalCode).trim());
    if (!match) return;
    const seq = Number(match[1]);
    if (Number.isFinite(seq)) {
      maxSequence = Math.max(maxSequence, seq);
    }
  });
  return `${prefix}-${maxSequence + 1}`;
}

function findDeviceByInternalCode({ clientId, internalCode }) {
  if (!clientId || !internalCode) return null;
  const normalized = String(internalCode).trim().toLowerCase();
  if (!normalized) return null;
  const devices = deps.listDevices({ clientId });
  return (
    devices.find((device) => {
      const candidate = device.attributes?.internalCode || device.internalCode;
      return candidate && String(candidate).trim().toLowerCase() === normalized;
    }) || null
  );
}

function buildDeviceResponse(device, context) {
  const { modelMap, chipMap, vehicleMap, traccarById, traccarByUnique } = context;
  const traccarDevice =
    (device.traccarId && traccarById.get(String(device.traccarId))) || traccarByUnique.get(String(device.uniqueId));
  const { connectionStatus, connectionStatusLabel, lastCommunication } = resolveConnection(traccarDevice);
  const usageStatus = device.vehicleId ? "active" : "stock";
  const usageStatusLabel = usageStatus === "active" ? "Ativo" : "Estoque";
  let statusLabel = usageStatusLabel;
  if (connectionStatus === "online" || connectionStatus === "offline") {
    statusLabel = `${usageStatusLabel} (${connectionStatusLabel})`;
  }
  if (connectionStatus === "never") {
    statusLabel = `${usageStatusLabel} (Nunca conectado)`;
  }

  const resolvedModelId = device.modelId || device.attributes?.modelId || null;
  const modelFromDevice = device.model || null;
  const model = resolvedModelId ? modelMap.get(resolvedModelId) || modelFromDevice : modelFromDevice;
  const chip = device.chipId ? chipMap.get(device.chipId) : null;
  const vehicle = device.vehicleId ? vehicleMap.get(device.vehicleId) : null;
  const attributes = { ...(traccarDevice?.attributes || {}), ...(device.attributes || {}) };
  const iconType = attributes.iconType || null;
  const metadataProtocol = traccarDevice?.protocol || traccarDevice?.attributes?.protocol || null;
  const protocol =
    device?.protocol ||
    model?.protocol ||
    attributes.protocol ||
    metadataProtocol ||
    null;
  const groupId = traccarDevice?.groupId ?? attributes.groupId ?? null;

  return {
    id: device.id,
    internalId: device.id,
    deviceId: device.traccarId ? String(device.traccarId) : null,
    traccarId: device.traccarId ? String(device.traccarId) : null,
    uniqueId: device.uniqueId,
    name: device.name,
    clientId: device.clientId,
    modelId: resolvedModelId,
    modelName: model?.name || null,
    modelBrand: model?.brand || null,
    chipId: device.chipId,
    chip: chip
      ? {
          id: chip.id,
          iccid: chip.iccid,
          phone: chip.phone,
          carrier: chip.carrier,
          status: chip.status,
        }
      : null,
    vehicleId: device.vehicleId,
    vehicle: vehicle
      ? {
          id: vehicle.id,
          name: vehicle.name,
          plate: vehicle.plate,
          type: vehicle.type || null,
        }
      : null,
    usageStatus,
    usageStatusLabel,
    connectionStatus,
    connectionStatusLabel,
    statusLabel,
    lastCommunication,
    protocol,
    modelProtocol: model?.protocol || null,
    groupId,
    attributes,
    iconType,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
    traccar: traccarDevice
      ? {
          id: traccarDevice.id,
          status: traccarDevice.status,
          lastUpdate: safeDate(traccarDevice.lastUpdate),
        }
      : null,
  };
}

function buildChipResponse(chip, { deviceMap, vehicleMap }) {
  const device = chip.deviceId ? deviceMap.get(chip.deviceId) : null;
  const vehicle = device?.vehicleId ? vehicleMap.get(device.vehicleId) : null;
  return {
    ...chip,
    device: device
      ? {
          id: device.id,
          name: device.name,
          uniqueId: device.uniqueId,
          plate: vehicle?.plate || null,
        }
      : null,
  };
}

function selectPrincipalDevice(devices = [], traccarById = new Map(), positionsByDeviceId = new Map()) {
  let selected = null;
  let latest = -Infinity;

  devices.forEach((device) => {
    const traccarDevice = device?.traccarId ? traccarById.get(String(device.traccarId)) : null;
    const position = device?.traccarId ? positionsByDeviceId.get(String(device.traccarId)) : null;
    const referenceTime =
      position?.deviceTime ||
      position?.fixTime ||
      position?.serverTime ||
      traccarDevice?.lastUpdate ||
      device?.lastUpdate ||
      device?.updatedAt ||
      device?.createdAt ||
      Date.now();
    const timestamp = new Date(referenceTime).getTime();
    if (!Number.isFinite(timestamp)) return;
    if (!selected || timestamp > latest) {
      selected = device;
      latest = timestamp;
    }
  });

  return selected || devices[0] || null;
}

function buildVehicleResponse(vehicle, context) {
  const {
    deviceMap,
    traccarById,
    positionsByDeviceId = new Map(),
    clientMap = new Map(),
  } = context;
  const linkedDevices = Array.from(deviceMap.values()).filter(
    (item) => item.vehicleId === vehicle.id || item.id === vehicle.deviceId,
  );

  const principalDevice = selectPrincipalDevice(linkedDevices, traccarById, positionsByDeviceId);
  const traccarDevice = principalDevice?.traccarId ? traccarById.get(String(principalDevice.traccarId)) : null;
  const { connectionStatus, connectionStatusLabel, lastCommunication } = resolveConnection(traccarDevice);
  const principalPosition = principalDevice?.traccarId
    ? positionsByDeviceId.get(String(principalDevice.traccarId)) || null
    : null;
  const mergedAttributes = {
    ...(vehicle?.attributes || {}),
    ...(principalDevice?.attributes || {}),
  };
  const iconType =
    vehicle?.iconType ||
    mergedAttributes.iconType ||
    principalDevice?.iconType ||
    principalDevice?.attributes?.iconType ||
    vehicle?.type ||
    vehicle?.category ||
    null;
  const resolvedClientName =
    clientMap.get(String(vehicle.clientId))?.name || vehicle?.client?.name || vehicle?.clientName || null;

  return {
    ...vehicle,
    vehicleType: vehicle?.type || vehicle?.vehicleType || null,
    clientName: resolvedClientName,
    attributes: mergedAttributes,
    iconType,
    device: principalDevice
      ? {
          id: principalDevice.id,
          uniqueId: principalDevice.uniqueId,
          name: principalDevice.name,
          traccarId: principalDevice.traccarId ? String(principalDevice.traccarId) : null,
          position: principalPosition,
          attributes: principalDevice.attributes || {},
          iconType: principalDevice.iconType || principalDevice.attributes?.iconType || null,
        }
      : null,
    devices: linkedDevices.map((item) => ({
      id: item.id,
      uniqueId: item.uniqueId,
      name: item.name,
      traccarId: item.traccarId ? String(item.traccarId) : null,
      vehicleId: item.vehicleId || null,
      attributes: item.attributes || {},
      iconType: item.iconType || item.attributes?.iconType || null,
    })),
    deviceCount: linkedDevices.length,
    position: principalPosition,
    connectionStatus,
    connectionStatusLabel,
    lastCommunication,
  };
}

function normalizeVehicleAttributesList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item) return null;
      if (typeof item === "string") {
        return { id: item, name: item, color: "#38bdf8" };
      }
      const id = item.id || item.value || item.key || item.name;
      const name = item.name || item.label || item.value;
      if (!name && !id) return null;
      return {
        id: id ? String(id) : String(name),
        name: String(name || id),
        color: item.color || "#38bdf8",
      };
    })
    .filter(Boolean);
}

function ensureSameClient(resource, clientId, message) {
  if (!resource || String(resource.clientId) !== String(clientId)) {
    throw createError(404, message);
  }
}

function resolveLinkClientId(clientId, ...resources) {
  if (clientId != null) return clientId;
  for (const resource of resources) {
    if (resource?.clientId != null) {
      return resource.clientId;
    }
  }
  return clientId;
}

export function linkChipToDevice(clientId, chipId, deviceId) {
  const chip = deps.getChipById(chipId);
  const device = deps.getDeviceById(deviceId);
  const resolvedClientId = resolveLinkClientId(clientId, chip, device);
  ensureSameClient(chip, resolvedClientId, "Chip não encontrado");
  ensureSameClient(device, resolvedClientId, "Equipamento não encontrado");

  if (device.chipId && device.chipId !== chip.id) {
    const previousChip = deps.getChipById(device.chipId);
    if (previousChip && String(previousChip.clientId) === String(resolvedClientId)) {
      deps.updateChip(previousChip.id, {
        deviceId: null,
        status: previousChip.status === "Vinculado" ? "Disponível" : previousChip.status,
      });
    }
  }

  if (chip.deviceId && chip.deviceId !== device.id) {
    const previousDevice = deps.getDeviceById(chip.deviceId);
    if (previousDevice && String(previousDevice.clientId) === String(resolvedClientId)) {
      deps.updateDevice(previousDevice.id, { chipId: null });
    }
  }

  deps.updateChip(chip.id, {
    deviceId: device.id,
    status: chip.status && chip.status.length ? chip.status : "Vinculado",
  });
  deps.updateDevice(device.id, { chipId: chip.id });
}

function detachChip(clientId, chipId) {
  const chip = deps.getChipById(chipId);
  const device = chip?.deviceId ? deps.getDeviceById(chip.deviceId) : null;
  const resolvedClientId = resolveLinkClientId(clientId, chip, device);
  ensureSameClient(chip, resolvedClientId, "Chip não encontrado");
  if (chip.deviceId && device && String(device.clientId) === String(resolvedClientId)) {
    deps.updateDevice(device.id, { chipId: null });
  }
  deps.updateChip(chip.id, {
    deviceId: null,
    status: chip.status === "Vinculado" ? "Disponível" : chip.status,
  });
}

function linkDeviceToVehicle(clientId, vehicleId, deviceId) {
  const vehicle = deps.getVehicleById(vehicleId);
  const device = deps.getDeviceById(deviceId);
  const resolvedClientId = resolveLinkClientId(clientId, vehicle, device);
  ensureSameClient(vehicle, resolvedClientId, "Veículo não encontrado");
  ensureSameClient(device, resolvedClientId, "Equipamento não encontrado");
  console.info("[vehicles] vinculando equipamento ao veículo", {
    vehicleId,
    deviceId,
    clientId: resolvedClientId,
  });

  if (device.vehicleId && device.vehicleId !== vehicle.id) {
    const previousVehicle = deps.getVehicleById(device.vehicleId);
    if (previousVehicle && String(previousVehicle.clientId) === String(resolvedClientId)) {
      deps.updateVehicle(previousVehicle.id, { deviceId: null });
    }
  }

  deps.updateVehicle(vehicle.id, { deviceId: device.id });
  deps.updateDevice(device.id, { vehicleId: vehicle.id });
}

function detachVehicle(clientId, vehicleId) {
  const vehicle = deps.getVehicleById(vehicleId);
  const devices = deps.listDevices({ clientId: resolveLinkClientId(clientId, vehicle) });
  const resolvedClientId = resolveLinkClientId(clientId, vehicle, ...devices);
  ensureSameClient(vehicle, resolvedClientId, "Veículo não encontrado");
  console.info("[vehicles] desvinculando equipamentos do veículo", {
    vehicleId,
    clientId: resolvedClientId,
    deviceCount: devices.length,
  });
  devices
    .filter((device) => device.vehicleId === vehicle.id)
    .forEach((device) => deps.updateDevice(device.id, { vehicleId: null }));

  deps.updateVehicle(vehicle.id, { deviceId: null });
}

router.get(
  "/models",
  authorizePermission({ menuKey: "primary", pageKey: "devices", subKey: "devices-models" }),
  (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.query.clientId, { required: false });
    const models = deps.listModels({ clientId, includeGlobal: true });
    res.json({ models });
  } catch (error) {
    next(error);
  }
  },
);

router.post(
  "/models",
  authorizePermission({ menuKey: "primary", pageKey: "devices", subKey: "devices-models", requireFull: true }),
  deps.requireRole("manager", "admin"),
  (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.body?.clientId, { required: req.user.role !== "admin" });
    const payload = {
      name: req.body?.name,
      brand: req.body?.brand,
      prefix: req.body?.prefix,
      protocol: req.body?.protocol,
      connectivity: req.body?.connectivity,
      version: req.body?.version,
      jammerBlockTime: req.body?.jammerBlockTime,
      panelBlockTime: req.body?.panelBlockTime,
      jammerDetectionTime: req.body?.jammerDetectionTime,
      frequency: req.body?.frequency,
      blockMode: req.body?.blockMode,
      resetMode: req.body?.resetMode,
      workshopMode: req.body?.workshopMode,
      productionDate: req.body?.productionDate,
      notes: req.body?.notes,
      isClientDefault: req.body?.isClientDefault,
      defaultClientId: req.body?.defaultClientId,
      ports: Array.isArray(req.body?.ports) ? req.body.ports : [],
      clientId: clientId ?? null,
    };
    const model = deps.createModel(payload);
    res.status(201).json({ model });
  } catch (error) {
    next(error);
  }
  },
);

router.put(
  "/models/:id",
  authorizePermission({ menuKey: "primary", pageKey: "devices", subKey: "devices-models", requireFull: true }),
  deps.requireRole("manager", "admin"),
  (req, res, next) => {
  try {
    const existing = deps.getModelById(req.params.id);
    const clientId = deps.resolveClientId(req, req.body?.clientId ?? existing?.clientId, {
      required: req.user.role !== "admin",
    });
    ensureSameClient(existing, clientId ?? existing?.clientId ?? null, "Modelo não encontrado");
    const payload = {
      name: req.body?.name,
      brand: req.body?.brand,
      prefix: req.body?.prefix,
      protocol: req.body?.protocol,
      connectivity: req.body?.connectivity,
      version: req.body?.version,
      jammerBlockTime: req.body?.jammerBlockTime,
      panelBlockTime: req.body?.panelBlockTime,
      jammerDetectionTime: req.body?.jammerDetectionTime,
      frequency: req.body?.frequency,
      blockMode: req.body?.blockMode,
      resetMode: req.body?.resetMode,
      workshopMode: req.body?.workshopMode,
      productionDate: req.body?.productionDate,
      notes: req.body?.notes,
      isClientDefault: req.body?.isClientDefault,
      defaultClientId: req.body?.defaultClientId,
      ports: Array.isArray(req.body?.ports) ? req.body.ports : undefined,
    };
    const model = deps.updateModel(req.params.id, payload);
    res.json({ model });
  } catch (error) {
    next(error);
  }
  },
);

router.get(
  "/devices/import",
  authorizePermission({ menuKey: "primary", pageKey: "devices", subKey: "devices-list" }),
  deps.requireRole("manager", "admin"),
  resolveClientMiddleware,
  (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.query?.clientId, { required: req.user.role !== "admin" });
    const knownDevices = deps.listDevices({});
    const knownUniqueIds = new Set(
      knownDevices
        .map((device) => (device?.uniqueId ? String(device.uniqueId).toLowerCase() : null))
        .filter(Boolean),
    );
    const traccarDevices = deps.getCachedTraccarResources("devices");
    const list = traccarDevices
      .filter((device) => device?.uniqueId && !knownUniqueIds.has(String(device.uniqueId).toLowerCase()))
      .map((device) => ({
        id: device.id,
        name: device.name,
        uniqueId: device.uniqueId,
        status: device.status || device.deviceStatus || null,
        protocol: device.protocol || null,
        groupId: device.groupId ?? null,
        lastUpdate: safeDate(device.lastUpdate || device.serverTime || device.lastCommunication),
        clientId,
      }));
    res.json({ devices: list });
  } catch (error) {
    next(error);
  }
  },
);

router.post(
  "/devices/import",
  authorizePermission({ menuKey: "primary", pageKey: "devices", subKey: "devices-list", requireFull: true }),
  deps.requireRole("manager", "admin"),
  resolveClientMiddleware,
  async (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.body?.clientId, { required: true });
    const { traccarId, uniqueId, modelId, name } = req.body || {};
    if (!traccarId && !uniqueId) {
      throw createError(400, "Informe traccarId ou uniqueId");
    }

    if (uniqueId && deps.findDeviceByUniqueId(uniqueId)) {
      throw createError(409, "Já existe um equipamento com este identificador");
    }

    if (traccarId && deps.findDeviceByTraccarId(traccarId)) {
      throw createError(409, "Este dispositivo já foi importado");
    }

    if (modelId) {
      const model = deps.getModelById(modelId);
      if (!model || (model.clientId && String(model.clientId) !== String(clientId))) {
        throw createError(404, "Modelo informado não pertence a este cliente");
      }
    }

    const cachedDevices = deps.getCachedTraccarResources("devices");
    let traccarDevice = cachedDevices.find((device) => {
      if (traccarId && String(device?.id) === String(traccarId)) {
        return true;
      }
      if (uniqueId && String(device?.uniqueId) === String(uniqueId)) {
        return true;
      }
      return false;
    });

    if (!traccarDevice && traccarId) {
      try {
        traccarDevice = await deps.traccarProxy("get", `/devices/${traccarId}`, { asAdmin: true });
      } catch (_error) {
        // ignora para tentar por uniqueId abaixo
      }
    }

    if (!traccarDevice && uniqueId) {
      const response = await deps.traccarProxy("get", "/devices", { params: { uniqueId }, asAdmin: true });
      const list = Array.isArray(response)
        ? response
        : Array.isArray(response?.devices)
        ? response.devices
        : Array.isArray(response?.data)
        ? response.data
        : [];
      traccarDevice = list.find((device) => String(device?.uniqueId) === String(uniqueId));
    }

    if (!traccarDevice) {
      throw createError(404, "Equipamento não encontrado no Traccar");
    }

    const groupId = gprsCommunication ? await ensureClientTraccarGroup(clientId) : null;
    const attributes = { ...(traccarDevice.attributes || {}) };
    let attributesChanged = false;
    if (modelId) {
      attributes.modelId = modelId;
      attributesChanged = true;
    }

    const requiresUpdate =
      (groupId && String(traccarDevice.groupId) !== String(groupId)) || attributesChanged;
    if (requiresUpdate) {
      traccarDevice = await deps.traccarProxy("put", `/devices/${traccarDevice.id}`, {
        data: {
          id: traccarDevice.id,
          name: traccarDevice.name,
          uniqueId: traccarDevice.uniqueId,
          groupId: groupId || traccarDevice.groupId || undefined,
          attributes,
        },
        asAdmin: true,
      });
    }

    const device = deps.createDevice({
      clientId,
      name: name || traccarDevice.name || traccarDevice.uniqueId,
      uniqueId: traccarDevice.uniqueId,
      modelId: modelId ? String(modelId) : null,
      traccarId: traccarDevice?.id ? String(traccarDevice.id) : null,
      attributes: { importedFrom: "traccar" },
    });

    const models = deps.listModels({ clientId, includeGlobal: true });
    const chips = deps.listChips({ clientId });
    const vehicles = deps.listVehicles({ clientId });
    const traccarById = new Map([[String(traccarDevice.id), traccarDevice]]);
    const traccarByUnique = new Map([[String(traccarDevice.uniqueId), traccarDevice]]);
    const response = buildDeviceResponse(device, {
      modelMap: new Map(models.map((item) => [item.id, item])),
      chipMap: new Map(chips.map((item) => [item.id, item])),
      vehicleMap: new Map(vehicles.map((item) => [item.id, item])),
      traccarById,
      traccarByUnique,
    });

    invalidateDeviceCache();
    res.status(201).json({ device: response });
  } catch (error) {
    next(error);
  }
});

router.post("/euro/import-xlsx", deps.requireRole("admin"), async (req, res, next) => {
  try {
    if (!config.features.euroXlsxImport) {
      throw createError(404, "Importação XLSX não habilitada");
    }
    if (!isPrismaReady()) {
      throw createError(503, "Banco de dados indisponível para importação");
    }
    const { mode, importMode, targetClientId, fileName, contentBase64 } = req.body || {};
    if (!mode || !["dry-run", "apply"].includes(mode)) {
      throw createError(400, "Modo de importação inválido");
    }
    if (!importMode || !["singleClient", "byClientName"].includes(importMode)) {
      throw createError(400, "Modo de cliente inválido");
    }
    if (!contentBase64 || typeof contentBase64 !== "string") {
      throw createError(400, "Arquivo XLSX não informado");
    }
    if (importMode === "byClientName" && req.user?.role !== "admin") {
      throw createError(403, "Somente administradores podem importar por nome de cliente");
    }

    const payload = {
      buffer: Buffer.from(contentBase64, "base64"),
      mode,
      importMode,
      targetClientId,
      fileName,
      user: req.user,
    };

    const result = await importEuroXlsx(payload);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
  },
);

router.post(
  "/devices/sync",
  authorizePermission({ menuKey: "primary", pageKey: "devices", subKey: "devices-list", requireFull: true }),
  deps.requireRole("manager", "admin"),
  resolveClientMiddleware,
  async (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: true });
    const groupId = gprsCommunication ? await ensureClientTraccarGroup(clientId) : null;

    const traccarResponse = await deps.traccarProxy("get", "/devices", {
      params: groupId ? { groupId } : undefined,
      asAdmin: true,
    });

    if (traccarResponse?.ok === false || traccarResponse?.error) {
      throw deps.buildTraccarUnavailableError(traccarResponse, { stage: "devices-sync" });
    }

    const traccarDevices = normaliseList(traccarResponse, ["devices"]);

    const filteredDevices = traccarDevices.filter((device) => {
      if (!groupId) return true;
      const deviceGroupId = device?.groupId ?? device?.groupid ?? null;
      return deviceGroupId && String(deviceGroupId) === String(groupId);
    });

    const summary = syncDevicesFromTraccar({
      clientId,
      devices: filteredDevices,
      findDeviceByTraccarId: deps.findDeviceByTraccarId,
      findDeviceByUniqueId: deps.findDeviceByUniqueId,
      createDevice: deps.createDevice,
      updateDevice: deps.updateDevice,
    });

    invalidateDeviceCache();

    res.status(200).json({
      data: summary,
      error: null,
    });
  } catch (error) {
    next(error);
  }
  },
);

router.get("/telemetry", resolveClientMiddleware, async (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.query?.clientId, { required: false });
    const includeUnlinked =
      ["manager", "admin"].includes(req.user?.role) &&
      String(req.query?.includeUnlinked).toLowerCase() === "true";

    const normaliseIdList = (raw) => {
      if (!raw) return [];
      if (Array.isArray(raw)) return raw;
      if (typeof raw === "string") return raw.split(",");
      return [];
    };

    const requestedVehicleIds = normaliseIdList(req.query?.vehicleIds || req.query?.vehicleId)
      .map((value) => String(value).trim())
      .filter(Boolean);
    const requestedPlates = normaliseIdList(req.query?.plates || req.query?.plate)
      .map((value) => String(value).trim().toLowerCase())
      .filter(Boolean);
    const hasVehicleFilter = requestedVehicleIds.length > 0 || requestedPlates.length > 0;

    const access = await getAccessibleVehicles({
      user: req.user,
      clientId,
      includeMirrorsForNonReceivers: false,
    });
    const accessVehicleIds = access.vehicles.map((vehicle) => String(vehicle.id)).filter(Boolean);
    let deviceRegistry = deps.listDevices({ clientId });
    if (access.mirrorOwnerIds.length) {
      const extraDevices = access.mirrorOwnerIds.flatMap((ownerId) => deps.listDevices({ clientId: ownerId }));
      deviceRegistry = mergeById(deviceRegistry, extraDevices);
    }
    const deviceById = new Map(deviceRegistry.map((device) => [String(device.id), device]));
    const devicesByVehicleId = new Map();
    deviceRegistry.forEach((device) => {
      if (!device?.vehicleId) return;
      const vehicleId = String(device.vehicleId);
      const current = devicesByVehicleId.get(vehicleId) || [];
      current.push(device);
      devicesByVehicleId.set(vehicleId, current);
    });
    let vehicles = [];
    let clientMap = new Map();

    if (isPrismaReady() && accessVehicleIds.length) {
      try {
        // 🔄 atualizado: buscar veículos e devices direto do Postgres para manter a visão por placa
        vehicles = await prisma.vehicle.findMany({
          where: { id: { in: accessVehicleIds } },
          include: { devices: true, client: true },
        });
        const clientIds = vehicles.map((vehicle) => vehicle?.clientId).filter(Boolean);
        if (clientIds.length) {
          const clients = await prisma.client.findMany({ where: { id: { in: Array.from(new Set(clientIds)) } } });
          clientMap = new Map(clients.map((client) => [client.id, client]));
        }
      } catch (prismaError) {
        logTelemetryWarning("vehicles-db", prismaError);
      }
    }

    if (!vehicles.length) {
      vehicles = access.vehicles;
    } else {
      const prismaIds = new Set(vehicles.map((vehicle) => String(vehicle.id)));
      const fallback = access.vehicles.filter((vehicle) => !prismaIds.has(String(vehicle.id)));
      if (fallback.length) {
        vehicles = [...vehicles, ...fallback];
      }
    }

    vehicles = vehicles.map((vehicle) => {
      const attachedDevices =
        (Array.isArray(vehicle.devices) && vehicle.devices.length
          ? vehicle.devices
          : devicesByVehicleId.get(String(vehicle.id)) || []);
      const primaryDevice =
        vehicle.deviceId && deviceById.has(String(vehicle.deviceId))
          ? deviceById.get(String(vehicle.deviceId))
          : null;
      const devices = primaryDevice && !attachedDevices.some((item) => String(item.id) === String(primaryDevice.id))
        ? [...attachedDevices, primaryDevice]
        : attachedDevices;
      return { ...vehicle, devices };
    });

    let filteredVehicles = hasVehicleFilter
      ? vehicles.filter((vehicle) => {
          const idMatch = requestedVehicleIds.includes(String(vehicle.id));
          const plateMatch = vehicle?.plate ? requestedPlates.includes(String(vehicle.plate).trim().toLowerCase()) : false;
          return idMatch || plateMatch;
        })
      : vehicles;

    let linkedVehicles = filteredVehicles.filter((vehicle) => Array.isArray(vehicle.devices) && vehicle.devices.length > 0);
    let vehiclesPool = includeUnlinked ? filteredVehicles : linkedVehicles;

    if (!vehiclesPool.length && deviceRegistry.length) {
      const syntheticVehicles = deviceRegistry.map((device) => {
        const syntheticId = device.vehicleId || device.id || device.uniqueId || randomUUID();
        const baseName = device.name || device.uniqueId || "Equipamento";
        const vehiclePlate = device.plate || device.vehiclePlate || null;
        return {
          id: String(syntheticId),
          name: baseName,
          plate: vehiclePlate,
          clientId: device.clientId ?? clientId ?? null,
          devices: [{ ...device, vehicleId: device.vehicleId ?? syntheticId }],
        };
      });
      filteredVehicles = syntheticVehicles;
      linkedVehicles = syntheticVehicles;
      vehiclesPool = syntheticVehicles;
    }

    if (!vehiclesPool.length) {
      const emptyWarnings = hasVehicleFilter
        ? [{ stage: "vehicles", message: "Nenhum veículo encontrado para o filtro solicitado." }]
        : [];
      return res
        .status(200)
        .json({ telemetry: [], warnings: emptyWarnings, data: { telemetry: [], warnings: emptyWarnings }, error: null });
    }

    const devices = linkedVehicles.flatMap((vehicle) =>
      (vehicle.devices || []).map((device) => ({
        ...device,
        vehicleId: device.vehicleId || vehicle.id,
        vehicle,
        clientId: device.clientId || vehicle.clientId,
      })),
    );

    const deviceMap = new Map(devices.map((device) => [String(device.traccarId || device.id || device.uniqueId), device]));
    const vehicleMap = new Map(vehiclesPool.map((vehicle) => [vehicle.id, vehicle]));

    let telemetryMappings = [];
    if (deps.listTelemetryFieldMappings) {
      try {
        telemetryMappings = await deps.listTelemetryFieldMappings({ clientId });
      } catch (mappingError) {
        logTelemetryWarning("tracker-mappings", mappingError);
      }
    }

    const allowedDeviceIds = devices
      .map((device) => (device?.traccarId != null ? String(device.traccarId) : null))
      .filter(Boolean);

    if (!allowedDeviceIds.length && !includeUnlinked) {
      const emptyWarnings = [{ stage: "devices", message: "Nenhum equipamento vinculado encontrado para os veículos." }];
      return res
        .status(200)
        .json({ telemetry: [], warnings: emptyWarnings, data: { telemetry: [], warnings: emptyWarnings }, error: null });
    }

    const rawDeviceIds = req.query?.deviceId || req.query?.deviceIds;
    const requestedDeviceIds = Array.isArray(rawDeviceIds)
      ? rawDeviceIds
      : typeof rawDeviceIds === "string"
      ? rawDeviceIds.split(",")
      : [];

    const filteredDeviceIds = requestedDeviceIds
      .map((value) => String(value).trim())
      .filter(Boolean);

    if (filteredDeviceIds.some((value) => !/^\d+$/.test(value))) {
      return respondBadRequest(res);
    }

    const deviceIdsToQuery = filteredDeviceIds.length
      ? filteredDeviceIds.filter((id) => allowedDeviceIds.includes(id))
      : allowedDeviceIds;

    if (filteredDeviceIds.length && deviceIdsToQuery.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: "Dispositivo não encontrado para este cliente.", code: "NOT_FOUND" },
      });
    }

    let metadata = [];
    if (deps.isTraccarDbConfigured()) {
      try {
        metadata = await deps.fetchDevicesMetadata();
      } catch (metadataError) {
        logTelemetryWarning("positions-db", metadataError);
        metadata = [];
      }
    }

    const metadataById = new Map(metadata.map((item) => [String(item.id), item]));
    const devicesByTraccarId = new Map();

    const telemetry = [];
    const warnings = [];

    // janela de tempo para buscar posições (últimas 24h)
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const to = now.toISOString();



    let latestPositions = allowedDeviceIds.length
      ? await deps.fetchLatestPositionsWithFallback(deviceIdsToQuery, null)
      : [];



    if (allowedDeviceIds.length && (!latestPositions || latestPositions.length === 0) && typeof deps.traccarProxy === "function") {
      try {
        const proxyResponse = await deps.traccarProxy("get", "/positions", {
          params: deviceIdsToQuery.length ? { deviceId: deviceIdsToQuery } : undefined,
          context: req,
        });
        const proxyPositions = normaliseList(proxyResponse, ["positions", "data"]);
        latestPositions = proxyPositions.map((item) => ({
          ...item,
          deviceId: item.deviceId ?? item.deviceid ?? item.device?.id ?? null,
          serverTime: item.serverTime ?? item.deviceTime ?? item.fixTime ?? null,
        }));
      } catch (proxyError) {
        logTelemetryWarning("positions-http", proxyError);
        throw proxyError;
      }
    }

    const positionByDevice = new Map((latestPositions || []).map((item) => [String(item.deviceId), item]));

    const pickPositionTimestamp = (pos) =>
      Date.parse(pos?.serverTime || pos?.deviceTime || pos?.fixTime || pos?.timestamp || 0) || 0;

    for (const vehicle of vehiclesPool) {
      const linkedDevices = (vehicle.devices && vehicle.devices.length
        ? vehicle.devices
        : devices.filter((device) => String(device.vehicleId) === String(vehicle.id)))
        .filter((device) => device?.traccarId != null);

      const decoratedDevices = linkedDevices.map((device) => {
        const traccarId = device.traccarId != null ? String(device.traccarId) : null;
        const rawPosition = traccarId ? positionByDevice.get(traccarId) : null;
        const normalisedPosition = rawPosition
          ? normaliseTelemetryPosition({
              ...rawPosition,
              timestamp: rawPosition.serverTime || rawPosition.deviceTime || rawPosition.fixTime,
            })
          : null;
        const warmedPosition = normalisedPosition
          ? deps.ensureCachedPositionAddress(normalisedPosition, { priority: "normal" })
          : null;
        const lastUpdate =
          warmedPosition?.timestamp ||
          rawPosition?.serverTime ||
          rawPosition?.deviceTime ||
          rawPosition?.fixTime ||
          device.lastUpdate ||
          device.updatedAt ||
          null;
        const mergedVehicle = device.vehicle || vehicleMap.get(device.vehicleId) || vehicle || null;
        const mergedClient = device.client || clientMap.get(device.clientId) || clientMap.get(mergedVehicle?.clientId) || null;

        if (traccarId && !devicesByTraccarId.has(traccarId)) {
          devicesByTraccarId.set(traccarId, { ...device, vehicle: mergedVehicle, client: mergedClient });
        }

        return {
          ...device,
          id: device.id ? String(device.id) : device.id,
          traccarId,
          vehicle: mergedVehicle,
          client: mergedClient,
          position: warmedPosition,
          rawPosition,
          lastUpdate,
        };
      });

      if (!linkedDevices.length && includeUnlinked) {
        telemetry.push({
          vehicleId: vehicle?.id ?? null,
          vehicleName: vehicle?.name ?? vehicle?.plate ?? null,
          plate: vehicle?.plate ?? null,
          clientId: vehicle?.clientId ?? null,
          clientName: clientMap.get(vehicle?.clientId)?.name ?? null,
          principalDeviceId: null,
          principalDeviceInternalId: null,
          deviceId: null,
          traccarId: null,
          device: null,
          position: null,
          rawAttributes: {},
          lastEvent: null,
          devices: [],
        });
        continue;
      }

      if (!linkedDevices.length) {
        continue;
      }

      const best = decoratedDevices.reduce(
        (acc, device) => {
          const position = device.position || device.rawPosition;
          const timestamp = pickPositionTimestamp(position);
          if (!acc || timestamp > acc.timestamp) {
            return { device, position, timestamp };
          }
          return acc;
        },
        null,
      );

      const principalDevice = best?.device || decoratedDevices[0] || null;
      const position = best?.position || null;

      const normalisedPosition = position
        ? normaliseTelemetryPosition({
            ...position,
            timestamp: position.serverTime || position.deviceTime || position.fixTime,
          })
        : null;
      const warmedPosition = normalisedPosition
        ? deps.ensureCachedPositionAddress(normalisedPosition, { priority: "normal" })
        : null;

      const attributesSource =
        warmedPosition?.rawAttributes ||
        warmedPosition?.attributes ||
        position?.attributes ||
        best?.device?.rawPosition?.attributes ||
        {};
      const applicableMappings = filterMappingsForDevice(telemetryMappings, {
        deviceId: principalDevice?.traccarId || principalDevice?.id,
        protocol: warmedPosition?.protocol || metadataById.get(String(principalDevice?.traccarId))?.protocol,
      });
      const mappedAttributes = buildMappedAttributes(attributesSource, applicableMappings);
      const positionWithMapping = warmedPosition ? { ...warmedPosition, mappedAttributes } : null;

      const deviceMetadata = metadataById.get(String(principalDevice?.traccarId || principalDevice?.id)) || null;
      const deviceMatch = principalDevice ? devicesByTraccarId.get(String(principalDevice.traccarId || principalDevice.id)) : null;
      const client = clientMap.get(vehicle.clientId) || deviceMatch?.client || clientMap.get(deviceMatch?.clientId) || null;

      const device = principalDevice
        ? {
            id: String(principalDevice.traccarId || principalDevice.id),
            name: deviceMetadata?.name || principalDevice?.name || principalDevice?.uniqueId || String(principalDevice?.id),
            uniqueId: deviceMetadata?.uniqueId || principalDevice?.uniqueId || null,
            status: deviceMetadata?.status || "unknown",
            lastUpdate: deviceMetadata?.lastUpdate || warmedPosition?.timestamp || null,
            vehicleId: principalDevice?.vehicleId || vehicle?.id || null,
            vehicle: principalDevice?.vehicle || vehicle || null,
          }
        : null;

      const telemetryEntry = {
        vehicleId: vehicle?.id ?? deviceMatch?.vehicleId ?? null,
        vehicleName: vehicle?.name ?? vehicle?.plate ?? null,
        plate: vehicle?.plate ?? null,
        clientId: client?.id ?? deviceMatch?.clientId ?? vehicle?.clientId ?? null,
        clientName: client?.name ?? client?.companyName ?? null,
        principalDeviceId: principalDevice?.traccarId ? String(principalDevice.traccarId) : principalDevice?.id || null,
        principalDeviceInternalId: principalDevice?.id ? String(principalDevice.id) : null,
        deviceId: principalDevice?.traccarId ? String(principalDevice.traccarId) : principalDevice?.id || null,
        traccarId: principalDevice?.traccarId ? String(principalDevice.traccarId) : principalDevice?.id || null,
        deviceName: device?.name || null,
        device,
        position: positionWithMapping,
        rawAttributes: attributesSource,
        lastEvent: null,
        devices: decoratedDevices.map((item) => ({
          id: String(item.traccarId || item.id),
          internalId: item.id ? String(item.id) : null,
          vehicleId: item.vehicleId || vehicle.id,
          uniqueId: item.uniqueId || item.id,
          name: item.name || item.uniqueId || item.id,
          traccarId: item.traccarId,
          position: item.position,
          lastUpdate: item.lastUpdate,
        })),
      };

      ingestSignalStateEvents({
        clientId: telemetryEntry.clientId,
        vehicleId: telemetryEntry.vehicleId,
        deviceId: telemetryEntry.deviceId,
        position: positionWithMapping || warmedPosition || position || null,
        attributes: attributesSource,
      });

      telemetry.push(telemetryEntry);
    }

    if (typeof deps.traccarProxy === "function") {
      try {
        await deps.traccarProxy("get", "/events", {
          params: { deviceId: deviceIdsToQuery, from, to, limit: 20 },
          context: req,
        });
      } catch (eventsError) {
        warnings.push({ stage: "events", message: eventsError?.message || "Falha ao carregar eventos." });
      }
    }

    if (!telemetry.length) {
      warnings.push({ stage: "positions", message: "Nenhuma posição encontrada para os dispositivos deste cliente." });
    }

    const filteredTelemetry = includeUnlinked
      ? telemetry
      : telemetry.filter((item) => {
          const device = item?.device || item;
          const vehicleId = device?.vehicleId ?? device?.vehicle?.id ?? null;
          return Boolean(vehicleId);
        });

    return res.status(200).json({
      telemetry: filteredTelemetry,
      warnings,
      data: { telemetry: filteredTelemetry, warnings },
      error: null,
    });
  } catch (error) {
    if (error?.status === 400) {
      return respondBadRequest(res, error.message || "Parâmetros inválidos.");
    }

    logTelemetryWarning("positions-db", error);
    const status = Number(error?.status || error?.statusCode) || 503;
    const message = error?.message || TELEMETRY_UNAVAILABLE_PAYLOAD.error.message;
    return res.status(status).json({
      message,
      data: null,
      error: { message, code: error?.code || TELEMETRY_UNAVAILABLE_PAYLOAD.error.code },
    });
  }
});

router.get(
  "/devices",
  authorizePermission({ menuKey: "primary", pageKey: "devices", subKey: "devices-list" }),
  async (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.query?.clientId, { required: false });

    const models = deps.listModels({ clientId, includeGlobal: true });
    const chips = deps.listChips({ clientId });
    const vehicles = deps.listVehicles({ clientId });
    const modelMap = new Map(models.map((item) => [item.id, item]));
    const chipMap = new Map(chips.map((item) => [item.id, item]));
    const vehicleMap = new Map(vehicles.map((item) => [item.id, item]));
    const metadata = (await deps.fetchDevicesMetadata()) || [];
    const traccarById = new Map(metadata.map((item) => [String(item.id), item]));
    const traccarByUniqueId = new Map(
      metadata.filter((item) => item.uniqueId).map((item) => [String(item.uniqueId), item]),
    );

    // 🔄 atualizado: devices direto do Postgres (Prisma), com fallback para storage legado
    let devices = [];
    if (isPrismaReady()) {
      try {
        devices = await prisma.device.findMany({
          where: clientId ? { clientId: String(clientId) } : {},
          include: { model: true },
        });
      } catch (databaseError) {
        console.warn("[devices] falha ao consultar devices no banco", databaseError?.message || databaseError);
      }
    }

    if (!devices.length) {
      devices = deps.listDevices({ clientId });
    }

    devices.forEach((device) => {
      if (device?.model?.id && !modelMap.has(String(device.model.id))) {
        modelMap.set(String(device.model.id), device.model);
      }
    });

    const response = devices.map((device) =>
      buildDeviceResponse(
        {
          ...device,
          id: String(device.id),
          clientId: device.clientId ? String(device.clientId) : null,
          modelId: device.modelId ? String(device.modelId) : null,
          traccarId: device.traccarId ? String(device.traccarId) : null,
          chipId: device.chipId ? String(device.chipId) : null,
          vehicleId: device.vehicleId ? String(device.vehicleId) : null,
          attributes: device.attributes || {},
        },
        {
          modelMap,
          chipMap,
          vehicleMap,
          traccarById,
          traccarByUnique: traccarByUniqueId,
        },
      ),
    );

    return res.status(200).json({ devices: response, data: response, error: null });
  } catch (error) {
    if (error?.status === 400) {
      return respondBadRequest(res, error.message || "Parâmetros inválidos.");
    }

    return res.status(503).json(TRACCAR_DB_UNAVAILABLE);
  }
  },
);

router.post(
  "/devices",
  authorizePermission({ menuKey: "primary", pageKey: "devices", subKey: "devices-list", requireFull: true }),
  deps.requireRole("manager", "admin"),
  resolveClientMiddleware,
  async (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.body?.clientId, { required: true });
    const { name, uniqueId, modelId, chipId, vehicleId } = req.body || {};
    const iconType = req.body?.iconType || req.body?.attributes?.iconType || null;
    const condition = req.body?.condition ?? req.body?.attributes?.condition ?? null;
    const rawInternalCode = req.body?.internalCode ?? req.body?.attributes?.internalCode ?? null;
    const internalCode = rawInternalCode === "" ? null : rawInternalCode;
    const rawGprs = req.body?.gprsCommunication ?? req.body?.attributes?.gprsCommunication;
    const gprsCommunication = rawGprs === false || rawGprs === "false" || rawGprs === 0 ? false : true;
    const warrantyFields = req.body?.attributes || {};
    if (!uniqueId) {
      throw createError(400, "uniqueId é obrigatório");
    }

    const normalizedUniqueId = String(uniqueId).trim();
    const existingDevice =
      deps.findDeviceByUniqueId(normalizedUniqueId) ||
      (await deps.findDeviceByUniqueIdInDb(normalizedUniqueId, { clientId })) ||
      (await deps.findDeviceByUniqueIdInDb(normalizedUniqueId, { matchAnyClient: true }));
    if (existingDevice && String(existingDevice.clientId) !== String(clientId)) {
      throw buildDeviceConflictError(normalizedUniqueId, existingDevice);
    }

    let model = null;
    if (modelId) {
      model = deps.getModelById(modelId);
      if (!model || (model.clientId && String(model.clientId) !== String(clientId))) {
        throw createError(404, "Modelo informado não pertence a este cliente");
      }
    }

    let resolvedInternalCode = internalCode ? String(internalCode).trim() : null;
    if (!resolvedInternalCode && modelId) {
      const prefix = resolveModelPrefix(model);
      if (prefix) {
        resolvedInternalCode = resolveNextInternalCode({ clientId, prefix });
      }
    }
    if (resolvedInternalCode) {
      const existingInternal = findDeviceByInternalCode({ clientId, internalCode: resolvedInternalCode });
      if (existingInternal && String(existingInternal.uniqueId) !== String(normalizedUniqueId)) {
        throw createError(409, "Código interno já existe neste cliente");
      }
    }

    const groupId = await ensureClientTraccarGroup(clientId);
    const attributes = { ...(req.body?.attributes || {}) };
    if (modelId) {
      attributes.modelId = modelId;
    }
    if (iconType) {
      attributes.iconType = iconType;
    }
    if (resolvedInternalCode !== null && resolvedInternalCode !== undefined) {
      attributes.internalCode = resolvedInternalCode;
    }
    if (condition !== null && condition !== undefined) {
      attributes.condition = condition;
    }
    if (rawGprs !== undefined) {
      attributes.gprsCommunication = gprsCommunication;
    }
    if (warrantyFields?.productionDate) attributes.productionDate = warrantyFields.productionDate;
    if (warrantyFields?.installationDate) attributes.installationDate = warrantyFields.installationDate;
    if (warrantyFields?.warrantyOrigin) attributes.warrantyOrigin = warrantyFields.warrantyOrigin;
    if (warrantyFields?.warrantyDays !== undefined) attributes.warrantyDays = warrantyFields.warrantyDays;
    if (warrantyFields?.warrantyStartDate) attributes.warrantyStartDate = warrantyFields.warrantyStartDate;
    if (warrantyFields?.warrantyEndDate) attributes.warrantyEndDate = warrantyFields.warrantyEndDate;
    if (warrantyFields?.warrantyNotes) attributes.warrantyNotes = warrantyFields.warrantyNotes;

    const resolvedOrigin = normalizeWarrantyOrigin(attributes.warrantyOrigin) || "production";
    if (attributes.warrantyDays !== undefined && attributes.warrantyDays !== null && attributes.warrantyDays !== "") {
      const startDate = resolvedOrigin === "installation" ? attributes.installationDate : attributes.productionDate;
      const computedEnd = computeWarrantyEndDate({ startDate, warrantyDays: attributes.warrantyDays });
      if (!computedEnd) {
        throw createError(400, "Informe a data base para calcular a garantia");
      }
      attributes.warrantyOrigin = resolvedOrigin;
      attributes.warrantyEndDate = computedEnd;
      attributes.warrantyStartDate = startDate;
    }

    const traccarName = resolvedInternalCode || name || normalizedUniqueId;
    const traccarResult = gprsCommunication
      ? await ensureTraccarDeviceExists({
          uniqueId: normalizedUniqueId,
          name: traccarName,
          groupId,
          attributes,
        })
      : { device: null };

    if (existingDevice) {
      const updated = deps.updateDevice(existingDevice.id, {
        name: name ?? existingDevice.name,
        modelId: modelId ? String(modelId) : existingDevice.modelId,
        traccarId: traccarResult.device?.id ? String(traccarResult.device.id) : existingDevice.traccarId,
        attributes,
      });

      if (chipId) {
        linkChipToDevice(clientId, chipId, updated.id);
      }
      if (vehicleId) {
        linkDeviceToVehicle(clientId, vehicleId, updated.id);
      }

      const models = deps.listModels({ clientId, includeGlobal: true });
      const chips = deps.listChips({ clientId });
      const vehicles = deps.listVehicles({ clientId });
      const traccarById = traccarResult.device?.id
        ? new Map([[String(traccarResult.device.id), traccarResult.device]])
        : new Map();
      const resolvedDevice = deps.getDeviceById(updated.id) || updated;
      const response = buildDeviceResponse(resolvedDevice, {
        modelMap: new Map(models.map((item) => [item.id, item])),
        chipMap: new Map(chips.map((item) => [item.id, item])),
        vehicleMap: new Map(vehicles.map((item) => [item.id, item])),
        traccarById,
        traccarByUnique: new Map(traccarResult.device?.uniqueId ? [[traccarResult.device.uniqueId, traccarResult.device]] : []),
      });

      invalidateDeviceCache();
      return res.status(200).json({ device: response, upserted: true, synced: Boolean(traccarResult.device) });
    }

    const device = deps.createDevice({
      clientId,
      name,
      uniqueId: normalizedUniqueId,
      modelId: modelId ? String(modelId) : null,
      traccarId: traccarResult.device?.id ? String(traccarResult.device.id) : null,
      attributes,
    });

    if (chipId) {
      linkChipToDevice(clientId, chipId, device.id);
    }
    if (vehicleId) {
      linkDeviceToVehicle(clientId, vehicleId, device.id);
    }

    const models = deps.listModels({ clientId, includeGlobal: true });
    const chips = deps.listChips({ clientId });
    const vehicles = deps.listVehicles({ clientId });
    const traccarById = new Map();
    if (traccarResult.device?.id) {
      traccarById.set(String(traccarResult.device.id), traccarResult.device);
    }
    const resolvedDevice = deps.getDeviceById(device.id) || device;
    const response = buildDeviceResponse(resolvedDevice, {
      modelMap: new Map(models.map((item) => [item.id, item])),
      chipMap: new Map(chips.map((item) => [item.id, item])),
      vehicleMap: new Map(vehicles.map((item) => [item.id, item])),
      traccarById,
      traccarByUnique: traccarResult.device?.uniqueId
        ? new Map([[traccarResult.device.uniqueId, traccarResult.device]])
        : new Map([[uniqueId, traccarResult.device || {}]]),
    });

    invalidateDeviceCache();
    res.status(201).json({ device: response });
  } catch (error) {
    next(error);
  }
  },
);

router.put(
  "/devices/:id",
  authorizePermission({ menuKey: "primary", pageKey: "devices", subKey: "devices-list", requireFull: true }),
  deps.requireRole("manager", "admin"),
  async (req, res, next) => {
  try {
    const { id } = req.params;
    const device = deps.getDeviceById(id);
    if (!device) {
      throw createError(404, "Equipamento não encontrado");
    }
    const incomingClientId = deps.resolveClientId(req, req.body?.clientId, {
      required: req.user.role !== "admin",
    });
    const clientId = resolveLinkClientId(incomingClientId, device);
    ensureSameClient(device, clientId, "Equipamento não encontrado");

    const payload = { ...req.body };
    const hasChipId = Object.prototype.hasOwnProperty.call(payload, "chipId");
    const hasVehicleId = Object.prototype.hasOwnProperty.call(payload, "vehicleId");
    const incomingChipId = hasChipId ? (payload.chipId === "" ? null : payload.chipId) : undefined;
    const incomingVehicleId = hasVehicleId ? (payload.vehicleId === "" ? null : payload.vehicleId) : undefined;

    if (hasChipId) delete payload.chipId;
    if (hasVehicleId) delete payload.vehicleId;
    const iconType = payload.iconType || payload.attributes?.iconType || null;
    if (iconType) {
      payload.attributes = { ...(payload.attributes || {}), iconType };
    }
    if (Object.prototype.hasOwnProperty.call(payload, "internalCode")) {
      payload.attributes = { ...(payload.attributes || {}), internalCode: payload.internalCode };
      delete payload.internalCode;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "condition")) {
      payload.attributes = { ...(payload.attributes || {}), condition: payload.condition };
      delete payload.condition;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "gprsCommunication")) {
      const rawGprs = payload.gprsCommunication;
      const gprsCommunication = rawGprs === false || rawGprs === "false" || rawGprs === 0 ? false : true;
      payload.attributes = { ...(payload.attributes || {}), gprsCommunication };
      delete payload.gprsCommunication;
    }
    if (payload.attributes) {
      const warrantyFields = payload.attributes;
      if (warrantyFields.productionDate) payload.attributes.productionDate = warrantyFields.productionDate;
      if (warrantyFields.installationDate) payload.attributes.installationDate = warrantyFields.installationDate;
      if (warrantyFields.warrantyOrigin) payload.attributes.warrantyOrigin = warrantyFields.warrantyOrigin;
      if (warrantyFields.warrantyDays !== undefined) payload.attributes.warrantyDays = warrantyFields.warrantyDays;
      if (warrantyFields.warrantyStartDate) payload.attributes.warrantyStartDate = warrantyFields.warrantyStartDate;
      if (warrantyFields.warrantyEndDate) payload.attributes.warrantyEndDate = warrantyFields.warrantyEndDate;
      if (warrantyFields.warrantyNotes) payload.attributes.warrantyNotes = warrantyFields.warrantyNotes;
    }
    if (payload.modelId) {
      const model = deps.getModelById(payload.modelId);
      if (!model || (model.clientId && String(model.clientId) !== String(clientId))) {
        throw createError(404, "Modelo informado não pertence a este cliente");
      }
    }

    const warrantyTouched = Boolean(
      payload.attributes &&
        (Object.prototype.hasOwnProperty.call(payload.attributes, "productionDate") ||
          Object.prototype.hasOwnProperty.call(payload.attributes, "installationDate") ||
          Object.prototype.hasOwnProperty.call(payload.attributes, "warrantyOrigin") ||
          Object.prototype.hasOwnProperty.call(payload.attributes, "warrantyDays")),
    );
    if (warrantyTouched) {
      const nextAttributes = { ...(device.attributes || {}), ...(payload.attributes || {}) };
      const resolvedOrigin = normalizeWarrantyOrigin(nextAttributes.warrantyOrigin) || "production";
      if (nextAttributes.warrantyDays !== undefined && nextAttributes.warrantyDays !== null && nextAttributes.warrantyDays !== "") {
        const startDate = resolvedOrigin === "installation" ? nextAttributes.installationDate : nextAttributes.productionDate;
        const computedEnd = computeWarrantyEndDate({ startDate, warrantyDays: nextAttributes.warrantyDays });
        if (!computedEnd) {
          throw createError(400, "Informe a data base para calcular a garantia");
        }
        nextAttributes.warrantyOrigin = resolvedOrigin;
        nextAttributes.warrantyEndDate = computedEnd;
        nextAttributes.warrantyStartDate = startDate;
      }
      payload.attributes = nextAttributes;
    }
    if (payload.attributes?.internalCode) {
      const existingInternal = findDeviceByInternalCode({ clientId, internalCode: payload.attributes.internalCode });
      if (existingInternal && String(existingInternal.id) !== String(device.id)) {
        throw createError(409, "Código interno já existe neste cliente");
      }
    }

    const updated = deps.updateDevice(id, payload);

    if (incomingChipId !== undefined) {
      if (incomingChipId) {
        linkChipToDevice(clientId, incomingChipId, id);
      } else if (incomingChipId === null && device.chipId) {
        detachChip(clientId, device.chipId);
      }
    }

    if (incomingVehicleId !== undefined) {
      if (incomingVehicleId) {
        linkDeviceToVehicle(clientId, incomingVehicleId, id);
      } else if (incomingVehicleId === null && device.vehicleId) {
        const previousVehicle = deps.getVehicleById(device.vehicleId);
        if (previousVehicle && String(previousVehicle.clientId) === String(clientId)) {
          deps.updateVehicle(previousVehicle.id, { deviceId: null });
        }
        deps.updateDevice(id, { vehicleId: null });
      }
    }

    const gprsEnabled = updated.attributes?.gprsCommunication !== false;
    if (gprsEnabled) {
      const traccarName = updated.attributes?.internalCode || updated.name || updated.uniqueId;
      const groupId = await ensureClientTraccarGroup(clientId);
      try {
        if (updated.traccarId) {
          await deps.traccarProxy("put", `/devices/${updated.traccarId}`, {
            data: {
              id: Number(updated.traccarId),
              name: traccarName,
              uniqueId: updated.uniqueId,
              groupId,
              attributes: updated.attributes || {},
            },
            asAdmin: true,
          });
        } else {
          const traccarResult = await ensureTraccarDeviceExists({
            uniqueId: updated.uniqueId,
            name: traccarName,
            groupId,
            attributes: updated.attributes || {},
          });
          if (traccarResult.device?.id) {
            deps.updateDevice(id, { traccarId: String(traccarResult.device.id) });
          }
        }
      } catch (traccarError) {
        console.warn("[devices] falha ao sincronizar dados no Traccar", traccarError?.message || traccarError);
      }
    }

    const models = deps.listModels({ clientId, includeGlobal: true });
    const chips = deps.listChips({ clientId });
    const vehicles = deps.listVehicles({ clientId });
    const traccarDevices = deps.getCachedTraccarResources("devices");
    const traccarById = new Map(traccarDevices.map((item) => [String(item.id), item]));
    const traccarByUnique = new Map(traccarDevices.map((item) => [String(item.uniqueId), item]));

    const resolvedDevice = deps.getDeviceById(id) || updated;
    const response = buildDeviceResponse(resolvedDevice, {
      modelMap: new Map(models.map((item) => [item.id, item])),
      chipMap: new Map(chips.map((item) => [item.id, item])),
      vehicleMap: new Map(vehicles.map((item) => [item.id, item])),
      traccarById,
      traccarByUnique,
    });

    invalidateDeviceCache();
    res.json({ device: response });
  } catch (error) {
    next(error);
  }
  },
);

router.delete(
  "/devices/:id",
  authorizePermission({ menuKey: "primary", pageKey: "devices", subKey: "devices-list", requireFull: true }),
  deps.requireRole("manager", "admin"),
  async (req, res, next) => {
  try {
    const { id } = req.params;
    const device = deps.getDeviceById(id);
    if (!device) {
      throw createError(404, "Equipamento não encontrado");
    }
    const clientId = deps.resolveClientId(req, req.query?.clientId, { required: true });
    ensureSameClient(device, clientId, "Equipamento não encontrado");

    if (device.traccarId) {
      try {
        await deps.traccarProxy("delete", `/devices/${device.traccarId}`, { asAdmin: true });
      } catch (traccarError) {
        console.warn("[devices] falha ao remover no Traccar", traccarError?.message || traccarError);
      }
    }

    if (device.chipId) {
      detachChip(clientId, device.chipId);
    }
    if (device.vehicleId) {
      detachVehicle(clientId, device.vehicleId);
    }

    deps.deleteDevice(id);
    invalidateDeviceCache();
    res.status(204).end();
  } catch (error) {
    next(error);
  }
  },
);

router.get(
  "/chips",
  authorizePermission({ menuKey: "primary", pageKey: "devices", subKey: "devices-chips" }),
  (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.query?.clientId, { required: false });
    const query = String(req.query?.query || "").trim().toLowerCase();
    const { page, pageSize, start } = parsePagination(req.query);
    const chips = deps.listChips({ clientId });
    const devices = deps.listDevices({ clientId });
    const vehicles = deps.listVehicles({ clientId });
    const deviceMap = new Map(devices.map((item) => [item.id, item]));
    const vehicleMap = new Map(vehicles.map((item) => [item.id, item]));

    let response = chips.map((chip) => buildChipResponse(chip, { deviceMap, vehicleMap }));

    if (query) {
      response = response.filter((chip) => {
        const haystack = [
          chip.iccid,
          chip.phone,
          chip.carrier,
          chip.provider,
          chip.status,
          chip.device?.name,
          chip.device?.uniqueId,
          chip.vehicle?.plate,
          chip.vehicle?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      });
    }

    const total = response.length;
    const paged = response.slice(start, start + pageSize);
    res.json({
      chips: paged,
      page,
      pageSize,
      total,
      hasMore: start + pageSize < total,
    });
  } catch (error) {
    next(error);
  }
  },
);

router.post(
  "/chips",
  authorizePermission({ menuKey: "primary", pageKey: "devices", subKey: "devices-chips", requireFull: true }),
  deps.requireRole("manager", "admin"),
  resolveClientMiddleware,
  (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.body?.clientId, { required: true });
    const { iccid, phone, carrier, status, apn, apnUser, apnPass, notes, provider, deviceId } = req.body || {};
    const chip = deps.createChip({
      clientId,
      iccid,
      phone,
      carrier,
      status,
      apn,
      apnUser,
      apnPass,
      notes,
      provider,
    });

    if (deviceId) {
      linkChipToDevice(clientId, chip.id, deviceId);
    }

    const devices = deps.listDevices({ clientId });
    const vehicles = deps.listVehicles({ clientId });
    const storedChip = deps.getChipById(chip.id);
    const response = buildChipResponse(storedChip, {
      deviceMap: new Map(devices.map((item) => [item.id, item])),
      vehicleMap: new Map(vehicles.map((item) => [item.id, item])),
    });
    res.status(201).json({ chip: response });
  } catch (error) {
    next(error);
  }
  },
);

router.put(
  "/chips/:id",
  authorizePermission({ menuKey: "primary", pageKey: "devices", subKey: "devices-chips", requireFull: true }),
  deps.requireRole("manager", "admin"),
  resolveClientMiddleware,
  (req, res, next) => {
  try {
    const { id } = req.params;
    const chip = deps.getChipById(id);
    if (!chip) {
      throw createError(404, "Chip não encontrado");
    }
    const clientId = deps.resolveClientId(req, req.body?.clientId, { required: true });
    ensureSameClient(chip, clientId, "Chip não encontrado");

    const payload = { ...req.body };
    if (payload.deviceId === "") {
      payload.deviceId = null;
    }

    const updated = deps.updateChip(id, payload);

    if (payload.deviceId) {
      linkChipToDevice(clientId, updated.id, payload.deviceId);
    } else if (payload.deviceId === null) {
      detachChip(clientId, updated.id);
    }

    const devices = deps.listDevices({ clientId });
    const vehicles = deps.listVehicles({ clientId });
    const response = buildChipResponse(deps.getChipById(updated.id), {
      deviceMap: new Map(devices.map((item) => [item.id, item])),
      vehicleMap: new Map(vehicles.map((item) => [item.id, item])),
    });

    res.json({ chip: response });
  } catch (error) {
    next(error);
  }
  },
);

router.delete(
  "/chips/:id",
  authorizePermission({ menuKey: "primary", pageKey: "devices", subKey: "devices-chips", requireFull: true }),
  deps.requireRole("manager", "admin"),
  resolveClientMiddleware,
  (req, res, next) => {
  try {
    const { id } = req.params;
    const chip = deps.getChipById(id);
    if (!chip) {
      throw createError(404, "Chip não encontrado");
    }
    const clientId = deps.resolveClientId(req, req.query?.clientId, { required: true });
    ensureSameClient(chip, clientId, "Chip não encontrado");

    if (chip.deviceId) {
      detachChip(clientId, chip.id);
    }

    deps.deleteChip(id);
    invalidateDeviceCache();
    res.status(204).end();
  } catch (error) {
    next(error);
  }
  },
);

router.get("/technicians", async (req, res, next) => {
  try {
    if (!isPrismaAvailable()) {
      throw createError(503, "Banco de dados indisponível");
    }
    const isAdmin = req.user?.role === "admin";
    let mirrorOwnerIds = [];
    const isManager = req.user?.role === "manager";
    const includeDetails = isAdmin || isManager;
    const clientId = deps.resolveClientId(req, req.query?.clientId, { required: !isAdmin });
    const query = String(req.query?.query || "").trim();
    const { page, pageSize, start } = parsePagination(req.query);

    const where = {
      role: TECHNICIAN_ROLE,
      ...(clientId ? { clientId: String(clientId) } : {}),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
              { username: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const technicians = await prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: start,
      take: pageSize,
    });

    const total = await prisma.user.count({ where });
    const items = technicians.map((tech) => {
      const attributes = tech.attributes || {};
      if (!includeDetails) {
        return { id: tech.id, name: tech.name };
      }
      return {
        id: tech.id,
        name: tech.name,
        email: tech.email,
        username: tech.username || null,
        clientId: tech.clientId,
        phone: attributes.phone || null,
        city: attributes.city || null,
        state: attributes.state || null,
        status: attributes.status || "ativo",
        type: attributes.type || null,
        profile: attributes.profile || "Técnico Completo",
        addressSearch: attributes.addressSearch || null,
        street: attributes.street || null,
        number: attributes.number || null,
        complement: attributes.complement || null,
        district: attributes.district || null,
        zip: attributes.zip || null,
        latitude: attributes.latitude ?? null,
        longitude: attributes.longitude ?? null,
        loginConfigured: attributes.loginConfigured ?? null,
        contact: attributes.phone || tech.email || null,
      };
    });

    res.json({
      ok: true,
      items,
      page,
      pageSize,
      total,
      hasMore: start + pageSize < total,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/technicians", deps.requireRole("manager", "admin"), async (req, res, next) => {
  try {
    if (!isPrismaAvailable()) {
      throw createError(503, "Banco de dados indisponível");
    }
    const body = req.body || {};
    const clientId = deps.resolveClientId(req, body.clientId, { required: true });
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const phone = body.phone ? String(body.phone).trim() : "";
    const city = body.city ? String(body.city).trim() : "";
    const state = body.state ? String(body.state).trim() : "";
    const status = body.status ? String(body.status).trim().toLowerCase() : "ativo";
    const type = body.type ? String(body.type).trim() : "";
    const profile = body.profile ? String(body.profile).trim() : "Técnico Completo";
    const addressSearch = body.addressSearch ? String(body.addressSearch).trim() : "";
    const street = body.street ? String(body.street).trim() : "";
    const number = body.number ? String(body.number).trim() : "";
    const complement = body.complement ? String(body.complement).trim() : "";
    const district = body.district ? String(body.district).trim() : "";
    const zip = body.zip ? String(body.zip).trim() : "";
    const latitudeRaw = body.latitude !== undefined && body.latitude !== null && body.latitude !== "" ? Number(body.latitude) : null;
    const longitudeRaw = body.longitude !== undefined && body.longitude !== null && body.longitude !== "" ? Number(body.longitude) : null;
    const latitude = Number.isFinite(latitudeRaw) ? latitudeRaw : null;
    const longitude = Number.isFinite(longitudeRaw) ? longitudeRaw : null;

    if (!name || !email) {
      throw createError(400, "Nome e e-mail são obrigatórios");
    }

    const password = randomUUID();
    const technician = await createUser({
      name,
      email,
      password,
      role: TECHNICIAN_ROLE,
      clientId,
      attributes: {
        phone,
        city,
        state,
        status,
        type,
        profile,
        addressSearch,
        street,
        number,
        complement,
        district,
        zip,
        latitude,
        longitude,
        loginConfigured: false,
      },
    });

    res.status(201).json({
      ok: true,
      item: {
        id: technician.id,
        name: technician.name,
        email: technician.email,
        username: technician.username || null,
        clientId: technician.clientId,
        phone,
        city,
        state,
        status,
        type,
        profile,
        addressSearch,
        street,
        number,
        complement,
        district,
        zip,
        latitude,
        longitude,
        loginConfigured: false,
        contact: phone || email,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.put("/technicians/:id", deps.requireRole("manager", "admin"), async (req, res, next) => {
  try {
    if (!isPrismaAvailable()) {
      throw createError(503, "Banco de dados indisponível");
    }
    const body = req.body || {};
    const existing = await getUserById(req.params.id, { includeSensitive: true });
    if (!existing || existing.role !== TECHNICIAN_ROLE) {
      throw createError(404, "Técnico não encontrado");
    }

    if (req.user?.role !== "admin") {
      const requiredClientId = deps.resolveClientId(req, body.clientId || existing.clientId, { required: true });
      if (String(requiredClientId) !== String(existing.clientId)) {
        throw createError(403, "Operação não permitida para este cliente");
      }
    }

    const attributes = { ...(existing.attributes || {}) };
    if (Object.prototype.hasOwnProperty.call(body, "phone")) {
      attributes.phone = body.phone ? String(body.phone).trim() : "";
    }
    if (Object.prototype.hasOwnProperty.call(body, "city")) {
      attributes.city = body.city ? String(body.city).trim() : "";
    }
    if (Object.prototype.hasOwnProperty.call(body, "state")) {
      attributes.state = body.state ? String(body.state).trim() : "";
    }
    if (Object.prototype.hasOwnProperty.call(body, "status")) {
      attributes.status = body.status ? String(body.status).trim().toLowerCase() : "ativo";
    }
    if (Object.prototype.hasOwnProperty.call(body, "type")) {
      attributes.type = body.type ? String(body.type).trim() : "";
    }
    if (Object.prototype.hasOwnProperty.call(body, "profile")) {
      attributes.profile = body.profile ? String(body.profile).trim() : "Técnico Completo";
    }
    if (Object.prototype.hasOwnProperty.call(body, "addressSearch")) {
      attributes.addressSearch = body.addressSearch ? String(body.addressSearch).trim() : "";
    }
    if (Object.prototype.hasOwnProperty.call(body, "street")) {
      attributes.street = body.street ? String(body.street).trim() : "";
    }
    if (Object.prototype.hasOwnProperty.call(body, "number")) {
      attributes.number = body.number ? String(body.number).trim() : "";
    }
    if (Object.prototype.hasOwnProperty.call(body, "complement")) {
      attributes.complement = body.complement ? String(body.complement).trim() : "";
    }
    if (Object.prototype.hasOwnProperty.call(body, "district")) {
      attributes.district = body.district ? String(body.district).trim() : "";
    }
    if (Object.prototype.hasOwnProperty.call(body, "zip")) {
      attributes.zip = body.zip ? String(body.zip).trim() : "";
    }
    if (Object.prototype.hasOwnProperty.call(body, "latitude")) {
      const nextLatitude = body.latitude !== null && body.latitude !== "" ? Number(body.latitude) : null;
      attributes.latitude = Number.isFinite(nextLatitude) ? nextLatitude : null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "longitude")) {
      const nextLongitude = body.longitude !== null && body.longitude !== "" ? Number(body.longitude) : null;
      attributes.longitude = Number.isFinite(nextLongitude) ? nextLongitude : null;
    }

    const payload = {
      name: body.name !== undefined ? String(body.name).trim() : undefined,
      email: body.email !== undefined ? String(body.email).trim() : undefined,
      attributes,
    };

    const updated = await updateUser(existing.id, payload);

    res.json({
      ok: true,
      item: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        username: updated.username || null,
        clientId: updated.clientId,
        phone: attributes.phone || null,
        city: attributes.city || null,
        state: attributes.state || null,
        status: attributes.status || "ativo",
        type: attributes.type || null,
        profile: attributes.profile || "Técnico Completo",
        addressSearch: attributes.addressSearch || null,
        street: attributes.street || null,
        number: attributes.number || null,
        complement: attributes.complement || null,
        district: attributes.district || null,
        zip: attributes.zip || null,
        latitude: attributes.latitude ?? null,
        longitude: attributes.longitude ?? null,
        loginConfigured: attributes.loginConfigured ?? null,
        contact: attributes.phone || updated.email || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.delete(
  "/technicians/:id",
  authorizePermission({ menuKey: "fleet", pageKey: "services", subKey: "technicians", requireFull: true }),
  deps.requireRole("manager", "admin"),
  async (req, res, next) => {
  try {
    if (!isPrismaAvailable()) {
      throw createError(503, "Banco de dados indisponível");
    }
    const existing = await getUserById(req.params.id, { includeSensitive: true });
    if (!existing || existing.role !== TECHNICIAN_ROLE) {
      throw createError(404, "Técnico não encontrado");
    }
    if (req.user?.role !== "admin") {
      const clientId = deps.resolveClientId(req, existing.clientId, { required: true });
      if (String(clientId) !== String(existing.clientId)) {
        throw createError(403, "Operação não permitida para este cliente");
      }
    }
    deleteUser(existing.id);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
  },
);

router.post("/technicians/:id/login", deps.requireRole("manager", "admin"), async (req, res, next) => {
  try {
    if (!isPrismaAvailable()) {
      throw createError(503, "Banco de dados indisponível");
    }
    const body = req.body || {};
    const existing = await getUserById(req.params.id, { includeSensitive: true });
    if (!existing || existing.role !== TECHNICIAN_ROLE) {
      throw createError(404, "Técnico não encontrado");
    }

    if (req.user?.role !== "admin") {
      const requiredClientId = deps.resolveClientId(req, body.clientId || existing.clientId, { required: true });
      if (String(requiredClientId) !== String(existing.clientId)) {
        throw createError(403, "Operação não permitida para este cliente");
      }
    }

    const attributes = { ...(existing.attributes || {}) };
    const shouldMarkConfigured = Boolean(body.password || body.username || body.email);
    if (shouldMarkConfigured) {
      attributes.loginConfigured = true;
      attributes.loginUpdatedAt = new Date().toISOString();
    }

    const payload = {
      email: body.email !== undefined ? String(body.email).trim() : undefined,
      username: body.username !== undefined ? String(body.username).trim() : undefined,
      password: body.password !== undefined ? String(body.password) : undefined,
      attributes,
    };

    const updated = await updateUser(existing.id, payload);

    res.json({
      ok: true,
      item: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        username: updated.username || null,
        clientId: updated.clientId,
        loginConfigured: attributes.loginConfigured ?? false,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/vehicle-attributes", async (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.query?.clientId, { required: true });
    const client = await deps.getClientById(clientId);
    if (!client) {
      throw createError(404, "Cliente não encontrado");
    }
    const attributes = Array.isArray(client.attributes?.vehicleAttributes)
      ? client.attributes.vehicleAttributes
      : [];
    res.json({ items: attributes });
  } catch (error) {
    next(error);
  }
});

router.post("/vehicle-attributes", deps.requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.body?.clientId, { required: true });
    const client = await deps.getClientById(clientId);
    if (!client) {
      throw createError(404, "Cliente não encontrado");
    }
    const name = req.body?.name ? String(req.body.name).trim() : "";
    if (!name) {
      throw createError(400, "Nome do atributo é obrigatório");
    }
    const color = req.body?.color ? String(req.body.color).trim() : "#38bdf8";
    const current = Array.isArray(client.attributes?.vehicleAttributes)
      ? client.attributes.vehicleAttributes
      : [];
    const normalizedName = name.toLowerCase();
    if (current.some((item) => String(item.name || "").toLowerCase() === normalizedName)) {
      throw createError(409, "Já existe um atributo com este nome");
    }
    const nextItem = { id: randomUUID(), name, color };
    const nextAttributes = {
      ...(client.attributes || {}),
      vehicleAttributes: [...current, nextItem],
    };
    await deps.updateClient(clientId, { attributes: nextAttributes });
    res.status(201).json({ ok: true, item: nextItem, items: nextAttributes.vehicleAttributes });
  } catch (error) {
    next(error);
  }
});

router.get(
  "/vehicles",
  authorizePermission({ menuKey: "fleet", pageKey: "vehicles" }),
  async (req, res, next) => {
  const startedAt = Date.now();
  let includeUnlinked = false;
  let onlyLinked = true;
  let clientId = null;
  try {
    clientId = deps.resolveClientId(req, req.query?.clientId, { required: false });
    const accessibleOnly = isTruthyParam(req.query?.accessible);
    const query = String(req.query?.query || "").trim().toLowerCase();
    const { page, pageSize, start } = parsePagination(req.query);
    const isAdmin = req.user?.role === "admin";
    let mirrorOwnerIds = [];
    let mirrorRestricted = false;
    const userAccess = req.user?.attributes?.userAccess || {};
    const groupIds = Array.isArray(userAccess.vehicleGroupIds)
      ? userAccess.vehicleGroupIds
      : userAccess.vehicleGroupId
        ? [userAccess.vehicleGroupId]
        : [];
    const accessVehicleIds =
      userAccess.vehicleAccess?.mode === "selected"
        ? new Set([
          ...(userAccess.vehicleAccess?.vehicleIds || []).map(String),
          ...listGroups({ clientId: req.user?.clientId ?? clientId })
            .filter(
              (group) =>
                groupIds.some((id) => String(id) === String(group.id))
                && group.attributes?.kind === "VEHICLE_GROUP",
            )
            .flatMap((group) => (group.attributes?.vehicleIds || []).map(String)),
        ])
        : null;
    const access = await getAccessibleVehicles({
      user: req.user,
      clientId,
      includeMirrorsForNonReceivers: !accessibleOnly,
    });
    let vehicles = access.vehicles;
    mirrorOwnerIds = access.mirrorOwnerIds;
    mirrorRestricted = access.isReceiver;
    if (accessVehicleIds) {
      vehicles = vehicles.filter((vehicle) => accessVehicleIds.has(String(vehicle.id)));
    }
    let devices = deps.listDevices({ clientId });
    if (mirrorOwnerIds.length) {
      const extraDevices = mirrorOwnerIds.flatMap((ownerId) => deps.listDevices({ clientId: ownerId }));
      devices = mergeById(devices, extraDevices);
    }
    const monitoringDevices = devices.filter((device) => device?.attributes?.gprsCommunication !== false);
    console.info("[vehicles] listagem para API", { clientId: clientId || null, vehicles: vehicles.length, devices: devices.length });
    const traccarDevices = deps.getCachedTraccarResources("devices");
    const traccarById = new Map(traccarDevices.map((item) => [String(item.id), item]));
    const deviceMap = new Map(monitoringDevices.map((item) => [item.id, item]));
    let clientMap = new Map();

    if (isPrismaAvailable()) {
      const clientIds = Array.from(new Set(vehicles.map((vehicle) => vehicle?.clientId).filter(Boolean)));
      if (clientIds.length) {
        try {
          const clients = await prisma.client.findMany({
            where: { id: { in: clientIds.map((id) => String(id)) } },
            select: { id: true, name: true },
          });
          clientMap = new Map(clients.map((client) => [String(client.id), client]));
        } catch (prismaError) {
          logTelemetryWarning("vehicles-clients", prismaError);
        }
      }
    }

    const allowUnlinked = req.user?.role === "admin" || req.user?.role === "manager";
    if (req.query?.includeUnlinked !== undefined) {
      const parsedInclude = normaliseBoolean(req.query?.includeUnlinked);
      if (parsedInclude === null) {
        return respondBadRequest(res, "includeUnlinked deve ser booleano (true/false).");
      }
      includeUnlinked = allowUnlinked ? parsedInclude : false;
    }
    if (req.query?.onlyLinked !== undefined) {
      const parsedOnlyLinked = normaliseBoolean(req.query?.onlyLinked);
      if (parsedOnlyLinked === null) {
        return respondBadRequest(res, "onlyLinked deve ser booleano (true/false).");
      }
      onlyLinked = parsedOnlyLinked;
    } else {
      onlyLinked = !includeUnlinked;
    }

    const linkedVehicleIds = new Set(
      monitoringDevices
        .filter((device) => device?.vehicleId)
        .map((device) => String(device.vehicleId))
        .filter(Boolean),
    );
    const knownDeviceIds = new Set(monitoringDevices.map((device) => String(device.id)).filter(Boolean));

    let positionsByDeviceId = new Map();
    let telemetryUnavailable = false;
    const traccarIdsToQuery = Array.from(
      new Set(
        monitoringDevices
          .map((device) => (device?.traccarId != null ? String(device.traccarId) : null))
          .filter(Boolean),
      ),
    );

    if (traccarIdsToQuery.length) {
      try {
        const latestPositions = await deps.fetchLatestPositionsWithFallback(traccarIdsToQuery, null);
        positionsByDeviceId = new Map(
          (Array.isArray(latestPositions) ? latestPositions : [])
            .map((position) => {
              const key = String(
                position.deviceId || position.deviceid || position.device?.id || position.id || position?.uniqueId || "",
              );
              return key ? [key, position] : null;
            })
            .filter(Boolean),
        );
        console.info("[monitoring] posições para veículos", {
          clientId: clientId || null,
          requested: traccarIdsToQuery.length,
          received: positionsByDeviceId.size,
        });
      } catch (positionsError) {
        telemetryUnavailable = true;
        logTelemetryWarning("vehicles-positions", positionsError);
      }
    }

    const vehiclesToExpose = onlyLinked
      ? vehicles.filter((vehicle) => {
          const vehicleId = String(vehicle.id);
          const hasDevice = linkedVehicleIds.has(vehicleId);
          const matchesDeviceId = vehicle.deviceId ? knownDeviceIds.has(String(vehicle.deviceId)) : false;
          return hasDevice || matchesDeviceId;
        })
      : vehicles;

    let response = vehiclesToExpose.map((vehicle) => {
      try {
        const built = buildVehicleResponse(vehicle, { deviceMap, traccarById, positionsByDeviceId, clientMap });
        return telemetryUnavailable ? { ...built, telemetryStatus: "unavailable" } : built;
      } catch (buildError) {
        telemetryUnavailable = true;
        console.warn("[vehicles] falha ao enriquecer veículo", {
          vehicleId: vehicle?.id,
          message: buildError?.message,
        });
        return {
          ...vehicle,
          device: null,
          devices: [],
          deviceCount: 0,
          position: null,
          connectionStatus: null,
          connectionStatusLabel: "Indisponível",
          lastCommunication: null,
          telemetryStatus: "unavailable",
        };
      }
    });
    if (query) {
      response = response.filter((vehicle) => {
        const haystack = [
          vehicle.plate,
          vehicle.name,
          vehicle.description,
          vehicle.type,
          vehicle.clientName,
          vehicle.device?.name,
          vehicle.device?.uniqueId,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      });
    }
    const total = response.length;
    const paged = response.slice(start, start + pageSize);
    const responsePayload = {
      vehicles: paged,
      page,
      pageSize,
      total,
      hasMore: start + pageSize < total,
      ...(telemetryUnavailable ? { telemetryStatus: "unavailable" } : {}),
    };
    if (accessibleOnly) {
      responsePayload.meta = { restricted: mirrorRestricted };
    }
    res.json(responsePayload);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error("[vehicles] falha ao listar", {
      route: req.originalUrl,
      clientId,
      includeUnlinked,
      userId: req.user?.id ? String(req.user.id) : null,
      role: req.user?.role || null,
      durationMs,
      message: error?.message,
      stack: error?.stack,
    });
    const status = Number(error?.status || error?.statusCode);
    if (status === 400) {
      return res.status(400).json({ code: "BAD_REQUEST", message: error?.message || "Parâmetros inválidos." });
    }
    if (status === 403) {
      return res.status(403).json({ code: "FORBIDDEN", message: error?.message || "Acesso negado." });
    }
    if (isDependencyFailure(error)) {
      return res.status(503).json(
        buildServiceUnavailablePayload({
          message: "Serviço indisponível no momento",
          details: { route: "/api/core/vehicles" },
        }),
      );
    }
    if (status && status >= 500 && status < 600) {
      return res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Erro interno no servidor" });
    }
    return next(error);
  }
  },
);

router.get(
  "/vehicles/:id/traccar-device",
  authorizePermission({ menuKey: "fleet", pageKey: "vehicles" }),
  async (req, res, next) => {
  try {
    const { id } = req.params;
    const clientId = deps.resolveClientId(req, req.query?.clientId, { required: false });
    const access = await getAccessibleVehicles({ user: req.user, clientId });
    const isAccessible = access.vehicles.some((vehicle) => String(vehicle.id) === String(id));
    if (!isAccessible) {
      throw createError(404, "Veículo não encontrado");
    }
    const vehicle = deps.getVehicleById(id);
    if (!vehicle) {
      throw createError(404, "Veículo não encontrado");
    }

    if (!vehicle.deviceId) {
      throw createError(404, "Veículo sem equipamento vinculado");
    }

    const device = deps.getDeviceById(vehicle.deviceId);
    if (!device) {
      throw createError(404, "Equipamento vinculado não encontrado");
    }

    const traccarDeviceId = device.traccarId ? String(device.traccarId).trim() : null;
    if (!traccarDeviceId) {
      throw createError(409, "Equipamento vinculado sem traccarId");
    }

    console.info("[vehicles] buscando device no Traccar", {
      vehicleId: vehicle.id,
      euroOneDeviceId: device.id,
      traccarId: traccarDeviceId,
    });

    const traccarDevice = await deps.traccarProxy("get", `/devices/${traccarDeviceId}`, {
      asAdmin: true,
      context: req,
    });
    const traccarStatus = Number(traccarDevice?.status || traccarDevice?.statusCode || traccarDevice?.error?.code);
    console.info("[traccar] GET /devices/:id", {
      vehicleId: vehicle.id,
      euroOneDeviceId: device.id,
      traccarId: traccarDeviceId,
      status: Number.isFinite(traccarStatus) ? traccarStatus : 200,
    });

    if (traccarDevice?.ok === false || traccarDevice?.error) {
      const mapped = resolveTraccarDeviceError(traccarDevice);
      return res.status(mapped.status).json({
        ok: false,
        message: mapped.message,
        details: {
          traccarStatus: mapped.code,
          traccarId: traccarDeviceId,
        },
      });
    }

    let resolvedProtocol = traccarDevice?.protocol ?? device?.protocol ?? null;

    if (!resolvedProtocol) {
      let latestPositions = [];
      try {
        latestPositions = await deps.fetchLatestPositionsWithFallback([traccarDeviceId], null);
      } catch (positionsError) {
        return next(positionsError);
      }

      const latestPosition = Array.isArray(latestPositions)
        ? latestPositions.find((position) => String(position?.deviceId || "") === traccarDeviceId) || latestPositions[0]
        : null;
      const normalisedPosition = normaliseTelemetryPosition(latestPosition);
      resolvedProtocol = normalisedPosition?.protocol ?? null;

      if (!resolvedProtocol) {
        return res.status(409).json({
          ok: false,
          message: "Device ainda não possui última posição no Traccar; protocolo indisponível",
        });
      }
    }
    return res.json({
      device: {
        ...traccarDevice,
        id: device.id,
        uniqueId: traccarDevice?.uniqueId || device?.uniqueId || null,
        protocol: resolvedProtocol,
        traccarId: traccarDevice?.id ?? device?.traccarId ?? null,
        euroOneDeviceId: device.id,
      },
    });
  } catch (error) {
    if (error?.isTraccarError) {
      return res.status(error.status || 503).json({
        ok: false,
        message: error.message || "Erro ao buscar device no Traccar",
        details: {
          ...(error?.details || {}),
          vehicleId: req.params?.id,
        },
      });
    }
    next(error);
  }
  },
);

router.post(
  "/vehicles",
  authorizePermission({ menuKey: "fleet", pageKey: "vehicles", requireFull: true }),
  deps.requireRole("manager", "admin"),
  resolveClientMiddleware,
  (req, res, next) => {
  try {
    const auditSentAt = new Date().toISOString();
    const clientId = deps.resolveClientId(req, req.body?.clientId, { required: true });
  const {
    name,
    plate,
    driver,
    group,
    type,
    status,
    notes,
    deviceId,
    item,
    identifier,
    model,
    brand,
    chassis,
    renavam,
    color,
    modelYear,
    manufactureYear,
    fipeCode,
    fipeValue,
    zeroKm,
    attributes: incomingAttributes,
    vehicleAttributes,
  } = req.body || {};
  const normalizedVehicleAttributes = normalizeVehicleAttributesList(
    vehicleAttributes ?? incomingAttributes?.vehicleAttributes,
  );
  const attributes =
    vehicleAttributes !== undefined || incomingAttributes?.vehicleAttributes !== undefined
      ? {
          ...(incomingAttributes && typeof incomingAttributes === "object" ? incomingAttributes : {}),
          vehicleAttributes: normalizedVehicleAttributes,
        }
      : incomingAttributes;
  const vehicle = deps.createVehicle({
    clientId,
    name,
    plate,
      driver,
      group,
      type,
      status,
      notes,
      item,
      identifier,
      model,
      brand,
      chassis,
      renavam,
      color,
      modelYear,
    manufactureYear,
    fipeCode,
    fipeValue,
    zeroKm,
    attributes,
  });

    if (deviceId) {
      linkDeviceToVehicle(clientId, vehicle.id, deviceId);
    }

    const devices = deps.listDevices({ clientId });
    const traccarDevices = deps.getCachedTraccarResources("devices");
    const traccarById = new Map(traccarDevices.map((item) => [String(item.id), item]));
    const clientMap = new Map();
    const client = deps.getClientById(clientId);
    if (client) {
      clientMap.set(String(clientId), client);
    }
    const response = buildVehicleResponse(deps.getVehicleById(vehicle.id), {
      deviceMap: new Map(devices.map((item) => [item.id, item])),
      traccarById,
      clientMap,
    });
    recordAuditEvent({
      clientId,
      vehicleId: vehicle.id,
      category: "vehicle",
      action: "CADASTRO DE VEÍCULO",
      status: "Sucesso",
      sentAt: auditSentAt,
      respondedAt: new Date().toISOString(),
      user: resolveAuditUser(req),
      ipAddress: resolveRequestIp(req),
      details: { plate: vehicle.plate || null },
    });
    res.status(201).json({ vehicle: response });
  } catch (error) {
    next(error);
  }
  },
);

router.post(
  "/vehicles/:vehicleId/devices/:deviceId",
  authorizePermission({ menuKey: "fleet", pageKey: "vehicles", requireFull: true }),
  deps.requireRole("manager", "admin"),
  resolveClientMiddleware,
  (req, res, next) => {
  try {
    const auditSentAt = new Date().toISOString();
    const { vehicleId, deviceId } = req.params;
    const clientId = deps.resolveClientId(
      req,
      req.body?.clientId || req.query?.clientId || req.clientId,
      { required: req.user.role !== "admin" },
    );
    const vehicle = deps.getVehicleById(vehicleId);
    const device = deps.getDeviceById(deviceId);
    const resolvedClientId = resolveLinkClientId(clientId, vehicle, device);
    linkDeviceToVehicle(resolvedClientId, vehicleId, deviceId);
    const vehicles = deps.listVehicles({ clientId: resolvedClientId });
    const devices = deps.listDevices({ clientId: resolvedClientId });
    const traccarDevices = deps.getCachedTraccarResources("devices");
    const traccarById = new Map(traccarDevices.map((item) => [String(item.id), item]));
    const clientMap = new Map();
    const client = deps.getClientById(resolvedClientId);
    if (client) {
      clientMap.set(String(resolvedClientId), client);
    }
    const response = buildVehicleResponse(deps.getVehicleById(vehicleId), {
      deviceMap: new Map(devices.map((item) => [item.id, item])),
      traccarById,
      clientMap,
    });
    recordAuditEvent({
      clientId: resolvedClientId,
      vehicleId,
      deviceId,
      category: "vehicle",
      action: "VINCULAR EQUIPAMENTO",
      status: "Sucesso",
      sentAt: auditSentAt,
      respondedAt: new Date().toISOString(),
      user: resolveAuditUser(req),
      ipAddress: resolveRequestIp(req),
    });
    res.status(200).json({ vehicle: response });
  } catch (error) {
    next(error);
  }
  },
);

router.delete(
  "/vehicles/:vehicleId/devices/:deviceId",
  authorizePermission({ menuKey: "fleet", pageKey: "vehicles", requireFull: true }),
  deps.requireRole("manager", "admin"),
  resolveClientMiddleware,
  (req, res, next) => {
  try {
    const auditSentAt = new Date().toISOString();
    const { vehicleId, deviceId } = req.params;
    const clientId = deps.resolveClientId(
      req,
      req.body?.clientId || req.query?.clientId || req.clientId,
      { required: req.user.role !== "admin" },
    );
    const vehicle = deps.getVehicleById(vehicleId);
    const device = deps.getDeviceById(deviceId);
    const resolvedClientId = resolveLinkClientId(clientId, vehicle, device);
    ensureSameClient(vehicle, resolvedClientId, "Veículo não encontrado");
    ensureSameClient(device, resolvedClientId, "Equipamento não encontrado");
    if (device.vehicleId && String(device.vehicleId) === String(vehicle.id)) {
      deps.updateDevice(device.id, { vehicleId: null });
    }
    if (vehicle.deviceId && String(vehicle.deviceId) === String(device.id)) {
      deps.updateVehicle(vehicle.id, { deviceId: null });
    }
    const devices = deps.listDevices({ clientId: resolvedClientId });
    const traccarDevices = deps.getCachedTraccarResources("devices");
    const traccarById = new Map(traccarDevices.map((item) => [String(item.id), item]));
    const clientMap = new Map();
    const client = deps.getClientById(resolvedClientId);
    if (client) {
      clientMap.set(String(resolvedClientId), client);
    }
    const response = buildVehicleResponse(deps.getVehicleById(vehicle.id), {
      deviceMap: new Map(devices.map((item) => [item.id, item])),
      traccarById,
      clientMap,
    });
    recordAuditEvent({
      clientId: resolvedClientId,
      vehicleId,
      deviceId,
      category: "vehicle",
      action: "DESVINCULAR EQUIPAMENTO",
      status: "Sucesso",
      sentAt: auditSentAt,
      respondedAt: new Date().toISOString(),
      user: resolveAuditUser(req),
      ipAddress: resolveRequestIp(req),
    });
    res.status(200).json({ vehicle: response });
  } catch (error) {
    next(error);
  }
  },
);

router.put(
  "/vehicles/:id",
  authorizePermission({ menuKey: "fleet", pageKey: "vehicles", requireFull: true }),
  deps.requireRole("manager", "admin"),
  resolveClientMiddleware,
  (req, res, next) => {
  try {
    const auditSentAt = new Date().toISOString();
    const { id } = req.params;
    const vehicle = deps.getVehicleById(id);
    if (!vehicle) {
      throw createError(404, "Veículo não encontrado");
    }
    const clientId = deps.resolveClientId(req, req.body?.clientId, { required: true });
    ensureSameClient(vehicle, clientId, "Veículo não encontrado");

    const payload = { ...req.body };
    if (payload.deviceId === "") {
      payload.deviceId = null;
    }
    if (payload.vehicleAttributes !== undefined || payload.attributes?.vehicleAttributes !== undefined) {
      const normalizedVehicleAttributes = normalizeVehicleAttributesList(
        payload.vehicleAttributes ?? payload.attributes?.vehicleAttributes,
      );
      const baseAttributes =
        payload.attributes && typeof payload.attributes === "object" ? payload.attributes : {};
      payload.attributes = { ...baseAttributes, vehicleAttributes: normalizedVehicleAttributes };
      delete payload.vehicleAttributes;
    }

    const updated = deps.updateVehicle(id, payload);

    if (payload.deviceId) {
      linkDeviceToVehicle(clientId, updated.id, payload.deviceId);
    } else if (payload.deviceId === null) {
      detachVehicle(clientId, updated.id);
    }

    const devices = deps.listDevices({ clientId });
    const traccarDevices = deps.getCachedTraccarResources("devices");
    const traccarById = new Map(traccarDevices.map((item) => [String(item.id), item]));
    const clientMap = new Map();
    const client = deps.getClientById(clientId);
    if (client) {
      clientMap.set(String(clientId), client);
    }
    const response = buildVehicleResponse(deps.getVehicleById(updated.id), {
      deviceMap: new Map(devices.map((item) => [item.id, item])),
      traccarById,
      clientMap,
    });

    recordAuditEvent({
      clientId,
      vehicleId: updated.id,
      category: "vehicle",
      action: "ATUALIZAÇÃO DE VEÍCULO",
      status: "Sucesso",
      sentAt: auditSentAt,
      respondedAt: new Date().toISOString(),
      user: resolveAuditUser(req),
      ipAddress: resolveRequestIp(req),
      details: { plate: updated.plate || vehicle?.plate || null },
    });
    res.json({ vehicle: response });
  } catch (error) {
    next(error);
  }
  },
);

router.delete(
  "/vehicles/:id",
  authorizePermission({ menuKey: "fleet", pageKey: "vehicles", requireFull: true }),
  deps.requireRole("manager", "admin"),
  (req, res, next) => {
  try {
    const auditSentAt = new Date().toISOString();
    const { id } = req.params;
    const vehicle = deps.getVehicleById(id);
    if (!vehicle) {
      throw createError(404, "Veículo não encontrado");
    }
    const clientId = deps.resolveClientId(req, req.body?.clientId, { required: true });
    ensureSameClient(vehicle, clientId, "Veículo não encontrado");
    if (vehicle.deviceId) {
      detachVehicle(clientId, id);
    }
    deps.deleteVehicle(id);
    recordAuditEvent({
      clientId,
      vehicleId: id,
      category: "vehicle",
      action: "EXCLUSÃO DE VEÍCULO",
      status: "Sucesso",
      sentAt: auditSentAt,
      respondedAt: new Date().toISOString(),
      user: resolveAuditUser(req),
      ipAddress: resolveRequestIp(req),
      details: { plate: vehicle.plate || null },
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
  },
);

router.get(
  "/stock",
  authorizePermission({ menuKey: "primary", pageKey: "devices", subKey: "devices-stock" }),
  (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.query?.clientId, { required: false });
    const items = deps.listStockItems({ clientId });
    res.json({ items });
  } catch (error) {
    next(error);
  }
  },
);

router.post(
  "/stock",
  authorizePermission({ menuKey: "primary", pageKey: "devices", subKey: "devices-stock", requireFull: true }),
  deps.requireRole("manager", "admin"),
  resolveClientMiddleware,
  (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.body?.clientId, { required: true });
    const { type, name, quantity, notes, status } = req.body || {};
    const item = deps.createStockItem({ clientId, type, name, quantity, notes, status });
    res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
  },
);

router.put(
  "/stock/:id",
  authorizePermission({ menuKey: "primary", pageKey: "devices", subKey: "devices-stock", requireFull: true }),
  deps.requireRole("manager", "admin"),
  resolveClientMiddleware,
  (req, res, next) => {
  try {
    const { id } = req.params;
    const item = deps.getStockItemById(id);
    if (!item) {
      throw createError(404, "Item não encontrado");
    }
    const clientId = deps.resolveClientId(req, req.body?.clientId, { required: true });
    ensureSameClient(item, clientId, "Item não encontrado");
    const { type, name, quantity, notes, status } = req.body || {};
    const updated = deps.updateStockItem(id, { type, name, quantity, notes, status });
    res.json({ item: updated });
  } catch (error) {
    next(error);
  }
  },
);

router.delete(
  "/stock/:id",
  authorizePermission({ menuKey: "primary", pageKey: "devices", subKey: "devices-stock", requireFull: true }),
  deps.requireRole("manager", "admin"),
  resolveClientMiddleware,
  (req, res, next) => {
  try {
    const { id } = req.params;
    const item = deps.getStockItemById(id);
    if (!item) {
      throw createError(404, "Item não encontrado");
    }
    const clientId = deps.resolveClientId(req, req.query?.clientId, { required: true });
    ensureSameClient(item, clientId, "Item não encontrado");
    deps.deleteStockItem(id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
  },
);

export function __setCoreRouteMocks(overrides = {}) {
  Object.assign(deps, overrides);
  if (overrides.fetchLatestPositions && !overrides.fetchLatestPositionsWithFallback) {
    deps.fetchLatestPositionsWithFallback = overrides.fetchLatestPositions;
  }
}

export function __resetCoreRouteMocks() {
  Object.assign(deps, defaultDeps);
  telemetryCache.clear();
  eventsCache.clear();
  telemetryWarnLog.clear();
  registryCacheKeys.forEach((key) => registryCache.delete(key));
  registryCacheKeys.clear();
}

export default router;
