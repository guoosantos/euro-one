import createError from "http-errors";

import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "userPreferences";
const preferences = new Map();

function syncStorage() {
  saveCollection(STORAGE_KEY, Array.from(preferences.values()));
}

function hydrate() {
  const stored = loadCollection(STORAGE_KEY, []);
  stored.forEach((entry) => {
    if (!entry?.userId) return;
    preferences.set(String(entry.userId), entry);
  });
}

hydrate();

function sanitizeColumns(columns) {
  if (!columns || typeof columns !== "object") return null;
  const visible = columns.visible && typeof columns.visible === "object" ? { ...columns.visible } : undefined;
  const order = Array.isArray(columns.order) ? [...columns.order] : undefined;
  return { visible, order };
}

export function getUserPreferences(userId) {
  if (!userId) throw createError(400, "userId é obrigatório");
  const record = preferences.get(String(userId));
  if (!record) return null;
  return {
    ...record,
    monitoringTableColumns: sanitizeColumns(record.monitoringTableColumns),
    routeReportColumns: sanitizeColumns(record.routeReportColumns),
    tripsReportColumns: sanitizeColumns(record.tripsReportColumns),
  };
}

export function saveUserPreferences(userId, updates = {}) {
  if (!userId) throw createError(400, "userId é obrigatório");
  const existing = preferences.get(String(userId)) || {
    userId: String(userId),
    monitoringTableColumns: null,
    routeReportColumns: null,
    tripsReportColumns: null,
    monitoringDefaultFilters: null,
    createdAt: new Date().toISOString(),
  };

  const next = {
    ...existing,
    monitoringTableColumns: sanitizeColumns(
      typeof updates.monitoringTableColumns !== "undefined"
        ? updates.monitoringTableColumns
        : existing.monitoringTableColumns,
    ),
    routeReportColumns: sanitizeColumns(
      typeof updates.routeReportColumns !== "undefined" ? updates.routeReportColumns : existing.routeReportColumns,
    ),
    tripsReportColumns: sanitizeColumns(
      typeof updates.tripsReportColumns !== "undefined" ? updates.tripsReportColumns : existing.tripsReportColumns,
    ),
    monitoringDefaultFilters:
      typeof updates.monitoringDefaultFilters !== "undefined"
        ? updates.monitoringDefaultFilters
        : existing.monitoringDefaultFilters,
    updatedAt: new Date().toISOString(),
  };

  preferences.set(String(userId), next);
  syncStorage();
  return getUserPreferences(userId);
}

export function resetUserPreferences(userId) {
  if (!userId) throw createError(400, "userId é obrigatório");
  preferences.delete(String(userId));
  syncStorage();
  return {
    userId: String(userId),
    monitoringTableColumns: null,
    routeReportColumns: null,
    tripsReportColumns: null,
    monitoringDefaultFilters: null,
  };
}

export default {
  getUserPreferences,
  saveUserPreferences,
  resetUserPreferences,
};
