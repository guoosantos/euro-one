const PROTOCOL_COLUMN_CATALOG = {
  default: {
    power: { labelPt: "Tensão do Veículo", unit: "V", type: "number", group: "voltage" },
    batteryLevel: { labelPt: "Nível de Bateria", unit: "%", type: "percent", group: "battery" },
    hdop: { labelPt: "HDOP", type: "number", group: "precision" },
    motion: { labelPt: "Movimento", type: "boolean", group: "base" },
    blocked: { labelPt: "Saída 1 (Bloqueio)", type: "boolean", group: "output" },
    charge: { labelPt: "Carga Ativa", type: "boolean", group: "sensor" },
    sensor_in_2: { labelPt: "Entrada 2 Ativa", type: "boolean", group: "input" },
    sensor_in_3: { labelPt: "Entrada 3 Ativa", type: "boolean", group: "input" },
    sensor_doors_f_l: { labelPt: "Porta Dianteira Esquerda Aberta", type: "boolean", group: "sensor" },
    sensor_motion_detected: { labelPt: "Movimento Detectado", type: "boolean", group: "sensor" },
    sensor_oil_pressure_warning: { labelPt: "Aviso Pressão de Óleo", type: "boolean", group: "sensor" },
  },
  iotm: {
    sensor_in_2: { labelPt: "Entrada 2 Ativa", type: "boolean", group: "input" },
    sensor_in_3: { labelPt: "Entrada 3 Ativa", type: "boolean", group: "input" },
    sensor_doors_f_l: { labelPt: "Porta Dianteira Esquerda Aberta", type: "boolean", group: "sensor" },
    sensor_motion_detected: { labelPt: "Movimento Detectado", type: "boolean", group: "sensor" },
    sensor_oil_pressure_warning: { labelPt: "Aviso Pressão de Óleo", type: "boolean", group: "sensor" },
  },
  gt06: {
    blocked: { labelPt: "Saída 1 (Bloqueio)", type: "boolean", group: "output" },
    charge: { labelPt: "Carga Ativa", type: "boolean", group: "sensor" },
    rssi: { labelPt: "Intensidade do Sinal (RSSI)", type: "number", group: "signal" },
  },
  teltonika: {},
  wialon: {},
  xirgo: {},
};

const COLUMN_GROUP_ORDER = {
  base: 0,
  voltage: 1,
  battery: 2,
  input: 3,
  output: 4,
  sensor: 5,
  io: 6,
  precision: 7,
  signal: 8,
  other: 9,
};

const BASE_COLUMNS = [
  { key: "gpsTime", labelPt: "Hora GPS", labelPdf: "Hora GPS", width: 140, defaultVisible: true, weight: 1.4, group: "base", alwaysVisible: true },
  { key: "address", labelPt: "Endereço", labelPdf: "Endereço", width: 260, defaultVisible: true, weight: 2.6, group: "base", alwaysVisible: true },
  { key: "speed", labelPt: "Velocidade", labelPdf: "Velocidade", width: 90, defaultVisible: true, weight: 0.9, group: "base", alwaysVisible: true },
  { key: "direction", labelPt: "Direção", labelPdf: "Direção", width: 90, defaultVisible: false, weight: 0.9, group: "base" },
  { key: "ignition", labelPt: "Ignição", labelPdf: "Ignição", width: 90, defaultVisible: true, weight: 0.9, group: "base", alwaysVisible: true, type: "boolean" },
  { key: "motion", labelPt: "Movimento", labelPdf: "Movimento", width: 120, defaultVisible: true, weight: 1, group: "base", alwaysVisible: true, type: "boolean" },
  { key: "power", labelPt: "Tensão do Veículo", labelPdf: "Tensão do Veículo", width: 150, defaultVisible: true, weight: 1.3, group: "voltage", unit: "V", type: "number" },
  { key: "batteryLevel", labelPt: "Nível de Bateria", labelPdf: "Nível de Bateria", width: 140, defaultVisible: true, weight: 1.2, group: "battery", unit: "%", type: "percent" },
  { key: "digitalInput1", labelPt: "Entrada 1 Ativa", labelPdf: "Entrada 1 Ativa", width: 140, defaultVisible: false, weight: 1.2, group: "input", type: "boolean" },
  { key: "digitalInput2", labelPt: "Entrada 2 Ativa", labelPdf: "Entrada 2 Ativa", width: 140, defaultVisible: false, weight: 1.2, group: "input", type: "boolean" },
  { key: "digitalOutput1", labelPt: "Saída 1 Ativa", labelPdf: "Saída 1 Ativa", width: 140, defaultVisible: false, weight: 1.2, group: "output", type: "boolean" },
  { key: "digitalOutput2", labelPt: "Saída 2 Ativa", labelPdf: "Saída 2 Ativa", width: 140, defaultVisible: false, weight: 1.2, group: "output", type: "boolean" },
  { key: "vehicleState", labelPt: "Estado do Veículo", labelPdf: "Estado do Veículo", width: 140, defaultVisible: true, weight: 1.4, group: "base" },
  { key: "distance", labelPt: "Distância", labelPdf: "Distância", width: 120, defaultVisible: false, weight: 1, group: "base", unit: "km", type: "number" },
  { key: "totalDistance", labelPt: "Distância Total", labelPdf: "Distância Total", width: 140, defaultVisible: false, weight: 1.1, group: "base", unit: "km", type: "number" },
  { key: "satellites", labelPt: "Satélites", labelPdf: "Satélites", width: 90, defaultVisible: false, weight: 0.9, group: "precision" },
  { key: "hdop", labelPt: "HDOP", labelPdf: "HDOP", width: 80, defaultVisible: false, weight: 0.8, group: "precision" },
  { key: "accuracy", labelPt: "Precisão", labelPdf: "Precisão", width: 90, defaultVisible: false, weight: 0.9, group: "precision" },
  { key: "rssi", labelPt: "Intensidade do Sinal (RSSI)", labelPdf: "Intensidade do Sinal (RSSI)", width: 160, defaultVisible: false, weight: 1.2, group: "signal" },
  { key: "geofence", labelPt: "Cerca Virtual", labelPdf: "Cerca Virtual", width: 140, defaultVisible: false, weight: 1.2, group: "base" },
  { key: "commandResponse", labelPt: "Resposta do Comando", labelPdf: "Resposta do Comando", width: 220, defaultVisible: true, weight: 2.2, group: "base" },
  {
    key: "deviceStatus",
    labelPt: "Status do Equipamento",
    labelPdf: "Status do Equipamento",
    width: 180,
    defaultVisible: true,
    weight: 1.6,
    group: "base",
  },
  {
    key: "deviceStatusEvent",
    labelPt: "Transição de Status",
    labelPdf: "Transição de Status",
    width: 200,
    defaultVisible: true,
    weight: 1.8,
    group: "base",
  },
  { key: "deviceTime", labelPt: "Hora do Dispositivo", labelPdf: "Hora do Dispositivo", width: 140, defaultVisible: false, weight: 1.4, group: "base" },
  { key: "serverTime", labelPt: "Hora do Servidor", labelPdf: "Hora do Servidor", width: 140, defaultVisible: false, weight: 1.4, group: "base" },
  { key: "latitude", labelPt: "Latitude", labelPdf: "Latitude", width: 110, defaultVisible: false, weight: 1, group: "base" },
  { key: "longitude", labelPt: "Longitude", labelPdf: "Longitude", width: 110, defaultVisible: false, weight: 1, group: "base" },
];

