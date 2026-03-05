import { resolveEventDefinitionFromPayload } from "../../client/src/lib/event-translations.js";
import { resolveTelemetryDescriptor, telemetryAliases } from "../../shared/telemetryDictionary.js";

const DEFAULT_LOCALE = "pt-BR";
const METRIC_ALLOWLIST = new Set([
  "speed",
  "topSpeed",
  "batteryLevel",
  "battery",
  "power",
  "vcc",
  "vbat",
  "vehicleVoltage",
  "ignitionState",
  "engineWorking",
  "distance",
  "totalDistance",
  "odometer",
  "obdOdometer",
  "tachoOdometer",
  "totalDistanceHighRes",
  "slot1Distance",
  "slot2Distance",
  "serviceDistance",
  "rangeKm",
  "hdop",
  "sat",
  "rssi",
  "rpm",
  "temperature",
  "deviceTemp",
  "engineTemperature",
  "acceleration",
]);

const METRIC_RULES = {
  speed: { unit: "km/h", precision: 1, scale: 1.852 },
  topSpeed: { unit: "km/h", precision: 1, scale: 1.852 },
  distance: { unit: "km", precision: 2, scale: 0.001, min: 0 },
  totalDistance: { unit: "km", precision: 2, scale: 0.001, min: 0 },
  totalDistanceHighRes: { unit: "km", precision: 2, scale: 0.001, min: 0 },
  odometer: { unit: "km", precision: 2, scale: 0.001, min: 0 },
  obdOdometer: { unit: "km", precision: 2, scale: 0.001, min: 0 },
  tachoOdometer: { unit: "km", precision: 2, scale: 0.001, min: 0 },
  slot1Distance: { unit: "km", precision: 2, scale: 0.001, min: 0 },
  slot2Distance: { unit: "km", precision: 2, scale: 0.001, min: 0 },
  serviceDistance: { unit: "km", precision: 2, scale: 0.001, min: 0 },
  rangeKm: { unit: "km", precision: 1, min: 0 },
  vehicleVoltage: { unit: "V", precision: 2, min: 0 },
  battery: { unit: "V", precision: 2, min: 0 },
  power: { unit: "V", precision: 2, min: 0 },
  vcc: { unit: "V", precision: 2, min: 0 },
  vbat: { unit: "V", precision: 2, min: 0 },
  batteryLevel: { unit: "%", precision: 0, min: 0, max: 100 },
  temperature: { unit: "°C", precision: 1, min: -60, max: 200 },
  deviceTemp: { unit: "°C", precision: 1, min: -60, max: 200 },
  engineTemperature: { unit: "°C", precision: 1, min: -60, max: 200 },
  acceleration: { unit: "m/s²", precision: 2, min: -50, max: 50 },
  hdop: { unit: null, precision: 1, min: 0, max: 50 },
  sat: { unit: null, precision: 0, min: 0, max: 100 },
  rssi: { unit: null, precision: 0, min: -200, max: 200 },
  rpm: { unit: "rpm", precision: 0, min: 0, max: 20000 },
};

const METRIC_LABELS = {
  speed: "Velocidade",
  topSpeed: "Velocidade Máxima",
  batteryLevel: "Bateria",
  battery: "Bateria Dispositivo",
  power: "Tensão",
  vcc: "Alimentação (VCC)",
  vbat: "Bateria Veicular (VBAT)",
  vehicleVoltage: "Tensão do Veículo",
  ignitionState: "Ignição",
  engineWorking: "Motor",
  distance: "Distância",
  totalDistance: "Distância Total",
  totalDistanceHighRes: "Distância Total (Alta Res.)",
  odometer: "Odômetro",
  obdOdometer: "Odômetro CAN",
  tachoOdometer: "Odômetro TACO",
  slot1Distance: "Distância Slot 1",
  slot2Distance: "Distância Slot 2",
  serviceDistance: "Distância para Revisão",
  rangeKm: "Autonomia Estimada",
  hdop: "Precisão GPS",
  sat: "Satélites",
  rssi: "Sinal Celular",
  rpm: "RPM",
  temperature: "Temperatura",
  deviceTemp: "Temperatura Dispositivo",
  engineTemperature: "Temperatura do Motor",
  acceleration: "Aceleração",
};

