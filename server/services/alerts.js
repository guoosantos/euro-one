import { loadCollection, saveCollection } from "./storage.js";

const STORAGE_KEY = "vehicle-alerts";

function normalizeClientKey(clientId) {
  return clientId ? String(clientId).trim() : "default";
}

function normalizeId(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function parseTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed);
}

function getSnapshot() {
  return loadCollection(STORAGE_KEY, {});
}

function persistSnapshot(next) {
  saveCollection(STORAGE_KEY, next);
}

function buildAlertRecord({
  event,
  configuredEvent,
  deviceId,
  vehicleId,
  vehicleLabel,
  plate,
  address,
  protocol,
}) {
  const eventId = normalizeId(event?.id ?? event?.eventId);
  if (!eventId) return null;
  const eventTime =
    event?.eventTime ?? event?.serverTime ?? event?.deviceTime ?? event?.time ?? null;
  const createdAt = parseTimestamp(eventTime) || new Date();

  return {
    id: eventId,
    eventId,
    protocol: protocol || null,
    eventType: event?.type || event?.attributes?.type || event?.event || null,
    eventLabel: configuredEvent?.label || event?.eventLabel || null,
    severity: configuredEvent?.severity || event?.eventSeverity || event?.severity || null,
    category: configuredEvent?.category ?? event?.eventCategory ?? null,
    requiresHandling: configuredEvent?.requiresHandling ?? event?.eventRequiresHandling ?? true,
    status: "pending",
    createdAt: createdAt.toISOString(),
    handledAt: null,
    handledBy: null,
    handledByName: null,
    handling: null,
    deviceId: deviceId ? String(deviceId) : null,
    vehicleId: vehicleId ? String(vehicleId) : null,
    vehicleLabel: vehicleLabel || null,
    plate: plate || null,
    address: address || null,
  };
}

export function listAlerts({
  clientId,
  status,
  vehicleId,
  deviceId,
  severity,
  category,
  from,
  to,
} = {}) {
  const snapshot = getSnapshot();
  const clientKey = normalizeClientKey(clientId);
  const alerts = Array.isArray(snapshot?.[clientKey]?.alerts)
    ? snapshot[clientKey].alerts
    : [];

  const normalizedStatus = status ? String(status).trim().toLowerCase() : null;
  const normalizedSeverity = severity ? String(severity).trim().toLowerCase() : null;
  const normalizedCategory = category ? String(category).trim().toLowerCase() : null;
  const vehicleKey = normalizeId(vehicleId);
  const deviceKey = normalizeId(deviceId);
  const fromDate = parseTimestamp(from);
  const toDate = parseTimestamp(to);

  return alerts.filter((alert) => {
    if (normalizedStatus && String(alert.status).toLowerCase() !== normalizedStatus) return false;
    if (vehicleKey && String(alert.vehicleId || "") !== vehicleKey) return false;
    if (deviceKey && String(alert.deviceId || "") !== deviceKey) return false;
    if (normalizedSeverity && String(alert.severity || "").toLowerCase() !== normalizedSeverity) return false;
    if (normalizedCategory && String(alert.category || "").toLowerCase() !== normalizedCategory) return false;
    if (fromDate || toDate) {
      const createdAt = parseTimestamp(alert.createdAt);
      if (!createdAt) return false;
      if (fromDate && createdAt < fromDate) return false;
      if (toDate && createdAt > toDate) return false;
    }
    return true;
  });
}

export function upsertAlertFromEvent({
  clientId,
  event,
  configuredEvent,
  deviceId,
  vehicleId,
  vehicleLabel,
  plate,
  address,
  protocol,
} = {}) {
  if (!configuredEvent?.requiresHandling) return null;
  if (configuredEvent?.active === false) return null;
  const snapshot = getSnapshot();
  const clientKey = normalizeClientKey(clientId);
  const alerts = Array.isArray(snapshot?.[clientKey]?.alerts)
    ? snapshot[clientKey].alerts
    : [];
  const eventId = normalizeId(event?.id ?? event?.eventId);
  if (!eventId) return null;
  const existing = alerts.find((alert) => String(alert.eventId) === eventId);
  if (existing) return existing;

  const record = buildAlertRecord({
    event,
    configuredEvent,
    deviceId,
    vehicleId,
    vehicleLabel,
    plate,
    address,
    protocol,
  });
  if (!record) return null;
  const nextAlerts = [record, ...alerts];
  const nextSnapshot = {
    ...snapshot,
    [clientKey]: {
      ...(snapshot?.[clientKey] || {}),
      alerts: nextAlerts,
    },
  };
  persistSnapshot(nextSnapshot);
  return record;
}

export function handleAlert({
  clientId,
  alertId,
  payload,
  handledBy,
  handledByName,
} = {}) {
  const snapshot = getSnapshot();
  const clientKey = normalizeClientKey(clientId);
  const alerts = Array.isArray(snapshot?.[clientKey]?.alerts)
    ? snapshot[clientKey].alerts
    : [];
  const normalizedId = normalizeId(alertId);
  if (!normalizedId) return null;
  const now = new Date().toISOString();

  const nextAlerts = alerts.map((alert) => {
    if (String(alert.id) !== normalizedId && String(alert.eventId) !== normalizedId) return alert;
    return {
      ...alert,
      status: "handled",
      handledAt: now,
      handledBy: handledBy ?? alert.handledBy ?? null,
      handledByName: handledByName ?? alert.handledByName ?? null,
      handling: {
        isOk: payload?.isOk ?? null,
        action: payload?.action ?? "",
        cause: payload?.cause ?? "",
        notes: payload?.notes ?? "",
      },
    };
  });

  const nextSnapshot = {
    ...snapshot,
    [clientKey]: {
      ...(snapshot?.[clientKey] || {}),
      alerts: nextAlerts,
    },
  };
  persistSnapshot(nextSnapshot);
  return nextAlerts.find(
    (alert) => String(alert.id) === normalizedId || String(alert.eventId) === normalizedId,
  );
}
