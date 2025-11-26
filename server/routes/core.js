import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { resolveClientIdMiddleware } from "../middleware/resolve-client.js";
import { resolveClientId } from "../middleware/client.js";
import { getClientById, updateClient } from "../models/client.js";
import { listModels, createModel, getModelById } from "../models/model.js";
import {
  listDevices,
  createDevice,
  updateDevice,
  getDeviceById,
  findDeviceByUniqueId,
  findDeviceByTraccarId,
} from "../models/device.js";
import { listChips, createChip, updateChip, getChipById } from "../models/chip.js";
import { listVehicles, createVehicle, updateVehicle, getVehicleById, deleteVehicle } from "../models/vehicle.js";
import { buildTraccarUnavailableError, traccarProxy } from "../services/traccar.js";
import { getCachedTraccarResources } from "../services/traccar-sync.js";
import { enrichPositionsWithAddresses } from "../utils/address.js";
import { createTtlCache } from "../utils/ttl-cache.js";

const router = express.Router();

router.use(authenticate);

function normaliseList(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

const telemetryWarnLog = new Map();
const telemetryCache = createTtlCache(3_000);

function logTelemetryWarning(stage, error, context = {}) {
  const now = Date.now();
  const previous = telemetryWarnLog.get(stage);
  if (!previous || now - previous > 30_000) {
    telemetryWarnLog.set(stage, now);
    console.warn(`[telemetry] failed to load ${stage}`, {
      message: error?.message || error,
      status: error?.status || error?.statusCode,
      details: error?.details,
      ...context,
    });
  }
}

function sanitizePosition(rawPosition) {
  if (!rawPosition || typeof rawPosition !== "object") return null;
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
  const client = getClientById(clientId);
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
    const group = await traccarProxy("post", "/groups", { data: { name: desiredName }, asAdmin: true });
    updateClient(clientId, { attributes: { ...attrs, traccarGroupId: group.id } });
    return group.id;
  } catch (error) {
    if (error.status === 409) {
      const groups = await traccarProxy("get", "/groups", { params: { all: true }, asAdmin: true });
      const match = Array.isArray(groups)
        ? groups.find((item) => item?.name === desiredName)
        : Array.isArray(groups?.groups)
        ? groups.groups.find((item) => item?.name === desiredName)
        : null;
      if (match?.id) {
        updateClient(clientId, { attributes: { ...attrs, traccarGroupId: match.id } });
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
  const chip = getChipById(chipId);
  ensureSameClient(chip, clientId, "Chip não encontrado");
  const device = getDeviceById(deviceId);
  ensureSameClient(device, clientId, "Equipamento não encontrado");

  if (device.chipId && device.chipId !== chip.id) {
    const previousChip = getChipById(device.chipId);
    if (previousChip && String(previousChip.clientId) === String(clientId)) {
      updateChip(previousChip.id, {
        deviceId: null,
        status: previousChip.status === "Vinculado" ? "Disponível" : previousChip.status,
      });
    }
  }

  if (chip.deviceId && chip.deviceId !== device.id) {
    const previousDevice = getDeviceById(chip.deviceId);
    if (previousDevice && String(previousDevice.clientId) === String(clientId)) {
      updateDevice(previousDevice.id, { chipId: null });
    }
  }

  updateChip(chip.id, {
    deviceId: device.id,
    status: chip.status && chip.status.length ? chip.status : "Vinculado",
  });
  updateDevice(device.id, { chipId: chip.id });
}

function detachChip(clientId, chipId) {
  const chip = getChipById(chipId);
  ensureSameClient(chip, clientId, "Chip não encontrado");
  if (chip.deviceId) {
    const device = getDeviceById(chip.deviceId);
    if (device && String(device.clientId) === String(clientId)) {
      updateDevice(device.id, { chipId: null });
    }
  }
  updateChip(chip.id, {
    deviceId: null,
    status: chip.status === "Vinculado" ? "Disponível" : chip.status,
  });
}

function linkDeviceToVehicle(clientId, vehicleId, deviceId) {
  const vehicle = getVehicleById(vehicleId);
  ensureSameClient(vehicle, clientId, "Veículo não encontrado");
  const device = getDeviceById(deviceId);
  ensureSameClient(device, clientId, "Equipamento não encontrado");

  if (vehicle.deviceId && vehicle.deviceId !== device.id) {
    const previousDevice = getDeviceById(vehicle.deviceId);
    if (previousDevice && String(previousDevice.clientId) === String(clientId)) {
      updateDevice(previousDevice.id, { vehicleId: null });
    }
  }

  if (device.vehicleId && device.vehicleId !== vehicle.id) {
    const previousVehicle = getVehicleById(device.vehicleId);
    if (previousVehicle && String(previousVehicle.clientId) === String(clientId)) {
      updateVehicle(previousVehicle.id, { deviceId: null });
    }
  }

  updateVehicle(vehicle.id, { deviceId: device.id });
  updateDevice(device.id, { vehicleId: vehicle.id });
}

function detachVehicle(clientId, vehicleId) {
  const vehicle = getVehicleById(vehicleId);
  ensureSameClient(vehicle, clientId, "Veículo não encontrado");
  if (vehicle.deviceId) {
    const device = getDeviceById(vehicle.deviceId);
    if (device && String(device.clientId) === String(clientId)) {
      updateDevice(device.id, { vehicleId: null });
    }
  }
  updateVehicle(vehicle.id, { deviceId: null });
}

router.get("/models", (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query.clientId, { required: false });
    const models = listModels({ clientId, includeGlobal: true });
    res.json({ models });
  } catch (error) {
    next(error);
  }
});

router.post("/models", requireRole("manager", "admin"), (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId, { required: req.user.role !== "admin" });
    const payload = {
      name: req.body?.name,
      brand: req.body?.brand,
      protocol: req.body?.protocol,
      connectivity: req.body?.connectivity,
      ports: Array.isArray(req.body?.ports) ? req.body.ports : [],
      clientId: clientId ?? null,
    };
    const model = createModel(payload);
    res.status(201).json({ model });
  } catch (error) {
    next(error);
  }
});

