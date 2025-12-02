import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import * as clientMiddleware from "../middleware/client.js";
import resolveClientIdMiddleware from "../middleware/resolve-client.js";
import * as clientModel from "../models/client.js";
import * as modelModel from "../models/model.js";
import * as deviceModel from "../models/device.js";
import * as chipModel from "../models/chip.js";
import * as vehicleModel from "../models/vehicle.js";
import * as traccarService from "../services/traccar.js";
import * as traccarDbService from "../services/traccar-db.js";
import * as traccarSyncService from "../services/traccar-sync.js";
import { ensureTraccarRegistryConsistency } from "../services/traccar-coherence.js";
import * as addressUtils from "../utils/address.js";
import { createTtlCache } from "../utils/ttl-cache.js";

const router = express.Router();

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
  findDeviceByTraccarId: deviceModel.findDeviceByTraccarId,
  listChips: chipModel.listChips,
  createChip: chipModel.createChip,
  updateChip: chipModel.updateChip,
  getChipById: chipModel.getChipById,
  listVehicles: vehicleModel.listVehicles,
  createVehicle: vehicleModel.createVehicle,
  updateVehicle: vehicleModel.updateVehicle,
  getVehicleById: vehicleModel.getVehicleById,
  deleteVehicle: vehicleModel.deleteVehicle,
  traccarProxy: traccarService.traccarProxy,
  buildTraccarUnavailableError: traccarService.buildTraccarUnavailableError,
  fetchLatestPositions: traccarDbService.fetchLatestPositions,
  isTraccarDbConfigured: traccarDbService.isTraccarDbConfigured,
  ensureTraccarRegistryConsistency,
  getCachedTraccarResources: traccarSyncService.getCachedTraccarResources,
  enrichPositionsWithAddresses: addressUtils.enrichPositionsWithAddresses,
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
    return { address: {}, formattedAddress: null, shortAddress: null };
  }
  const address = rawPosition.address;
  const normalizedAddress =
    address && typeof address === "object" && !Array.isArray(address)
      ? address
      : address
      ? { formatted: String(address) }
      : {};

  return {
    ...rawPosition,
    address: normalizedAddress,
    formattedAddress: rawPosition.formattedAddress || normalizedAddress.formatted || null,
    shortAddress: rawPosition.shortAddress || normalizedAddress.short || null,
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

  const model = device.modelId ? modelMap.get(device.modelId) : null;
  const chip = device.chipId ? chipMap.get(device.chipId) : null;
  const vehicle = device.vehicleId ? vehicleMap.get(device.vehicleId) : null;
  const attributes = { ...(traccarDevice?.attributes || {}), ...(device.attributes || {}) };
  const iconType = attributes.iconType || null;

  return {
    id: device.id,
    internalId: device.id,
    deviceId: device.traccarId ? String(device.traccarId) : null,
    traccarId: device.traccarId ? String(device.traccarId) : null,
    uniqueId: device.uniqueId,
    name: device.name,
    clientId: device.clientId,
    modelId: device.modelId,
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
        }
      : null,
    usageStatus,
    usageStatusLabel,
    connectionStatus,
    connectionStatusLabel,
    statusLabel,
    lastCommunication,
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

function buildVehicleResponse(vehicle, context) {
  const { deviceMap, traccarById } = context;
  const device = vehicle.deviceId ? deviceMap.get(vehicle.deviceId) : null;
  const traccarDevice = device?.traccarId ? traccarById.get(String(device.traccarId)) : null;
  const { connectionStatus, connectionStatusLabel, lastCommunication } = resolveConnection(traccarDevice);
  return {
    ...vehicle,
    device: device
      ? {
          id: device.id,
          uniqueId: device.uniqueId,
          name: device.name,
          traccarId: device.traccarId ? String(device.traccarId) : null,
        }
      : null,
    connectionStatus,
    connectionStatusLabel,
    lastCommunication,
  };
}

function ensureSameClient(resource, clientId, message) {
  if (!resource || String(resource.clientId) !== String(clientId)) {
    throw createError(404, message);
  }
}

function linkChipToDevice(clientId, chipId, deviceId) {
  const chip = deps.getChipById(chipId);
  ensureSameClient(chip, clientId, "Chip não encontrado");
  const device = deps.getDeviceById(deviceId);
  ensureSameClient(device, clientId, "Equipamento não encontrado");

  if (device.chipId && device.chipId !== chip.id) {
    const previousChip = deps.getChipById(device.chipId);
    if (previousChip && String(previousChip.clientId) === String(clientId)) {
      deps.updateChip(previousChip.id, {
        deviceId: null,
        status: previousChip.status === "Vinculado" ? "Disponível" : previousChip.status,
      });
    }
  }

  if (chip.deviceId && chip.deviceId !== device.id) {
    const previousDevice = deps.getDeviceById(chip.deviceId);
    if (previousDevice && String(previousDevice.clientId) === String(clientId)) {
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
  ensureSameClient(chip, clientId, "Chip não encontrado");
  if (chip.deviceId) {
    const device = deps.getDeviceById(chip.deviceId);
    if (device && String(device.clientId) === String(clientId)) {
      deps.updateDevice(device.id, { chipId: null });
    }
  }
  deps.updateChip(chip.id, {
    deviceId: null,
    status: chip.status === "Vinculado" ? "Disponível" : chip.status,
  });
}

function linkDeviceToVehicle(clientId, vehicleId, deviceId) {
  const vehicle = deps.getVehicleById(vehicleId);
  ensureSameClient(vehicle, clientId, "Veículo não encontrado");
  const device = deps.getDeviceById(deviceId);
  ensureSameClient(device, clientId, "Equipamento não encontrado");

  if (vehicle.deviceId && vehicle.deviceId !== device.id) {
    const previousDevice = deps.getDeviceById(vehicle.deviceId);
    if (previousDevice && String(previousDevice.clientId) === String(clientId)) {
      deps.updateDevice(previousDevice.id, { vehicleId: null });
    }
  }

  if (device.vehicleId && device.vehicleId !== vehicle.id) {
    const previousVehicle = deps.getVehicleById(device.vehicleId);
    if (previousVehicle && String(previousVehicle.clientId) === String(clientId)) {
      deps.updateVehicle(previousVehicle.id, { deviceId: null });
    }
  }

  deps.updateVehicle(vehicle.id, { deviceId: device.id });
  deps.updateDevice(device.id, { vehicleId: vehicle.id });
}

function detachVehicle(clientId, vehicleId) {
  const vehicle = deps.getVehicleById(vehicleId);
  ensureSameClient(vehicle, clientId, "Veículo não encontrado");
  if (vehicle.deviceId) {
    const device = deps.getDeviceById(vehicle.deviceId);
    if (device && String(device.clientId) === String(clientId)) {
      deps.updateDevice(device.id, { vehicleId: null });
    }
  }
  deps.updateVehicle(vehicle.id, { deviceId: null });
}

router.get("/models", (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.query.clientId, { required: false });
    const models = deps.listModels({ clientId, includeGlobal: true });
    res.json({ models });
  } catch (error) {
    next(error);
  }
});

router.post("/models", deps.requireRole("manager", "admin"), (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.body?.clientId, { required: req.user.role !== "admin" });
    const payload = {
      name: req.body?.name,
      brand: req.body?.brand,
      protocol: req.body?.protocol,
      connectivity: req.body?.connectivity,
      ports: Array.isArray(req.body?.ports) ? req.body.ports : [],
      clientId: clientId ?? null,
    };
    const model = deps.createModel(payload);
    res.status(201).json({ model });
  } catch (error) {
    next(error);
  }
});

