import createError from "http-errors";
import { randomUUID } from "crypto";

import prisma, { isPrismaAvailable } from "../services/prisma.js";
import { withTimeout } from "../utils/async-timeout.js";
import { getFallbackClient, isFallbackEnabled } from "../services/fallback-data.js";
import { loadCollection, saveCollection } from "../services/storage.js";
import { isAdminGeneralClient, normalizeAdminClientName } from "../utils/admin-general.js";

const STORAGE_KEY = "clients";
const PRISMA_TIMEOUT_MS = Number(process.env.PRISMA_TIMEOUT_MS) || 4000;
const clients = new Map();

function syncStorage() {
  saveCollection(STORAGE_KEY, Array.from(clients.values()));
}

function persist(record, { skipSync = false } = {}) {
  clients.set(String(record.id), record);
  if (!skipSync) {
    syncStorage();
  }
  return clone(record);
}

const persistedClients = loadCollection(STORAGE_KEY, []);
persistedClients.forEach((record) => {
  if (!record?.id) return;
  persist({ ...record }, { skipSync: true });
});

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clone(record) {
  if (!record) return null;
  return { ...record, name: normalizeAdminClientName(record.name) };
}

export async function listClients() {
  if (isPrismaAvailable()) {
    try {
      const clients = await withTimeout(
        prisma.client.findMany({ orderBy: { createdAt: "desc" } }),
        PRISMA_TIMEOUT_MS,
        { label: "prisma.client.findMany" },
      );
      return clients.map(clone);
    } catch (error) {
      console.warn("[clients] falha ao listar no banco, usando storage", error?.message || error);
    }
  }
  const list = Array.from(clients.values()).map(clone);
  if (list.length) return list;
  if (isFallbackEnabled()) {
    return [getFallbackClient()];
  }
  return [];
}

export async function getClientById(id) {
  if (isPrismaAvailable()) {
    try {
      const record = await withTimeout(
        prisma.client.findUnique({ where: { id: String(id) } }),
        PRISMA_TIMEOUT_MS,
        { label: "prisma.client.findUnique" },
      );
      return clone(record);
    } catch (error) {
      console.warn("[clients] falha ao buscar no banco, usando storage", error?.message || error);
    }
  }
  const record = clients.get(String(id));
  if (record) return clone(record);
  if (isFallbackEnabled()) {
    const fallback = getFallbackClient();
    return String(id) === String(fallback.id) ? fallback : null;
  }
  return null;
}

export async function getAdminGeneralClient() {
  const clients = await listClients();
  return clients.find((client) => isAdminGeneralClient(client)) || null;
}

export async function createClient({
  name,
  deviceLimit = 100,
  userLimit = 50,
  attributes = {},
}) {
  if (!name) {
    throw createError(400, "Nome é obrigatório");
  }
  const id = randomUUID();
  if (isPrismaAvailable()) {
    try {
      const record = await prisma.client.create({
        data: {
          id,
          name,
          deviceLimit: toNumber(deviceLimit, 0),
          userLimit: toNumber(userLimit, 0),
          attributes,
        },
      });
      return clone(record);
    } catch (error) {
      console.warn("[clients] falha ao criar no banco, usando storage", error?.message || error);
    }
  }
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
  return persist(record);
}

export async function updateClient(id, updates = {}) {
  if (isPrismaAvailable()) {
    try {
      const record = await prisma.client.findUnique({ where: { id: String(id) } });
      if (!record) {
        throw createError(404, "Cliente não encontrado");
      }
      const payload = {};
      if (updates.name) {
        payload.name = updates.name;
      }
      if (Object.prototype.hasOwnProperty.call(updates, "deviceLimit")) {
        payload.deviceLimit = toNumber(updates.deviceLimit, record.deviceLimit);
      }
      if (Object.prototype.hasOwnProperty.call(updates, "userLimit")) {
        payload.userLimit = toNumber(updates.userLimit, record.userLimit);
      }
      if (updates.attributes) {
        payload.attributes = updates.attributes;
      }
      const nextRecord = await prisma.client.update({
        where: { id: String(id) },
        data: { ...payload, updatedAt: new Date() },
      });
      return clone(nextRecord);
    } catch (error) {
      console.warn("[clients] falha ao atualizar no banco, usando storage", error?.message || error);
    }
  }
  const record = clients.get(String(id));
  if (!record) {
    throw createError(404, "Cliente não encontrado");
  }
  const next = { ...record };
  if (updates.name) {
    next.name = updates.name;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "deviceLimit")) {
    next.deviceLimit = toNumber(updates.deviceLimit, record.deviceLimit);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "userLimit")) {
    next.userLimit = toNumber(updates.userLimit, record.userLimit);
  }
  if (updates.attributes) {
    next.attributes = updates.attributes;
  }
  next.updatedAt = new Date().toISOString();
  return persist(next);
}

export async function deleteClient(id) {
  if (isPrismaAvailable()) {
    try {
      const record = await prisma.client.delete({ where: { id: String(id) } }).catch(() => null);
      if (!record) {
        throw createError(404, "Cliente não encontrado");
      }
      return clone(record);
    } catch (error) {
      console.warn("[clients] falha ao remover no banco, usando storage", error?.message || error);
    }
  }
  const record = clients.get(String(id));
  if (!record) {
    throw createError(404, "Cliente não encontrado");
  }
  clients.delete(String(id));
  syncStorage();
  return clone(record);
}

export default {
  listClients,
  getClientById,
  getAdminGeneralClient,
  createClient,
  updateClient,
  deleteClient,
};
