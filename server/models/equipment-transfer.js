import createError from "http-errors";
import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "equipment-transfers";
const transfers = new Map();

function clone(record) {
  return record ? { ...record } : null;
}

function persist(record, { skipSync = false } = {}) {
  transfers.set(record.id, record);
  if (!skipSync) {
    saveCollection(STORAGE_KEY, Array.from(transfers.values()));
  }
  return clone(record);
}

const persisted = loadCollection(STORAGE_KEY, []);
persisted.forEach((record) => {
  if (!record?.id) return;
  persist(record, { skipSync: true });
});

export function listEquipmentTransfers({ requestId, technicianId, clientId } = {}) {
  let list = Array.from(transfers.values());
  if (requestId) {
    list = list.filter((item) => String(item.requestId) === String(requestId));
  }
  if (technicianId) {
    list = list.filter((item) => String(item.technicianId) === String(technicianId));
  }
  if (clientId) {
    list = list.filter((item) => String(item.clientId) === String(clientId));
  }
  return list.map(clone);
}

export function createEquipmentTransfer(payload = {}) {
  const {
    requestId,
    clientId,
    origin = "cliente",
    equipmentId = null,
    equipmentName = null,
    quantity = 1,
    technicianId,
    technicianName = null,
    createdBy = null,
  } = payload;

  if (!requestId) {
    throw createError(400, "requestId é obrigatório");
  }
  if (!clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  if (!technicianId) {
    throw createError(400, "technicianId é obrigatório");
  }
  if (!equipmentId && !equipmentName) {
    throw createError(400, "Equipamento é obrigatório");
  }
  const normalizedOrigin = String(origin).toLowerCase();
  if (!["euro", "cliente"].includes(normalizedOrigin)) {
    throw createError(400, "Origem inválida");
  }
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw createError(400, "Quantidade inválida");
  }

  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    requestId: String(requestId),
    clientId: String(clientId),
    origin: normalizedOrigin,
    equipmentId: equipmentId ? String(equipmentId) : null,
    equipmentName: equipmentName ? String(equipmentName) : null,
    quantity: qty,
    technicianId: String(technicianId),
    technicianName: technicianName ? String(technicianName) : null,
    createdBy: createdBy ? String(createdBy) : null,
    createdAt: now,
  };

  return persist(record);
}

export function listTechnicianInventory({ technicianId, clientId } = {}) {
  if (!technicianId) {
    throw createError(400, "technicianId é obrigatório");
  }
  const list = listEquipmentTransfers({ technicianId, clientId });
  const inventoryMap = new Map();

  list.forEach((item) => {
    const key = [
      item.origin || "cliente",
      item.equipmentId || "",
      item.equipmentName || "",
    ].join("|");
    const current = inventoryMap.get(key) || {
      origin: item.origin || "cliente",
      equipmentId: item.equipmentId || null,
      equipmentName: item.equipmentName || null,
      quantity: 0,
    };
    current.quantity += Number(item.quantity) || 0;
    inventoryMap.set(key, current);
  });

  return Array.from(inventoryMap.values())
    .filter((item) => item.quantity > 0)
    .sort((a, b) => (a.origin || "").localeCompare(b.origin || "") || (a.equipmentName || "").localeCompare(b.equipmentName || ""));
}

export default {
  listEquipmentTransfers,
  createEquipmentTransfer,
  listTechnicianInventory,
};
