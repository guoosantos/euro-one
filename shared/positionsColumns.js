const BASE_COLUMNS = [
  { key: "gpsTime", labelPt: "Hora GPS", labelPdf: "Hora GPS", width: 140, defaultVisible: true, weight: 1.4, group: "base" },
  { key: "address", labelPt: "Endereço", labelPdf: "Endereço", width: 260, defaultVisible: true, weight: 2.6, group: "base" },
  { key: "speed", labelPt: "Velocidade", labelPdf: "Velocidade", width: 90, defaultVisible: true, weight: 0.9, group: "base" },
  { key: "ignition", labelPt: "Ignição", labelPdf: "Ignição", width: 90, defaultVisible: true, weight: 0.9, group: "base", type: "boolean" },
  { key: "vehicleState", labelPt: "Movimento", labelPdf: "Movimento", width: 130, defaultVisible: true, weight: 1.3, group: "base" },
  { key: "vehicleVoltage", labelPt: "Tensão do Veículo", labelPdf: "Tensão do Veículo", width: 150, defaultVisible: true, weight: 1.3, group: "voltage", unit: "V", type: "number" },
  { key: "batteryLevel", labelPt: "Nível de Bateria", labelPdf: "Nível de Bateria", width: 140, defaultVisible: true, weight: 1.2, group: "battery", unit: "%", type: "percent" },

  { key: "digitalInput1", labelPt: "Entrada 1", labelPdf: "Entrada 1", width: 140, defaultVisible: false, weight: 1.2, group: "input", type: "boolean" },
  { key: "digitalInput2", labelPt: "Entrada 2", labelPdf: "Entrada 2", width: 140, defaultVisible: false, weight: 1.2, group: "input", type: "boolean" },
  { key: "digitalInput3", labelPt: "Entrada 3", labelPdf: "Entrada 3", width: 140, defaultVisible: false, weight: 1.2, group: "input", type: "boolean" },
  { key: "digitalInput4", labelPt: "Entrada 4", labelPdf: "Entrada 4", width: 140, defaultVisible: false, weight: 1.2, group: "input", type: "boolean" },
  { key: "digitalInput5", labelPt: "Entrada 5", labelPdf: "Entrada 5", width: 140, defaultVisible: false, weight: 1.2, group: "input", type: "boolean" },
  { key: "digitalInput6", labelPt: "Entrada 6", labelPdf: "Entrada 6", width: 140, defaultVisible: false, weight: 1.2, group: "input", type: "boolean" },
  { key: "digitalInput7", labelPt: "Entrada 7", labelPdf: "Entrada 7", width: 140, defaultVisible: false, weight: 1.2, group: "input", type: "boolean" },
  { key: "digitalInput8", labelPt: "Entrada 8", labelPdf: "Entrada 8", width: 140, defaultVisible: false, weight: 1.2, group: "input", type: "boolean" },

  { key: "digitalOutput1", labelPt: "Saída 1", labelPdf: "Saída 1", width: 140, defaultVisible: false, weight: 1.2, group: "output", type: "boolean" },
  { key: "digitalOutput2", labelPt: "Saída 2", labelPdf: "Saída 2", width: 140, defaultVisible: false, weight: 1.2, group: "output", type: "boolean" },
  { key: "digitalOutput3", labelPt: "Saída 3", labelPdf: "Saída 3", width: 140, defaultVisible: false, weight: 1.2, group: "output", type: "boolean" },
  { key: "digitalOutput4", labelPt: "Saída 4", labelPdf: "Saída 4", width: 140, defaultVisible: false, weight: 1.2, group: "output", type: "boolean" },
  { key: "digitalOutput5", labelPt: "Saída 5", labelPdf: "Saída 5", width: 140, defaultVisible: false, weight: 1.2, group: "output", type: "boolean" },
  { key: "digitalOutput6", labelPt: "Saída 6", labelPdf: "Saída 6", width: 140, defaultVisible: false, weight: 1.2, group: "output", type: "boolean" },
  { key: "digitalOutput7", labelPt: "Saída 7", labelPdf: "Saída 7", width: 140, defaultVisible: false, weight: 1.2, group: "output", type: "boolean" },
  { key: "digitalOutput8", labelPt: "Saída 8", labelPdf: "Saída 8", width: 140, defaultVisible: false, weight: 1.2, group: "output", type: "boolean" },

  { key: "satellites", labelPt: "Satélites", labelPdf: "Satélites", width: 90, defaultVisible: false, weight: 0.9, group: "sensor", type: "number" },
  { key: "rssi", labelPt: "RSSI / Sinal", labelPdf: "RSSI / Sinal", width: 110, defaultVisible: false, weight: 1, group: "sensor" },
  { key: "hdop", labelPt: "HDOP", labelPdf: "HDOP", width: 90, defaultVisible: false, weight: 0.9, group: "sensor", type: "number" },
  { key: "accuracy", labelPt: "Precisão", labelPdf: "Precisão", width: 100, defaultVisible: false, weight: 1, group: "sensor", unit: "m", type: "number" },
  { key: "deviceTemp", labelPt: "Temperatura do Dispositivo", labelPdf: "Temperatura do Dispositivo", width: 160, defaultVisible: false, weight: 1.4, group: "sensor", unit: "°C", type: "number" },
  { key: "handBrake", labelPt: "Freio de Mão", labelPdf: "Freio de Mão", width: 130, defaultVisible: false, weight: 1.1, group: "sensor", type: "boolean" },

  { key: "distance", labelPt: "Distância", labelPdf: "Distância", width: 110, defaultVisible: true, weight: 1, group: "other", unit: "km", type: "number" },
  { key: "totalDistance", labelPt: "Distância Total", labelPdf: "Distância Total", width: 140, defaultVisible: true, weight: 1.2, group: "other", unit: "km", type: "number" },

  { key: "ioDetails", labelPt: "Detalhes (IO)", labelPdf: "Detalhes (IO)", width: 220, defaultVisible: false, weight: 2.2, group: "io" },
  { key: "commandResponse", labelPt: "Resposta do Comando", labelPdf: "Resposta do Comando", width: 220, defaultVisible: true, weight: 2.2, group: "other" },

  {
    key: "deviceStatus",
    labelPt: "Status do Equipamento",
    labelPdf: "Status do Equipamento",
    width: 180,
    defaultVisible: true,
    weight: 1.6,
    group: "other",
  },
  {
    key: "deviceStatusEvent",
    labelPt: "Transição de Status",
    labelPdf: "Transição de Status",
    width: 200,
    defaultVisible: true,
    weight: 1.8,
    group: "other",
  },

  { key: "deviceTime", labelPt: "Hora do Dispositivo", labelPdf: "Hora do Dispositivo", width: 140, defaultVisible: false, weight: 1.4, group: "other" },
  { key: "serverTime", labelPt: "Hora do Servidor", labelPdf: "Hora do Servidor", width: 140, defaultVisible: false, weight: 1.4, group: "other" },
  { key: "latitude", labelPt: "Latitude", labelPdf: "Latitude", width: 110, defaultVisible: false, weight: 1, group: "other" },
  { key: "longitude", labelPt: "Longitude", labelPdf: "Longitude", width: 110, defaultVisible: false, weight: 1, group: "other" },
  { key: "direction", labelPt: "Direção", labelPdf: "Direção", width: 90, defaultVisible: false, weight: 0.9, group: "other" },
  { key: "geofence", labelPt: "Cerca Virtual", labelPdf: "Cerca Virtual", width: 140, defaultVisible: false, weight: 1.2, group: "other" },
  { key: "deviceId", labelPt: "ID do Equipamento", labelPdf: "ID do Equipamento", width: 120, defaultVisible: false, weight: 1, group: "other" },
  { key: "id", labelPt: "Identificador", labelPdf: "Identificador", width: 110, defaultVisible: false, weight: 0.9, group: "other" },
];

