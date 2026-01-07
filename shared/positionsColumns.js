import { resolveTelemetryDescriptor } from "./telemetryDictionary.js";

const BASE_COLUMNS = [
  { key: "deviceTime", labelPt: "Transmissão Dispositivo", labelPdf: "Transmissão Dispositivo", width: 170, defaultVisible: true, weight: 1.4, group: "other" },
  { key: "gpsTime", labelPt: "Transmissão GPS", labelPdf: "Transmissão GPS", width: 160, defaultVisible: false, weight: 1.4, group: "base" },
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
  { key: "ignition", labelPt: "Ignição", labelPdf: "Ignição", width: 90, defaultVisible: true, weight: 0.9, group: "base", type: "boolean" },
  { key: "speed", labelPt: "Velocidade", labelPdf: "Velocidade", width: 90, defaultVisible: true, weight: 0.9, group: "base" },
  { key: "vehicleState", labelPt: "Status", labelPdf: "Status", width: 120, defaultVisible: false, weight: 1.4, group: "base" },
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
  { key: "distance", labelPt: "Distância percorrida", labelPdf: "Distância percorrida", width: 160, defaultVisible: false, weight: 1, group: "other", unit: "km", type: "number" },
  { key: "totalDistance", labelPt: "Distância total acumulada", labelPdf: "Distância total acumulada", width: 190, defaultVisible: false, weight: 1.2, group: "other", unit: "km", type: "number" },
  {
    key: "deviceStatus",
    labelPt: "Status (EXCLUIR REPETIDO)",
    labelPdf: "Status (EXCLUIR REPETIDO)",
    width: 160,
    defaultVisible: false,
    weight: 1.6,
    group: "other",
  },
  {
    key: "deviceStatusEvent",
    labelPt: "Status (EXCLUIR REPETIDO)",
    labelPdf: "Status (EXCLUIR REPETIDO)",
    width: 160,
    defaultVisible: false,
    weight: 1.8,
    group: "other",
  },
  { key: "serverTime", labelPt: "Transmissão Servidor", labelPdf: "Transmissão Servidor", width: 170, defaultVisible: false, weight: 1.4, group: "other" },
  { key: "latitude", labelPt: "Latitude", labelPdf: "Latitude", width: 110, defaultVisible: false, weight: 1, group: "other" },
  { key: "longitude", labelPt: "Longitude", labelPdf: "Longitude", width: 110, defaultVisible: false, weight: 1, group: "other" },
  { key: "direction", labelPt: "Direção em graus", labelPdf: "Direção em graus", width: 140, defaultVisible: false, weight: 1.1, group: "other" },
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
    key: "batteryLevel",
    labelPt: "Bateria (EXCLUIR JÁ TEM TENSAO DO VEICULO)",
    labelPdf: "Bateria (EXCLUIR JÁ TEM TENSAO DO VEICULO)",
    width: 190,
    defaultVisible: false,
    weight: 1.3,
    group: "battery",
    type: "percent",
  },
  {
    key: "digitalInput2",
    labelPt: "Entrada 2",
    labelPdf: "Entrada 2",
    width: 140,
    defaultVisible: true,
    weight: 1.2,
    group: "input",
    type: "boolean",
  },
  {
    key: "digitalInput4",
    labelPt: "Entrada 4",
    labelPdf: "Entrada 4",
    width: 140,
    defaultVisible: true,
    weight: 1.2,
    group: "input",
    type: "boolean",
  },
  {
    key: "digitalInput5",
    labelPt: "Entrada 5",
    labelPdf: "Entrada 5",
    width: 140,
    defaultVisible: true,
    weight: 1.2,
    group: "input",
    type: "boolean",
  },
  {
    key: "digitalOutput1",
    labelPt: "Saida 1",
    labelPdf: "Saida 1",
    width: 140,
    defaultVisible: true,
    weight: 1.2,
    group: "output",
    type: "boolean",
  },
  {
    key: "digitalOutput2",
    labelPt: "Saida 2",
    labelPdf: "Saida 2",
    width: 140,
    defaultVisible: true,
    weight: 1.2,
    group: "output",
    type: "boolean",
  },
  {
    key: "digitalOutput3",
    labelPt: "Saida 3",
    labelPdf: "Saida 3",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "output",
    type: "boolean",
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
    key: "digitalOutput4",
    labelPt: "Saida 4",
    labelPdf: "Saida 4",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "output",
    type: "boolean",
  },
  {
    key: "digitalOutput5",
    labelPt: "Saida 5",
    labelPdf: "Saida 5",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "output",
    type: "boolean",
  },
  {
    key: "digitalOutput6",
    labelPt: "Saida 6",
    labelPdf: "Saida 6",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "output",
    type: "boolean",
  },
  {
    key: "digitalOutput7",
    labelPt: "Saida 7",
    labelPdf: "Saida 7",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "output",
    type: "boolean",
  },
  {
    key: "digitalOutput8",
    labelPt: "Saida 8",
    labelPdf: "Saida 8",
    width: 140,
    defaultVisible: false,
    weight: 1.2,
    group: "output",
    type: "boolean",
  },
  {
    key: "ioDetails",
    labelPt: "Detalhes IO",
    labelPdf: "Detalhes IO",
    width: 200,
    defaultVisible: false,
    weight: 1.4,
    group: "io",
  },
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

