import createError from "http-errors";
import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "itineraries";
const itineraries = new Map();

function clone(record) {
  if (!record) return null;
  return JSON.parse(JSON.stringify(record));
}

function persist(record) {
  itineraries.set(record.id, record);
  syncStorage();
  return clone(record);
}

function syncStorage() {
  saveCollection(STORAGE_KEY, Array.from(itineraries.values()));
}

function ensureName(name) {
  const normalized = String(name || "").trim();
  if (!normalized) {
    throw createError(400, "Nome do itinerário é obrigatório");
  }
  return normalized;
}

function normalizeItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const type = String(item.type || "").toLowerCase();
      if (type !== "geofence" && type !== "route" && type !== "target") return null;
      if (!item.id) return null;
      const xdmGeozoneId =
        Object.prototype.hasOwnProperty.call(item, "xdmGeozoneId") && item.xdmGeozoneId !== undefined
          ? item.xdmGeozoneId ?? null
          : null;
      return { type, id: String(item.id), xdmGeozoneId };
    })
    .filter(Boolean);
}

function mergeItemMappings(currentItems = [], nextItems = []) {
  if (!Array.isArray(nextItems) || !nextItems.length) return [];
  const byKey = new Map(
    (currentItems || []).map((item) => [`${item.type}:${item.id}`, item?.xdmGeozoneId ?? null]),
  );
  return nextItems.map((item) => {
    if (item.xdmGeozoneId != null) return item;
    const mapped = byKey.get(`${item.type}:${item.id}`);
    if (mapped == null) return item;
    return { ...item, xdmGeozoneId: mapped };
  });
}

const persisted = loadCollection(STORAGE_KEY, []);
persisted.forEach((item) => {
  if (!item?.id) return;
  itineraries.set(item.id, item);
});

export function listItineraries({ clientId } = {}) {
  const list = Array.from(itineraries.values());
  if (!clientId) return list.map(clone);
  return list.filter((itinerary) => String(itinerary.clientId) === String(clientId)).map(clone);
}

export function getItineraryById(id) {
  return clone(itineraries.get(String(id)));
}

export function createItinerary({ clientId, name, description = "", items = [] }) {
  if (!clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  const record = {
    id: randomUUID(),
    clientId: String(clientId),
    name: ensureName(name),
    description: description || "",
    items: normalizeItems(items),
    xdmGeozoneGroupId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return persist(record);
}

export function updateItinerary(id, updates = {}) {
  const existing = itineraries.get(String(id));
  if (!existing) {
    throw createError(404, "Itinerário não encontrado");
  }

  const updated = {
    ...existing,
    name: updates.name ? ensureName(updates.name) : existing.name,
    description:
      Object.prototype.hasOwnProperty.call(updates, "description") && updates.description !== undefined
        ? updates.description || ""
        : existing.description,
    items: updates.items ? mergeItemMappings(existing.items, normalizeItems(updates.items)) : existing.items,
    xdmGeozoneGroupId:
      Object.prototype.hasOwnProperty.call(updates, "xdmGeozoneGroupId") && updates.xdmGeozoneGroupId !== undefined
        ? updates.xdmGeozoneGroupId
        : existing.xdmGeozoneGroupId ?? null,
    updatedAt: new Date().toISOString(),
  };

  return persist(updated);
}

export function deleteItinerary(id) {
  const existing = itineraries.get(String(id));
  if (!existing) return null;
  itineraries.delete(String(id));
  syncStorage();
  return clone(existing);
}

export default {
  listItineraries,
  getItineraryById,
  createItinerary,
  updateItinerary,
  deleteItinerary,
};
