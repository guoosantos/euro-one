import createError from "http-errors";

import { listDevices } from "../models/device.js";
import { listVehicles } from "../models/vehicle.js";
import { getClientById } from "../models/client.js";

export function resolveAllowedDeviceIds(req) {
  if (req.user?.role === "admin") return null;

  if (!req.user?.clientId) {
    throw createError(403, "Usuário não vinculado a um cliente");
  }
  const devices = listDevices({ clientId: req.user.clientId });
  const traccarIds = devices
    .map((d) => (d?.traccarId ? String(d.traccarId) : null))
    .filter(Boolean);

  if (!traccarIds.length) {
    throw createError(403, "Cliente não possui dispositivos sincronizados");
  }
  return traccarIds;
}

export function extractDeviceIds(source = {}) {
  const values = [];
  const pushValue = (entry) => {
    if (entry === undefined || entry === null) return;
    if (Array.isArray(entry)) {
      entry.forEach(pushValue);
      return;
    }
    const s = String(entry).trim();
    if (!s) return;
    if (s.includes(",")) {
      s.split(",").forEach((p) => pushValue(p));
      return;
    }
    values.push(s);
  };
  pushValue(source.deviceId);
  pushValue(source.deviceID);
  pushValue(source.device_id);
  pushValue(source.traccarDeviceId);
  pushValue(source.deviceIds);
  pushValue(source.device_ids);
  pushValue(source.devices);
  pushValue(source.id);
  return values;
}

export function assignDeviceScope(target, allowed, { preferArray = true } = {}) {
  const list = allowed.map((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : String(v);
  });
  if (preferArray) {
    target.deviceId = list;
    target.deviceIds = list; // compat
  } else {
    target.deviceId = list.join(",");
    target.deviceIds = list.join(",");
  }
}

export function enforceDeviceFilterInQuery(req, target = req.query) {
  const allowed = resolveAllowedDeviceIds(req);
  if (!allowed) return;

  const params = target || (req.query = {});
  const requested = extractDeviceIds(params);

  if (!requested.length) {
    assignDeviceScope(params, allowed, { preferArray: true });
    return;
  }
  const invalid = requested.some((v) => !allowed.includes(String(v)));
  if (invalid) {
    throw createError(403, "Dispositivo não autorizado para este cliente");
  }
}

export function enforceDeviceFilterInBody(req, target = req.body) {
  const allowed = resolveAllowedDeviceIds(req);
  if (!allowed) return;

  const body = target || (req.body = {});
  const requested = extractDeviceIds(body);

  if (!requested.length) {
    assignDeviceScope(body, allowed, { preferArray: true });
    return;
  }
  const invalid = requested.some((v) => !allowed.includes(String(v)));
  if (invalid) {
    throw createError(403, "Dispositivo não autorizado para este cliente");
  }
}

export function resolveClientGroupId(req) {
  if (req.user?.role === "admin") return null;
  const clientId = req.user?.clientId;
  if (!clientId) return null;
  const client = getClientById(clientId);
  return client?.attributes?.traccarGroupId ?? null;
}

export function normalizeReportEventScope(value) {
  if (value === undefined || value === null || value === "") return "all";
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "all" || normalized === "active") return normalized;
  throw createError(400, "reportEventScope inválido");
}

export function enforceClientGroupInQuery(req, target = req.query) {
  const groupId = resolveClientGroupId(req);
  if (!groupId) return;

  const params = target || (req.query = {});
  const hasGroup = params.groupId || params.group_id || params.groupIds;
  if (!hasGroup) {
    params.groupId = groupId;
  }
}

export function normalizeReportDeviceIds(params = {}) {
  const ids = extractDeviceIds(params);
  const vehiclesFromParams = [];
  const pushVehicleValue = (entry) => {
    if (entry === undefined || entry === null) return;
    if (Array.isArray(entry)) {
      entry.forEach(pushVehicleValue);
      return;
    }
    const value = String(entry).trim();
    if (!value) return;
    value.split(",").forEach((part) => {
      const token = String(part).trim();
      if (token) vehiclesFromParams.push(token);
    });
  };
  pushVehicleValue(params.vehicleId);
  pushVehicleValue(params.vehicleIds);
  pushVehicleValue(params.plate);
  pushVehicleValue(params.plates);

  if (!ids.length && !vehiclesFromParams.length) return params;

  const allNumeric = ids.every((v) => /^\d+$/.test(String(v)));
  if (allNumeric && !vehiclesFromParams.length) return params;

  const allDevices = listDevices() || [];
  const allVehicles = listVehicles() || [];

  const byInternalId = new Map();
  const byVehicleId = new Map();
  const byPlate = new Map();

  allDevices.forEach((d) => {
    if (d?.id) {
      byInternalId.set(String(d.id), d);
    }
    if (d?.vehicleId) {
      const key = String(d.vehicleId);
      const current = byVehicleId.get(key) || [];
      current.push(d);
      byVehicleId.set(key, current);
    }
  });

  allVehicles.forEach((v) => {
    if (v?.id) {
      const vehicleId = String(v.id);
      if (!byVehicleId.has(vehicleId)) {
        byVehicleId.set(vehicleId, []);
      }
    }
    if (v?.plate) {
      byPlate.set(String(v.plate).toLowerCase(), v);
    }
  });

  const traccarIds = new Set();
  ids.forEach((v) => {
    const s = String(v);
    if (/^\d+$/.test(s)) {
      traccarIds.add(s);
      return;
    }
    const dev = byInternalId.get(s);
    if (dev?.traccarId) {
      traccarIds.add(String(dev.traccarId));
    }
  });

  vehiclesFromParams.forEach((token) => {
    const normalized = String(token).trim();
    if (!normalized) return;

    const vehicle =
      byPlate.get(normalized.toLowerCase()) ||
      allVehicles.find((v) => String(v.id) === normalized) ||
      null;

    if (!vehicle) return;
    const attachedDevices = byVehicleId.get(String(vehicle.id)) || [];
    attachedDevices.forEach((device) => {
      if (device?.traccarId) {
        traccarIds.add(String(device.traccarId));
      } else if (device?.id) {
        traccarIds.add(String(device.id));
      }
    });
    if (vehicle.deviceId && byInternalId.has(String(vehicle.deviceId))) {
      const primary = byInternalId.get(String(vehicle.deviceId));
      if (primary?.traccarId) {
        traccarIds.add(String(primary.traccarId));
      } else if (primary?.id) {
        traccarIds.add(String(primary.id));
      }
    }
  });

  if (!traccarIds.size) {
    return params;
  }

  const next = { ...params };
  const list = Array.from(traccarIds);
  next.deviceId = list;
  next.deviceIds = list;
  return next;
}

export function ensureReportDateRange(params = {}, { windowMs = 24 * 60 * 60 * 1000 } = {}) {
  const now = new Date();
  const to = params.to ? new Date(params.to) : now;
  const from = params.from ? new Date(params.from) : new Date(to.getTime() - windowMs);
  return {
    ...params,
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

export function buildSearchParams(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => search.append(key, entry));
    } else {
      search.append(key, value);
    }
  });
  return search;
}

export function normaliseJsonList(payload, keys = ["data", "items", "events", "positions"]) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}