const COLUMN_GROUP_ORDER = {
  base: 0,
  voltage: 10,
  battery: 20,
  input: 30,
  output: 40,
  sensor: 50,
  io: 60,
  other: 90,
};

const PROTOCOL_COLUMN_CATALOG = {
  default: {
    id: { labelPt: "Identificador", group: "other" },
    deviceid: { labelPt: "ID do Equipamento", group: "other" },
    fixtime: { labelPt: "Hora GPS", group: "base" },
    valid: { labelPt: "Válido", type: "boolean", group: "base" },
    latitude: { labelPt: "Latitude", group: "other" },
    longitude: { labelPt: "Longitude", group: "other" },
    altitude: { labelPt: "Altitude", group: "other", unit: "m", type: "number" },
    speed: { labelPt: "Velocidade", group: "base" },
    course: { labelPt: "Direção", group: "other" },
    address: { labelPt: "Endereço", group: "base" },
    accuracy: { labelPt: "Precisão", unit: "m", type: "number", group: "sensor" },
    network: { labelPt: "Rede", group: "other" },
    geofenceids: { labelPt: "Cerca Geográfica", group: "other" },
    obdodometer: { labelPt: "Odômetro OBD", unit: "km", type: "number", group: "sensor" },
    power: { labelPt: "Tensão do Veículo", unit: "V", type: "number", group: "voltage" },
    battery: { labelPt: "Bateria", unit: "V", type: "number", group: "battery" },
    fuelused: { labelPt: "Combustível Usado", unit: "L", type: "number", group: "sensor" },
    devicetemp: { labelPt: "Temperatura do Dispositivo", unit: "°C", type: "number", group: "sensor" },
    acceleration: { labelPt: "Aceleração", unit: "m/s²", type: "number", group: "sensor" },
    hdop: { labelPt: "HDOP", type: "number", group: "sensor" },
    sat: { labelPt: "Satélites", type: "number", group: "sensor" },
    ignition: { labelPt: "Ignição", type: "boolean", group: "base" },
    motion: { labelPt: "Movimento", type: "boolean", group: "base" },
    distance: { labelPt: "Distância", unit: "km", type: "number", group: "other" },
    totaldistance: { labelPt: "Distância Total", unit: "km", type: "number", group: "other" },
    hours: { labelPt: "Horas de Motor", unit: "h", type: "number", group: "other" },
    charge: { labelPt: "Carga Ativa", type: "boolean", group: "battery" },
    batterylevel: { labelPt: "Nível de Bateria", unit: "%", type: "percent", group: "battery" },
    rssi: { labelPt: "RSSI / Sinal", group: "sensor" },
  },
  gt06: {
    blocked: { labelPt: "Saída 1 (Bloqueio)", type: "boolean", group: "output" },
    charge: { labelPt: "Carga Ativa", type: "boolean", group: "battery" },
    batterylevel: { labelPt: "Nível de Bateria", unit: "%", type: "percent", group: "battery" },
    rssi: { labelPt: "RSSI / Sinal", group: "sensor" },
    digitaloutput1: { labelPt: "Saída 1 (Bloqueio)", type: "boolean", group: "output" },
  },
};

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
  const inputMatch = normalized.match(/^(?:sensor_)?(?:in|input|entrada|digitalinput)_?(\d+)$/i);
  if (inputMatch) {
    return { labelPt: `Entrada ${inputMatch[1]}`, type: "boolean", group: "input" };
  }
  const outputMatch = normalized.match(/^(?:sensor_)?(?:out|output|saida|digitaloutput)_?(\d+)$/i);
  if (outputMatch) {
    return { labelPt: `Saída ${outputMatch[1]}`, type: "boolean", group: "output" };
  }
  const ioMatch = normalized.match(/^(?:io|i\/o)[-_ ]?(\d+)$/i);
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
  const catalog = resolveCatalogEntry(key, protocol);
  const base = positionsColumnMap.get(key);
  if (base && catalog) {
    return { ...base, ...catalog, key };
  }
  if (base) return base;
  const voltagePattern = resolveVoltagePattern(key);
  if (voltagePattern) {
    return { key, ...voltagePattern };
  }
  const pattern = resolveIoPattern(key);
  if (pattern) {
    return { key, ...pattern };
  }
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
