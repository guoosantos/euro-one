import { loadCollection, saveCollection } from "./storage.js";

const STATE_STORAGE_KEY = "signal-state";
const EVENT_STORAGE_KEY = "signal-state-events";
const MAX_STORED_EVENTS = 5000;
const TRUE_VALUES = new Set(["true", "1", "on", "yes", "sim"]);

const SIGNAL_DEFINITIONS = [
  {
    key: "IN2",
    kind: "input",
    index: 2,
    keys: ["input2", "in2", "digitalinput2", "digitalInput2", "signalIn2"],
    labelOn: "BLOQUEADO POR JAMMER",
    labelOff: "DESBLOQUEADO (JAMMER)",
    codeOn: "109_2_ON",
    codeOff: "109_2_OFF",
    descriptionOn: "IN2 ativou (bloqueio por jammer)",
    descriptionOff: "IN2 desativou (desbloqueio por jammer)",
    attributes: { fun_id: 109, war_id: 2 },
  },
  {
    key: "IN4",
    kind: "input",
    index: 4,
    keys: ["input4", "in4", "digitalinput4", "digitalInput4", "signalIn4"],
    labelOn: "BLOQUEADO POR PAINEL",
    labelOff: "DESBLOQUEADO (PAINEL)",
    codeOn: "109_4_ON",
    codeOff: "109_4_OFF",
    descriptionOn: "IN4 ativou (bloqueio por painel)",
    descriptionOff: "IN4 desativou (desbloqueio por painel)",
    attributes: { fun_id: 109, war_id: 4 },
  },
  {
    key: "OUT1",
    kind: "output",
    index: 1,
    keys: ["out1", "output1", "digitaloutput1", "digitalOutput1"],
    labelOn: "VEÍCULO NO ITINERÁRIO",
    labelOff: "DESVIO NO ITINERÁRIO",
    codeOn: "OUT1_ON",
    codeOff: "OUT1_OFF",
    descriptionOn: "OUT1 ativou (veículo no itinerário)",
    descriptionOff: "OUT1 desativou (desvio no itinerário)",
  },
  {
    key: "OUT2",
    kind: "output",
    index: 2,
    keys: ["out2", "output2", "digitaloutput2", "digitalOutput2"],
    labelOn: "COMANDO DESACIONADO",
    labelOff: "COMANDO ACIONADO",
    codeOn: "OUT2_ON",
    codeOff: "OUT2_OFF",
    descriptionOn: "OUT2 ativou (comando desacionado)",
    descriptionOff: "OUT2 desativou (comando acionado)",
  },
];

const persistedStates = loadCollection(STATE_STORAGE_KEY, []);
const persistedEvents = loadCollection(EVENT_STORAGE_KEY, []);
const signalStates = new Map(
  (Array.isArray(persistedStates) ? persistedStates : [])
    .map((entry) => {
      const key = buildStateKey(entry?.deviceId, entry?.signalKey);
      if (!key) return null;
      return [key, entry];
    })
    .filter(Boolean),
);
let signalEvents = Array.isArray(persistedEvents) ? persistedEvents : [];

function buildStateKey(deviceId, signalKey) {
  const normalizedDeviceId = normalizeId(deviceId);
  const normalizedSignal = normalizeId(signalKey);
  if (!normalizedDeviceId || !normalizedSignal) return null;
  return `${normalizedDeviceId}:${normalizedSignal}`;
}

function normalizeId(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function parseTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed);
}

function normalizeIoValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed;
  }
  return value;
}

function isIoActive(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return false;
  return TRUE_VALUES.has(normalized);
}

function extractBulkIo(attributes = {}, key, index) {
  const collection = attributes?.[key];
  if (!Array.isArray(collection)) return null;
  const candidate = collection[index - 1];
  if (candidate === undefined) return null;
  return normalizeIoValue(candidate?.state ?? candidate?.raw ?? candidate);
}

function resolveSignalValue(attributes = {}, definition) {
  for (const key of definition.keys) {
    if (attributes[key] !== undefined && attributes[key] !== null) {
      return normalizeIoValue(attributes[key]);
    }
  }

  const kind = definition.kind === "output" ? "output" : "input";
  const index = definition.index;
  const aliasKeys =
    kind === "output"
      ? [`out${index}`, `output${index}`, `saida${index}`, `saída${index}`, `digitalOutput${index}`]
      : [`in${index}`, `input${index}`, `entrada${index}`, `digitalInput${index}`];
  for (const key of aliasKeys) {
    if (attributes[key] !== undefined && attributes[key] !== null) {
      return normalizeIoValue(attributes[key]);
    }
  }

  const bulk = kind === "output" ? extractBulkIo(attributes, "outputs", index) : extractBulkIo(attributes, "inputs", index);
  if (bulk !== null) return bulk;

  const fallbackKey = kind === "output" ? "digitalOutputs" : "digitalInputs";
  const fallback = extractBulkIo(attributes, fallbackKey, index);
  if (fallback !== null) return fallback;

  return null;
}

