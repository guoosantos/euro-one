const TRUE_VALUES = new Set(["true", "1", "on", "yes", "sim"]);
const FALSE_VALUES = new Set(["false", "0", "off", "no", "não", "nao"]);

function isValuePresent(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

export function normalizeAlertList(alarm) {
  if (!isValuePresent(alarm)) return [];
  if (Array.isArray(alarm)) return alarm.map(String).filter(Boolean);
  if (typeof alarm === "string") {
    return alarm
      .split(/[,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof alarm === "object") {
    return Object.entries(alarm)
      .filter(([, value]) => toBoolean(value))
      .map(([key]) => String(key));
  }
  return [];
}

export function resolveAlertSignals({ position, device, payload } = {}) {
  const source = payload || position || {};
  const attributes =
    source.attributes || source.position?.attributes || source.rawAttributes || source.position?.rawAttributes || {};
  const candidates = [
    source.alarm,
    source.alarms,
    source.alerts,
    source.position?.alarm,
    source.position?.alarms,
    attributes.alarm,
    attributes.alarms,
    attributes.alerts,
    device?.alerts,
    device?.alarm,
  ];
  const match = candidates.find((value) => isValuePresent(value));
  return normalizeAlertList(match);
}

export default {
  normalizeAlertList,
  resolveAlertSignals,
};
