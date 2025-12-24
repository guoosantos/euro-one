import createError from "http-errors";
import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../services/storage.js";
import prisma, { isPrismaAvailable } from "../services/prisma.js";

const STORAGE_KEY = "vehicles";
const vehicles = new Map();
const byPlate = new Map();

function isPrismaReady() {
  return isPrismaAvailable();
}

function syncStorage() {
  saveCollection(STORAGE_KEY, Array.from(vehicles.values()));
}

function clone(record) {
  if (!record) return null;
  return { ...record };
}

function persist(record, { skipSync = false } = {}) {
  vehicles.set(record.id, record);
  if (record.plate) {
    byPlate.set(`${record.clientId}:${record.plate.toLowerCase()}`, record);
  }
  if (!skipSync) {
    syncStorage();
  }
  return clone(record);
}

async function syncVehicleToPrisma(record) {
  if (!isPrismaReady() || !record?.id || !record?.clientId) return;
  try {
    const payload = {
      clientId: String(record.clientId),
      name: record.name || null,
      plate: record.plate,
      driver: record.driver || null,
      group: record.group || null,
      type: record.type || null,
      status: record.status || null,
      notes: record.notes || null,
      updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date(),
    };

    await prisma.vehicle.upsert({
      where: { id: record.id },
      create: {
        id: record.id,
        ...payload,
        createdAt: record.createdAt ? new Date(record.createdAt) : new Date(),
      },
      update: payload,
    });
  } catch (error) {
    console.warn("[vehicles] falha ao sincronizar com o banco", error?.message || error);
  }
}

async function deleteVehicleFromPrisma(id) {
  if (!isPrismaReady() || !id) return;
  try {
    await prisma.vehicle.delete({ where: { id: String(id) } });
  } catch (error) {
    if (error?.code !== "P2025") {
      console.warn("[vehicles] falha ao remover veículo no banco", error?.message || error);
    }
  }
}

function remove(record) {
  vehicles.delete(record.id);
  if (record.plate) {
    byPlate.delete(`${record.clientId}:${record.plate.toLowerCase()}`);
  }
  syncStorage();
}

const persistedVehicles = loadCollection(STORAGE_KEY, []);
persistedVehicles.forEach((record) => {
  if (!record?.id) return;
  persist({ ...record }, { skipSync: true });
  void syncVehicleToPrisma(record);
});

async function hydrateVehiclesFromPrisma() {
  if (!isPrismaReady()) return;
  try {
    const vehiclesFromDb = await prisma.vehicle.findMany({ include: { devices: true } });
    if (vehiclesFromDb.length) {
      vehicles.clear();
      byPlate.clear();
      vehiclesFromDb.forEach((record) => {
        const primaryDevice = Array.isArray(record.devices) && record.devices.length ? record.devices[0] : null;
        persist(
          {
            id: record.id,
            clientId: String(record.clientId),
            name: record.name || "",
            plate: record.plate,
            driver: record.driver || "",
            group: record.group || "",
            type: record.type || "",
            status: record.status || "",
            notes: record.notes || "",
            deviceId: primaryDevice?.id ? String(primaryDevice.id) : null,
            createdAt: record.createdAt ? new Date(record.createdAt).toISOString() : new Date().toISOString(),
            updatedAt: record.updatedAt ? new Date(record.updatedAt).toISOString() : new Date().toISOString(),
          },
          { skipSync: true },
        );
      });
      syncStorage();
      console.info("[vehicles] hidratados veículos do banco", { count: vehiclesFromDb.length });
      return;
    }

    if (vehicles.size) {
      await Promise.all(Array.from(vehicles.values()).map((item) => syncVehicleToPrisma(item)));
    }
  } catch (error) {
    console.warn("[vehicles] falha ao hidratar veículos do banco", error?.message || error);
  }
}

await hydrateVehiclesFromPrisma();

export function listVehicles({ clientId } = {}) {
  const list = Array.from(vehicles.values());
  if (clientId) {
    console.info("[vehicles] listagem por cliente", { clientId });
  }
  if (!clientId) {
    return list.map(clone);
  }
  return list.filter((vehicle) => String(vehicle.clientId) === String(clientId)).map(clone);
}

export function getVehicleById(id) {
  const record = vehicles.get(String(id));
  if (!record) {
    console.warn("[vehicles] lookup falhou para id", { id });
  }
  return clone(record);
}

export function createVehicle({
  clientId,
  name,
  plate,
  driver = "",
  group = "",
  type = "",
  status = "ativo",
  notes = "",
  deviceId = null,
}) {
  if (!clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  if (!plate) {
    throw createError(400, "Placa é obrigatória");
  }
  const normalizedPlate = String(plate).trim();
  if (!normalizedPlate) {
    throw createError(400, "Placa é obrigatória");
  }
  const plateKey = `${clientId}:${normalizedPlate.toLowerCase()}`;
  if (byPlate.has(plateKey)) {
    throw createError(409, "Já existe um veículo com esta placa");
  }

  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    clientId: String(clientId),
    name: name ? String(name).trim() : "",
    plate: normalizedPlate,
    driver: driver ? String(driver).trim() : "",
    group: group ? String(group).trim() : "",
    type: type ? String(type).trim() : "",
    status: status ? String(status).trim() : "ativo",
    notes: notes ? String(notes).trim() : "",
    deviceId: deviceId ? String(deviceId) : null,
    createdAt: now,
    updatedAt: now,
  };

  const stored = persist(record);
  void syncVehicleToPrisma(stored);
  return stored;
}

export function updateVehicle(id, updates = {}) {
  const record = vehicles.get(String(id));
  if (!record) {
    throw createError(404, "Veículo não encontrado");
  }

  if (Object.prototype.hasOwnProperty.call(updates, "name")) {
    record.name = updates.name ? String(updates.name).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "driver")) {
    record.driver = updates.driver ? String(updates.driver).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "group")) {
    record.group = updates.group ? String(updates.group).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "type")) {
    record.type = updates.type ? String(updates.type).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "status")) {
    record.status = updates.status ? String(updates.status).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "notes")) {
    record.notes = updates.notes ? String(updates.notes).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "plate")) {
    const normalizedPlate = updates.plate ? String(updates.plate).trim() : "";
    if (!normalizedPlate) {
      throw createError(400, "Placa é obrigatória");
    }
    if (normalizedPlate !== record.plate) {
      const plateKey = `${record.clientId}:${normalizedPlate.toLowerCase()}`;
      if (byPlate.has(plateKey)) {
        throw createError(409, "Já existe um veículo com esta placa");
      }
      if (record.plate) {
        byPlate.delete(`${record.clientId}:${record.plate.toLowerCase()}`);
      }
      record.plate = normalizedPlate;
      byPlate.set(plateKey, record);
    }
  }
  if (Object.prototype.hasOwnProperty.call(updates, "deviceId")) {
    record.deviceId = updates.deviceId ? String(updates.deviceId) : null;
  }
  record.updatedAt = new Date().toISOString();
  const stored = persist(record);
  void syncVehicleToPrisma(stored);
  return stored;
}

export function deleteVehicle(id) {
  const record = vehicles.get(String(id));
  if (!record) {
    throw createError(404, "Veículo não encontrado");
  }
  remove(record);
  void deleteVehicleFromPrisma(id);
  return clone(record);
}

export default {
  listVehicles,
  getVehicleById,
  createVehicle,
  updateVehicle,
  deleteVehicle,
};
