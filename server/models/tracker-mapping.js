import createError from "http-errors";

import prisma, { isPrismaAvailable } from "../services/prisma.js";

function ensurePrisma({ allowNull = false } = {}) {
  if (!isPrismaAvailable()) {
    if (allowNull) return false;
    throw createError(503, "Banco de dados indisponível para mapeamentos de rastreador");
  }
  if (!prisma || !prisma.telemetryFieldMapping || !prisma.eventMapping) {
    if (allowNull) return false;
    throw createError(503, "Banco de dados indisponível para mapeamentos de rastreador");
  }
  return true;
}

function buildMappingWhere({ clientId, deviceId, protocol, key, eventKey }) {
  const where = { clientId: clientId ? String(clientId) : undefined };
  if (deviceId) where.deviceId = String(deviceId);
  if (protocol) where.protocol = String(protocol);
  if (key) where.key = String(key);
  if (eventKey) where.eventKey = String(eventKey);
  return where;
}

export async function listTelemetryFieldMappings(filters = {}) {
  if (!ensurePrisma({ allowNull: true })) return [];
  const records = await prisma.telemetryFieldMapping.findMany({
    where: buildMappingWhere(filters),
    orderBy: [{ deviceId: "asc" }, { protocol: "asc" }, { key: "asc" }],
  });
  return records;
}

export async function upsertTelemetryFieldMapping(payload) {
  ensurePrisma();
  if (!payload?.clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  if (!payload?.key) {
    throw createError(400, "key é obrigatório");
  }
  if (!payload?.label) {
    throw createError(400, "label é obrigatório");
  }

  const data = {
    clientId: String(payload.clientId),
    deviceId: payload.deviceId ? String(payload.deviceId) : null,
    protocol: payload.protocol ? String(payload.protocol) : null,
    key: String(payload.key),
    label: String(payload.label),
    dataType: payload.dataType ? String(payload.dataType) : "string",
    unit: payload.unit ? String(payload.unit) : null,
  };

  if (payload.id) {
    const existing = await prisma.telemetryFieldMapping.findUnique({ where: { id: String(payload.id) } });
    if (!existing) throw createError(404, "Mapeamento não encontrado");
    if (String(existing.clientId) !== data.clientId) {
      throw createError(403, "Não é permitido mover mapeamentos para outro cliente");
    }
    return prisma.telemetryFieldMapping.update({ where: { id: String(payload.id) }, data });
  }

  return prisma.telemetryFieldMapping.upsert({
    where: {
      clientId_deviceId_protocol_key: {
        clientId: data.clientId,
        deviceId: data.deviceId,
        protocol: data.protocol,
        key: data.key,
      },
    },
    update: data,
    create: data,
  });
}

export async function deleteTelemetryFieldMapping(id) {
  ensurePrisma();
  const deleted = await prisma.telemetryFieldMapping.delete({ where: { id: String(id) } }).catch(() => null);
  if (!deleted) throw createError(404, "Mapeamento não encontrado");
  return deleted;
}

export async function listEventMappings(filters = {}) {
  if (!ensurePrisma({ allowNull: true })) return [];
  const records = await prisma.eventMapping.findMany({
    where: buildMappingWhere(filters),
    orderBy: [{ deviceId: "asc" }, { protocol: "asc" }, { eventKey: "asc" }],
  });
  return records;
}

export async function upsertEventMapping(payload) {
  ensurePrisma();
  if (!payload?.clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  if (!payload?.eventKey) {
    throw createError(400, "eventKey é obrigatório");
  }
  if (!payload?.label) {
    throw createError(400, "label é obrigatório");
  }

  const data = {
    clientId: String(payload.clientId),
    deviceId: payload.deviceId ? String(payload.deviceId) : null,
    protocol: payload.protocol ? String(payload.protocol) : null,
    eventKey: String(payload.eventKey),
    label: String(payload.label),
  };

  if (payload.id) {
    const existing = await prisma.eventMapping.findUnique({ where: { id: String(payload.id) } });
    if (!existing) throw createError(404, "Mapeamento não encontrado");
    if (String(existing.clientId) !== data.clientId) {
      throw createError(403, "Não é permitido mover mapeamentos para outro cliente");
    }
    return prisma.eventMapping.update({ where: { id: String(payload.id) }, data });
  }

  return prisma.eventMapping.upsert({
    where: {
      clientId_deviceId_protocol_eventKey: {
        clientId: data.clientId,
        deviceId: data.deviceId,
        protocol: data.protocol,
        eventKey: data.eventKey,
      },
    },
    update: data,
    create: data,
  });
}

export async function deleteEventMapping(id) {
  ensurePrisma();
  const deleted = await prisma.eventMapping.delete({ where: { id: String(id) } }).catch(() => null);
  if (!deleted) throw createError(404, "Mapeamento não encontrado");
  return deleted;
}