router.get("/devices/import", requireRole("manager", "admin"), resolveClientIdMiddleware, (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query?.clientId, { required: req.user.role !== "admin" });
    const knownDevices = listDevices({});
    const knownUniqueIds = new Set(
      knownDevices
        .map((device) => (device?.uniqueId ? String(device.uniqueId).toLowerCase() : null))
        .filter(Boolean),
    );
    const traccarDevices = getCachedTraccarResources("devices");
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

router.post("/devices/import", requireRole("manager", "admin"), resolveClientIdMiddleware, async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    const { traccarId, uniqueId, modelId, name } = req.body || {};
    if (!traccarId && !uniqueId) {
      throw createError(400, "Informe traccarId ou uniqueId");
    }

    if (uniqueId && findDeviceByUniqueId(uniqueId)) {
      throw createError(409, "Já existe um equipamento com este identificador");
    }

    if (traccarId && findDeviceByTraccarId(traccarId)) {
      throw createError(409, "Este dispositivo já foi importado");
    }

    if (modelId) {
      const model = getModelById(modelId);
      if (!model || (model.clientId && String(model.clientId) !== String(clientId))) {
        throw createError(404, "Modelo informado não pertence a este cliente");
      }
    }

    const cachedDevices = getCachedTraccarResources("devices");
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
        traccarDevice = await traccarProxy("get", `/devices/${traccarId}`, { asAdmin: true });
      } catch (_error) {
        // ignora para tentar por uniqueId abaixo
      }
    }

    if (!traccarDevice && uniqueId) {
      const response = await traccarProxy("get", "/devices", { params: { uniqueId }, asAdmin: true });
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
      traccarDevice = await traccarProxy("put", `/devices/${traccarDevice.id}`, {
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

    const device = createDevice({
      clientId,
      name: name || traccarDevice.name || traccarDevice.uniqueId,
      uniqueId: traccarDevice.uniqueId,
      modelId: modelId ? String(modelId) : null,
      traccarId: traccarDevice?.id ? String(traccarDevice.id) : null,
      attributes: { importedFrom: "traccar" },
    });

    const models = listModels({ clientId, includeGlobal: true });
    const chips = listChips({ clientId });
    const vehicles = listVehicles({ clientId });
    const traccarById = new Map([[String(traccarDevice.id), traccarDevice]]);
    const traccarByUnique = new Map([[String(traccarDevice.uniqueId), traccarDevice]]);
    const response = buildDeviceResponse(device, {
      modelMap: new Map(models.map((item) => [item.id, item])),
      chipMap: new Map(chips.map((item) => [item.id, item])),
      vehicleMap: new Map(vehicles.map((item) => [item.id, item])),
      traccarById,
      traccarByUnique,
    });

    res.status(201).json({ device: response });
  } catch (error) {
    next(error);
  }
});

