import { iotmEventCatalog } from "./iotmEventCatalog.js";
import iotmIoCatalog from "./iotmIoCatalog.pt-BR.json" with { type: "json" };
import { translateDiagnosticEvent } from "./eventTranslator.js";
import xirgoSensorsCatalog from "./xirgoSensorsCatalog.pt-BR.json" with { type: "json" };

const BASE_TELEMETRY_ATTRIBUTES = [
  { key: "engineWorking", labelPt: "Motor", type: "boolean", unit: null, priority: 15 },
  { key: "ignitionState", labelPt: "Ignição", type: "boolean", unit: null, priority: 16 },
  { key: "vehicleVoltage", labelPt: "Tensão do Veículo (V)", type: "number", unit: "V", priority: 30 },
  { key: "batteryLevel", labelPt: "Nível de Bateria (%)", type: "number", unit: "%", priority: 40 },
  { key: "battery", labelPt: "Bateria Dispositivo (V)", type: "number", unit: "V", priority: 45 },
  { key: "batteryCharge", labelPt: "Carga da Bateria", type: "boolean", unit: null, priority: 46 },
  { key: "vcc", labelPt: "Alimentação (VCC)", type: "number", unit: "V", priority: 47 },
  { key: "vbat", labelPt: "Bateria Veicular (VBAT)", type: "number", unit: "V", priority: 47 },
  { key: "power", labelPt: "Tensão da Alimentação do Dispositivo", type: "number", unit: "V", priority: 50 },
  { key: "signalIn2", labelPt: "Entrada 2", type: "boolean", unit: null, priority: 60 },
  { key: "signalIn4", labelPt: "Entrada 4", type: "boolean", unit: null, priority: 61 },
  { key: "signalIn5", labelPt: "Entrada 5", type: "boolean", unit: null, priority: 62 },
  { key: "motion", labelPt: "Veiculo Movimento", type: "boolean", unit: null, priority: 63 },
  { key: "deviceTemp", labelPt: "Temperatura (°C)", type: "number", unit: "°C", priority: 120 },
  { key: "status", labelPt: "Status", type: "string", unit: null, priority: 121 },
  { key: "handBrake", labelPt: "Freio de Estacionamento", type: "boolean", unit: null, priority: 140 },
  { key: "clutchPedal", labelPt: "Pedal da Embreagem", type: "boolean", unit: null, priority: 141 },
  { key: "highBeam", labelPt: "Farol Alto", type: "boolean", unit: null, priority: 142 },
  { key: "lowBeam", labelPt: "Farol", type: "boolean", unit: null, priority: 143 },
  { key: "driverSeatbelt", labelPt: "Cinto do Motorista", type: "boolean", unit: null, priority: 144 },
  { key: "passengerSeatbelt", labelPt: "Cinto do Passageiro", type: "boolean", unit: null, priority: 145 },
  { key: "fuelUsed", labelPt: "Uso do Combustível", type: "number", unit: "L", priority: 160 },
  { key: "fuelUsedHighRes", labelPt: "Uso do Combustível", type: "number", unit: "L", priority: 161 },
  { key: "fuelLevel1", labelPt: "Nível de Combustível 1", type: "number", unit: "%", priority: 162 },
  { key: "fuelLevel2", labelPt: "Nível de Combustível 2", type: "number", unit: "%", priority: 163 },
  { key: "fuelRate", labelPt: "Taxa de Combustível", type: "number", unit: "L/h", priority: 162 },
  { key: "fuelInstant", labelPt: "Combustível Instantâneo", type: "number", unit: "L", priority: 163 },
  { key: "fuelInstantHighRes", labelPt: "Combustível Instantâneo (Alta Res.)", type: "number", unit: "L", priority: 164 },
  { key: "acceleration", labelPt: "Aceleração", type: "number", unit: "m/s²", priority: 170 },
  { key: "wiperMode", labelPt: "Modo do Limpador", type: "string", unit: null, priority: 171 },
  { key: "obdOdometer", labelPt: "Odometro", type: "number", unit: "km", priority: 180 },
  { key: "tachoOdometer", labelPt: "Odômetro TACO", type: "number", unit: "km", priority: 181 },
  { key: "totalDistanceHighRes", labelPt: "Distância Total (Alta Res.)", type: "number", unit: "km", priority: 182 },
  { key: "wheelSpeed", labelPt: "Velocidade da Roda", type: "number", unit: "km/h", priority: 183 },
  { key: "topSpeed", labelPt: "Velocidade Máxima", type: "number", unit: "km/h", priority: 184 },
  { key: "rpm", labelPt: "RPM", type: "number", unit: "rpm", priority: 185 },
  { key: "throttlePosition", labelPt: "Posição do Acelerador", type: "number", unit: "%", priority: 186 },
  { key: "engineTemperature", labelPt: "Temperatura do Motor", type: "number", unit: "°C", priority: 187 },
  { key: "transmissionTemperature", labelPt: "Temperatura da Transmissão", type: "number", unit: "°C", priority: 188 },
  { key: "rangeKm", labelPt: "Autonomia Estimada", type: "number", unit: "km", priority: 189 },
  { key: "hours", labelPt: "Horas de Motor", type: "number", unit: "h", priority: 190 },
  { key: "totalEngineHours", labelPt: "Horas de Motor Totais", type: "number", unit: "h", priority: 191 },
  { key: "serviceDistance", labelPt: "Distância para Revisão", type: "number", unit: "km", priority: 192 },
  { key: "geozoneId", labelPt: "Itinerário", type: "string", unit: null, priority: 193 },
  { key: "geozoneInside", labelPt: "Dentro do Itinerário", type: "boolean", unit: null, priority: 194 },
  { key: "geozoneInsidePrimary", labelPt: "Dentro do Itinerário", type: "boolean", unit: null, priority: 195 },
  { key: "receivedCan", labelPt: "Quadros CAN Recebidos", type: "number", unit: null, priority: 196 },
  { key: "rssi", labelPt: "Sinal Celular", type: "number", unit: null, priority: 200 },
  { key: "sat", labelPt: "Satélites", type: "number", unit: null, priority: 210 },
  { key: "hdop", labelPt: "Precisão GPS", type: "number", unit: null, priority: 220 },
  { key: "doorFrontLeft", labelPt: "Porta Motorista", type: "boolean", unit: null, priority: 230 },
  { key: "doorFrontRight", labelPt: "Porta Passageiro", type: "boolean", unit: null, priority: 231 },
  { key: "doorRearLeft", labelPt: "Porta Traseira Esquerda", type: "boolean", unit: null, priority: 232 },
  { key: "doorRearRight", labelPt: "Porta Traseira Direita", type: "boolean", unit: null, priority: 233 },
  { key: "slot1Distance", labelPt: "Distância Slot 1", type: "number", unit: "km", priority: 234 },
  { key: "slot2Distance", labelPt: "Distância Slot 2", type: "number", unit: "km", priority: 235 },
  { key: "temperature", labelPt: "Temperatura", type: "number", unit: "°C", priority: 240 },
];

