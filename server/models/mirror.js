import createError from "http-errors";
import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "mirrors";
const mirrors = new Map();

function syncStorage() {
  saveCollection(STORAGE_KEY, Array.from(mirrors.values()));
}

function persistMirror(record, { skipSync = false } = {}) {
  mirrors.set(record.id, record);
  if (!skipSync) {
    syncStorage();
  }
  return record;
}

const persistedMirrors = loadCollection(STORAGE_KEY, []);
persistedMirrors.forEach((record) => {
  if (record?.id) {
    persistMirror({ ...record }, { skipSync: true });
  }
});

export function listMirrors({ ownerClientId, targetClientId } = {}) {
  let collection = Array.from(mirrors.values());
  if (ownerClientId) {
    collection = collection.filter((item) => String(item.ownerClientId) === String(ownerClientId));
  }
  if (targetClientId) {
    collection = collection.filter((item) => String(item.targetClientId) === String(targetClientId));
  }
  return collection.map((item) => ({ ...item }));
}

export function getMirrorById(id) {
  const record = mirrors.get(String(id));
  return record ? { ...record } : null;
}

export function createMirror({
  ownerClientId,
  targetClientId,
  targetType,
  vehicleIds = [],
  vehicleGroupId = null,
  permissionGroupId = null,
  startAt = null,
  endAt = null,
  createdBy = null,
  createdByName = null,
}) {
  if (!ownerClientId) {
    throw createError(400, "ownerClientId é obrigatório");
  }
  if (!targetClientId) {
    throw createError(400, "targetClientId é obrigatório");
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const record = {
    id,
    ownerClientId: String(ownerClientId),
    targetClientId: String(targetClientId),
    targetType,
    vehicleIds: Array.isArray(vehicleIds) ? vehicleIds.map(String) : [],
    vehicleGroupId: vehicleGroupId ? String(vehicleGroupId) : null,
    permissionGroupId: permissionGroupId ? String(permissionGroupId) : null,
    startAt,
    endAt,
    createdBy: createdBy ? String(createdBy) : null,
    createdByName: createdByName || null,
    createdAt: now,
    updatedAt: now,
  };
  persistMirror(record);
  return { ...record };
}

export function updateMirror(id, updates = {}) {
  const record = mirrors.get(String(id));
  if (!record) {
    throw createError(404, "Espelhamento não encontrado");
  }
  if (Object.prototype.hasOwnProperty.call(updates, "ownerClientId")) {
    if (!updates.ownerClientId) {
      throw createError(400, "ownerClientId é obrigatório");
    }
    record.ownerClientId = String(updates.ownerClientId);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "targetClientId")) {
    if (!updates.targetClientId) {
      throw createError(400, "targetClientId é obrigatório");
    }
    record.targetClientId = String(updates.targetClientId);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "targetType")) {
    record.targetType = updates.targetType;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "vehicleIds")) {
    record.vehicleIds = Array.isArray(updates.vehicleIds) ? updates.vehicleIds.map(String) : [];
  }
  if (Object.prototype.hasOwnProperty.call(updates, "vehicleGroupId")) {
    record.vehicleGroupId = updates.vehicleGroupId ? String(updates.vehicleGroupId) : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "permissionGroupId")) {
    record.permissionGroupId = updates.permissionGroupId ? String(updates.permissionGroupId) : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "startAt")) {
    record.startAt = updates.startAt;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "endAt")) {
    record.endAt = updates.endAt;
  }
  record.updatedAt = new Date().toISOString();
  persistMirror(record);
  return { ...record };
}

export function deleteMirror(id) {
  const record = mirrors.get(String(id));
  if (!record) {
    throw createError(404, "Espelhamento não encontrado");
  }
  mirrors.delete(String(id));
  syncStorage();
  return { ...record };
}

export default {
  listMirrors,
  getMirrorById,
  createMirror,
  updateMirror,
  deleteMirror,
};
