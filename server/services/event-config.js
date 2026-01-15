import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { normalizeDiagnosticKey } from "../../shared/eventTranslator.js";
import { getProtocolEvents, normalizeProtocolKey } from "./protocol-catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storagePath = process.env.EVENT_CONFIG_PATH || path.join(__dirname, "..", "data", "event-config.json");
let cachedConfig = null;
const DEFAULT_EVENT_CATEGORY = "Logística";
const SECURITY_EVENT_IDS = new Set(
  [
    "10",
    "11",
    "12",
    "13",
    "145",
    "21",
    "3",
    "4",
    "5",
    "6",
    "68",
    "69",
    "70",
    "9",
    "commandresult",
    "deviceinactive",
    "deviceoffline",
    "fun_id=0,war_id=1",
    "fun_id=0,war_id=140",
  ].map((entry) => entry.toLowerCase()),
);

function readFile() {
  if (cachedConfig) return cachedConfig;
  try {
    const raw = fs.readFileSync(storagePath, "utf-8");
    cachedConfig = JSON.parse(raw);
  } catch (_error) {
    cachedConfig = {};
  }
  return cachedConfig;
}

function writeFile(payload) {
  cachedConfig = payload;
  fs.writeFileSync(storagePath, JSON.stringify(payload, null, 2));
}

function normalizeClientKey(clientId) {
  return clientId ? String(clientId).trim() : "default";
}

function normalizeEventId(eventId) {
  if (eventId === undefined || eventId === null) return "";
  return String(eventId).trim();
}

function resolveDefaultCategory(eventId, catalogEvent = null) {
  const normalized = normalizeEventId(eventId).toLowerCase();
  if (catalogEvent?.category) return catalogEvent.category;
  if (SECURITY_EVENT_IDS.has(normalized)) return "Segurança";
  return DEFAULT_EVENT_CATEGORY;
}

function getCatalogEvents(protocolKey, catalogEvents) {
  if (Array.isArray(catalogEvents)) return catalogEvents;
  const events = getProtocolEvents(protocolKey);
  return Array.isArray(events) ? events : [];
}

function getCatalogMap(events = []) {
  return new Map(
    (events || [])
      .map((event) => {
        const id = normalizeEventId(event?.id);
        if (!id) return null;
        return [id, event];
      })
      .filter(Boolean),
  );
}

function resolveCatalogEventId({ protocolKey, eventKey, payload, catalogMap }) {
  if (!eventKey) return eventKey;
  if (catalogMap.has(eventKey)) return eventKey;
  if (protocolKey !== "iotm") return eventKey;

  const normalized = normalizeDiagnosticKey({ payload, rawCode: eventKey });
  const diagnosticKey = normalized?.key ? String(normalized.key).trim() : "";
  if (diagnosticKey && catalogMap.has(diagnosticKey)) {
    return diagnosticKey;
  }
  return eventKey;
}

function normalizeEntry(entry, defaults = {}) {
  const rawName =
    entry?.customName ??
    (typeof entry?.displayName === "string" ? entry.displayName.trim() : entry?.displayName ?? null);
  const displayName = typeof rawName === "string" ? rawName.trim() : rawName ?? null;
  const severity = entry?.severity || defaults.severity || "info";
  const active = typeof entry?.active === "boolean" ? entry.active : defaults.active ?? true;
  const category =
    entry?.category ??
    defaults.category ??
    null;
  const requiresHandling =
    typeof entry?.requiresHandling === "boolean"
      ? entry.requiresHandling
      : typeof defaults.requiresHandling === "boolean"
      ? defaults.requiresHandling
      : false;
  return {
    displayName: displayName || null,
    customName: displayName || null,
    severity,
    active,
    category,
    requiresHandling,
  };
}

function ensureProtocolConfig(data, clientKey, protocolKey) {
  const clientEntry = data?.[clientKey] && typeof data[clientKey] === "object" ? data[clientKey] : {};
  const protocolEntry =
    clientEntry?.[protocolKey] && typeof clientEntry[protocolKey] === "object" ? clientEntry[protocolKey] : {};
  return { clientEntry, protocolEntry };
}

export function getEventConfig({ clientId, protocol, catalogEvents } = {}) {
  const protocolKey = normalizeProtocolKey(protocol);
  const clientKey = normalizeClientKey(clientId);
  const data = readFile();
  const { clientEntry, protocolEntry } = ensureProtocolConfig(data, clientKey, protocolKey);
  const next = { ...protocolEntry };
  let mutated = false;

  const events = getCatalogEvents(protocolKey, catalogEvents);
  events.forEach((event) => {
    const eventId = normalizeEventId(event?.id);
    if (!eventId) return;
    const defaults = {
      severity: event?.defaultSeverity || event?.severity || "info",
      active: true,
      category: resolveDefaultCategory(eventId, event),
      requiresHandling: event?.requiresHandling ?? false,
    };
    if (!next[eventId]) {
      next[eventId] = {
        displayName: null,
        customName: null,
        severity: defaults.severity,
        active: true,
        category: defaults.category,
        requiresHandling: defaults.requiresHandling,
      };
      mutated = true;
      return;
    }
    const normalized = normalizeEntry(next[eventId], defaults);
    if (JSON.stringify(normalized) !== JSON.stringify(next[eventId])) {
      next[eventId] = normalized;
      mutated = true;
    }
  });

  if (mutated) {
    const payload = {
      ...data,
      [clientKey]: {
        ...clientEntry,
        [protocolKey]: next,
      },
    };
    writeFile(payload);
  }
  return next;
}