function persistStates() {
  saveCollection(STATE_STORAGE_KEY, Array.from(signalStates.values()));
}

function persistEvents() {
  saveCollection(EVENT_STORAGE_KEY, signalEvents);
}

function buildSignalEvent({
  definition,
  active,
  deviceId,
  vehicleId,
  clientId,
  position,
  eventTime,
}) {
  const now = new Date().toISOString();
  const code = active ? definition.codeOn : definition.codeOff;
  const label = active ? definition.labelOn : definition.labelOff;
  const description = active ? definition.descriptionOn : definition.descriptionOff;
  const eventTimestamp = eventTime || now;
  const id = `${normalizeId(deviceId) || "device"}-${definition.key}-${code}-${Date.parse(eventTimestamp) || Date.now()}`;
  return {
    id,
    eventId: code,
    type: code,
    eventLabel: label,
    eventSeverity: "high",
    eventCategory: "Segurança",
    eventRequiresHandling: true,
    eventActive: true,
    description,
    eventTime: eventTimestamp,
    serverTime: now,
    deviceId: normalizeId(deviceId),
    vehicleId: normalizeId(vehicleId),
    clientId: normalizeId(clientId),
    source: "telemetry",
    synthetic: true,
    latitude: position?.latitude ?? position?.lat ?? null,
    longitude: position?.longitude ?? position?.lng ?? null,
    address: position?.address ?? position?.shortAddress ?? null,
    attributes: {
      ...(definition.attributes || {}),
      signalKey: definition.key,
      signalValue: active ? 1 : 0,
      eventId: code,
    },
  };
}

export function ingestSignalStateEvents({
  clientId,
  vehicleId,
  deviceId,
  position,
  attributes = {},
} = {}) {
  const normalizedDeviceId = normalizeId(deviceId);
  if (!normalizedDeviceId) return [];

  const eventTime =
    position?.fixTime ||
    position?.deviceTime ||
    position?.serverTime ||
    position?.timestamp ||
    null;
  const parsedEventTime = parseTimestamp(eventTime) || new Date();
  const eventTimeIso = parsedEventTime.toISOString();
  const createdEvents = [];

  SIGNAL_DEFINITIONS.forEach((definition) => {
    const rawValue = resolveSignalValue(attributes, definition);
    if (rawValue === null || rawValue === undefined) return;

    const active = isIoActive(rawValue);
    const stateKey = buildStateKey(normalizedDeviceId, definition.key);
    if (!stateKey) return;
    const previous = signalStates.get(stateKey);

    if (!previous) {
      signalStates.set(stateKey, {
        deviceId: normalizedDeviceId,
        signalKey: definition.key,
        state: active,
        updatedAt: eventTimeIso,
      });
      return;
    }

    if (Boolean(previous.state) === Boolean(active)) return;

    const eventRecord = buildSignalEvent({
      definition,
      active,
      deviceId: normalizedDeviceId,
      vehicleId,
      clientId,
      position,
      eventTime: eventTimeIso,
    });
    createdEvents.push(eventRecord);
    signalEvents = [eventRecord, ...signalEvents].slice(0, MAX_STORED_EVENTS);
    signalStates.set(stateKey, {
      deviceId: normalizedDeviceId,
      signalKey: definition.key,
      state: active,
      updatedAt: eventTimeIso,
    });
  });

  if (createdEvents.length) {
    persistEvents();
  }
  persistStates();

  return createdEvents;
}

export function listSignalEvents({
  clientId,
  deviceIds = [],
  from,
  to,
} = {}) {
  const normalizedClientId = normalizeId(clientId);
  const deviceSet = new Set((Array.isArray(deviceIds) ? deviceIds : []).map((id) => normalizeId(id)).filter(Boolean));
  const fromDate = parseTimestamp(from);
  const toDate = parseTimestamp(to);

  return (Array.isArray(signalEvents) ? signalEvents : []).filter((event) => {
    if (normalizedClientId && String(event.clientId || "") !== normalizedClientId) return false;
    if (deviceSet.size && !deviceSet.has(String(event.deviceId || ""))) return false;
    if (fromDate || toDate) {
      const eventDate = parseTimestamp(event.eventTime || event.serverTime);
      if (!eventDate) return false;
      if (fromDate && eventDate < fromDate) return false;
      if (toDate && eventDate > toDate) return false;
    }
    return true;
  });
}
