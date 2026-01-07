import { resolveTelemetryDescriptor } from "./telemetryDictionary.js";

const BASE_COLUMNS = [
  { key: "gpsTime", labelPt: "Transmissão GPS", labelPdf: "Transmissão GPS", width: 160, defaultVisible: true, weight: 1.4, group: "base" },
  { key: "event", labelPt: "Evento", labelPdf: "Evento", width: 200, defaultVisible: true, weight: 1.8, group: "base" },
  {
    key: "address",
    labelPt: "Endereço",
    labelPdf: "Endereço",
    width: 220,
    defaultVisible: true,
    weight: 2.8,
    group: "base",
  },
  { key: "speed", labelPt: "Velocidade", labelPdf: "Velocidade", width: 90, defaultVisible: true, weight: 0.9, group: "base" },
  { key: "ignition", labelPt: "Ignição", labelPdf: "Ignição", width: 90, defaultVisible: true, weight: 0.9, group: "base", type: "boolean" },
  { key: "vehicleState", labelPt: "Status", labelPdf: "Status", width: 120, defaultVisible: true, weight: 1.4, group: "base" },
  {
    key: "vehicleVoltage",
    labelPt: "Tensão do Veículo",
    labelPdf: "Tensão do Veículo",
    width: 140,
    defaultVisible: true,
    weight: 1.3,
    group: "voltage",
    unit: "V",
    type: "number",
  },
  { key: "batteryLevel", labelPt: "Nível da Bateria", labelPdf: "Nível da Bateria", width: 150, defaultVisible: true, weight: 1.3, group: "battery", unit: "%", type: "percent" },

  {
    key: "digitalInput1",
    labelPt: "Entrada 1",
    labelPdf: "Entrada 1",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "input",
    type: "boolean",
  },
  {
    key: "digitalInput2",
    labelPt: "Entrada 2",
    labelPdf: "Entrada 2",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "input",
    type: "boolean",
  },
  {
    key: "digitalInput3",
    labelPt: "Entrada 3",
    labelPdf: "Entrada 3",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "input",
    type: "boolean",
  },
  {
    key: "digitalInput4",
    labelPt: "Entrada 4",
    labelPdf: "Entrada 4",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "input",
    type: "boolean",
  },
  {
    key: "digitalInput5",
    labelPt: "Entrada 5",
    labelPdf: "Entrada 5",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "input",
    type: "boolean",
  },
  {
    key: "digitalInput6",
    labelPt: "Entrada 6",
    labelPdf: "Entrada 6",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "input",
    type: "boolean",
  },
  {
    key: "digitalInput7",
    labelPt: "Entrada 7",
    labelPdf: "Entrada 7",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "input",
    type: "boolean",
  },
  {
    key: "digitalInput8",
    labelPt: "Entrada 8",
    labelPdf: "Entrada 8",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "input",
    type: "boolean",
  },

  {
    key: "digitalOutput1",
    labelPt: "Saída 1",
    labelPdf: "Saída 1",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "output",
    type: "boolean",
  },
  {
    key: "digitalOutput2",
    labelPt: "Saída 2",
    labelPdf: "Saída 2",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "output",
    type: "boolean",
  },
  {
    key: "digitalOutput3",
    labelPt: "Saída 3",
    labelPdf: "Saída 3",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "output",
    type: "boolean",
  },
  {
    key: "digitalOutput4",
    labelPt: "Saída 4",
    labelPdf: "Saída 4",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "output",
    type: "boolean",
  },
  {
    key: "digitalOutput5",
    labelPt: "Saída 5",
    labelPdf: "Saída 5",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "output",
    type: "boolean",
  },
  {
    key: "digitalOutput6",
    labelPt: "Saída 6",
    labelPdf: "Saída 6",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "output",
    type: "boolean",
  },
  {
    key: "digitalOutput7",
    labelPt: "Saída 7",
    labelPdf: "Saída 7",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "output",
    type: "boolean",
  },
  {
    key: "digitalOutput8",
    labelPt: "Saída 8",
    labelPdf: "Saída 8",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "output",
    type: "boolean",
  },

  {
    key: "satellites",
    labelPt: "Número de satélites",
    labelPdf: "Número de satélites",
    width: 120,
    defaultVisible: false,
    weight: 1,
    group: "sensor",
    type: "number",
  },
  {
    key: "rssi",
    labelPt: "Intensidade do Sinal Celular",
    labelPdf: "Intensidade do Sinal Celular",
    width: 150,
    defaultVisible: false,
    weight: 1.2,
    group: "sensor",
  },
  {
    key: "hdop",
    labelPt: "Precisão GPS",
    labelPdf: "Precisão GPS",
    width: 140,
    defaultVisible: false,
    weight: 1.4,
    group: "sensor",
    type: "number",
  },
  {
    key: "accuracy",
    labelPt: "Precisão do posicionamento",
    labelPdf: "Precisão do posicionamento",
    width: 160,
    defaultVisible: false,
    weight: 1.1,
    group: "sensor",
    unit: "m",
    type: "number",
  },
  {
    key: "deviceTemp",
    labelPt: "Temperatura do dispositivo",
    labelPdf: "Temperatura do dispositivo",
    width: 160,
    defaultVisible: false,
    weight: 1.4,
    group: "sensor",
    unit: "°C",
    type: "number",
  },
  {
    key: "handBrake",
    labelPt: "Freio de mão",
    labelPdf: "Freio de mão",
    width: 150,
    defaultVisible: false,
    weight: 1.1,
    group: "sensor",
    type: "boolean",
  },

  { key: "distance", labelPt: "Distância percorrida", labelPdf: "Distância percorrida", width: 160, defaultVisible: true, weight: 1, group: "other", unit: "km", type: "number" },
  { key: "totalDistance", labelPt: "Distância total acumulada", labelPdf: "Distância total acumulada", width: 190, defaultVisible: true, weight: 1.2, group: "other", unit: "km", type: "number" },

  {
    key: "deviceStatus",
    labelPt: "Status",
    labelPdf: "Status",
    width: 120,
    defaultVisible: true,
    weight: 1.6,
    group: "other",
  },
  {
    key: "deviceStatusEvent",
    labelPt: "Status",
    labelPdf: "Status",
    width: 120,
    defaultVisible: true,
    weight: 1.8,
    group: "other",
  },

  { key: "deviceTime", labelPt: "Transmissão Dispositivo", labelPdf: "Transmissão Dispositivo", width: 170, defaultVisible: false, weight: 1.4, group: "other" },
  { key: "serverTime", labelPt: "Transmissão Servidor", labelPdf: "Transmissão Servidor", width: 170, defaultVisible: false, weight: 1.4, group: "other" },
  { key: "latitude", labelPt: "Latitude", labelPdf: "Latitude", width: 110, defaultVisible: false, weight: 1, group: "other" },
  { key: "longitude", labelPt: "Longitude", labelPdf: "Longitude", width: 110, defaultVisible: false, weight: 1, group: "other" },
  { key: "direction", labelPt: "Direção em graus", labelPdf: "Direção em graus", width: 140, defaultVisible: false, weight: 1.1, group: "other" },
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
    fixtime: { labelPt: "Transmissão GPS", group: "base" },
    valid: { labelPt: "GPS com sinal válido", type: "boolean", group: "base" },
    latitude: { labelPt: "Latitude", group: "other" },
    longitude: { labelPt: "Longitude", group: "other" },
    altitude: { labelPt: "Altitude", group: "other", unit: "m", type: "number" },
    speed: { labelPt: "Velocidade", group: "base" },
    course: { labelPt: "Direção em graus", group: "other" },
    address: { labelPt: "Endereço", group: "base" },
    accuracy: { labelPt: "Precisão do posicionamento", unit: "m", type: "number", group: "sensor" },
    network: { labelPt: "Rede", group: "other" },
    geofenceids: { labelPt: "Itinerário", group: "other" },
    obdodometer: { labelPt: "Odômetro", unit: "km", type: "number", group: "sensor" },
    power: { labelPt: "Tensão da bateria interna do dispositivo", unit: "V", type: "number", group: "battery" },
    battery: { labelPt: "Tensão da bateria interna do dispositivo", unit: "V", type: "number", group: "battery" },
    fuelused: { labelPt: "Uso do Combustível", unit: "L", type: "number", group: "sensor" },
    devicetemp: { labelPt: "Temperatura do dispositivo", unit: "°C", type: "number", group: "sensor" },
    acceleration: { labelPt: "Aceleração", unit: "m/s²", type: "number", group: "sensor" },
    hdop: { labelPt: "Precisão GPS", type: "number", group: "sensor" },
    sat: { labelPt: "Número de satélites", type: "number", group: "sensor" },
    ignition: { labelPt: "Ignição", type: "boolean", group: "base" },
    motion: { labelPt: "Veículo em movimento", type: "boolean", group: "base" },
    distance: { labelPt: "Distância percorrida", unit: "km", type: "number", group: "other" },
    totaldistance: { labelPt: "Distância total acumulada", unit: "km", type: "number", group: "other" },
    hours: { labelPt: "Horas de Motor", unit: "h", type: "number", group: "other" },
    charge: { labelPt: "Carga da Bateria", type: "boolean", group: "battery" },
    batterylevel: { labelPt: "Nível da Bateria", unit: "%", type: "percent", group: "battery" },
    rssi: { labelPt: "Intensidade do Sinal Celular", group: "sensor" },
    status: { labelPt: "Status", group: "other" },
  },
  gt06: {
    adc1: { labelPt: "Entrada 1", type: "boolean", group: "input" },
    blocked: { labelPt: "Saída 1", type: "boolean", group: "output" },
    type: { labelPt: "Tipo do Evento", group: "other" },
    charge: { labelPt: "Carga Ativa", type: "boolean", group: "battery" },
    batterylevel: { labelPt: "Nível de Bateria", unit: "%", type: "percent", group: "battery" },
    rssi: { labelPt: "Intensidade do Sinal Celular", group: "sensor" },
    digitaloutput1: { labelPt: "Saída 1", type: "boolean", group: "output" },
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
    return { labelPt: "Tensão da bateria interna do dispositivo", unit: "V", type: "number", group: "battery" };
  }
  return null;
}

