import { resolveColumn } from "./positionsColumns.js";

// O relatório precisa refletir tudo que chegou do backend, inclusive attributes dinâmicos.
// O monitoring continua com colunas opinadas; aqui o schema é sempre derivado das chaves reais.

function normalizeKey(key) {
  return String(key || "").trim();
}

function collectKeys(position, keySet) {
  if (!position || typeof position !== "object") return;
  Object.keys(position).forEach((key) => {
    const normalized = normalizeKey(key);
    if (!normalized || normalized === "attributes") return;
    keySet.add(normalized);
  });

  const attributes = position.attributes;
  if (!attributes || typeof attributes !== "object") return;
  Object.keys(attributes).forEach((key) => {
    const normalized = normalizeKey(key);
    if (!normalized) return;
    keySet.add(normalized);
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

export default function buildPositionsSchema(positions = []) {
  const keys = new Set();
  (positions || []).forEach((position) => collectKeys(position, keys));

  const columns = Array.from(keys)
    .map((key) => resolveColumn(key))
    .filter(Boolean);

  return columns.sort((a, b) => {
    const baseDelta = resolveBaseOrder(a.key) - resolveBaseOrder(b.key);
    if (baseDelta !== 0) return baseDelta;
    const priorityDelta = (a.priority ?? 0) - (b.priority ?? 0);
    if (priorityDelta !== 0) return priorityDelta;
    return a.label.localeCompare(b.label, "pt-BR");
  });
}
