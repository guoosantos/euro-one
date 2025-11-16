import createError from "http-errors";
import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "clients";
const clients = new Map();

function syncStorage() {
  saveCollection(STORAGE_KEY, Array.from(clients.values()));
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function persistClient(record, { skipSync = false } = {}) {
  clients.set(record.id, record);
  if (!skipSync) {
    syncStorage();
  }
  return record;
}

const persistedClients = loadCollection(STORAGE_KEY, []);
persistedClients.forEach((record) => {
  if (record?.id) {
    persistClient({ ...record }, { skipSync: true });
  }
});

export function listClients() {
  return Array.from(clients.values()).map((client) => ({ ...client }));
}

export function getClientById(id) {
  const record = clients.get(String(id));
  return record ? { ...record } : null;
}

export function createClient({
  name,
  deviceLimit = 100,
  userLimit = 50,
  attributes = {},
}) {
  if (!name) {
    throw createError(400, "Nome é obrigatório");
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const record = {
    id,
    name,
    deviceLimit: toNumber(deviceLimit, 0),
    userLimit: toNumber(userLimit, 0),
    attributes,
    createdAt: now,
    updatedAt: now,
  };
  persistClient(record);
  return { ...record };
}

export function updateClient(id, updates = {}) {
  const record = clients.get(String(id));
  if (!record) {
    throw createError(404, "Cliente não encontrado");
  }
  if (updates.name) {
    record.name = updates.name;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "deviceLimit")) {
    record.deviceLimit = toNumber(updates.deviceLimit, record.deviceLimit);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "userLimit")) {
    record.userLimit = toNumber(updates.userLimit, record.userLimit);
  }
  if (updates.attributes) {
    record.attributes = { ...record.attributes, ...updates.attributes };
  }
  record.updatedAt = new Date().toISOString();
  persistClient(record);
  return { ...record };
}

export function deleteClient(id) {
  const record = clients.get(String(id));
  if (!record) {
    throw createError(404, "Cliente não encontrado");
  }
  clients.delete(String(id));
  syncStorage();
  return { ...record };
}