export const positionsColumns = BASE_COLUMNS;
export const positionsColumnMap = new Map(BASE_COLUMNS.map((column) => [column.key, column]));

export function resolveColumn(key) {
  if (!key) return null;
  const normalized = normalizeKey(key);
  if (!normalized) return null;
  if (normalized.toLowerCase() === "protocol") return null;

  const definition = resolveColumnDefinition(normalized) || resolveColumnDefinition(key);
  const descriptor = resolveTelemetryDescriptor(normalized) || resolveTelemetryDescriptor(key);
  if (!definition && !descriptor) return null;

  if (descriptor && (!definition || definition.labelPt === buildFriendlyLabel(definition.key))) {
    const resolved = resolveColumnLabel({ ...descriptor, key: descriptor.key || normalized }, "pt");
    const resolvedPdf = resolveColumnLabel({ ...descriptor, key: descriptor.key || normalized }, "pdf");
    return {
      key: descriptor.key || normalized,
      label: resolved,
      labelPt: resolved,
      labelPdf: resolvedPdf,
      type: descriptor.type || null,
      unit: descriptor.unit || null,
      priority: descriptor.priority ?? resolveColumnGroupOrder(definition?.group),
      descriptionPt: descriptor.descriptionPt || descriptor.description || null,
    };
  }

  const resolved = definition ? resolveColumnLabel(definition, "pt") : buildFriendlyLabel(normalized);
  const resolvedPdf = definition ? resolveColumnLabel(definition, "pdf") : buildFriendlyLabel(normalized);
  return {
    key: definition?.key || normalized,
    label: resolved,
    labelPt: resolved,
    labelPdf: resolvedPdf,
    type: definition?.type || null,
    unit: definition?.unit || null,
    priority: resolveColumnGroupOrder(definition?.group),
    descriptionPt: definition?.descriptionPt || definition?.description || null,
  };
}

export function resolveColumnLabel(column, variant = "pt") {
  if (!column) return "[SEM TRADUÇÃO]";
  const description = column.descriptionPt || column.description;
  const baseLabel =
    variant === "pdf"
      ? column.labelPdf || description || column.labelPt
      : description || column.labelPt;
  const label = baseLabel || buildFriendlyLabel(column.key);
  return withUnit(label, column.unit);
}

export function resolveColumnDefinition(key, { protocol } = {}) {
  if (!key) return null;
  const telemetryDescriptor = resolveTelemetryDescriptor(key);
  if (telemetryDescriptor) {
    return {
      key,
      labelPt: telemetryDescriptor.labelPt || buildFriendlyLabel(key),
      descriptionPt: telemetryDescriptor.descriptionPt || telemetryDescriptor.description || null,
      type: telemetryDescriptor.type || null,
      unit: telemetryDescriptor.unit || null,
      group: telemetryDescriptor.group || "io",
    };
  }
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
