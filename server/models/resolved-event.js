import createError from "http-errors";

import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "resolved-events";
const records = new Map();

const persisted = loadCollection(STORAGE_KEY, []);
persisted.forEach((entry) => {
  if (!entry?.eventId) return;
  const key = buildKey(entry.eventId, entry.clientId);
  records.set(key, {
    eventId: String(entry.eventId),
    clientId: entry.clientId != null ? String(entry.clientId) : null,
    resolvedAt: entry.resolvedAt || entry.resolved_at || null,
    resolvedBy: entry.resolvedBy || entry.resolved_by || null,
    resolvedByName: entry.resolvedByName || entry.resolved_by_name || null,
  });
});

function buildKey(eventId, clientId) {
  return `${String(eventId)}::${clientId != null ? String(clientId) : "global"}`;
}

function clone(record) {
  return record ? { ...record } : null;
}

function persist() {
  saveCollection(STORAGE_KEY, Array.from(records.values()));
}

export function listResolvedEvents({ clientId } = {}) {
  const targetClient = clientId != null ? String(clientId) : null;
  return Array.from(records.values())
    .filter((record) => record.clientId === targetClient)
    .map(clone);
}

export function getEventResolution(eventId, { clientId } = {}) {
  if (eventId === null || eventId === undefined) return null;
  const key = buildKey(eventId, clientId);
  return clone(records.get(key));
}

export function markEventResolved(eventId, { clientId = null, resolvedBy = null, resolvedByName = null } = {}) {
  const normalizedId = String(eventId || "").trim();
  if (!normalizedId) {
    throw createError(400, "ID do evento é obrigatório");
  }

  const payload = {
    eventId: normalizedId,
    clientId: clientId != null ? String(clientId) : null,
    resolvedAt: new Date().toISOString(),
    resolvedBy: resolvedBy != null ? String(resolvedBy) : null,
    resolvedByName: resolvedByName || null,
  };

  const key = buildKey(normalizedId, clientId);
  records.set(key, payload);
  persist();
  return clone(payload);
}

export function clearResolvedEvents() {
  records.clear();
  persist();
}

export default {
  listResolvedEvents,
  getEventResolution,
  markEventResolved,
  clearResolvedEvents,
};