const SENSOR_LABEL_OVERRIDES = {
  SENSOR_ARMED: "CAN – Alarme armado",
  SENSOR_LOCKED: "CAN – Portas travadas",
  SENSOR_DOORS_F_L: "CAN – Porta dianteira esquerda",
  SENSOR_DOORS_F_R: "CAN – Porta dianteira direita",
  SENSOR_DOORS_R_L: "CAN – Porta traseira esquerda",
  SENSOR_DOORS_R_R: "CAN – Porta traseira direita",
  SENSOR_BONNET: "CAN – Capô aberto",
  SENSOR_TRUNK: "CAN – Porta-malas aberto",
  SENSOR_FACTORY_ALARM: "CAN – Alarme de fábrica",
  SENSOR_IGNITION: "CAN – Ignição ligada",
  SENSOR_HEADLIGHT_INDICATOR: "CAN – Farol baixo",
  SENSOR_HIGH_BEAM_LIGHT_INDICATOR: "CAN – Farol alto",
  SENSOR_PARKING_LIGHT_INDICATOR: "CAN – Luz de posição",
  SENSOR_DRIVER_SEATBELT_WARNING: "CAN – Cinto do Motorista",
  SENSOR_PASSENGER_SEATBELT_WARNING: "CAN – Cinto do Passageiro",
  SENSOR_ENGINE_WORKING: "CAN – Motor ligado",
  SENSOR_HANDBRAKE: "CAN – Freio de estacionamento",
  SENSOR_FOOT_BRAKE: "CAN – Freio de pé",
  SENSOR_KEY_INSERTED: "CAN – Chave inserida",
};

