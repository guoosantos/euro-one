import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "./storage.js";

const STORAGE_KEY = "auditLogs";
const auditLogs = new Map();

function clone(record) {
  if (!record) return null;
  return {
    ...record,
    user: record.user ? { ...record.user } : null,
    details: record.details ? { ...record.details } : null,
  };
}

function syncStorage() {
  saveCollection(STORAGE_KEY, Array.from(auditLogs.values()));
}

const persistedLogs = loadCollection(STORAGE_KEY, []);
persistedLogs.forEach((record) => {
  if (!record?.id) return;
  auditLogs.set(record.id, record);
});

export function resolveRequestIp(req) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length) {
    return String(forwarded[0]).trim();
  }
  if (req?.ip) return req.ip;
  if (req?.connection?.remoteAddress) return req.connection.remoteAddress;
  return null;
}

export function recordAuditEvent(payload = {}) {
  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    clientId: payload.clientId ? String(payload.clientId) : null,
    vehicleId: payload.vehicleId ? String(payload.vehicleId) : null,
    deviceId: payload.deviceId ? String(payload.deviceId) : null,
    category: payload.category ? String(payload.category) : "system",
    action: payload.action ? String(payload.action) : "AÇÃO DO USUÁRIO",
    status: payload.status ? String(payload.status) : "Pendente",
    sentAt: payload.sentAt || now,
    respondedAt: payload.respondedAt ?? null,
    user: payload.user && typeof payload.user === "object"
      ? {
          id: payload.user.id ? String(payload.user.id) : null,
          name: payload.user.name ? String(payload.user.name) : null,
        }
      : null,
    ipAddress: payload.ipAddress ? String(payload.ipAddress) : null,
    details: payload.details && typeof payload.details === "object" ? { ...payload.details } : null,
    relatedId: payload.relatedId ? String(payload.relatedId) : null,
    createdAt: now,
  };

  auditLogs.set(record.id, record);
  syncStorage();
  return clone(record);
}

export function listAuditEvents({ clientId, vehicleId, from, to, categories } = {}) {
  const fromMs = from ? new Date(from).getTime() : null;
  const toMs = to ? new Date(to).getTime() : null;
  const categorySet = Array.isArray(categories) && categories.length
    ? new Set(categories.map((item) => String(item)))
    : null;

  return Array.from(auditLogs.values())
    .filter((record) => {
      if (clientId && String(record.clientId) !== String(clientId)) return false;
      if (vehicleId && String(record.vehicleId) !== String(vehicleId)) return false;
      if (categorySet && !categorySet.has(String(record.category))) return false;
      const timeValue = record.sentAt || record.respondedAt || record.createdAt;
      const timeMs = timeValue ? new Date(timeValue).getTime() : null;
      if (!Number.isFinite(timeMs)) return false;
      if (fromMs !== null && timeMs < fromMs) return false;
      if (toMs !== null && timeMs > toMs) return false;
      return true;
    })
    .map(clone);
}

export default {
  recordAuditEvent,
  listAuditEvents,
  resolveRequestIp,
};
