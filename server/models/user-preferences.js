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
  const widths = columns.widths && typeof columns.widths === "object" ? { ...columns.widths } : undefined;
  return { visible, order, widths };
}

function sanitizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return { ...value };
}

function sanitizeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function getUserPreferences(userId) {
  if (!userId) throw createError(400, "userId é obrigatório");
  const record = preferences.get(String(userId));
  if (!record) return null;
  return {
    ...record,
    monitoringTableColumns: sanitizeColumns(record.monitoringTableColumns),
    monitoringColumnWidths: sanitizePlainObject(record.monitoringColumnWidths),
    monitoringLayoutVisibility: sanitizePlainObject(record.monitoringLayoutVisibility),
    monitoringDefaultFilters: sanitizePlainObject(record.monitoringDefaultFilters),
    monitoringMapLayerKey: record.monitoringMapLayerKey || null,
    monitoringMapHeight: sanitizeNumber(record.monitoringMapHeight),
    monitoringSearchRadius: sanitizeNumber(record.monitoringSearchRadius),
    monitoringPanelRatio: sanitizeNumber(record.monitoringPanelRatio),
    monitoringContexts: sanitizePlainObject(record.monitoringContexts),
    routeReportColumns: sanitizeColumns(record.routeReportColumns),
    tripsReportColumns: sanitizeColumns(record.tripsReportColumns),
  };
}

export function saveUserPreferences(userId, updates = {}) {
  if (!userId) throw createError(400, "userId é obrigatório");
  const existing = preferences.get(String(userId)) || {
    userId: String(userId),
    monitoringTableColumns: null,
    monitoringColumnWidths: null,
    routeReportColumns: null,
    tripsReportColumns: null,
    monitoringDefaultFilters: null,
    monitoringLayoutVisibility: null,
    monitoringMapLayerKey: null,
    monitoringMapHeight: null,
    monitoringSearchRadius: null,
    monitoringPanelRatio: null,
    monitoringContexts: null,
    createdAt: new Date().toISOString(),
  };

  const next = {
    ...existing,
    monitoringTableColumns: sanitizeColumns(
      typeof updates.monitoringTableColumns !== "undefined"
        ? updates.monitoringTableColumns
        : existing.monitoringTableColumns,
    ),
    monitoringColumnWidths: sanitizePlainObject(
      typeof updates.monitoringColumnWidths !== "undefined"
        ? updates.monitoringColumnWidths
        : existing.monitoringColumnWidths,
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
    monitoringLayoutVisibility: sanitizePlainObject(
      typeof updates.monitoringLayoutVisibility !== "undefined"
        ? updates.monitoringLayoutVisibility
        : existing.monitoringLayoutVisibility,
    ),
    monitoringMapLayerKey:
      typeof updates.monitoringMapLayerKey !== "undefined"
        ? updates.monitoringMapLayerKey
        : existing.monitoringMapLayerKey,
    monitoringMapHeight:
      typeof updates.monitoringMapHeight !== "undefined"
        ? updates.monitoringMapHeight
        : existing.monitoringMapHeight,
    monitoringSearchRadius:
      typeof updates.monitoringSearchRadius !== "undefined"
        ? updates.monitoringSearchRadius
        : existing.monitoringSearchRadius,
    monitoringPanelRatio:
      typeof updates.monitoringPanelRatio !== "undefined"
        ? updates.monitoringPanelRatio
        : existing.monitoringPanelRatio,
    monitoringContexts: sanitizePlainObject(
      typeof updates.monitoringContexts !== "undefined"
        ? updates.monitoringContexts
        : existing.monitoringContexts,
    ),
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
    monitoringColumnWidths: null,
    routeReportColumns: null,
    tripsReportColumns: null,
    monitoringDefaultFilters: null,
    monitoringLayoutVisibility: null,
    monitoringMapLayerKey: null,
    monitoringMapHeight: null,
    monitoringSearchRadius: null,
    monitoringPanelRatio: null,
    monitoringContexts: null,
  };
}

export default {
  getUserPreferences,
  saveUserPreferences,
  resetUserPreferences,
};