const IOTM_PROTOCOL_KEY = "iotm";
const IOTM_STATUS_EXCLUDED_KEYS = new Set(["devicestatus", "devicestatusevent", "status"]);
const IOTM_LABEL_OVERRIDES = new Map([
  ["freio de mão", "Freio de mão"],
  ["in2", "Entrada 2"],
  ["in4", "Entrada 4"],
  ["in5", "Entrada 5"],
  ["out1", "Saida 1"],
  ["out2", "Saida 2"],
  ["out3", "Saida 3"],
  ["Ativado quando dispositivo has GNSS fix but Satellite count and HDOP is low", "HDOP"],
  [
    "Códigos de Falha do Veículo (DTC) preenchidos durante a geração do pacote de telemetria.",
    "Códigos de Falha do Veículo (DTC)",
  ],
  ["Nome do script 1.", "Nome da Configuração"],
  ["obdOdometer", "Odometro"],
  [
    "Sinal do vehicle barramento CAN to indicar driver seatbelt warning lamp on",
    "CAN - Cinto de Segurança Motorista",
  ],
  ["Sinal do vehicle barramento CAN to indicar headlamp indicator on", "CAN - Farol"],
  ["Sinal do vehicle barramento CAN to indicar high beam light indicator on", "CAN - Farol Alto"],
  ["Sinal do vehicle barramento CAN to indicar motor on", "CAN - Motor"],
  [
    "Sinal do vehicle barramento CAN to indicar passenger seatbelt warning lamp on",
    "CAN - Cinto de Segurança Passageiro",
  ],
  ["Status para indicar se o dispositivo está atualmente dentro da geozona", "Dentro do Itinerário"],
  ["Tensão da bateria interna do dispositivo", "Bateria interna do dispositivo"],
  ["fuelUsed", "Uso de Combustível"],
  ["portaFL", "Porta Motorista"],
  ["portaRL", "Porta Passageiro"],
  ["ioDetails", "Detalhes IO"],
]);
const IOTM_DEFAULT_VISIBILITY = new Map([
  ["devicetime", true],
  ["event", true],
  ["address", true],
  ["ignition", true],
  ["geozoneid", true],
  ["geofence", true],
  ["geozoneinside", true],
  ["geozoneinsideprimary", true],
  ["speed", true],
  ["topspeed", true],
  ["vehiclevoltage", true],
  ["digitalinput2", true],
  ["digitalinput4", true],
  ["digitalinput5", true],
  ["digitaloutput1", true],
  ["digitaloutput2", true],
  ["sensor_dtc", true],
  ["gpstime", false],
  ["satellites", false],
  ["sat", false],
  ["accuracy", false],
  ["distance", false],
  ["totaldistance", false],
  ["servertime", false],
  ["latitude", false],
  ["longitude", false],
  ["direction", false],
  ["handbrake", false],
  ["hdop", false],
  ["devicetemp", false],
  ["digitaloutput3", false],
  ["rssi", false],
  ["odometer", false],
  ["odometro", false],
  ["obdodometer", false],
  ["battery", false],
  ["power", false],
  ["batterylevel", false],
  ["fuelused", false],
  ["motion", false],
  ["firmware", false],
  ["modemfirmware", false],
  ["doorfrontleft", false],
  ["doorfrontright", false],
  ["clutchpedal", false],
  ["driverseatbelt", false],
  ["passengerseatbelt", false],
  ["lowbeam", false],
  ["highbeam", false],
  ["engineworking", false],
  ["iodetails", false],
  ["portafl", false],
  ["portarl", false],
]);

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
    obdodometer: { labelPt: "Odometro", unit: "km", type: "number", group: "sensor" },
    power: { labelPt: "Bateria interna do dispositivo", unit: "V", type: "number", group: "battery" },
    battery: { labelPt: "Bateria interna do dispositivo", unit: "V", type: "number", group: "battery" },
    fuelused: { labelPt: "Uso de Combustível", unit: "L", type: "number", group: "sensor" },
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
    batterylevel: { labelPt: "Bateria (EXCLUIR JÁ TEM TENSAO DO VEICULO)", unit: null, type: "percent", group: "battery" },
    rssi: { labelPt: "Intensidade do Sinal Celular", group: "sensor" },
    status: { labelPt: "Status", group: "other" },
  },
  iotm: {
    in2: { labelPt: "Entrada 2", type: "boolean", group: "input" },
    in4: { labelPt: "Entrada 4", type: "boolean", group: "input" },
    in5: { labelPt: "Entrada 5", type: "boolean", group: "input" },
    out1: { labelPt: "Saida 1", type: "boolean", group: "output" },
    out2: { labelPt: "Saida 2", type: "boolean", group: "output" },
    out3: { labelPt: "Saida 3", type: "boolean", group: "output" },
    portafl: { labelPt: "Porta Motorista", type: "boolean", group: "sensor" },
    portarl: { labelPt: "Porta Passageiro", type: "boolean", group: "sensor" },
    power: { labelPt: "Bateria interna do dispositivo", unit: "V", type: "number", group: "battery" },
    fuelused: { labelPt: "Uso de Combustível", unit: "L", type: "number", group: "sensor" },
    obdodometer: { labelPt: "Odometro", unit: "km", type: "number", group: "sensor" },
    iodetails: { labelPt: "Detalhes IO", group: "io" },
    geofence: { labelPt: "Itinerário", group: "other" },
  },
  gt06: {
    adc1: { labelPt: "Entrada 1", type: "boolean", group: "input" },
    blocked: { labelPt: "Saida 1", type: "boolean", group: "output" },
    type: { labelPt: "Tipo do Evento", group: "other" },
    charge: { labelPt: "Carga Ativa", type: "boolean", group: "battery" },
    batterylevel: { labelPt: "Bateria (EXCLUIR JÁ TEM TENSAO DO VEICULO)", unit: null, type: "percent", group: "battery" },
    rssi: { labelPt: "Intensidade do Sinal Celular", group: "sensor" },
    digitaloutput1: { labelPt: "Saida 1", type: "boolean", group: "output" },
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
    return { labelPt: `Saida ${outputMatch[1]}`, type: "boolean", group: "output" };
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
    return { labelPt: "Bateria interna do dispositivo", unit: "V", type: "number", group: "battery" };
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
  const override =
    column.protocol === IOTM_PROTOCOL_KEY ? IOTM_LABEL_OVERRIDES.get(label) || label : label;
  return withUnit(override, column.unit);
}

