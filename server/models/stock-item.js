import createError from "http-errors";
import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "stock-items";
const items = new Map();

function clone(record) {
  return record ? { ...record } : null;
}

function persist(record, { skipSync = false } = {}) {
  items.set(record.id, record);
  if (!skipSync) {
    saveCollection(STORAGE_KEY, Array.from(items.values()));
  }
  return clone(record);
}

function remove(id) {
  items.delete(id);
  saveCollection(STORAGE_KEY, Array.from(items.values()));
}

const persisted = loadCollection(STORAGE_KEY, []);
persisted.forEach((record) => {
  if (!record?.id) return;
  persist(record, { skipSync: true });
});

export function listStockItems({ clientId } = {}) {
  const list = Array.from(items.values());
  if (!clientId) return list.map(clone);
  return list.filter((item) => String(item.clientId) === String(clientId)).map(clone);
}

export function getStockItemById(id) {
  return clone(items.get(String(id)));
}

export function createStockItem({ clientId, type, name, quantity = 0, notes = "", status = "em-estoque" }) {
  if (!clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  if (!type && !name) {
    throw createError(400, "Tipo ou nome são obrigatórios");
  }
  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    clientId: String(clientId),
    type: type ? String(type).trim() : null,
    name: name ? String(name).trim() : null,
    quantity: Number.isFinite(quantity) ? Number(quantity) : 0,
    notes: notes ? String(notes).trim() : "",
    status: status ? String(status) : "em-estoque",
    createdAt: now,
    updatedAt: now,
  };
  return persist(record);
}

export function updateStockItem(id, updates = {}) {
  const record = items.get(String(id));
  if (!record) {
    throw createError(404, "Item não encontrado");
  }
  if (Object.prototype.hasOwnProperty.call(updates, "type")) {
    record.type = updates.type ? String(updates.type).trim() : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "name")) {
    record.name = updates.name ? String(updates.name).trim() : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "quantity")) {
    record.quantity = Number.isFinite(Number(updates.quantity)) ? Number(updates.quantity) : record.quantity;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "notes")) {
    record.notes = updates.notes ? String(updates.notes).trim() : "";
  }
  if (Object.prototype.hasOwnProperty.call(updates, "status")) {
    record.status = updates.status ? String(updates.status) : record.status;
  }
  record.updatedAt = new Date().toISOString();
  return persist(record);
}

export function deleteStockItem(id) {
  const record = items.get(String(id));
  if (!record) {
    throw createError(404, "Item não encontrado");
  }
  remove(String(id));
  return clone(record);
}

export default {
  listStockItems,
  getStockItemById,
  createStockItem,
  updateStockItem,
  deleteStockItem,
};
