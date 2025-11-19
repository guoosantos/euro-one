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

export function listTasks({ clientId, vehicleId, status, from, to } = {}) {
  const list = Array.from(tasks.values());
  const filtered = list.filter((task) => {
    if (clientId && String(task.clientId) !== String(clientId)) return false;
    if (vehicleId && String(task.vehicleId) !== String(vehicleId)) return false;
    if (status && String(task.status) !== String(status)) return false;
    if (from && new Date(task.startTimeExpected) < new Date(from)) return false;
    if (to && new Date(task.endTimeExpected) > new Date(to)) return false;
    return true;
  });
  return filtered.map(clone);
}

export function getTaskById(id) {
  return clone(tasks.get(String(id)));
}

export function createTask(payload) {
  const now = new Date().toISOString();
  const { clientId, vehicleId = null, driverId = null, address = null, geoFenceId = null } = payload || {};
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
    startTimeExpected: payload?.startTimeExpected || null,
    endTimeExpected: payload?.endTimeExpected || null,
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