const SENSOR_LABEL_REPLACEMENTS = [
  [/front left/gi, "dianteira esquerda"],
  [/front right/gi, "dianteira direita"],
  [/rear left/gi, "traseira esquerda"],
  [/rear right/gi, "traseira direita"],
  [/doors?/gi, "porta"],
  [/bonnet/gi, "capô"],
  [/trunk/gi, "porta-malas"],
  [/headlamp/gi, "farol baixo"],
  [/high beam/gi, "farol alto"],
  [/parking light/gi, "luz de posição"],
  [/driver seatbelt/gi, "cinto do motorista"],
  [/passenger seatbelt/gi, "cinto do passageiro"],
  [/engine on/gi, "motor ligado"],
  [/ignition on/gi, "ignição ligada"],
  [/handbrake/gi, "freio de estacionamento"],
  [/footbrake/gi, "freio de pé"],
];

const truncateLabel = (value, maxLength = 42) => {
  if (!value) return value;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
};

const normalizeSensorLabel = (label, name) => {
  const trimmed = String(label || "").trim();
  const nameKey = String(name || "").trim().toUpperCase();
  if (SENSOR_LABEL_OVERRIDES[nameKey]) return SENSOR_LABEL_OVERRIDES[nameKey];

  let cleaned = trimmed;
  cleaned = cleaned.replace(/Sinal do vehicle barramento CAN\\s*to\\s*indicar\\s*/i, "CAN – ");
  cleaned = cleaned.replace(/Signal from vehicle CAN bus to indicate\\s*/i, "CAN – ");
  cleaned = cleaned.replace(/indicator on$/i, "");
  cleaned = cleaned.replace(/warning lamp on$/i, "");

  SENSOR_LABEL_REPLACEMENTS.forEach(([regex, replacement]) => {
    cleaned = cleaned.replace(regex, replacement);
  });

  cleaned = cleaned.replace(/\\s+/g, " ").trim();
  if (!cleaned) return trimmed;
  return truncateLabel(cleaned);
};

const IOTM_IO_ENTRIES = (iotmIoCatalog || [])
  .filter((entry) => entry && entry.key && entry.labelPt)
  .map((entry) => ({
    key: entry.key,
    labelPt: normalizeSensorLabel(entry.labelPt, entry.name || entry.key),
    type: entry.type || null,
    unit: entry.unit || null,
    priority: entry.priority ?? 250,
    id: entry.id ?? null,
  }));

const XIRGO_SENSOR_ENTRIES = (xirgoSensorsCatalog || [])
  .filter((entry) => entry && entry.key && entry.labelPt)
  .map((entry) => ({
    key: entry.key,
    labelPt: normalizeSensorLabel(entry.labelPt, entry.name || entry.key),
    descriptionPt: entry.descriptionPt || entry.description || null,
    type: entry.type || null,
    unit: entry.unit || null,
    priority: 270,
    id: entry.id ?? null,
  }));

const buildUserDefinedRange = ({ baseId, count, indexOffset = 0, keyPrefix, labelPrefix, type }) =>
  Array.from({ length: count }, (_, index) => ({
    id: baseId + index,
    key: `${keyPrefix}${index + indexOffset}`,
    labelPt: `${labelPrefix} ${index + indexOffset}`,
    type,
    unit: null,
    priority: 260,
  }));