function normalizeProtocolKey(protocol) {
  return String(protocol || "").trim().toLowerCase();
}

function normalizeKey(key) {
  return String(key || "").trim();
}

function toTitleCase(value) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function splitWords(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFriendlyLabel(key) {
  const normalized = splitWords(String(key || ""));
  if (!normalized) return "Campo";
  if (normalized.toLowerCase().startsWith("sensor ")) {
    return toTitleCase(normalized);
  }
  return toTitleCase(normalized);
}

function withUnit(label, unit) {
  if (!unit) return label;
  if (label.includes(`(${unit})`)) return label;
  return `${label} (${unit})`;
}

function resolveCatalogEntry(key, protocol) {
  const normalizedKey = normalizeKey(key).toLowerCase();
  if (!normalizedKey) return null;
  const protocolKey = normalizeProtocolKey(protocol);
  const protocolCatalog = PROTOCOL_COLUMN_CATALOG[protocolKey] || {};
  if (protocolCatalog[normalizedKey]) return protocolCatalog[normalizedKey];
  const defaultCatalog = PROTOCOL_COLUMN_CATALOG.default || {};
  if (defaultCatalog[normalizedKey]) return defaultCatalog[normalizedKey];
  return null;
}

function resolveIoPattern(key) {
  const normalized = normalizeKey(key);
  if (!normalized) return null;
  const inputMatch = normalized.match(/^(?:sensor_)?(?:in|input|entrada|digitalinput)_?(\\d+)$/i);
  if (inputMatch) {
    return { labelPt: `Entrada ${inputMatch[1]} Ativa`, type: "boolean", group: "input" };
  }
  const outputMatch = normalized.match(/^(?:sensor_)?(?:out|output|saida|digitaloutput)_?(\\d+)$/i);
  if (outputMatch) {
    return { labelPt: `Saída ${outputMatch[1]} Ativa`, type: "boolean", group: "output" };
  }
  const ioMatch = normalized.match(/^(?:io|i\\/o)[-_ ]?(\\d+)$/i);
  if (ioMatch) {
    return { labelPt: `IO ${ioMatch[1]}`, group: "io" };
  }
  return null;
}

function resolveVoltagePattern(key) {
  const normalized = normalizeKey(key).toLowerCase();
  if (!normalized) return null;
  if (["power", "externalpower", "powervoltage", "voltage", "vehiclevoltage"].includes(normalized)) {
    return { labelPt: "Tensão do Veículo", unit: "V", type: "number", group: "voltage" };
  }
  if (["batteryvoltage", "battery_voltage"].includes(normalized)) {
    return { labelPt: "Tensão da Bateria", unit: "V", type: "number", group: "battery" };
  }
  return null;
}

export const positionsColumns = BASE_COLUMNS;
export const positionsColumnMap = new Map(BASE_COLUMNS.map((column) => [column.key, column]));

export function resolveColumnLabel(column, variant = "pt") {
  if (!column) return "[SEM TRADUÇÃO]";
  const baseLabel = variant === "pdf" ? column.labelPdf || column.labelPt : column.labelPt;
  const label = baseLabel || buildFriendlyLabel(column.key);
  return withUnit(label, column.unit);
}

export function resolveColumnDefinition(key, { protocol } = {}) {
  if (!key) return null;
  const base = positionsColumnMap.get(key);
  if (base) return base;
  const voltagePattern = resolveVoltagePattern(key);
  if (voltagePattern) {
    return { key, ...voltagePattern };
  }
  const pattern = resolveIoPattern(key);
  if (pattern) {
    return { key, ...pattern };
  }
  const catalog = resolveCatalogEntry(key, protocol);
  if (catalog) {
    return { key, ...catalog };
  }
  return {
    key,
    labelPt: buildFriendlyLabel(key),
    group: "other",
  };
}

export function resolveColumnGroupOrder(group) {
  return COLUMN_GROUP_ORDER[group] ?? COLUMN_GROUP_ORDER.other;
}