const SEVERITY_MAP = {
  critical: "critical",
  critica: "critical",
  "crítica": "critical",
  critico: "critical",
  "crítico": "critical",
  grave: "critical",
  high: "warning",
  alta: "warning",
  warning: "warning",
  warn: "warning",
  alerta: "warning",
  alarm: "warning",
  alarme: "warning",
  medium: "warning",
  moderate: "warning",
  moderada: "warning",
  media: "warning",
  "média": "warning",
  low: "info",
  baixa: "info",
  info: "info",
  informativa: "info",
  normal: "info",
};

const BOOLEAN_TRUE = new Set(["true", "1", "on", "yes", "sim", "ligado", "ligada"]);
const BOOLEAN_FALSE = new Set(["false", "0", "off", "no", "nao", "não", "desligado", "desligada"]);

function normalizeString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeSeverity(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return "info";
  return SEVERITY_MAP[normalized] || normalized;
}

function normalizeEventTypeKey(value) {
  return normalizeString(value).replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function toUpperSnake(value) {
  const raw = normalizeString(value);
  if (!raw) return null;
  const withSpaces = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  const parts = withSpaces.split(/\s+/).filter(Boolean);
  return parts.length ? parts.join("_").toUpperCase() : raw.toUpperCase();
}

function parseBoolean(value) {
  if (value === true || value === false) return value;
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return null;
  if (BOOLEAN_TRUE.has(normalized)) return true;
  if (BOOLEAN_FALSE.has(normalized)) return false;
  return null;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundValue(value, precision = 0) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** Math.max(0, precision);
  return Math.round(value * factor) / factor;
}

function formatNumber(value, precision) {
  const rounded = roundValue(value, precision);
  if (rounded === null) return null;
  const fixed = rounded.toFixed(Math.max(0, precision));
  return fixed.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function resolveMetricKey(rawKey) {
  if (!rawKey) return null;
  const cleaned = normalizeString(rawKey);
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();
  const alias = telemetryAliases?.[lower];
  if (alias) return alias;
  if (["ignition", "acc", "ign"].includes(lower)) return "ignitionState";
  return cleaned;
}

function formatMetricEntry(key, rawValue, descriptor) {
  if (!key) return null;
  if (rawValue === null || rawValue === undefined || rawValue === "") return null;

  const rule = METRIC_RULES[key] || {};
  const label = descriptor?.labelPt || descriptor?.label || METRIC_LABELS[key] || key;
  const unit = rule.unit ?? descriptor?.unit ?? null;
  const type = descriptor?.type || (typeof rawValue === "boolean" ? "boolean" : "number");

  if (type === "boolean") {
    const boolValue = parseBoolean(rawValue);
    if (boolValue === null) return null;
    return {
      key,
      label,
      raw: rawValue,
      value: boolValue,
      unit: unit ?? null,
      text: boolValue ? "Ativo" : "Inativo",
      valid: true,
    };
  }

  if (type === "string") {
    const textValue = normalizeString(rawValue);
    if (!textValue) return null;
    return {
      key,
      label,
      raw: rawValue,
      value: textValue,
      unit: unit ?? null,
      text: textValue,
      valid: true,
    };
  }

  const parsed = parseNumber(rawValue);
  if (parsed === null) return null;

  const scale = Number.isFinite(rule.scale) ? rule.scale : 1;
  const scaled = parsed * scale;
  const min = Number.isFinite(rule.min) ? rule.min : null;
  const max = Number.isFinite(rule.max) ? rule.max : null;
  if ((min !== null && scaled < min) || (max !== null && scaled > max)) {
    return {
      key,
      label,
      raw: rawValue,
      value: scaled,
      unit: unit ?? null,
      text: "Valor inválido",
      valid: false,
    };
  }
  const precision = Number.isFinite(rule.precision) ? rule.precision : 2;
  const formattedNumber = formatNumber(scaled, precision);
  if (formattedNumber === null) return null;
  const text = unit ? `${formattedNumber} ${unit}` : formattedNumber;
  return {
    key,
    label,
    raw: rawValue,
    value: roundValue(scaled, precision),
    unit: unit ?? null,
    text,
    valid: true,
  };
}

function collectMetrics({ event, position }) {
  const metrics = new Map();
  const sources = [];
  if (event && typeof event === "object") sources.push(event);
  if (event?.attributes && typeof event.attributes === "object") sources.push(event.attributes);
  if (position && typeof position === "object") sources.push(position);
  if (position?.attributes && typeof position.attributes === "object") sources.push(position.attributes);

  const assignMetric = (rawKey, rawValue) => {
    const key = resolveMetricKey(rawKey);
    if (!key || !METRIC_ALLOWLIST.has(key)) return;
    if (metrics.has(key)) return;
    const descriptor = resolveTelemetryDescriptor(key);
    const entry = formatMetricEntry(key, rawValue, descriptor);
    if (entry) {
      metrics.set(key, {
        ...entry,
        priority: descriptor?.priority ?? 999,
      });
    }
  };

  sources.forEach((source) => {
    Object.entries(source || {}).forEach(([rawKey, rawValue]) => {
      assignMetric(rawKey, rawValue);
    });
  });

  // Ensure ignition is checked even if provided under common aliases.
  const ignitionValue =
    event?.ignition ??
    event?.attributes?.ignition ??
    event?.attributes?.acc ??
    event?.attributes?.ign ??
    position?.ignition ??
    position?.attributes?.ignition ??
    position?.attributes?.acc ??
    position?.attributes?.ign ??
    null;
  if (!metrics.has("ignitionState") && ignitionValue !== null) {
    assignMetric("ignitionState", ignitionValue);
  }

  const list = Array.from(metrics.values());
  list.sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  return list.map(({ priority, ...entry }) => entry);
}

function resolveEventTypeKey({ rawCandidate, definition, configuredEvent }) {
  const raw = normalizeString(rawCandidate);
  const rawIsNumeric = raw ? /^\d+$/.test(raw) : false;
  if (rawIsNumeric && definition?.type && !["event", "position", "unmapped"].includes(definition.type)) {
    return definition.type;
  }
  if (raw && !rawIsNumeric) return raw;
  if (definition?.raw && !/^\d+$/.test(definition.raw)) return definition.raw;
  if (configuredEvent?.id && !/^\d+$/.test(String(configuredEvent.id))) return String(configuredEvent.id);
  if (definition?.type) return definition.type;
  return raw || null;
}

export function normalizeEventPayload({
  event,
  position = null,
  protocol = null,
  configuredEvent = null,
  locale = DEFAULT_LOCALE,
} = {}) {
  if (!event) return null;
  const attributes = event?.attributes || {};
  const definitionPayload = {
    ...event,
    protocol: protocol || event?.protocol || attributes?.protocol || null,
    position: position || event?.position || null,
  };
  if (attributes?.alarm && String(event?.type || "").trim().toLowerCase() === "alarm") {
    definitionPayload.type = attributes.alarm;
  }
  const definition = resolveEventDefinitionFromPayload(definitionPayload, locale, null);
  const rawCandidate =
    attributes?.alarm ||
    attributes?.event ||
    event?.eventType ||
    event?.event ||
    event?.type ||
    attributes?.type ||
    null;
  const typeKey = resolveEventTypeKey({ rawCandidate, definition, configuredEvent });
  const eventType = typeKey ? toUpperSnake(typeKey) : null;
  const title =
    configuredEvent?.label ||
    definition?.label ||
    event?.eventLabel ||
    attributes?.eventLabel ||
    rawCandidate ||
    "Evento";
  const description =
    attributes?.message ||
    attributes?.description ||
    attributes?.type ||
    title;
  const severityRaw =
    configuredEvent?.severity ||
    definition?.severity ||
    event?.eventSeverity ||
    event?.severity ||
    attributes?.severity ||
    attributes?.criticality ||
    null;
  const severity = normalizeSeverity(severityRaw);

  return {
    eventType,
    typeKey: typeKey ? normalizeEventTypeKey(typeKey) : null,
    title,
    description,
    severity,
    protocol: protocol || definitionPayload.protocol || null,
    rawType: rawCandidate || null,
    metrics: collectMetrics({ event, position }),
  };
}
