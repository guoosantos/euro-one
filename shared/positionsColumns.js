
export const positionsColumns = [
  { key: "gpsTime", labelPt: "Hora GPS", labelPdf: "Hora GPS", width: 140, defaultVisible: true, weight: 1.4 },
  { key: "address", labelPt: "Endereço", labelPdf: "Endereço", width: 260, defaultVisible: true, weight: 2.6 },
  { key: "speed", labelPt: "Velocidade", labelPdf: "Velocidade", width: 90, defaultVisible: true, weight: 0.9 },
  { key: "ignition", labelPt: "Ignição", labelPdf: "Ignição", width: 90, defaultVisible: true, weight: 0.9 },
  { key: "vehicleState", labelPt: "Movimento", labelPdf: "Movimento", width: 130, defaultVisible: true, weight: 1.3 },
  { key: "distance", labelPt: "Distância (km)", labelPdf: "Distância (km)", width: 110, defaultVisible: true, weight: 1 },
  { key: "totalDistance", labelPt: "Distância Total (km)", labelPdf: "Distância Total (km)", width: 140, defaultVisible: true, weight: 1.2 },
  { key: "vehicleVoltage", labelPt: "Tensão do Veículo (V)", labelPdf: "Tensão do Veículo (V)", width: 150, defaultVisible: true, weight: 1.3 },
  { key: "batteryLevel", labelPt: "Nível de Bateria (%)", labelPdf: "Nível de Bateria (%)", width: 140, defaultVisible: true, weight: 1.2 },
  { key: "digitalInput1", labelPt: "Entrada 1", labelPdf: "Entrada 1", width: 140, defaultVisible: false, weight: 1.2 },
  { key: "digitalInput2", labelPt: "Entrada 2", labelPdf: "Entrada 2", width: 140, defaultVisible: false, weight: 1.2 },
  { key: "digitalInput3", labelPt: "Entrada 3", labelPdf: "Entrada 3", width: 140, defaultVisible: false, weight: 1.2 },
  { key: "digitalInput4", labelPt: "Entrada 4", labelPdf: "Entrada 4", width: 140, defaultVisible: false, weight: 1.2 },
  { key: "digitalInput5", labelPt: "Entrada 5", labelPdf: "Entrada 5", width: 140, defaultVisible: false, weight: 1.2 },
  { key: "digitalInput6", labelPt: "Entrada 6", labelPdf: "Entrada 6", width: 140, defaultVisible: false, weight: 1.2 },
  { key: "digitalInput7", labelPt: "Entrada 7", labelPdf: "Entrada 7", width: 140, defaultVisible: false, weight: 1.2 },
  { key: "digitalInput8", labelPt: "Entrada 8", labelPdf: "Entrada 8", width: 140, defaultVisible: false, weight: 1.2 },
  { key: "digitalOutput1", labelPt: "Saída 1", labelPdf: "Saída 1", width: 140, defaultVisible: false, weight: 1.2 },
  { key: "digitalOutput2", labelPt: "Saída 2", labelPdf: "Saída 2", width: 140, defaultVisible: false, weight: 1.2 },
  { key: "digitalOutput3", labelPt: "Saída 3", labelPdf: "Saída 3", width: 140, defaultVisible: false, weight: 1.2 },
  { key: "digitalOutput4", labelPt: "Saída 4", labelPdf: "Saída 4", width: 140, defaultVisible: false, weight: 1.2 },
  { key: "digitalOutput5", labelPt: "Saída 5", labelPdf: "Saída 5", width: 140, defaultVisible: false, weight: 1.2 },
  { key: "digitalOutput6", labelPt: "Saída 6", labelPdf: "Saída 6", width: 140, defaultVisible: false, weight: 1.2 },
  { key: "digitalOutput7", labelPt: "Saída 7", labelPdf: "Saída 7", width: 140, defaultVisible: false, weight: 1.2 },
  { key: "digitalOutput8", labelPt: "Saída 8", labelPdf: "Saída 8", width: 140, defaultVisible: false, weight: 1.2 },
  { key: "satellites", labelPt: "Satélites", labelPdf: "Satélites", width: 90, defaultVisible: false, weight: 0.9 },
  { key: "hdop", labelPt: "HDOP", labelPdf: "HDOP", width: 90, defaultVisible: false, weight: 0.9 },
  { key: "accuracy", labelPt: "Precisão (m)", labelPdf: "Precisão (m)", width: 100, defaultVisible: false, weight: 1 },
  { key: "rssi", labelPt: "RSSI", labelPdf: "RSSI", width: 80, defaultVisible: false, weight: 0.8 },
  { key: "geofence", labelPt: "Cerca Virtual", labelPdf: "Cerca Virtual", width: 140, defaultVisible: false, weight: 1.2 },
  { key: "deviceTemp", labelPt: "Temperatura do Dispositivo (°C)", labelPdf: "Temperatura do Dispositivo (°C)", width: 160, defaultVisible: false, weight: 1.4 },
  { key: "handBrake", labelPt: "Freio de Mão", labelPdf: "Freio de Mão", width: 130, defaultVisible: false, weight: 1.1 },
  { key: "ioDetails", labelPt: "Detalhes (IO)", labelPdf: "Detalhes (IO)", width: 220, defaultVisible: false, weight: 2.2 },
  { key: "commandResponse", labelPt: "Resposta do Comando", labelPdf: "Resposta do Comando", width: 220, defaultVisible: true, weight: 2.2 },

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

  { key: "deviceTime", labelPt: "Hora do Dispositivo", labelPdf: "Hora do Dispositivo", width: 140, defaultVisible: false, weight: 1.4 },
  { key: "serverTime", labelPt: "Hora do Servidor", labelPdf: "Hora do Servidor", width: 140, defaultVisible: false, weight: 1.4 },
  { key: "latitude", labelPt: "Latitude", labelPdf: "Latitude", width: 110, defaultVisible: false, weight: 1 },
  { key: "longitude", labelPt: "Longitude", labelPdf: "Longitude", width: 110, defaultVisible: false, weight: 1 },
  { key: "direction", labelPt: "Direção", labelPdf: "Direção", width: 90, defaultVisible: false, weight: 0.9 },

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