router.get("/devices/import", deps.requireRole("manager", "admin"), resolveClientMiddleware, (req, res, next) => {
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
});

router.post("/devices/import", deps.requireRole("manager", "admin"), resolveClientMiddleware, async (req, res, next) => {
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

    const groupId = await ensureClientTraccarGroup(clientId);
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

router.get("/telemetry", resolveClientMiddleware, async (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.query?.clientId, { required: false });

    await deps.ensureTraccarRegistryConsistency();

    const cacheKey = clientId ? `telemetry:${clientId}` : "telemetry:all";
    const cached = telemetryCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const devices = deps.listDevices({ clientId });
    const models = deps.listModels({ clientId, includeGlobal: true });
    const chips = deps.listChips({ clientId });
    const vehicles = deps.listVehicles({ clientId });

    const modelMap = new Map(models.map((item) => [item.id, item]));
    const chipMap = new Map(chips.map((item) => [item.id, item]));
    const vehicleMap = new Map(vehicles.map((item) => [item.id, item]));

    const traccarDevicesRaw = await deps.traccarProxy("get", "/devices", { params: { all: true }, asAdmin: true });
    const traccarDevices = normaliseList(traccarDevicesRaw, ["devices", "data"]);
    const traccarById = new Map();
    const traccarByUnique = new Map();
    const positionIds = new Set();

    traccarDevices.forEach((item) => {
      if (!item) return;
      if (item.id !== undefined && item.id !== null) {
        traccarById.set(String(item.id), item);
      }
      if (item.uniqueId) {
        traccarByUnique.set(String(item.uniqueId), item);
      }
      if (item.positionId !== undefined && item.positionId !== null) {
        positionIds.add(String(item.positionId));
      }
    });

    const validPositionIds = filterValidPositionIds(Array.from(positionIds));
    if (validPositionIds.length === 0) {
      const payload = { telemetry: [] };
      telemetryCache.set(cacheKey, payload, 3_000);
      return res.json(payload);
    }

    let positions = [];
    if (validPositionIds.length > 0) {
      try {
        const positionResponse = await deps.traccarProxy("get", "/positions", {
          params: { id: validPositionIds },
          asAdmin: true,
        });
        positions = await deps.enrichPositionsWithAddresses(normaliseList(positionResponse, ["positions", "data"]));
      } catch (positionError) {
        logTelemetryWarning("positions", positionError, { ids: validPositionIds });
        throw deps.buildTraccarUnavailableError(positionError, {
          stage: "positions",
          url: "/positions",
          params: { id: validPositionIds },
        });
      }
    }

    const positionById = new Map();
    positions.forEach((pos) => {
      if (pos?.id !== undefined && pos?.id !== null) {
        positionById.set(String(pos.id), pos);
      }
    });

    const deviceIds = filterValidPositionIds(
      devices
        .map((device) => device?.traccarId)
        .filter((value) => value !== null && value !== undefined)
        .map((value) => String(value)),
    );

    const warnings = [];
    let events = [];
    if (deviceIds.length) {
      const eventsCacheKey = `telemetry-events:${deviceIds.sort().join(",")}`;
      const cachedEvents = eventsCache.get(eventsCacheKey);
      if (cachedEvents) {
        events = cachedEvents;
      }
    }

    if (deviceIds.length && events.length === 0) {
      const now = new Date();
      const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      try {
        const eventsResponse = await deps.traccarProxy("get", "/events", {
          params: { deviceId: deviceIds, from: from.toISOString(), to: now.toISOString() },
          asAdmin: true,
        });
        events = normaliseList(eventsResponse, ["events", "data"]);
        const eventsCacheKey = `telemetry-events:${deviceIds.sort().join(",")}`;
        eventsCache.set(eventsCacheKey, events, 15_000);
      } catch (eventError) {
        logTelemetryWarning("events", eventError, { deviceIds, from: from.toISOString(), to: now.toISOString() });
        warnings.push({ stage: "events", message: "Falha ao carregar eventos recentes" });
      }
    }

    const lastEventByDevice = new Map();
    events.forEach((event) => {
      if (!event || event.deviceId === undefined || event.deviceId === null) return;
      const deviceId = String(event.deviceId);
      const time = Date.parse(event.eventTime || event.serverTime || event.deviceTime || event.time || 0);
      const current = lastEventByDevice.get(deviceId);
      if (!current) {
        lastEventByDevice.set(deviceId, { event, time });
        return;
      }
      if (Number.isFinite(time) && (!Number.isFinite(current.time) || time > current.time)) {
        lastEventByDevice.set(deviceId, { event, time });
      }
    });

    let response = devices.map((device) => {
      const traccarDevice =
        (device.traccarId && traccarById.get(String(device.traccarId))) ||
        traccarByUnique.get(String(device.uniqueId));
      const position = traccarDevice?.positionId
        ? positionById.get(String(traccarDevice.positionId)) || null
        : null;
      const lastEvent = traccarDevice?.id ? lastEventByDevice.get(String(traccarDevice.id))?.event || null : null;

      return {
        ...buildDeviceResponse(device, { modelMap, chipMap, vehicleMap, traccarById, traccarByUnique }),
        position: sanitizePosition(position),
        lastEvent,
      };
    });

    let missingPositionDeviceIds = filterValidPositionIds(
      response
        .filter((item) => !item.position && item.traccarId)
        .map((item) => String(item.traccarId)),
    );

    if (missingPositionDeviceIds.length && deps.isTraccarDbConfigured()) {
      try {
        const dbPositions = await deps.fetchLatestPositions(missingPositionDeviceIds);
        const latestByDevice = new Map();

        dbPositions.forEach((pos) => {
          if (!pos?.deviceId) return;
          latestByDevice.set(String(pos.deviceId), sanitizePosition(pos));
        });

        response = response.map((item) => {
          if (item.position || !item.traccarId) return item;
          const fallback = latestByDevice.get(String(item.traccarId));
          if (!fallback) return item;
          return { ...item, position: fallback };
        });

        missingPositionDeviceIds = filterValidPositionIds(
          response
            .filter((item) => !item.position && item.traccarId)
            .map((item) => String(item.traccarId)),
        );
      } catch (dbFallbackError) {
        logTelemetryWarning("positions-db", dbFallbackError, { deviceIds: missingPositionDeviceIds });
      }
    }

    if (missingPositionDeviceIds.length) {
      const now = new Date();
      const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      try {
        const fallbackPositionsResponse = await deps.traccarProxy("get", "/positions", {
          params: { deviceId: missingPositionDeviceIds, from: from.toISOString(), to: now.toISOString() },
          asAdmin: true,
        });
        const fallbackPositions = await deps.enrichPositionsWithAddresses(
          normaliseList(fallbackPositionsResponse, ["positions", "data"]),
        );
        const latestByDevice = new Map();

        fallbackPositions.forEach((pos) => {
          if (pos?.deviceId === undefined || pos?.deviceId === null) return;
          const deviceId = String(pos.deviceId);
          const time = Date.parse(pos.fixTime || pos.serverTime || pos.deviceTime || pos.time || 0);
          const current = latestByDevice.get(deviceId);
          if (!current) {
            latestByDevice.set(deviceId, { pos: sanitizePosition(pos), time });
            return;
          }
          if (Number.isFinite(time) && (!Number.isFinite(current.time) || time > current.time)) {
            latestByDevice.set(deviceId, { pos, time });
          }
        });

        response.forEach((item, index) => {
          if (item.position || !item.traccarId) return;
          const fallback = latestByDevice.get(String(item.traccarId));
          if (fallback?.pos) {
            response[index] = { ...item, position: fallback.pos };
          }
        });
      } catch (fallbackError) {
        logTelemetryWarning("positions-fallback", fallbackError, { deviceIds: missingPositionDeviceIds });
      }
    }

    const payload = { telemetry: response, warnings };
    telemetryCache.set(cacheKey, payload, 3_000);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.get("/devices", async (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.query?.clientId, { required: false });
    await deps.ensureTraccarRegistryConsistency();
    const cacheKey = buildDeviceCacheKey(clientId);
    const cached = getCachedRegistry(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    const devices = deps.listDevices({ clientId });
    const models = deps.listModels({ clientId, includeGlobal: true });
    const chips = deps.listChips({ clientId });
    const vehicles = deps.listVehicles({ clientId });

    const modelMap = new Map(models.map((item) => [item.id, item]));
    const chipMap = new Map(chips.map((item) => [item.id, item]));
    const vehicleMap = new Map(vehicles.map((item) => [item.id, item]));

    const traccarDevices = deps.getCachedTraccarResources("devices");
    const traccarById = new Map();
    const traccarByUnique = new Map();
    traccarDevices.forEach((item) => {
      if (!item) return;
      if (item.id !== undefined && item.id !== null) {
        traccarById.set(String(item.id), item);
      }
      if (item.uniqueId) {
        traccarByUnique.set(String(item.uniqueId), item);
      }
    });

    const response = devices.map((device) =>
      buildDeviceResponse(device, { modelMap, chipMap, vehicleMap, traccarById, traccarByUnique }),
    );
    const payload = { devices: response };
    cacheRegistry(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.post("/devices", deps.requireRole("manager", "admin"), resolveClientMiddleware, async (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.body?.clientId, { required: true });
    const { name, uniqueId, modelId } = req.body || {};
    const iconType = req.body?.iconType || req.body?.attributes?.iconType || null;
    if (!uniqueId) {
      throw createError(400, "uniqueId é obrigatório");
    }

    if (modelId) {
      const model = deps.getModelById(modelId);
      if (!model || (model.clientId && String(model.clientId) !== String(clientId))) {
        throw createError(404, "Modelo informado não pertence a este cliente");
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

    const traccarPayload = {
      name: name || uniqueId,
      uniqueId,
      groupId,
      attributes,
    };
    const traccarDevice = await deps.traccarProxy("post", "/devices", { data: traccarPayload, asAdmin: true });

    const device = deps.createDevice({
      clientId,
      name,
      uniqueId,
      modelId: modelId ? String(modelId) : null,
      traccarId: traccarDevice?.id ? String(traccarDevice.id) : null,
      attributes,
    });

    const models = deps.listModels({ clientId, includeGlobal: true });
    const chips = deps.listChips({ clientId });
    const vehicles = deps.listVehicles({ clientId });
    const traccarById = new Map();
    if (traccarDevice?.id) {
      traccarById.set(String(traccarDevice.id), traccarDevice);
    }
    const response = buildDeviceResponse(device, {
      modelMap: new Map(models.map((item) => [item.id, item])),
      chipMap: new Map(chips.map((item) => [item.id, item])),
      vehicleMap: new Map(vehicles.map((item) => [item.id, item])),
      traccarById,
      traccarByUnique: new Map([[uniqueId, traccarDevice]]),
    });

    invalidateDeviceCache();
    res.status(201).json({ device: response });
  } catch (error) {
    next(error);
  }
});

router.put("/devices/:id", deps.requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const device = deps.getDeviceById(id);
    if (!device) {
      throw createError(404, "Equipamento não encontrado");
    }
    const clientId = deps.resolveClientId(req, req.body?.clientId, { required: true });
    ensureSameClient(device, clientId, "Equipamento não encontrado");

    const payload = { ...req.body };
    const iconType = payload.iconType || payload.attributes?.iconType || null;
    if (iconType) {
      payload.attributes = { ...(payload.attributes || {}), iconType };
    }
    if (payload.modelId) {
      const model = deps.getModelById(payload.modelId);
      if (!model || (model.clientId && String(model.clientId) !== String(clientId))) {
        throw createError(404, "Modelo informado não pertence a este cliente");
      }
    }

    const updated = deps.updateDevice(id, payload);

    const models = deps.listModels({ clientId, includeGlobal: true });
    const chips = deps.listChips({ clientId });
    const vehicles = deps.listVehicles({ clientId });
    const traccarDevices = deps.getCachedTraccarResources("devices");
    const traccarById = new Map(traccarDevices.map((item) => [String(item.id), item]));
    const traccarByUnique = new Map(traccarDevices.map((item) => [String(item.uniqueId), item]));

    const response = buildDeviceResponse(updated, {
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
});

router.get("/chips", (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.query?.clientId, { required: false });
    const chips = deps.listChips({ clientId });
    const devices = deps.listDevices({ clientId });
    const vehicles = deps.listVehicles({ clientId });
    const deviceMap = new Map(devices.map((item) => [item.id, item]));
    const vehicleMap = new Map(vehicles.map((item) => [item.id, item]));

    const response = chips.map((chip) => buildChipResponse(chip, { deviceMap, vehicleMap }));
    res.json({ chips: response });
  } catch (error) {
    next(error);
  }
});

router.post("/chips", deps.requireRole("manager", "admin"), resolveClientMiddleware, (req, res, next) => {
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
});

router.put("/chips/:id", deps.requireRole("manager", "admin"), resolveClientMiddleware, (req, res, next) => {
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
});

router.get("/vehicles", (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.query?.clientId, { required: false });
    const vehicles = deps.listVehicles({ clientId });
    const devices = deps.listDevices({ clientId });
    const traccarDevices = deps.getCachedTraccarResources("devices");
    const traccarById = new Map(traccarDevices.map((item) => [String(item.id), item]));
    const deviceMap = new Map(devices.map((item) => [item.id, item]));

    const response = vehicles.map((vehicle) => buildVehicleResponse(vehicle, { deviceMap, traccarById }));
    res.json({ vehicles: response });
  } catch (error) {
    next(error);
  }
});

router.post("/vehicles", deps.requireRole("manager", "admin"), resolveClientMiddleware, (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.body?.clientId, { required: true });
    const { name, plate, driver, group, type, status, notes, deviceId } = req.body || {};
    const vehicle = deps.createVehicle({
      clientId,
      name,
      plate,
      driver,
      group,
      type,
      status,
      notes,
    });

    if (deviceId) {
      linkDeviceToVehicle(clientId, vehicle.id, deviceId);
    }

    const devices = deps.listDevices({ clientId });
    const traccarDevices = deps.getCachedTraccarResources("devices");
    const traccarById = new Map(traccarDevices.map((item) => [String(item.id), item]));
    const response = buildVehicleResponse(deps.getVehicleById(vehicle.id), {
      deviceMap: new Map(devices.map((item) => [item.id, item])),
      traccarById,
    });
    res.status(201).json({ vehicle: response });
  } catch (error) {
    next(error);
  }
});

router.put("/vehicles/:id", deps.requireRole("manager", "admin"), resolveClientMiddleware, (req, res, next) => {
  try {
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

    const updated = deps.updateVehicle(id, payload);

    if (payload.deviceId) {
      linkDeviceToVehicle(clientId, updated.id, payload.deviceId);
    } else if (payload.deviceId === null) {
      detachVehicle(clientId, updated.id);
    }

    const devices = deps.listDevices({ clientId });
    const traccarDevices = deps.getCachedTraccarResources("devices");
    const traccarById = new Map(traccarDevices.map((item) => [String(item.id), item]));
    const response = buildVehicleResponse(deps.getVehicleById(updated.id), {
      deviceMap: new Map(devices.map((item) => [item.id, item])),
      traccarById,
    });

    res.json({ vehicle: response });
  } catch (error) {
    next(error);
  }
});

router.delete("/vehicles/:id", deps.requireRole("manager", "admin"), (req, res, next) => {
  try {
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
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export function __setCoreRouteMocks(overrides = {}) {
  Object.assign(deps, overrides);
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
