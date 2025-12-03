import createError from "http-errors";
import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../services/storage.js";
import prisma from "../services/prisma.js";

const STORAGE_KEY = "devices";
const devices = new Map();
const byUniqueId = new Map();
const byTraccarId = new Map();

function syncStorage() {
  saveCollection(STORAGE_KEY, Array.from(devices.values()));
}

function clone(record) {
  if (!record) return null;
  return { ...record };
}

function persist(record, { skipSync = false } = {}) {
  devices.set(record.id, record);
  if (record.uniqueId) {
    byUniqueId.set(String(record.uniqueId).toLowerCase(), record);
  }
  if (record.traccarId) {
    byTraccarId.set(String(record.traccarId), record);
  }
  if (!skipSync) {
    syncStorage();
  }
  return clone(record);
}

function removeIndexes(record) {
  if (!record) return;
  if (record.uniqueId) {
    byUniqueId.delete(String(record.uniqueId).toLowerCase());
  }
  if (record.traccarId) {
    byTraccarId.delete(String(record.traccarId));
  }
}

const persistedDevices = loadCollection(STORAGE_KEY, []);
persistedDevices.forEach((record) => {
  if (!record?.id) return;
  persist({ ...record }, { skipSync: true });
});

export function listDevices({ clientId } = {}) {
  const list = Array.from(devices.values());
  if (!clientId) {
    return list.map(clone);
  }
  return list.filter((device) => String(device.clientId) === String(clientId)).map(clone);
}

export function getDeviceById(id) {
  const record = devices.get(String(id));
  return clone(record);
}

export function findDeviceByUniqueId(uniqueId) {
  if (!uniqueId) return null;
  const record = byUniqueId.get(String(uniqueId).toLowerCase());
  return clone(record);
}

export function findDeviceByTraccarId(traccarId) {
  if (traccarId === null || traccarId === undefined) return null;
  const record = byTraccarId.get(String(traccarId));
  return clone(record);
}

export function createDevice({ clientId, name, uniqueId, modelId = null, traccarId = null, attributes = {} }) {
  if (!clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  if (!uniqueId) {
    throw createError(400, "uniqueId é obrigatório");
  }
  const normalizedUniqueId = String(uniqueId).trim();
  if (!normalizedUniqueId) {
    throw createError(400, "uniqueId é obrigatório");
  }

  const existing = byUniqueId.get(normalizedUniqueId.toLowerCase());
  if (existing) {
    throw createError(409, "Já existe um equipamento com este identificador");
  }

  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    clientId: String(clientId),
    name: name ? String(name).trim() : null,
    uniqueId: normalizedUniqueId,
    modelId: modelId ? String(modelId) : null,
    traccarId: traccarId ? String(traccarId) : null,
    chipId: null,
    vehicleId: null,
    attributes: { ...attributes },
    createdAt: now,
    updatedAt: now,
  };

  return persist(record);
}

export function updateDevice(id, updates = {}) {
  const record = devices.get(String(id));
  if (!record) {
    throw createError(404, "Equipamento não encontrado");
  }

  if (Object.prototype.hasOwnProperty.call(updates, "name")) {
    record.name = updates.name ? String(updates.name).trim() : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "modelId")) {
    record.modelId = updates.modelId ? String(updates.modelId) : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "clientId")) {
    record.clientId = updates.clientId ? String(updates.clientId) : record.clientId;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "traccarId")) {
    if (record.traccarId && record.traccarId !== updates.traccarId) {
      byTraccarId.delete(String(record.traccarId));
    }
    record.traccarId = updates.traccarId ? String(updates.traccarId) : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "chipId")) {
    record.chipId = updates.chipId ? String(updates.chipId) : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "vehicleId")) {
    record.vehicleId = updates.vehicleId ? String(updates.vehicleId) : null;
  }
  if (updates.attributes && typeof updates.attributes === "object") {
    record.attributes = { ...record.attributes, ...updates.attributes };
  }
  record.updatedAt = new Date().toISOString();
  return persist(record);
}

export function deleteDevice(id) {
  const record = devices.get(String(id));
  if (!record) {
    throw createError(404, "Equipamento não encontrado");
  }
  devices.delete(String(id));
  removeIndexes(record);
  syncStorage();
  return clone(record);
}

export function clearDeviceChip(deviceId) {
  const record = devices.get(String(deviceId));
  if (!record) {
    throw createError(404, "Equipamento não encontrado");
  }
  record.chipId = null;
  record.updatedAt = new Date().toISOString();
  return persist(record);
}

export function clearDeviceVehicle(deviceId) {
  const record = devices.get(String(deviceId));
  if (!record) {
    throw createError(404, "Equipamento não encontrado");
  }
  record.vehicleId = null;
  record.updatedAt = new Date().toISOString();
  return persist(record);
}

export async function findDeviceByTraccarIdInDb(traccarId, { clientId } = {}) {
  if (traccarId === null || traccarId === undefined) return null;
  return prisma.device.findFirst({
    where: {
      traccarId: String(traccarId),
      ...(clientId ? { clientId: String(clientId) } : {}),
    },
  });
}

export async function listDevicesFromDb({ clientId } = {}) {
  return prisma.device.findMany({
    where: clientId ? { clientId: String(clientId) } : undefined,
    orderBy: { createdAt: "desc" },
  });
}

export default {
  listDevices,
  getDeviceById,
  findDeviceByUniqueId,
  findDeviceByTraccarId,
  createDevice,
  updateDevice,
  deleteDevice,
  clearDeviceChip,
  clearDeviceVehicle,
  findDeviceByTraccarIdInDb,
  listDevicesFromDb,
};
