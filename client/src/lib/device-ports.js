const PORT_TYPE_ALIASES = {
  di: "di",
  digital: "di",
  input: "di",
  entrada: "di",
  do: "do",
  output: "do",
  saida: "do",
  saída: "do",
  rs232: "rs232",
  rs485: "rs485",
  can: "can",
  lora: "lora",
  wifi: "wifi",
  "wi-fi": "wifi",
  bluetooth: "bluetooth",
  bt: "bluetooth",
};

const PORT_META = [
  { key: "di", label: "Entrada", shortLabel: "DI", telemetryPrefix: "input" },
  { key: "do", label: "Saída", shortLabel: "DO", telemetryPrefix: "output" },
  { key: "rs232", label: "RS232", shortLabel: "RS232" },
  { key: "rs485", label: "RS485", shortLabel: "RS485" },
  { key: "can", label: "CAN", shortLabel: "CAN" },
  { key: "lora", label: "LoRa", shortLabel: "LoRa" },
  { key: "wifi", label: "Wi-Fi", shortLabel: "Wi-Fi" },
  { key: "bluetooth", label: "Bluetooth", shortLabel: "BT" },
];

const DEFAULT_PORT_COUNTS = {
  di: 0,
  do: 0,
  rs232: 0,
  rs485: 0,
  can: 0,
  lora: 0,
  wifi: 0,
  bluetooth: 0,
};

const PORT_COUNT_ALIASES = {
  di: ["di", "entradasDI", "entradaDI", "inputsDI"],
  do: ["do", "saidasDO", "saídasDO", "outputsDO"],
  rs232: ["rs232"],
  rs485: ["rs485"],
  can: ["can"],
  lora: ["lora"],
  wifi: ["wifi"],
  bluetooth: ["bluetooth"],
};

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

export function normalizePortCounts(portCounts, ports) {
  const result = { ...DEFAULT_PORT_COUNTS };
  const source = portCounts && typeof portCounts === "object" ? portCounts : null;
  if (source) {
    let hasAnyValue = false;
    Object.keys(result).forEach((key) => {
      const aliases = PORT_COUNT_ALIASES[key] || [key];
      for (const alias of aliases) {
        if (!hasOwn(source, alias)) continue;
        result[key] = toNumber(source[alias], result[key]);
        hasAnyValue = true;
        break;
      }
    });
    if (hasAnyValue) return result;
  }
  if (Array.isArray(ports)) {
    ports.forEach((port) => {
      const rawType = String(port?.type ?? port?.mode ?? port?.label ?? "").toLowerCase().trim();
      const resolved = PORT_TYPE_ALIASES[rawType];
      if (resolved) {
        result[resolved] += 1;
      }
    });
  }
  return result;
}

function normalizeTelemetryMap(attributes = {}) {
  const map = new Map();
  Object.entries(attributes || {}).forEach(([key, value]) => {
    map.set(String(key).toLowerCase(), value);
  });
  return map;
}

function extractTelemetryMaxIndex(telemetryMap, prefix) {
  if (!telemetryMap || !prefix) return 0;
  let maxIndex = 0;
  const regex = new RegExp(`^${prefix}[_\\s-]?(\\d+)$`, "i");
  for (const key of telemetryMap.keys()) {
    const match = regex.exec(key);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > maxIndex) {
        maxIndex = value;
      }
    }
  }
  return maxIndex;
}

function resolveTelemetryValue(telemetryMap, prefix, index) {
  if (!telemetryMap || !prefix || !index) return null;
  const candidates = [
    `${prefix}${index}`,
    `${prefix}_${index}`,
    `${prefix}-${index}`,
  ];
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    if (telemetryMap.has(normalized)) {
      return telemetryMap.get(normalized);
    }
  }
  return null;
}

export function buildPortKey(typeKey, index) {
  const meta = PORT_META.find((item) => item.key === typeKey);
  if (!meta) return `${typeKey}${index}`;
  return `${meta.shortLabel}${index}`;
}

export function buildDefaultPortLabel(typeKey, index) {
  const meta = PORT_META.find((item) => item.key === typeKey);
  if (!meta) return `Porta ${index}`;
  const shortKey = buildPortKey(typeKey, index);
  return `${meta.label} ${index} (${shortKey})`;
}

export function buildPortList({ model, telemetry, deviceLabels, vehicleLabels }) {
  const counts = normalizePortCounts(model?.portCounts, model?.ports);
  const telemetryMap = normalizeTelemetryMap(telemetry);
  const telemetryCounts = {};
  PORT_META.forEach((meta) => {
    if (meta.telemetryPrefix) {
      telemetryCounts[meta.key] = extractTelemetryMaxIndex(telemetryMap, meta.telemetryPrefix);
    }
  });

  const ports = [];
  PORT_META.forEach((meta) => {
    const count = Math.max(counts[meta.key] || 0, telemetryCounts[meta.key] || 0);
    for (let index = 1; index <= count; index += 1) {
      const key = buildPortKey(meta.key, index);
      const label =
        vehicleLabels?.[key] ||
        deviceLabels?.[key] ||
        buildDefaultPortLabel(meta.key, index);
      const telemetryValue = meta.telemetryPrefix
        ? resolveTelemetryValue(telemetryMap, meta.telemetryPrefix, index)
        : null;
      let stateLabel = null;
      if (typeof telemetryValue === "boolean") {
        stateLabel = telemetryValue ? "ON" : "OFF";
      } else if (telemetryValue !== null && telemetryValue !== undefined) {
        stateLabel = String(telemetryValue);
      }
      ports.push({
        key,
        type: meta.key,
        label,
        defaultLabel: buildDefaultPortLabel(meta.key, index),
        telemetryValue,
        stateLabel,
      });
    }
  });
  return ports;
}

export default {
  normalizePortCounts,
  buildPortKey,
  buildDefaultPortLabel,
  buildPortList,
};
