import createError from "http-errors";
import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../services/storage.js";
import prisma from "../services/prisma.js";

const STORAGE_KEY = "devices";
const devices = new Map();
const byUniqueId = new Map();
const byTraccarId = new Map();
const missingClients = new Set();
const duplicateUniqueWarnings = new Set();

function logOnce(target, key, message, payload) {
  if (target.has(key)) return;
  target.add(key);
  console.warn(message, payload);
}

function buildDeviceConflictError(existing, uniqueId) {
  const error = createError(409, "Equipamento já existe no Euro One");
  error.code = "DEVICE_ALREADY_EXISTS";
  error.details = existing?.id
    ? {
        deviceId: existing.id,
        uniqueId: existing.uniqueId || uniqueId,
        ...(existing.traccarId ? { traccarId: existing.traccarId } : {}),
      }
    : { uniqueId };
  return error;
}

function isPrismaReady() {
  return Boolean(prisma) && Boolean(process.env.DATABASE_URL);
}

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
  const stored = persist({ ...record }, { skipSync: true });
  // Garante que registros pré-existentes também sejam refletidos no banco quando disponível.
  if (stored?.id) {
    void syncDeviceToPrisma(stored);
  }
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

export async function findDeviceByUniqueIdInDb(uniqueId, { clientId, matchAnyClient = false } = {}) {
  if (!isPrismaReady() || !uniqueId) return null;
  try {
    return await prisma.device.findFirst({
      where: {
        uniqueId: { equals: String(uniqueId), mode: "insensitive" },
        ...(clientId && !matchAnyClient ? { clientId: String(clientId) } : {}),
      },
    });
  } catch (error) {
    console.warn("[devices] falha ao consultar dispositivo por uniqueId", error?.message || error);
    return null;
  }
}

async function syncDeviceToPrisma(record) {
  if (!isPrismaReady() || !record?.id || !record?.uniqueId) return;
  try {
    const clientId = String(record.clientId);
    const uniqueId = String(record.uniqueId);

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      logOnce(missingClients, clientId, "[devices] cliente não encontrado para sincronizar", {
        clientId,
        uniqueId,
      });
      return;
    }

    const existing = await prisma.device.findFirst({
      where: { uniqueId: { equals: uniqueId, mode: "insensitive" } },
    });

    if (existing && String(existing.clientId) !== clientId) {
      const warningKey = `${uniqueId}:${clientId}:${existing.clientId}`;
      logOnce(duplicateUniqueWarnings, warningKey, "[devices] uniqueId já associado a outro cliente, ignorando sync", {
        clientId,
        uniqueId,
        existingClientId: existing.clientId,
        existingId: existing.id,
      });
      return;
    }

    let modelId = record.modelId ? String(record.modelId) : null;
    if (modelId) {
      try {
        const model = await prisma.model.findUnique({ where: { id: modelId } });
        if (!model || (model.clientId && String(model.clientId) !== clientId)) {
          console.warn("[devices] modelo inexistente ou de outro cliente; removendo referência", {
            modelId,
            clientId,
            uniqueId,
          });
          modelId = null;
        }
      } catch (modelError) {
        console.warn("[devices] falha ao validar modelo antes do sync", modelError?.message || modelError);
        modelId = null;
      }
    }

    const payload = {
      clientId,
      name: record.name,
      uniqueId,
      modelId,
      traccarId: record.traccarId ? String(record.traccarId) : null,
      chipId: record.chipId ? String(record.chipId) : null,
      vehicleId: record.vehicleId ? String(record.vehicleId) : null,
      attributes: record.attributes || {},
    };

    if (existing) {
      await prisma.device.update({
        where: { id: existing.id },
        data: {
          ...payload,
          updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date(),
        },
      });
      return;
    }

    await prisma.device.upsert({
      where: { uniqueId },
      create: {
        id: record.id,
        ...payload,
        createdAt: record.createdAt ? new Date(record.createdAt) : new Date(),
        updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date(),
      },
      update: {
        ...payload,
        updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date(),
      },
    });
  } catch (error) {
    console.warn("[devices] falha ao sincronizar com o banco", error?.message || error);
  }
}

async function deleteDeviceFromPrisma(id) {
  if (!isPrismaReady() || !id) return;
  try {
    await prisma.device.delete({ where: { id: String(id) } });
  } catch (error) {
    // ignora registros inexistentes mas registra outros erros
    if (error?.code !== "P2025") {
      console.warn("[devices] falha ao remover no banco", error?.message || error);
    }
  }
}

async function hydrateDevicesFromPrisma() {
  if (!isPrismaReady()) return;
  try {
    const dbDevices = await prisma.device.findMany();
    dbDevices.forEach((record) => {
      if (!record?.id) return;
      persist(
        {
          ...record,
          id: String(record.id),
          clientId: String(record.clientId),
          uniqueId: record.uniqueId ? String(record.uniqueId) : null,
          modelId: record.modelId ? String(record.modelId) : null,
          traccarId: record.traccarId ? String(record.traccarId) : null,
          chipId: record.chipId ? String(record.chipId) : null,
          vehicleId: record.vehicleId ? String(record.vehicleId) : null,
          attributes: record.attributes || {},
          createdAt: record.createdAt ? new Date(record.createdAt).toISOString() : new Date().toISOString(),
          updatedAt: record.updatedAt ? new Date(record.updatedAt).toISOString() : new Date().toISOString(),
        },
        { skipSync: true },
      );
    });
    syncStorage();
  } catch (error) {
    console.warn("[devices] falha ao hidratar dispositivos do banco", error?.message || error);
  }
}

void hydrateDevicesFromPrisma();

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
    throw buildDeviceConflictError(existing, normalizedUniqueId);
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

  const stored = persist(record);
  void syncDeviceToPrisma(stored);
  return stored;
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
  const stored = persist(record);
  void syncDeviceToPrisma(stored);
  return stored;
}

export function deleteDevice(id) {
  const record = devices.get(String(id));
  if (!record) {
    throw createError(404, "Equipamento não encontrado");
  }
  devices.delete(String(id));
  removeIndexes(record);
  syncStorage();
  void deleteDeviceFromPrisma(id);
  return clone(record);
}

export function clearDeviceChip(deviceId) {
  const record = devices.get(String(deviceId));
  if (!record) {
    throw createError(404, "Equipamento não encontrado");
  }
  record.chipId = null;
  record.updatedAt = new Date().toISOString();
  const stored = persist(record);
  void syncDeviceToPrisma(stored);
  return stored;
}

export function clearDeviceVehicle(deviceId) {
  const record = devices.get(String(deviceId));
  if (!record) {
    throw createError(404, "Equipamento não encontrado");
  }
  record.vehicleId = null;
  record.updatedAt = new Date().toISOString();
  const stored = persist(record);
  void syncDeviceToPrisma(stored);
  return stored;
}

export async function findDeviceByTraccarIdInDb(traccarId, { clientId } = {}) {
  if (traccarId === null || traccarId === undefined) return null;
  try {
    return await prisma.device.findFirst({
      where: {
        traccarId: String(traccarId),
        ...(clientId ? { clientId: String(clientId) } : {}),
      },
    });
  } catch (error) {
    console.warn("[devices] falha ao consultar dispositivo por traccarId", error?.message || error);
    return null;
  }
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
  findDeviceByUniqueIdInDb,
  listDevicesFromDb,
};
