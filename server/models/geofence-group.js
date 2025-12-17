import createError from "http-errors";

import prisma from "../services/prisma.js";

function ensurePrisma() {
  if (!prisma) {
    throw createError(503, "Banco de dados indisponível");
  }
}

async function assertClientExists(clientId) {
  const client = await prisma.client.findUnique({ where: { id: String(clientId) } });
  if (!client) {
    throw createError(404, "Cliente associado não encontrado");
  }
}

function clone(record) {
  if (!record) return null;
  return { ...record, clientId: record.clientId ? String(record.clientId) : record.clientId };
}

export async function listGeofenceGroups({ clientId } = {}) {
  ensurePrisma();
  const where = clientId ? { clientId: String(clientId) } : {};
  const groups = await prisma.geofenceGroup.findMany({ where, orderBy: { createdAt: "desc" } });
  return groups.map(clone);
}

export async function getGeofenceGroupById(id) {
  ensurePrisma();
  const group = await prisma.geofenceGroup.findUnique({ where: { id: String(id) } });
  return clone(group);
}

export async function createGeofenceGroup({ clientId, name, description = null, color = null }) {
  ensurePrisma();
  if (!clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  if (!name) {
    throw createError(400, "Nome é obrigatório");
  }
  await assertClientExists(clientId);
  const group = await prisma.geofenceGroup.create({
    data: {
      clientId: String(clientId),
      name: String(name),
      description: description || null,
      color: color || null,
    },
  });
  return clone(group);
}

export async function updateGeofenceGroup(id, updates = {}) {
  ensurePrisma();
  const existing = await prisma.geofenceGroup.findUnique({ where: { id: String(id) } });
  if (!existing) {
    throw createError(404, "Grupo não encontrado");
  }

  const data = {};
  if (updates.name) {
    data.name = String(updates.name);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "description")) {
    data.description = updates.description || null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "color")) {
    data.color = updates.color || null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "clientId") && updates.clientId) {
    await assertClientExists(updates.clientId);
    data.clientId = String(updates.clientId);
  }

  const group = await prisma.geofenceGroup.update({
    where: { id: String(id) },
    data,
  });
  return clone(group);
}

export async function deleteGeofenceGroup(id) {
  ensurePrisma();
  const deleted = await prisma.geofenceGroup.delete({ where: { id: String(id) } }).catch(() => null);
  if (!deleted) {
    throw createError(404, "Grupo não encontrado");
  }
  return clone(deleted);
}

export default {
  listGeofenceGroups,
  getGeofenceGroupById,
  createGeofenceGroup,
  updateGeofenceGroup,
  deleteGeofenceGroup,
};
