import createError from "http-errors";
import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "groups";
const groups = new Map();

function syncStorage() {
  saveCollection(STORAGE_KEY, Array.from(groups.values()));
}

function persistGroup(record, { skipSync = false } = {}) {
  groups.set(record.id, record);
  if (!skipSync) {
    syncStorage();
  }
  return record;
}

const persistedGroups = loadCollection(STORAGE_KEY, []);
persistedGroups.forEach((record) => {
  if (record?.id) {
    persistGroup({ ...record }, { skipSync: true });
  }
});

export function listGroups({ clientId } = {}) {
  const collection = Array.from(groups.values());
  if (typeof clientId === "undefined") {
    return collection.map((item) => ({ ...item }));
  }
  if (clientId === null) {
    return collection
      .filter((item) => item.clientId === null)
      .map((item) => ({ ...item }));
  }
  return collection
    .filter((item) => String(item.clientId) === String(clientId))
    .map((item) => ({ ...item }));
}

export function getGroupById(id) {
  const record = groups.get(String(id));
  return record ? { ...record } : null;
}

export function createGroup({ name, clientId, description = null, attributes = {} }) {
  if (!name) {
    throw createError(400, "Nome é obrigatório");
  }
  if (!clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const record = {
    id,
    name,
    description: description || null,
    clientId: String(clientId),
    attributes: { ...attributes },
    createdAt: now,
    updatedAt: now,
  };
  persistGroup(record);
  return { ...record };
}

export function updateGroup(id, updates = {}) {
  const record = groups.get(String(id));
  if (!record) {
    throw createError(404, "Grupo não encontrado");
  }
  if (Object.prototype.hasOwnProperty.call(updates, "clientId")) {
    if (!updates.clientId) {
      throw createError(400, "clientId é obrigatório");
    }
    record.clientId = String(updates.clientId);
  }
  if (updates.name) {
    record.name = updates.name;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "description")) {
    record.description = updates.description || null;
  }
  if (updates.attributes) {
    record.attributes = { ...record.attributes, ...updates.attributes };
  }
  record.updatedAt = new Date().toISOString();
  persistGroup(record);
  return { ...record };
}

export function deleteGroup(id) {
  const record = groups.get(String(id));
  if (!record) {
    throw createError(404, "Grupo não encontrado");
  }
  groups.delete(String(id));
  syncStorage();
  return { ...record };
}

export function deleteGroupsByClientId(clientId) {
  const ids = Array.from(groups.values())
    .filter((item) => String(item.clientId) === String(clientId))
    .map((item) => item.id);
  ids.forEach((groupId) => {
    groups.delete(groupId);
  });
  if (ids.length) {
    syncStorage();
  }
}
