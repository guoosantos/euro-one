import createError from "http-errors";
import { randomUUID } from "crypto";

const vehicles = new Map();
const byPlate = new Map();

function clone(record) {
  if (!record) return null;
  return { ...record };
}

function persist(record) {
  vehicles.set(record.id, record);
  if (record.plate) {
    byPlate.set(`${record.clientId}:${record.plate.toLowerCase()}`, record);
  }
  return clone(record);
}

function remove(record) {
  vehicles.delete(record.id);
  if (record.plate) {
    byPlate.delete(`${record.clientId}:${record.plate.toLowerCase()}`);
  }
}

export function listVehicles({ clientId } = {}) {
  const list = Array.from(vehicles.values());
  if (!clientId) {
    return list.map(clone);
  }
  return list.filter((vehicle) => String(vehicle.clientId) === String(clientId)).map(clone);
}

export function getVehicleById(id) {
  const record = vehicles.get(String(id));
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

  return persist(record);
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
  return persist(record);
}

export function deleteVehicle(id) {
  const record = vehicles.get(String(id));
  if (!record) {
    throw createError(404, "Veículo não encontrado");
  }
  remove(record);
  return clone(record);
}

export default {
  listVehicles,
  getVehicleById,
  createVehicle,
  updateVehicle,
  deleteVehicle,
};
