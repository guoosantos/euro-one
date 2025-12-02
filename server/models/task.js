import { randomUUID } from "crypto";
import createError from "http-errors";

import prisma from "../services/prisma.js";

function clone(record) {
  if (!record) return null;
  return { ...record, attachments: Array.isArray(record.attachments) ? [...record.attachments] : [] };
}

export async function listTasks({ id, clientId, vehicleId, driverId, status, type, from, to } = {}) {
  const statuses = status
    ? Array.isArray(status)
      ? status.map(String)
      : String(status)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
    : undefined;

  const tasks = await prisma.task.findMany({
    where: {
      id: id ? String(id) : undefined,
      clientId: clientId ? String(clientId) : undefined,
      vehicleId: vehicleId ? String(vehicleId) : undefined,
      driverId: driverId ? String(driverId) : undefined,
      type: type ? String(type) : undefined,
      status: statuses && statuses.length ? { in: statuses } : undefined,
      startTimeExpected: from ? { gte: new Date(from) } : undefined,
      endTimeExpected: to ? { lte: new Date(to) } : undefined,
    },
    orderBy: { createdAt: "desc" },
  });
  return tasks.map(clone);
}

export async function getTaskById(id) {
  const record = await prisma.task.findUnique({ where: { id: String(id) } });
  return clone(record);
}

export async function createTask(payload) {
  const now = new Date();
  const {
    clientId,
    vehicleId = null,
    driverId = null,
    address = null,
    geoFenceId = null,
    geofenceRadius = null,
    latitude = null,
    longitude = null,
  } = payload || {};
  if (!clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  const record = await prisma.task.create({
    data: {
      id: randomUUID(),
      clientId: String(clientId),
      vehicleId: vehicleId ? String(vehicleId) : null,
      driverId: driverId ? String(driverId) : null,
      address,
      geoFenceId,
      geofenceRadius: geofenceRadius ? Number(geofenceRadius) : null,
      latitude: latitude ? Number(latitude) : null,
      longitude: longitude ? Number(longitude) : null,
      startTimeExpected: payload?.startTimeExpected ? new Date(payload.startTimeExpected) : null,
      endTimeExpected: payload?.endTimeExpected ? new Date(payload.endTimeExpected) : null,
      arrivalTime: payload?.arrivalTime ? new Date(payload.arrivalTime) : null,
      serviceStartTime: payload?.serviceStartTime ? new Date(payload.serviceStartTime) : null,
      serviceEndTime: payload?.serviceEndTime ? new Date(payload.serviceEndTime) : null,
      checklistCompleted: Boolean(payload?.checklistCompleted),
      type: payload?.type || "entrega",
      status: payload?.status || "pendente",
      attachments: Array.isArray(payload?.attachments) ? [...payload.attachments] : [],
      createdAt: now,
      updatedAt: now,
    },
  });

  return clone(record);
}

export async function updateTask(id, updates = {}) {
  const existing = await prisma.task.findUnique({ where: { id: String(id) } });
  if (!existing) {
    throw createError(404, "Task não encontrada");
  }
  const data = {
    ...updates,
    vehicleId: updates.vehicleId ? String(updates.vehicleId) : updates.vehicleId ?? existing.vehicleId,
    driverId: updates.driverId ? String(updates.driverId) : updates.driverId ?? existing.driverId,
    geoFenceId: updates.geoFenceId ?? existing.geoFenceId,
    geofenceRadius:
      updates.geofenceRadius !== undefined && updates.geofenceRadius !== null
        ? Number(updates.geofenceRadius)
        : existing.geofenceRadius,
    latitude: updates.latitude !== undefined && updates.latitude !== null ? Number(updates.latitude) : existing.latitude,
    longitude:
      updates.longitude !== undefined && updates.longitude !== null ? Number(updates.longitude) : existing.longitude,
    startTimeExpected: updates.startTimeExpected ? new Date(updates.startTimeExpected) : existing.startTimeExpected,
    endTimeExpected: updates.endTimeExpected ? new Date(updates.endTimeExpected) : existing.endTimeExpected,
    arrivalTime: updates.arrivalTime ? new Date(updates.arrivalTime) : existing.arrivalTime,
    serviceStartTime: updates.serviceStartTime ? new Date(updates.serviceStartTime) : existing.serviceStartTime,
    serviceEndTime: updates.serviceEndTime ? new Date(updates.serviceEndTime) : existing.serviceEndTime,
    checklistCompleted:
      updates.checklistCompleted !== undefined ? Boolean(updates.checklistCompleted) : existing.checklistCompleted,
    type: updates.type || existing.type,
    status: updates.status || existing.status,
    attachments: Array.isArray(updates.attachments) ? [...updates.attachments] : existing.attachments,
    updatedAt: new Date(),
  };
  const updated = await prisma.task.update({ where: { id: existing.id }, data });
  return clone(updated);
}

export default {
  listTasks,
  getTaskById,
  createTask,
  updateTask,
};