const IOTM_SENSOR_RANGE_ENTRIES = [
  ...buildUserDefinedRange({
    baseId: 31,
    count: 65,
    keyPrefix: "iotmBoolUserDefined",
    labelPrefix: "Sensor booleano definido pelo usuário",
    type: "boolean",
  }),
  ...buildUserDefinedRange({
    baseId: 112,
    count: 4,
    indexOffset: 65,
    keyPrefix: "iotmBoolUserDefined",
    labelPrefix: "Sensor booleano definido pelo usuário",
    type: "boolean",
  }),
  ...buildUserDefinedRange({
    baseId: 8203,
    count: 22,
    keyPrefix: "iotmU8UserDefined",
    labelPrefix: "Sensor U8 definido pelo usuário",
    type: "number",
  }),
  ...buildUserDefinedRange({
    baseId: 12301,
    count: 16,
    keyPrefix: "iotmU16UserDefined",
    labelPrefix: "Sensor U16 definido pelo usuário",
    type: "number",
  }),
  ...buildUserDefinedRange({
    baseId: 16389,
    count: 80,
    keyPrefix: "iotmU32UserDefined",
    labelPrefix: "Sensor U32 definido pelo usuário",
    type: "number",
  }),
  ...buildUserDefinedRange({
    baseId: 20481,
    count: 3,
    keyPrefix: "iotmU64UserDefined",
    labelPrefix: "Sensor U64 definido pelo usuário",
    type: "number",
  }),
  ...buildUserDefinedRange({
    baseId: 24576,
    count: 10,
    keyPrefix: "iotmS8UserDefined",
    labelPrefix: "Sensor S8 definido pelo usuário",
    type: "number",
  }),
  ...buildUserDefinedRange({
    baseId: 28676,
    count: 10,
    keyPrefix: "iotmS16UserDefined",
    labelPrefix: "Sensor S16 definido pelo usuário",
    type: "number",
  }),
  ...buildUserDefinedRange({
    baseId: 32768,
    count: 10,
    keyPrefix: "iotmS32UserDefined",
    labelPrefix: "Sensor S32 definido pelo usuário",
    type: "number",
  }),
  ...buildUserDefinedRange({
    baseId: 40963,
    count: 20,
    keyPrefix: "iotmF32UserDefined",
    labelPrefix: "Sensor F32 definido pelo usuário",
    type: "number",
  }),
];

export const telemetryAttributeCatalog = [
  ...BASE_TELEMETRY_ATTRIBUTES,
  ...IOTM_IO_ENTRIES.filter((entry) => !BASE_TELEMETRY_ATTRIBUTES.some((base) => base.key === entry.key)),
  ...IOTM_SENSOR_RANGE_ENTRIES.filter(
    (entry) => !BASE_TELEMETRY_ATTRIBUTES.some((base) => base.key === entry.key),
  ),
  ...XIRGO_SENSOR_ENTRIES.filter((entry) => !BASE_TELEMETRY_ATTRIBUTES.some((base) => base.key === entry.key)),
];

const TELEMETRY_DESCRIPTOR_MAP = new Map(telemetryAttributeCatalog.map((item) => [item.key, item]));

const BASE_TELEMETRY_ALIASES = {
  handbrake: "handBrake",
  devicetemp: "deviceTemp",
  blocked: "digitalOutput1",
  "3": "ignitionState",
  "4": "ignitionState",
  "6": "geozoneInside",
  "16": "signalIn2",
  "18": "signalIn4",
  "19": "signalIn5",
  "25": "geozoneInsidePrimary",
  "98": "doorFrontLeft",
  "100": "doorRearRight",
  "109": "ignitionState",
  "133": "driverSeatbelt",
  "134": "passengerSeatbelt",
  "136": "lowBeam",
  "137": "highBeam",
  "139": "handBrake",
  "141": "engineWorking",
  "148": "digitalOutput1",
  "157": "clutchPedal",
  "8236": "geozoneId",
  "8197": "gsmPower",
  "8198": "throttlePosition",
  "8199": "fuelLevel1",
  "8200": "engineTemperature",
  "8201": "fuelLevel2",
  "8226": "topSpeed",
  "8253": "wiperMode",
  "8257": "batteryCharge",
  "12288": "vcc",
  "12292": "vbat",
  "12300": "rpm",
  "12317": "wheelSpeed",
  "12321": "fuelRate",
  "12340": "instantFuelEconomy",
  "12342": "transmissionTemperature",
  "12344": "serviceDistance",
  "12346": "rangeKm",
  "16385": "fuelUsed",
  "16386": "totalEngineHours",
  "16387": "obdOdometer",
  "16470": "receivedCan",
  "16474": "fuelInstantHighRes",
  "16475": "tachoOdometer",
  "16478": "slot1Distance",
  "16479": "slot2Distance",
  "16482": "totalDistanceHighRes",
  "40960": "temperature",
  "40961": "acceleration",
  "40987": "fuelInstant",
  "45058": "distance",
};

const IOTM_TELEMETRY_ALIASES = [...(iotmIoCatalog || []), ...IOTM_SENSOR_RANGE_ENTRIES]
  .filter((entry) => entry && entry.key && entry.id !== undefined && entry.id !== null)
  .reduce((acc, entry) => {
    const id = String(entry.id).trim();
    if (!id || acc[id]) return acc;
    acc[id] = entry.key;
    return acc;
  }, {});

