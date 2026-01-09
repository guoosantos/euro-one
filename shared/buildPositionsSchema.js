import { filterIotmStatusColumns, isIotmProtocol, resolveColumn } from "./positionsColumns.js";

// O relatório precisa refletir tudo que chegou do backend, inclusive attributes dinâmicos.
// O monitoring continua com colunas opinadas; aqui o schema é sempre derivado das chaves reais.

function normalizeKey(key) {
  return String(key || "").trim();
}

function isDisplayableValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === "-" || trimmed === "—") return false;
  }
  return true;
}

const EXCLUDED_KEYS = new Set([
  "id",
  "deviceid",
  "positionid",
  "commandresponse",
  "command_response",
  "formattedaddress",
  "shortaddress",
  "formatted_address",
  "short_address",
  "digitalinput5",
  "digitalinput6",
  "digitalinput7",
  "digitaloutput1",
  "digitaloutput2",
  "input2",
  "input4",
  "input5",
  "signalin2",
  "signalin4",
  "signalin5",
  "satellites",
  "power",
]);

const LATITUDE_ALIASES = new Set(["lat", "latitude"]);
const LONGITUDE_ALIASES = new Set(["lng", "lon", "long", "longitude"]);

function shouldExcludeKey(key) {
  if (!key) return true;
  return EXCLUDED_KEYS.has(String(key).toLowerCase());
}

function collectKeys(position, keySet, keysWithValue) {
  if (!position || typeof position !== "object") return;
  Object.entries(position).forEach(([key, value]) => {
    const normalized = normalizeKey(key);
    if (!normalized || normalized === "attributes" || shouldExcludeKey(normalized)) return;
    if (isDisplayableValue(value)) {
      keySet.add(normalized);
      keysWithValue.add(normalized);
    }
  });

  const attributes = position.attributes;
  if (!attributes || typeof attributes !== "object") return;
  Object.entries(attributes).forEach(([key, value]) => {
    const normalized = normalizeKey(key);
    if (!normalized || shouldExcludeKey(normalized)) return;
    if (isDisplayableValue(value)) {
      keySet.add(normalized);
      keysWithValue.add(normalized);
    }
  });
}

function resolveBaseOrder(key) {
  const baseOrder = [
    "gpsTime",
    "deviceTime",
    "serverTime",
    "latitude",
    "longitude",
    "address",
    "speed",
    "direction",
    "ignition",
    "vehicleState",
    "distance",
    "totalDistance",
  ];
  const index = baseOrder.findIndex((item) => item.toLowerCase() === String(key || "").toLowerCase());
  return index === -1 ? baseOrder.length + 1 : index;
}

export default function buildPositionsSchema(positions = [], options = {}) {
  const keys = new Set();
  const keysWithValue = new Set();
  (positions || []).forEach((position) => collectKeys(position, keys, keysWithValue));

  const hasAddress = Array.from(keys).some((key) => key.toLowerCase() === "address");
  if (hasAddress) {
    Array.from(keys).forEach((key) => {
      const lower = key.toLowerCase();
      if (["formattedaddress", "shortaddress", "formatted_address", "short_address"].includes(lower)) {
        keys.delete(key);
        keysWithValue.delete(key);
      }
    });
  }

  const hasCanonicalLatitude = Array.from(keys).some((key) => key.toLowerCase() === "latitude");
  const hasCanonicalLongitude = Array.from(keys).some((key) => key.toLowerCase() === "longitude");
  if (hasCanonicalLatitude) {
    Array.from(keys).forEach((key) => {
      const lower = key.toLowerCase();
      if (LATITUDE_ALIASES.has(lower) && lower !== "latitude") {
        keys.delete(key);
        keysWithValue.delete(key);
      }
    });
  }
  if (hasCanonicalLongitude) {
    Array.from(keys).forEach((key) => {
      const lower = key.toLowerCase();
      if (LONGITUDE_ALIASES.has(lower) && lower !== "longitude") {
        keys.delete(key);
        keysWithValue.delete(key);
      }
    });
  }

  const hasIoDetails = Array.from(keys).some((key) => key.toLowerCase() === "iodetails");
  const hasIoSummary = Array.from(keys).some((key) => key.toLowerCase() === "iosummary");
  if (hasIoDetails && hasIoSummary) {
    Array.from(keys).forEach((key) => {
      if (key.toLowerCase() === "iosummary") {
        keys.delete(key);
        keysWithValue.delete(key);
      }
    });
  }

  const columns = Array.from(keys)
    .filter((key) => keysWithValue.has(key))
    .map((key) => resolveColumn(key))
    .filter(Boolean);

  const sorted = columns.sort((a, b) => {
    const baseDelta = resolveBaseOrder(a.key) - resolveBaseOrder(b.key);
    if (baseDelta !== 0) return baseDelta;
    const priorityDelta = (a.priority ?? 0) - (b.priority ?? 0);
    if (priorityDelta !== 0) return priorityDelta;
    return a.label.localeCompare(b.label, "pt-BR");
  });

  if (!isIotmProtocol(options.protocol, options.deviceModel)) {
    return sorted;
  }
  return filterIotmStatusColumns(sorted);
}
