import createError from "http-errors";
import { randomUUID } from "crypto";

import prisma, { isPrismaAvailable } from "../services/prisma.js";
import { getFallbackClient } from "../services/fallback-data.js";

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clone(record) {
  if (!record) return null;
  return { ...record };
}

export async function listClients() {
  if (!isPrismaAvailable()) {
    return [getFallbackClient()];
  }
  const clients = await prisma.client.findMany({ orderBy: { createdAt: "desc" } });
  return clients.map(clone);
}

export async function getClientById(id) {
  if (!isPrismaAvailable()) {
    const fallback = getFallbackClient();
    return String(id) === String(fallback.id) ? fallback : null;
  }
  const record = await prisma.client.findUnique({ where: { id: String(id) } });
  return clone(record);
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
}

export async function updateClient(id, updates = {}) {
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
}

export async function deleteClient(id) {
  const record = await prisma.client.delete({ where: { id: String(id) } }).catch(() => null);
  if (!record) {
    throw createError(404, "Cliente não encontrado");
  }
  return clone(record);
}

export default {
  listClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
};