const XIRGO_TELEMETRY_ALIASES = (xirgoSensorsCatalog || [])
  .filter((entry) => entry && entry.key && entry.id !== undefined && entry.id !== null)
  .reduce((acc, entry) => {
    const id = String(entry.id).trim();
    if (!id || acc[id]) return acc;
    acc[id] = entry.key;
    return acc;
  }, {});

export const telemetryAliases = { ...BASE_TELEMETRY_ALIASES, ...IOTM_TELEMETRY_ALIASES, ...XIRGO_TELEMETRY_ALIASES };

const BASE_IO_FRIENDLY_NAMES = {
  io157: { key: "handBrake", labelPt: "Freio de Estacionamento", type: "boolean" },
  io19: { key: "signalIn5", labelPt: "Entrada 5", type: "boolean" },
  io16: { key: "signalIn2", labelPt: "Entrada 2", type: "boolean" },
  io18: { key: "signalIn4", labelPt: "Entrada 4", type: "boolean" },
  io148: { key: "digitalOutput1", labelPt: "Saída 1", type: "boolean" },
  io139: { key: "handBrake", labelPt: "Freio de Estacionamento", type: "boolean" },
  io141: { key: "engineWorking", labelPt: "Motor", type: "boolean" },
  io136: { key: "lowBeam", labelPt: "Farol", type: "boolean" },
  io137: { key: "highBeam", labelPt: "Farol Alto", type: "boolean" },
  io98: { key: "doorFrontLeft", labelPt: "Porta Motorista", type: "boolean" },
  io100: { key: "doorRearRight", labelPt: "Porta Traseira Direita", type: "boolean" },
  io133: { key: "driverSeatbelt", labelPt: "Cinto do Motorista", type: "boolean" },
  io134: { key: "passengerSeatbelt", labelPt: "Cinto do Passageiro", type: "boolean" },
  io109: { key: "ignitionState", labelPt: "Ignição", type: "boolean" },
};

const IOTM_IO_FRIENDLY_NAMES = [...(iotmIoCatalog || []), ...IOTM_SENSOR_RANGE_ENTRIES]
  .filter((entry) => entry && entry.id !== undefined && entry.id !== null && entry.labelPt)
  .reduce((acc, entry) => {
    const id = String(entry.id).trim();
    if (!id) return acc;
    acc[`io${id}`.toLowerCase()] = {
      key: entry.key || `iotmIo${id}`,
      labelPt: normalizeSensorLabel(entry.labelPt, entry.name || entry.key),
      type: entry.type || null,
      unit: entry.unit || null,
    };
    return acc;
  }, {});

const XIRGO_IO_FRIENDLY_NAMES = (xirgoSensorsCatalog || [])
  .filter((entry) => entry && entry.id !== undefined && entry.id !== null && entry.labelPt)
  .reduce((acc, entry) => {
    const id = String(entry.id).trim();
    if (!id) return acc;
    acc[`io${id}`.toLowerCase()] = {
      key: entry.key || `xirgoIo${id}`,
      labelPt: normalizeSensorLabel(entry.labelPt, entry.name || entry.key),
      type: entry.type || null,
      unit: entry.unit || null,
    };
    return acc;
  }, {});

export const ioFriendlyNames = { ...BASE_IO_FRIENDLY_NAMES, ...IOTM_IO_FRIENDLY_NAMES, ...XIRGO_IO_FRIENDLY_NAMES };

const DEFAULT_EVENT_CODE_MAP = new Map([
  ["3", { key: "ignitionOn", labelPt: "Ignição ligada" }],
  ["4", { key: "ignitionOff", labelPt: "Ignição desligada" }],
  ["21", { key: "gpsJamming", labelPt: "JAMMER GPS" }],
  ["69", { key: "gsmJamming", labelPt: "JAMMER GSM" }],
  ["70", { key: "jamming", labelPt: "Interferência detectada" }],
  ["98", { key: "doorFrontLeft", labelPt: "Porta dianteira esquerda" }],
  ["100", { key: "doorRearRight", labelPt: "Porta traseira direita" }],
  ["133", { key: "driverSeatbelt", labelPt: "Cinto motorista" }],
  ["134", { key: "passengerSeatbelt", labelPt: "Cinto passageiro" }],
  ["136", { key: "lowBeam", labelPt: "Farol baixo" }],
  ["137", { key: "highBeam", labelPt: "Farol alto" }],
  ["139", { key: "handBrake", labelPt: "Freio de estacionamento" }],
  ["141", { key: "engineWorking", labelPt: "Motor em funcionamento" }],
  ["145", { key: "gsmJamming", labelPt: "JAMMER GSM" }],
  ["158", { key: "engineEvent", labelPt: "Evento do motor" }],
  ["255", { key: "generic", labelPt: "Evento do dispositivo" }],
]);

