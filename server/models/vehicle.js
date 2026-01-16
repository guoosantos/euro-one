import createError from "http-errors";
import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../services/storage.js";
import prisma, { isPrismaAvailable } from "../services/prisma.js";

const STORAGE_KEY = "vehicles";
const vehicles = new Map();
const byPlate = new Map();

function parseNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

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
      item: record.item || null,
      plate: record.plate,
      identifier: record.identifier || null,
      model: record.model || record.name || null,
      brand: record.brand || null,
      chassis: record.chassis || null,
      renavam: record.renavam || null,
      color: record.color || null,
      externalRef: record.externalRef || null,
      modelYear: Number.isFinite(record.modelYear) ? record.modelYear : null,
      manufactureYear: Number.isFinite(record.manufactureYear) ? record.manufactureYear : null,
      fipeCode: record.fipeCode || null,
      fipeValue: Number.isFinite(record.fipeValue) ? record.fipeValue : null,
      zeroKm: Boolean(record.zeroKm),
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

export function buildVehicleRecordFromPrisma(record) {
  if (!record) return null;
  const primaryDevice = Array.isArray(record.devices) && record.devices.length ? record.devices[0] : null;
  const existingDeviceImei = record.deviceImei ? String(record.deviceImei).trim() : null;
  const resolvedDeviceImei = existingDeviceImei || (primaryDevice?.uniqueId ? String(primaryDevice.uniqueId) : null);

  return {
    id: record.id,
    clientId: String(record.clientId),
    name: record.name || "",
    item: record.item || "",
    plate: record.plate,
    identifier: record.identifier || "",
    model: record.model || record.name || "",
    brand: record.brand || "",
    chassis: record.chassis || "",
    renavam: record.renavam || "",
    color: record.color || "",
    externalRef: record.externalRef || "",
    modelYear: Number.isFinite(record.modelYear) ? record.modelYear : null,
    manufactureYear: Number.isFinite(record.manufactureYear) ? record.manufactureYear : null,
    fipeCode: record.fipeCode || "",
    fipeValue: Number.isFinite(record.fipeValue) ? record.fipeValue : null,
    zeroKm: Boolean(record.zeroKm),
    driver: record.driver || "",
    group: record.group || "",
    type: record.type || "",
    status: record.status || "",
    notes: record.notes || "",
    deviceId: primaryDevice?.id ? String(primaryDevice.id) : null,
    deviceImei: resolvedDeviceImei,
    xdmDeviceUid: record.xdmDeviceUid ? String(record.xdmDeviceUid).trim() : null,
    createdAt: record.createdAt ? new Date(record.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: record.updatedAt ? new Date(record.updatedAt).toISOString() : new Date().toISOString(),
  };
}

async function hydrateVehiclesFromPrisma() {
  if (!isPrismaReady()) return;
  try {
    const vehiclesFromDb = await prisma.vehicle.findMany({ include: { devices: true } });
    if (vehiclesFromDb.length) {
      vehicles.clear();
      byPlate.clear();
      vehiclesFromDb.forEach((record) => {
        const hydrated = buildVehicleRecordFromPrisma(record);
        if (!hydrated) return;
        persist(hydrated, { skipSync: true });
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

let vehiclesHydrated = false;

export async function initVehicles() {
  if (vehiclesHydrated) return;
  const persistedVehicles = loadCollection(STORAGE_KEY, []);
  persistedVehicles.forEach((record) => {
    if (!record?.id) return;
    persist({ ...record }, { skipSync: true });
    void syncVehicleToPrisma(record);
  });
  await hydrateVehiclesFromPrisma();
  vehiclesHydrated = true;
}

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
  item,
  plate,
  identifier,
  model,
  brand,
  chassis,
  renavam,
  color,
  externalRef,
  modelYear,
  manufactureYear,
  fipeCode,
  fipeValue,
  zeroKm = false,
  driver = "",
  group = "",
  type = "",
  status = "ativo",
  notes = "",
  deviceId = null,
  deviceImei = null,
  xdmDeviceUid = null,
}) {
  if (!clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  if (!plate) {
    throw createError(400, "Placa é obrigatória");
  }
  if (!model && !name) {
    throw createError(400, "Modelo é obrigatório");
  }
  const normalizedType = type ? String(type).trim() : "";
  if (!normalizedType) {
    throw createError(400, "Tipo do veículo é obrigatório");
  }
  const normalizedPlate = String(plate).trim();
  if (!normalizedPlate) {
    throw createError(400, "Placa é obrigatória");
  }
  const normalizedModel = model ? String(model).trim() : name ? String(name).trim() : "";
  if (!normalizedModel) {
    throw createError(400, "Modelo é obrigatório");
  }
  const plateKey = `${clientId}:${normalizedPlate.toLowerCase()}`;
  if (byPlate.has(plateKey)) {
    throw createError(409, "Já existe um veículo com esta placa");
  }

  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    clientId: String(clientId),
    name: normalizedModel,
    item: item ? String(item).trim() : "",
    plate: normalizedPlate,
    identifier: identifier ? String(identifier).trim() : "",
    model: normalizedModel,
    brand: brand ? String(brand).trim() : "",
    chassis: chassis ? String(chassis).trim() : "",
    renavam: renavam ? String(renavam).trim() : "",
    color: color ? String(color).trim() : "",
    externalRef: externalRef ? String(externalRef).trim() : "",
    modelYear: parseNumber(modelYear),
    manufactureYear: parseNumber(manufactureYear),
    fipeCode: fipeCode ? String(fipeCode).trim() : "",
    fipeValue: parseNumber(fipeValue),
    zeroKm: Boolean(zeroKm),
    driver: driver ? String(driver).trim() : "",
    group: group ? String(group).trim() : "",
    type: normalizedType,
    status: status ? String(status).trim() : "ativo",
    notes: notes ? String(notes).trim() : "",
    deviceId: deviceId ? String(deviceId) : null,
    deviceImei: deviceImei ? String(deviceImei).trim() : null,
    xdmDeviceUid: xdmDeviceUid ? String(xdmDeviceUid).trim() : null,
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
    const nextName = updates.name ? String(updates.name).trim() : "";
    record.name = nextName;
    if (nextName && !record.model) {
      record.model = nextName;
    }
  }
  if (Object.prototype.hasOwnProperty.call(updates, "item")) {
    record.item = updates.item ? String(updates.item).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "driver")) {
    record.driver = updates.driver ? String(updates.driver).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "group")) {
    record.group = updates.group ? String(updates.group).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "type")) {
    const nextType = updates.type ? String(updates.type).trim() : "";
    if (!nextType) {
      throw createError(400, "Tipo do veículo é obrigatório");
    }
    record.type = nextType;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "identifier")) {
    record.identifier = updates.identifier ? String(updates.identifier).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "model")) {
    const nextModel = updates.model ? String(updates.model).trim() : "";
    if (!nextModel) {
      throw createError(400, "Modelo é obrigatório");
    }
    record.model = nextModel;
    if (nextModel) {
      record.name = nextModel;
    }
  }
  if (Object.prototype.hasOwnProperty.call(updates, "brand")) {
    record.brand = updates.brand ? String(updates.brand).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "chassis")) {
    record.chassis = updates.chassis ? String(updates.chassis).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "renavam")) {
    record.renavam = updates.renavam ? String(updates.renavam).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "color")) {
    record.color = updates.color ? String(updates.color).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "externalRef")) {
    record.externalRef = updates.externalRef ? String(updates.externalRef).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "modelYear")) {
    record.modelYear = parseNumber(updates.modelYear);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "manufactureYear")) {
    record.manufactureYear = parseNumber(updates.manufactureYear);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "fipeCode")) {
    record.fipeCode = updates.fipeCode ? String(updates.fipeCode).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "fipeValue")) {
    record.fipeValue = parseNumber(updates.fipeValue);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "zeroKm")) {
    record.zeroKm = Boolean(updates.zeroKm);
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
  if (Object.prototype.hasOwnProperty.call(updates, "deviceImei")) {
    record.deviceImei = updates.deviceImei ? String(updates.deviceImei).trim() : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "xdmDeviceUid")) {
    record.xdmDeviceUid = updates.xdmDeviceUid ? String(updates.xdmDeviceUid).trim() : null;
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
