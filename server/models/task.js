import { randomUUID } from "crypto";
import createError from "http-errors";

import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "tasks";
const tasks = new Map();

function clone(record) {
  if (!record) return null;
  return { ...record, attachments: Array.isArray(record.attachments) ? [...record.attachments] : [] };
}

function persist(record, { skipSync = false } = {}) {
  tasks.set(String(record.id), record);
  if (!skipSync) {
    saveCollection(STORAGE_KEY, Array.from(tasks.values()));
  }
  return clone(record);
}

const persisted = loadCollection(STORAGE_KEY, []);
persisted.forEach((record) => {
  if (record?.id) persist({ ...record }, { skipSync: true });
});

export function listTasks({ id, clientId, vehicleId, driverId, status, type, from, to } = {}) {
  const list = Array.from(tasks.values());
  const filtered = list.filter((task) => {
    if (id && String(task.id) !== String(id)) return false;
    if (clientId && String(task.clientId) !== String(clientId)) return false;
    if (vehicleId && String(task.vehicleId) !== String(vehicleId)) return false;
    if (driverId && String(task.driverId) !== String(driverId)) return false;
    if (type && String(task.type) !== String(type)) return false;
    if (status) {
      const statuses = Array.isArray(status) ? status.map(String) : String(status).split(",");
      if (!statuses.includes(String(task.status))) return false;
    }
    if (from && task.startTimeExpected && new Date(task.startTimeExpected) < new Date(from)) return false;
    if (to && task.endTimeExpected && new Date(task.endTimeExpected) > new Date(to)) return false;
    return true;
  });
  return filtered.map(clone);
}

export function getTaskById(id) {
  return clone(tasks.get(String(id)));
}

export function createTask(payload) {
  const now = new Date().toISOString();
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
  const record = {
    id: randomUUID(),
    clientId: String(clientId),
    vehicleId: vehicleId ? String(vehicleId) : null,
    driverId: driverId ? String(driverId) : null,
    address: address || null,
    geoFenceId: geoFenceId || null,
    geofenceRadius: geofenceRadius || null,
    latitude: latitude || null,
    longitude: longitude || null,
    startTimeExpected: payload?.startTimeExpected || null,
    endTimeExpected: payload?.endTimeExpected || null,
    arrivalTime: payload?.arrivalTime || null,
    serviceStartTime: payload?.serviceStartTime || null,
    serviceEndTime: payload?.serviceEndTime || null,
    checklistCompleted: Boolean(payload?.checklistCompleted),
    type: payload?.type || "entrega",
    status: payload?.status || "pendente",
    attachments: Array.isArray(payload?.attachments) ? [...payload.attachments] : [],
    createdAt: now,
    updatedAt: now,
  };

  return persist(record);
}

export function updateTask(id, updates = {}) {
  const record = tasks.get(String(id));
  if (!record) {
    throw createError(404, "Task não encontrada");
  }
  Object.assign(record, { ...updates, updatedAt: new Date().toISOString() });
  return persist(record);
}