const GT06_EVENT_CODE_MAP = new Map([
  ...DEFAULT_EVENT_CODE_MAP,
  ["0", { key: "generic", labelPt: "Evento padrão" }],
  ["1", { key: "sos", labelPt: "SOS / Botão de pânico" }],
  ["2", { key: "powerCut", labelPt: "Corte de alimentação" }],
  ["5", { key: "overspeed", labelPt: "Velocidade excedida" }],
  ["6", { key: "lowBattery", labelPt: "Bateria baixa" }],
  ["7", { key: "shock", labelPt: "Alarme de vibração" }],
  ["8", { key: "geofenceEnter", labelPt: "Entrada em geocerca" }],
  ["9", { key: "geofenceExit", labelPt: "Saída de geocerca" }],
]);

const IOTM_EVENT_CODE_MAP = new Map(
  iotmEventCatalog.map((item) => [
    String(item.id),
    { key: `iotm_${item.id}`, labelPt: item.labelPt, severity: item.severity, description: item.description },
  ]),
);

function normalizeProtocolKey(protocol) {
  return String(protocol || "").trim().toLowerCase();
}

export function resolveTelemetryDescriptor(key) {
  if (!key) return null;
  const normalizedKey = String(key).trim();
  if (!normalizedKey) return null;
  const lowerKey = normalizedKey.toLowerCase();
  if (TELEMETRY_DESCRIPTOR_MAP.has(normalizedKey)) return TELEMETRY_DESCRIPTOR_MAP.get(normalizedKey);
  if (TELEMETRY_DESCRIPTOR_MAP.has(lowerKey)) return TELEMETRY_DESCRIPTOR_MAP.get(lowerKey);
  if (ioFriendlyNames[normalizedKey]) return { ...ioFriendlyNames[normalizedKey], key: normalizedKey };
  if (ioFriendlyNames[lowerKey]) return { ...ioFriendlyNames[lowerKey], key: lowerKey };
  if (/^\\d+$/.test(normalizedKey)) {
    return { key: `iotmSensor${normalizedKey}`, labelPt: `Sensor ${normalizedKey}`, type: null, unit: null };
  }
  return null;
}

export function resolveEventDescriptor(code, { protocol, payload } = {}) {
  if (code === undefined || code === null) return null;
  const normalized = String(code).trim();
  if (!normalized) return null;
  const protocolKey = normalizeProtocolKey(protocol);
  if (protocolKey === "iotm") {
    const diagnostic = translateDiagnosticEvent({ payload, rawCode: normalized });
    if (diagnostic?.label_ptBR) {
      return {
        key: diagnostic.raw_code ? `iotm_diag_${diagnostic.raw_code}` : "iotm_diag",
        labelPt: diagnostic.label_ptBR,
        severity: diagnostic.fallback_used ? "warning" : "info",
        isFallback: diagnostic.fallback_used,
      };
    }

    const eventDescriptor = IOTM_EVENT_CODE_MAP.get(normalized);
    if (eventDescriptor) return eventDescriptor;
    const defaultEvent = DEFAULT_EVENT_CODE_MAP.get(normalized);
    if (defaultEvent) return defaultEvent;

    return null;
  }
  if (protocolKey === "gt06") {
    const eventDescriptor = GT06_EVENT_CODE_MAP.get(normalized) || DEFAULT_EVENT_CODE_MAP.get(normalized) || null;
    if (eventDescriptor) return eventDescriptor;
    return null;
  }
  const eventDescriptor = DEFAULT_EVENT_CODE_MAP.get(normalized) || null;
  if (eventDescriptor) return eventDescriptor;
  return null;
}