router.get("/telemetry", resolveClientIdMiddleware, async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query?.clientId, { required: false });

    const cacheKey = clientId ? `telemetry:${clientId}` : "telemetry:all";
    const cached = telemetryCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const devices = listDevices({ clientId });
    const models = listModels({ clientId, includeGlobal: true });
    const chips = listChips({ clientId });
    const vehicles = listVehicles({ clientId });

    const modelMap = new Map(models.map((item) => [item.id, item]));
    const chipMap = new Map(chips.map((item) => [item.id, item]));
    const vehicleMap = new Map(vehicles.map((item) => [item.id, item]));

    const traccarDevicesRaw = await traccarProxy("get", "/devices", { params: { all: true }, asAdmin: true });
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

    let positions = [];
    if (positionIds.size > 0) {
      try {
        const positionResponse = await traccarProxy("get", "/positions", {
          params: { id: Array.from(positionIds) },
          asAdmin: true,
        });
        positions = await enrichPositionsWithAddresses(normaliseList(positionResponse, ["positions", "data"]));
      } catch (positionError) {
        logTelemetryWarning("positions", positionError, { ids: Array.from(positionIds) });
        throw buildTraccarUnavailableError(positionError, {
          stage: "positions",
          url: "/positions",
          params: { id: Array.from(positionIds) },
        });
      }
    }

    const positionById = new Map();
    positions.forEach((pos) => {
      if (pos?.id !== undefined && pos?.id !== null) {
        positionById.set(String(pos.id), pos);
      }
    });

    const deviceIds = devices
      .map((device) => device?.traccarId)
      .filter((value) => value !== null && value !== undefined)
      .map((value) => String(value));

    let events = [];
    if (deviceIds.length) {
      const now = new Date();
      const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      try {
        const eventsResponse = await traccarProxy("get", "/events", {
          params: { deviceId: deviceIds, from: from.toISOString(), to: now.toISOString() },
          asAdmin: true,
        });
        events = normaliseList(eventsResponse, ["events", "data"]);
      } catch (eventError) {
        logTelemetryWarning("events", eventError, { deviceIds, from: from.toISOString(), to: now.toISOString() });
        throw buildTraccarUnavailableError(eventError, {
          stage: "events",
          url: "/events",
          params: { deviceId: deviceIds, from: from.toISOString(), to: now.toISOString() },
        });
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

    const response = devices.map((device) => {
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

    const missingPositionDeviceIds = response
      .filter((item) => !item.position && item.traccarId)
      .map((item) => String(item.traccarId));

    if (missingPositionDeviceIds.length) {
      const now = new Date();
      const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      try {
        const fallbackPositionsResponse = await traccarProxy("get", "/positions", {
          params: { deviceId: missingPositionDeviceIds, from: from.toISOString(), to: now.toISOString() },
          asAdmin: true,
        });
        const fallbackPositions = await enrichPositionsWithAddresses(
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

    const payload = { telemetry: response };
    telemetryCache.set(cacheKey, payload, 3_000);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.get("/devices", (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const devices = listDevices({ clientId });
    const models = listModels({ clientId, includeGlobal: true });
    const chips = listChips({ clientId });
    const vehicles = listVehicles({ clientId });

    const modelMap = new Map(models.map((item) => [item.id, item]));
    const chipMap = new Map(chips.map((item) => [item.id, item]));
    const vehicleMap = new Map(vehicles.map((item) => [item.id, item]));

    const traccarDevices = getCachedTraccarResources("devices");
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
    res.json({ devices: response });
  } catch (error) {
    next(error);
  }
});

router.post("/devices", requireRole("manager", "admin"), resolveClientIdMiddleware, async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    const { name, uniqueId, modelId } = req.body || {};
    const iconType = req.body?.iconType || req.body?.attributes?.iconType || null;
    if (!uniqueId) {
      throw createError(400, "uniqueId é obrigatório");
    }

    if (modelId) {
      const model = getModelById(modelId);
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
    const traccarDevice = await traccarProxy("post", "/devices", { data: traccarPayload, asAdmin: true });

    const device = createDevice({
      clientId,
      name,
      uniqueId,
      modelId: modelId ? String(modelId) : null,
      traccarId: traccarDevice?.id ? String(traccarDevice.id) : null,
      attributes,
    });

    const models = listModels({ clientId, includeGlobal: true });
    const chips = listChips({ clientId });
    const vehicles = listVehicles({ clientId });
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

    res.status(201).json({ device: response });
  } catch (error) {
    next(error);
  }
});

router.put("/devices/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const device = getDeviceById(id);
    if (!device) {
      throw createError(404, "Equipamento não encontrado");
    }
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    ensureSameClient(device, clientId, "Equipamento não encontrado");

    const payload = { ...req.body };
    const iconType = payload.iconType || payload.attributes?.iconType || null;
    if (iconType) {
      payload.attributes = { ...(payload.attributes || {}), iconType };
    }
    if (payload.modelId) {
      const model = getModelById(payload.modelId);
      if (!model || (model.clientId && String(model.clientId) !== String(clientId))) {
        throw createError(404, "Modelo informado não pertence a este cliente");
      }
    }

    const updated = updateDevice(id, payload);

    const models = listModels({ clientId, includeGlobal: true });
    const chips = listChips({ clientId });
    const vehicles = listVehicles({ clientId });
    const traccarDevices = getCachedTraccarResources("devices");
    const traccarById = new Map(traccarDevices.map((item) => [String(item.id), item]));
    const traccarByUnique = new Map(traccarDevices.map((item) => [String(item.uniqueId), item]));

    const response = buildDeviceResponse(updated, {
      modelMap: new Map(models.map((item) => [item.id, item])),
      chipMap: new Map(chips.map((item) => [item.id, item])),
      vehicleMap: new Map(vehicles.map((item) => [item.id, item])),
      traccarById,
      traccarByUnique,
    });

    res.json({ device: response });
  } catch (error) {
    next(error);
  }
});

router.get("/chips", (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const chips = listChips({ clientId });
    const devices = listDevices({ clientId });
    const vehicles = listVehicles({ clientId });
    const deviceMap = new Map(devices.map((item) => [item.id, item]));
    const vehicleMap = new Map(vehicles.map((item) => [item.id, item]));

    const response = chips.map((chip) => buildChipResponse(chip, { deviceMap, vehicleMap }));
    res.json({ chips: response });
  } catch (error) {
    next(error);
  }
});

router.post("/chips", requireRole("manager", "admin"), resolveClientIdMiddleware, (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    const { iccid, phone, carrier, status, apn, apnUser, apnPass, notes, provider, deviceId } = req.body || {};
    const chip = createChip({
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

    const devices = listDevices({ clientId });
    const vehicles = listVehicles({ clientId });
    const storedChip = getChipById(chip.id);
    const response = buildChipResponse(storedChip, {
      deviceMap: new Map(devices.map((item) => [item.id, item])),
      vehicleMap: new Map(vehicles.map((item) => [item.id, item])),
    });
    res.status(201).json({ chip: response });
  } catch (error) {
    next(error);
  }
});

router.put("/chips/:id", requireRole("manager", "admin"), resolveClientIdMiddleware, (req, res, next) => {
  try {
    const { id } = req.params;
    const chip = getChipById(id);
    if (!chip) {
      throw createError(404, "Chip não encontrado");
    }
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    ensureSameClient(chip, clientId, "Chip não encontrado");

    const payload = { ...req.body };
    if (payload.deviceId === "") {
      payload.deviceId = null;
    }

    const updated = updateChip(id, payload);

    if (payload.deviceId) {
      linkChipToDevice(clientId, updated.id, payload.deviceId);
    } else if (payload.deviceId === null) {
      detachChip(clientId, updated.id);
    }

    const devices = listDevices({ clientId });
    const vehicles = listVehicles({ clientId });
    const response = buildChipResponse(getChipById(updated.id), {
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
    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const vehicles = listVehicles({ clientId });
    const devices = listDevices({ clientId });
    const traccarDevices = getCachedTraccarResources("devices");
    const traccarById = new Map(traccarDevices.map((item) => [String(item.id), item]));
    const deviceMap = new Map(devices.map((item) => [item.id, item]));

    const response = vehicles.map((vehicle) => buildVehicleResponse(vehicle, { deviceMap, traccarById }));
    res.json({ vehicles: response });
  } catch (error) {
    next(error);
  }
});

router.post("/vehicles", requireRole("manager", "admin"), resolveClientIdMiddleware, (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    const { name, plate, driver, group, type, status, notes, deviceId } = req.body || {};
    const vehicle = createVehicle({
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

    const devices = listDevices({ clientId });
    const traccarDevices = getCachedTraccarResources("devices");
    const traccarById = new Map(traccarDevices.map((item) => [String(item.id), item]));
    const response = buildVehicleResponse(getVehicleById(vehicle.id), {
      deviceMap: new Map(devices.map((item) => [item.id, item])),
      traccarById,
    });
    res.status(201).json({ vehicle: response });
  } catch (error) {
    next(error);
  }
});

router.put("/vehicles/:id", requireRole("manager", "admin"), resolveClientIdMiddleware, (req, res, next) => {
  try {
    const { id } = req.params;
    const vehicle = getVehicleById(id);
    if (!vehicle) {
      throw createError(404, "Veículo não encontrado");
    }
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    ensureSameClient(vehicle, clientId, "Veículo não encontrado");

    const payload = { ...req.body };
    if (payload.deviceId === "") {
      payload.deviceId = null;
    }

    const updated = updateVehicle(id, payload);

    if (payload.deviceId) {
      linkDeviceToVehicle(clientId, updated.id, payload.deviceId);
    } else if (payload.deviceId === null) {
      detachVehicle(clientId, updated.id);
    }

    const devices = listDevices({ clientId });
    const traccarDevices = getCachedTraccarResources("devices");
    const traccarById = new Map(traccarDevices.map((item) => [String(item.id), item]));
    const response = buildVehicleResponse(getVehicleById(updated.id), {
      deviceMap: new Map(devices.map((item) => [item.id, item])),
      traccarById,
    });

    res.json({ vehicle: response });
  } catch (error) {
    next(error);
  }
});

router.delete("/vehicles/:id", requireRole("manager", "admin"), (req, res, next) => {
  try {
    const { id } = req.params;
    const vehicle = getVehicleById(id);
    if (!vehicle) {
      throw createError(404, "Veículo não encontrado");
    }
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    ensureSameClient(vehicle, clientId, "Veículo não encontrado");
    if (vehicle.deviceId) {
      detachVehicle(clientId, id);
    }
    deleteVehicle(id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
