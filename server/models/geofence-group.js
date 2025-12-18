import createError from "http-errors";

import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../services/storage.js";
import prisma from "../services/prisma.js";

const GROUP_STORAGE_KEY = "geofenceGroups";
const ASSIGNMENT_STORAGE_KEY = "geofenceGroupAssignments";

const geofenceGroups = new Map();
const assignments = new Map();

function ensurePrismaGroupModel() {
  if (!prisma) return;
  if (!prisma.geofenceGroup) {
    throw createError(503, "Prisma Client sem o modelo GeofenceGroup. Rode prisma generate e redeploy.");
  }
}

function clone(record) {
  return record ? { ...record, geofenceIds: record.geofenceIds ? [...record.geofenceIds] : undefined } : null;
}

function syncStorage() {
  saveCollection(GROUP_STORAGE_KEY, Array.from(geofenceGroups.values()));
  saveCollection(ASSIGNMENT_STORAGE_KEY, Array.from(assignments.values()));
}

function persistGroup(record, { skipSync = false } = {}) {
  geofenceGroups.set(record.id, record);
  if (!skipSync) {
    syncStorage();
  }
}

function persistAssignment(record, { skipSync = false } = {}) {
  assignments.set(record.id, record);
  if (!skipSync) {
    syncStorage();
  }
}

// bootstrap from storage
const persistedGroups = loadCollection(GROUP_STORAGE_KEY, []);
persistedGroups.forEach((item) => {
  if (item?.id) {
    persistGroup({ ...item }, { skipSync: true });
  }
});

const persistedAssignments = loadCollection(ASSIGNMENT_STORAGE_KEY, []);
persistedAssignments.forEach((item) => {
  if (item?.id) {
    persistAssignment({ ...item }, { skipSync: true });
  }
});

function filterGroupsByClient(collection, clientId) {
  if (typeof clientId === "undefined") {
    return collection;
  }
  if (clientId === null) {
    return collection.filter((item) => item.clientId === null);
  }
  return collection.filter((item) => String(item.clientId) === String(clientId));
}

function listAssignmentsByGroupId(groupId) {
  return Array.from(assignments.values()).filter((item) => String(item.geofenceGroupId) === String(groupId));
}

function listAssignmentsByClientId(clientId) {
  const collection = Array.from(assignments.values());
  if (typeof clientId === "undefined") {
    return collection;
  }
  return collection.filter((item) => String(item.clientId) === String(clientId));
}

function attachGeofences(group) {
  if (!group) return null;
  const geofenceIds = listAssignmentsByGroupId(group.id).map((item) => item.geofenceId);
  return { ...group, geofenceIds };
}

export function listGeofenceGroups({ clientId, includeGeofences = false } = {}) {
  ensurePrismaGroupModel();
  const collection = filterGroupsByClient(Array.from(geofenceGroups.values()), clientId);
  const groups = includeGeofences ? collection.map((item) => attachGeofences(item)) : collection;
  return groups.map((item) => clone(item) || item);
}

export function getGeofenceGroupById(id, { includeGeofences = false } = {}) {
  ensurePrismaGroupModel();
  const record = geofenceGroups.get(String(id));
  if (!record) return null;
  return clone(includeGeofences ? attachGeofences(record) : record);
}

export function getGroupIdsForGeofence(geofenceId, { clientId } = {}) {
  if (!geofenceId) return [];
  const filteredAssignments = listAssignmentsByClientId(clientId ?? undefined).filter(
    (item) => String(item.geofenceId) === String(geofenceId),
  );
  return filteredAssignments.map((item) => item.geofenceGroupId);
}

export function createGeofenceGroup({ name, clientId, color = null, description = null }) {
  ensurePrismaGroupModel();
  if (!name) {
    throw createError(400, "Nome é obrigatório");
  }
  if (!clientId) {
    throw createError(400, "clientId é obrigatório");
  }

  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    clientId: String(clientId),
    name,
    color: color || null,
    description: description || null,
    createdAt: now,
    updatedAt: now,
  };

  persistGroup(record);
  return clone(record);
}

export function updateGeofenceGroup(id, updates = {}) {
  ensurePrismaGroupModel();
  const record = geofenceGroups.get(String(id));
  if (!record) {
    throw createError(404, "Grupo de geofence não encontrado");
  }

  if (Object.prototype.hasOwnProperty.call(updates, "clientId")) {
    if (!updates.clientId) {
      throw createError(400, "clientId é obrigatório");
    }
    record.clientId = String(updates.clientId);
  }
  if (updates.name) {
    record.name = updates.name;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "color")) {
    record.color = updates.color || null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "description")) {
    record.description = updates.description || null;
  }
  record.updatedAt = new Date().toISOString();

  persistGroup(record);
  return clone(record);
}

export function deleteGeofenceGroup(id) {
  ensurePrismaGroupModel();
  const record = geofenceGroups.get(String(id));
  if (!record) {
    throw createError(404, "Grupo de geofence não encontrado");
  }
  geofenceGroups.delete(String(id));

  Array.from(assignments.values()).forEach((item) => {
    if (String(item.geofenceGroupId) === String(id)) {
      assignments.delete(item.id);
    }
  });

  syncStorage();
  return clone(record);
}

export function deleteGeofenceGroupsByClientId(clientId) {
  const removed = [];
  Array.from(geofenceGroups.values()).forEach((item) => {
    if (String(item.clientId) === String(clientId)) {
      geofenceGroups.delete(item.id);
      removed.push(item.id);
    }
  });

  if (removed.length) {
    Array.from(assignments.values()).forEach((item) => {
      if (removed.includes(item.geofenceGroupId)) {
        assignments.delete(item.id);
      }
    });
    syncStorage();
  }
}

export function setGeofencesForGroup(groupId, geofenceIds = [], { clientId } = {}) {
  ensurePrismaGroupModel();
  const record = geofenceGroups.get(String(groupId));
  if (!record) {
    throw createError(404, "Grupo de geofence não encontrado");
  }
  if (clientId && String(record.clientId) !== String(clientId)) {
    throw createError(403, "Grupo pertence a outro cliente");
  }

  // remove existing assignments for group
  Array.from(assignments.values()).forEach((item) => {
    if (String(item.geofenceGroupId) === String(groupId)) {
      assignments.delete(item.id);
    }
  });

  const now = new Date().toISOString();
  const uniqueIds = Array.from(new Set((geofenceIds || []).filter(Boolean).map((item) => String(item))));
  uniqueIds.forEach((geofenceId) => {
    const entry = {
      id: randomUUID(),
      geofenceGroupId: String(groupId),
      geofenceId,
      clientId: record.clientId,
      createdAt: now,
      updatedAt: now,
    };
    persistAssignment(entry, { skipSync: true });
  });

  syncStorage();
  return attachGeofences(record);
}