export function updateEventConfig({ clientId, protocol, items = [], catalogEvents } = {}) {
  const protocolKey = normalizeProtocolKey(protocol);
  const clientKey = normalizeClientKey(clientId);
  const data = readFile();
  const { clientEntry, protocolEntry } = ensureProtocolConfig(data, clientKey, protocolKey);
  const next = { ...protocolEntry };
  const events = getCatalogEvents(protocolKey, catalogEvents);
  const catalogMap = getCatalogMap(events);

  (items || []).forEach((item) => {
    const eventId = normalizeEventId(item?.id ?? item?.eventId);
    if (!eventId) return;
    const catalog = catalogMap.get(eventId);
    const defaults = {
      severity: catalog?.defaultSeverity || catalog?.severity || "info",
      active: true,
      category: resolveDefaultCategory(eventId, catalog),
      requiresHandling: catalog?.requiresHandling ?? false,
    };
    const normalized = normalizeEntry(
      {
        displayName:
          item?.customName ??
          item?.displayName ??
          next?.[eventId]?.customName ??
          next?.[eventId]?.displayName ??
          null,
        severity: item?.severity ?? next?.[eventId]?.severity,
        active: typeof item?.active === "boolean" ? item.active : next?.[eventId]?.active,
        category: item?.category ?? next?.[eventId]?.category,
        requiresHandling:
          typeof item?.requiresHandling === "boolean"
            ? item.requiresHandling
            : next?.[eventId]?.requiresHandling,
      },
      defaults,
    );
    next[eventId] = normalized;
  });

  const payload = {
    ...data,
    [clientKey]: {
      ...clientEntry,
      [protocolKey]: next,
    },
  };
  writeFile(payload);
  return next;
}

export function ensureUnmappedEventConfig({ clientId, protocol, eventId }) {
  const protocolKey = normalizeProtocolKey(protocol);
  const clientKey = normalizeClientKey(clientId);
  const data = readFile();
  const { clientEntry, protocolEntry } = ensureProtocolConfig(data, clientKey, protocolKey);
  const eventKey = normalizeEventId(eventId);
  if (!eventKey) return null;
  if (protocolEntry?.[eventKey]) {
    return protocolEntry[eventKey];
  }
  const next = {
    ...protocolEntry,
    [eventKey]: {
      displayName: `Evento desconhecido (${eventKey})`,
      customName: `Evento desconhecido (${eventKey})`,
      severity: "warning",
      active: true,
      category: resolveDefaultCategory(eventKey),
      requiresHandling: false,
    },
  };
  const payload = {
    ...data,
    [clientKey]: {
      ...clientEntry,
      [protocolKey]: next,
    },
  };
  writeFile(payload);
  return next[eventKey];
}

export function resolveEventConfiguration({
  clientId,
  protocol,
  eventId,
  payload = null,
  deviceId = null,
  catalogEvents,
  logger = console,
} = {}) {
  const protocolKey = normalizeProtocolKey(protocol);
  const rawEventKey = normalizeEventId(eventId);
  if (!rawEventKey) return null;

  const events = getCatalogEvents(protocolKey, catalogEvents);
  const catalogMap = getCatalogMap(events);
  const eventKey = resolveCatalogEventId({ protocolKey, eventKey: rawEventKey, payload, catalogMap });
  const catalogEntry = catalogMap.get(eventKey) || null;
  const config = getEventConfig({ clientId, protocol: protocolKey, catalogEvents: events });

  if (!catalogEntry) {
    const entry = ensureUnmappedEventConfig({ clientId, protocol: protocolKey, eventId: eventKey });
    if (logger?.warn) {
      logger.warn("[events] evento não mapeado", {
        protocol: protocolKey || null,
        id: eventKey,
        deviceId: deviceId ?? null,
        payload,
      });
    }
    return {
      id: eventKey,
      label: entry?.customName || entry?.displayName || `Evento desconhecido (${eventKey})`,
      severity: entry?.severity || "warning",
      active: entry?.active ?? true,
      category: entry?.category ?? null,
      requiresHandling: entry?.requiresHandling ?? false,
      isMapped: false,
    };
  }

  const entry = config?.[eventKey] || {};
  const label =
    entry.customName ||
    entry.displayName ||
    catalogEntry.name ||
    catalogEntry.labelPt ||
    catalogEntry.label ||
    eventKey;
  const severity = entry.severity || catalogEntry.defaultSeverity || catalogEntry.severity || "info";
  const active = typeof entry.active === "boolean" ? entry.active : true;
  const category = entry.category ?? catalogEntry.category ?? null;
  const requiresHandling =
    typeof entry.requiresHandling === "boolean"
      ? entry.requiresHandling
      : typeof catalogEntry.requiresHandling === "boolean"
      ? catalogEntry.requiresHandling
      : false;

  return {
    id: eventKey,
    label,
    severity,
    active,
    category,
    requiresHandling,
    isMapped: true,
    catalog: catalogEntry,
  };
}

export function resetEventConfigCache() {
  cachedConfig = null;
}