export function resolveColumnDefinition(key, { protocol } = {}) {
  if (!key) return null;
  const protocolKey = normalizeProtocolKey(protocol);
  const normalizedKey = normalizeKey(key).toLowerCase();
  if (protocolKey === IOTM_PROTOCOL_KEY && IOTM_STATUS_EXCLUDED_KEYS.has(normalizedKey)) {
    return null;
  }
  const telemetryDescriptor = resolveTelemetryDescriptor(key);
  if (telemetryDescriptor) {
    const base = {
      key,
      labelPt: telemetryDescriptor.labelPt || buildFriendlyLabel(key),
      descriptionPt: telemetryDescriptor.descriptionPt || telemetryDescriptor.description || null,
      type: telemetryDescriptor.type || null,
      unit: telemetryDescriptor.unit || null,
      group: telemetryDescriptor.group || "io",
    };
    if (protocolKey === IOTM_PROTOCOL_KEY) {
      base.protocol = IOTM_PROTOCOL_KEY;
    }
    if (protocolKey === IOTM_PROTOCOL_KEY && IOTM_DEFAULT_VISIBILITY.has(normalizedKey)) {
      return { ...base, defaultVisible: IOTM_DEFAULT_VISIBILITY.get(normalizedKey) };
    }
    return base;
  }
  const catalog = resolveCatalogEntry(key, protocol);
  const base = positionsColumnMap.get(key);
  if (base && catalog) {
    const merged = { ...base, ...catalog, key };
    if (protocolKey === IOTM_PROTOCOL_KEY) {
      merged.protocol = IOTM_PROTOCOL_KEY;
    }
    if (protocolKey === IOTM_PROTOCOL_KEY && IOTM_DEFAULT_VISIBILITY.has(normalizedKey)) {
      return { ...merged, defaultVisible: IOTM_DEFAULT_VISIBILITY.get(normalizedKey) };
    }
    return merged;
  }
  if (base) {
    const resolvedBase = protocolKey === IOTM_PROTOCOL_KEY ? { ...base, protocol: IOTM_PROTOCOL_KEY } : base;
    if (protocolKey === IOTM_PROTOCOL_KEY && IOTM_DEFAULT_VISIBILITY.has(normalizedKey)) {
      return { ...resolvedBase, defaultVisible: IOTM_DEFAULT_VISIBILITY.get(normalizedKey) };
    }
    return resolvedBase;
  }
  const voltagePattern = resolveVoltagePattern(key);
  if (voltagePattern) {
    const resolved = { key, ...voltagePattern };
    if (protocolKey === IOTM_PROTOCOL_KEY) {
      resolved.protocol = IOTM_PROTOCOL_KEY;
    }
    if (protocolKey === IOTM_PROTOCOL_KEY && IOTM_DEFAULT_VISIBILITY.has(normalizedKey)) {
      return { ...resolved, defaultVisible: IOTM_DEFAULT_VISIBILITY.get(normalizedKey) };
    }
    return resolved;
  }
  const pattern = resolveIoPattern(key);
  if (pattern) {
    const resolved = { key, ...pattern };
    if (protocolKey === IOTM_PROTOCOL_KEY) {
      resolved.protocol = IOTM_PROTOCOL_KEY;
    }
    if (protocolKey === IOTM_PROTOCOL_KEY && IOTM_DEFAULT_VISIBILITY.has(normalizedKey)) {
      return { ...resolved, defaultVisible: IOTM_DEFAULT_VISIBILITY.get(normalizedKey) };
    }
    return resolved;
  }
  if (catalog) {
    const resolved = { key, ...catalog };
    if (protocolKey === IOTM_PROTOCOL_KEY) {
      resolved.protocol = IOTM_PROTOCOL_KEY;
    }
    if (protocolKey === IOTM_PROTOCOL_KEY && IOTM_DEFAULT_VISIBILITY.has(normalizedKey)) {
      return { ...resolved, defaultVisible: IOTM_DEFAULT_VISIBILITY.get(normalizedKey) };
    }
    return resolved;
  }
  const fallback = {
    key,
    labelPt: buildFriendlyLabel(key),
    group: "other",
  };
  if (protocolKey === IOTM_PROTOCOL_KEY) {
    fallback.protocol = IOTM_PROTOCOL_KEY;
  }
  if (protocolKey === IOTM_PROTOCOL_KEY && IOTM_DEFAULT_VISIBILITY.has(normalizedKey)) {
    return { ...fallback, defaultVisible: IOTM_DEFAULT_VISIBILITY.get(normalizedKey) };
  }
  return fallback;
}

export function resolveColumnGroupOrder(group) {
  return COLUMN_GROUP_ORDER[group] ?? COLUMN_GROUP_ORDER.other;
}
