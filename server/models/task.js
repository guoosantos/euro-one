import { randomUUID } from "crypto";
import createError from "http-errors";

import prisma from "../services/prisma.js";

function normalizeDate(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createError(400, `Parâmetro ${label} inválido`, { details: { param: label, value: String(value) } });
  }
  return date;
}

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
  const fromDate = normalizeDate(from, "from");
  const toDate = normalizeDate(to, "to");

  const tasks = await prisma.task.findMany({
    where: {
      id: id ? String(id) : undefined,
      clientId: clientId ? String(clientId) : undefined,
      vehicleId: vehicleId ? String(vehicleId) : undefined,
      driverId: driverId ? String(driverId) : undefined,
      type: type ? String(type) : undefined,
      status: statuses && statuses.length ? { in: statuses } : undefined,
      startTimeExpected: fromDate ? { gte: fromDate } : undefined,
      endTimeExpected: toDate ? { lte: toDate } : undefined,
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
    referencePoint = null,
    geoFenceId = null,
    geofenceRadius = null,
    latitude = null,
    longitude = null,
    unit = null,
    operation = null,
    category = null,
    clientName = null,
    clientDocument = null,
    contractPlan = null,
    contactName = null,
    contactChannel = null,
    authorizationStatus = null,
    authorizationBy = null,
    serviceReason = null,
    serviceItem = null,
    priority = null,
    sla = null,
    slaExceptionReason = null,
    ownerName = null,
    technicianName = null,
    assignedTeam = null,
    rescheduleReason = null,
    cancelReason = null,
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
      unit,
      operation,
      category,
      clientName,
      clientDocument,
      contractPlan,
      contactName,
      contactChannel,
      authorizationStatus,
      authorizationBy,
      address,
      referencePoint,
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
      serviceReason,
      serviceItem,
      priority,
      sla,
      slaExceptionReason,
      status: payload?.status || "pendente",
      ownerName,
      technicianName,
      assignedTeam,
      rescheduleReason,
      cancelReason,
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
  const { technicianId, ...safeUpdates } = updates;
  const data = {
    ...safeUpdates,
    vehicleId: safeUpdates.vehicleId ? String(safeUpdates.vehicleId) : safeUpdates.vehicleId ?? existing.vehicleId,
    driverId: safeUpdates.driverId ? String(safeUpdates.driverId) : safeUpdates.driverId ?? existing.driverId,
    geoFenceId: safeUpdates.geoFenceId ?? existing.geoFenceId,
    referencePoint: safeUpdates.referencePoint ?? existing.referencePoint,
    unit: safeUpdates.unit ?? existing.unit,
    operation: safeUpdates.operation ?? existing.operation,
    category: safeUpdates.category ?? existing.category,
    clientName: safeUpdates.clientName ?? existing.clientName,
    clientDocument: safeUpdates.clientDocument ?? existing.clientDocument,
    contractPlan: safeUpdates.contractPlan ?? existing.contractPlan,
    contactName: safeUpdates.contactName ?? existing.contactName,
    contactChannel: safeUpdates.contactChannel ?? existing.contactChannel,
    authorizationStatus: safeUpdates.authorizationStatus ?? existing.authorizationStatus,
    authorizationBy: safeUpdates.authorizationBy ?? existing.authorizationBy,
    geofenceRadius:
      safeUpdates.geofenceRadius !== undefined && safeUpdates.geofenceRadius !== null
        ? Number(safeUpdates.geofenceRadius)
        : existing.geofenceRadius,
    latitude: safeUpdates.latitude !== undefined && safeUpdates.latitude !== null ? Number(safeUpdates.latitude) : existing.latitude,
    longitude:
      safeUpdates.longitude !== undefined && safeUpdates.longitude !== null ? Number(safeUpdates.longitude) : existing.longitude,
    startTimeExpected: safeUpdates.startTimeExpected ? new Date(safeUpdates.startTimeExpected) : existing.startTimeExpected,
    endTimeExpected: safeUpdates.endTimeExpected ? new Date(safeUpdates.endTimeExpected) : existing.endTimeExpected,
    arrivalTime: safeUpdates.arrivalTime ? new Date(safeUpdates.arrivalTime) : existing.arrivalTime,
    serviceStartTime: safeUpdates.serviceStartTime ? new Date(safeUpdates.serviceStartTime) : existing.serviceStartTime,
    serviceEndTime: safeUpdates.serviceEndTime ? new Date(safeUpdates.serviceEndTime) : existing.serviceEndTime,
    checklistCompleted:
      safeUpdates.checklistCompleted !== undefined ? Boolean(safeUpdates.checklistCompleted) : existing.checklistCompleted,
    type: safeUpdates.type || existing.type,
    serviceReason: safeUpdates.serviceReason ?? existing.serviceReason,
    serviceItem: safeUpdates.serviceItem ?? existing.serviceItem,
    priority: safeUpdates.priority ?? existing.priority,
    sla: safeUpdates.sla ?? existing.sla,
    slaExceptionReason: safeUpdates.slaExceptionReason ?? existing.slaExceptionReason,
    status: safeUpdates.status || existing.status,
    ownerName: safeUpdates.ownerName ?? existing.ownerName,
    technicianName: safeUpdates.technicianName ?? existing.technicianName,
    assignedTeam: safeUpdates.assignedTeam ?? existing.assignedTeam,
    rescheduleReason: safeUpdates.rescheduleReason ?? existing.rescheduleReason,
    cancelReason: safeUpdates.cancelReason ?? existing.cancelReason,
    attachments: Array.isArray(safeUpdates.attachments) ? [...safeUpdates.attachments] : existing.attachments,
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
