import { iotmEventCatalog } from "./iotmEventCatalog.js";

export const telemetryAttributeCatalog = [
  { key: "engineWorking", labelPt: "Motor em funcionamento", type: "boolean", unit: null, priority: 15 },
  { key: "ignitionState", labelPt: "Ignição", type: "boolean", unit: null, priority: 16 },
  { key: "vehicleVoltage", labelPt: "Tensão do Veículo (V)", type: "number", unit: "V", priority: 30 },
  { key: "batteryLevel", labelPt: "Nível de Bateria (%)", type: "number", unit: "%", priority: 40 },
  { key: "battery", labelPt: "Bateria (V)", type: "number", unit: "V", priority: 45 },
  { key: "batteryCharge", labelPt: "Carga da Bateria", type: "boolean", unit: null, priority: 46 },
  { key: "vcc", labelPt: "Alimentação (VCC)", type: "number", unit: "V", priority: 47 },
  { key: "vbat", labelPt: "Bateria Veicular (VBAT)", type: "number", unit: "V", priority: 47 },
  { key: "power", labelPt: "Tensão do Veículo (V)", type: "number", unit: "V", priority: 50 },
  { key: "signalIn2", labelPt: "Entrada 2", type: "boolean", unit: null, priority: 60 },
  { key: "signalIn4", labelPt: "Entrada 4", type: "boolean", unit: null, priority: 61 },
  { key: "signalIn5", labelPt: "Entrada 5", type: "boolean", unit: null, priority: 62 },
  { key: "deviceTemp", labelPt: "Temperatura do Dispositivo (°C)", type: "number", unit: "°C", priority: 120 },
  { key: "handBrake", labelPt: "Freio de Mão", type: "boolean", unit: null, priority: 140 },
  { key: "clutchPedal", labelPt: "Pedal da Embreagem", type: "boolean", unit: null, priority: 141 },
  { key: "highBeam", labelPt: "Farol Alto", type: "boolean", unit: null, priority: 142 },
  { key: "lowBeam", labelPt: "Farol Baixo", type: "boolean", unit: null, priority: 143 },
  { key: "driverSeatbelt", labelPt: "Cinto Motorista", type: "boolean", unit: null, priority: 144 },
  { key: "passengerSeatbelt", labelPt: "Cinto Passageiro", type: "boolean", unit: null, priority: 145 },
  { key: "fuelUsed", labelPt: "Combustível Usado", type: "number", unit: "L", priority: 160 },
  { key: "fuelUsedHighRes", labelPt: "Combustível Usado (Alta Res.)", type: "number", unit: "L", priority: 161 },
  { key: "fuelLevel1", labelPt: "Nível de Combustível 1", type: "number", unit: "%", priority: 162 },
  { key: "fuelLevel2", labelPt: "Nível de Combustível 2", type: "number", unit: "%", priority: 163 },
  { key: "fuelRate", labelPt: "Taxa de Combustível", type: "number", unit: "L/h", priority: 162 },
  { key: "fuelInstant", labelPt: "Combustível Instantâneo", type: "number", unit: "L", priority: 163 },
  { key: "fuelInstantHighRes", labelPt: "Combustível Instantâneo (Alta Res.)", type: "number", unit: "L", priority: 164 },
  { key: "acceleration", labelPt: "Aceleração", type: "number", unit: "m/s²", priority: 170 },
  { key: "wiperMode", labelPt: "Modo do Limpador", type: "string", unit: null, priority: 171 },
  { key: "obdOdometer", labelPt: "Odômetro OBD", type: "number", unit: "km", priority: 180 },
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
  { key: "geozoneId", labelPt: "Geozona", type: "string", unit: null, priority: 193 },
  { key: "geozoneInside", labelPt: "Dentro da Geozona", type: "boolean", unit: null, priority: 194 },
  { key: "geozoneInsidePrimary", labelPt: "Geozona Principal (Dentro)", type: "boolean", unit: null, priority: 195 },
  { key: "receivedCan", labelPt: "Quadros CAN Recebidos", type: "number", unit: null, priority: 196 },
  { key: "rssi", labelPt: "RSSI / Sinal", type: "number", unit: null, priority: 200 },
  { key: "sat", labelPt: "Satélites", type: "number", unit: null, priority: 210 },
  { key: "hdop", labelPt: "HDOP", type: "number", unit: null, priority: 220 },
  { key: "doorFrontLeft", labelPt: "Porta Dianteira Esquerda", type: "boolean", unit: null, priority: 230 },
  { key: "doorFrontRight", labelPt: "Porta Dianteira Direita", type: "boolean", unit: null, priority: 231 },
  { key: "doorRearLeft", labelPt: "Porta Traseira Esquerda", type: "boolean", unit: null, priority: 232 },
  { key: "doorRearRight", labelPt: "Porta Traseira Direita", type: "boolean", unit: null, priority: 233 },
  { key: "slot1Distance", labelPt: "Distância Slot 1", type: "number", unit: "km", priority: 234 },
  { key: "slot2Distance", labelPt: "Distância Slot 2", type: "number", unit: "km", priority: 235 },
  { key: "temperature", labelPt: "Temperatura", type: "number", unit: "°C", priority: 240 },
];

const TELEMETRY_DESCRIPTOR_MAP = new Map(telemetryAttributeCatalog.map((item) => [item.key, item]));

export const telemetryAliases = {
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

export const ioFriendlyNames = {
  io157: { key: "handBrake", labelPt: "Freio de Mão", type: "boolean" },
  io19: { key: "signalIn5", labelPt: "Entrada 5", type: "boolean" },
  io16: { key: "signalIn2", labelPt: "Entrada 2", type: "boolean" },
  io18: { key: "signalIn4", labelPt: "Entrada 4", type: "boolean" },
  io148: { key: "digitalOutput1", labelPt: "Saída 1 (Bloqueio)", type: "boolean" },
  io139: { key: "handBrake", labelPt: "Freio de Mão", type: "boolean" },
  io141: { key: "engineWorking", labelPt: "Motor em funcionamento", type: "boolean" },
  io136: { key: "lowBeam", labelPt: "Farol Baixo", type: "boolean" },
  io137: { key: "highBeam", labelPt: "Farol Alto", type: "boolean" },
  io98: { key: "doorFrontLeft", labelPt: "Porta Dianteira Esquerda", type: "boolean" },
  io100: { key: "doorRearRight", labelPt: "Porta Traseira Direita", type: "boolean" },
  io133: { key: "driverSeatbelt", labelPt: "Cinto Motorista", type: "boolean" },
  io134: { key: "passengerSeatbelt", labelPt: "Cinto Passageiro", type: "boolean" },
  io109: { key: "ignitionState", labelPt: "Ignição", type: "boolean" },
};

const DEFAULT_EVENT_CODE_MAP = new Map([
  ["3", { key: "ignitionOn", labelPt: "Ignição ligada" }],
  ["4", { key: "ignitionOff", labelPt: "Ignição desligada" }],
  ["21", { key: "gpsJamming", labelPt: "GPS Jamming" }],
  ["69", { key: "gsmJamming", labelPt: "GSM Jamming" }],
  ["70", { key: "jamming", labelPt: "Jamming detectado" }],
  ["98", { key: "doorFrontLeft", labelPt: "Porta dianteira esquerda" }],
  ["100", { key: "doorRearRight", labelPt: "Porta traseira direita" }],
  ["133", { key: "driverSeatbelt", labelPt: "Cinto motorista" }],
  ["134", { key: "passengerSeatbelt", labelPt: "Cinto passageiro" }],
  ["136", { key: "lowBeam", labelPt: "Farol baixo" }],
  ["137", { key: "highBeam", labelPt: "Farol alto" }],
  ["139", { key: "handBrake", labelPt: "Freio de mão" }],
  ["141", { key: "engineWorking", labelPt: "Motor em funcionamento" }],
  ["145", { key: "gsmJamming", labelPt: "GSM Jamming" }],
  ["158", { key: "engineEvent", labelPt: "Evento do motor" }],
  ["255", { key: "generic", labelPt: "Evento do dispositivo" }],
]);

const GT06_EVENT_CODE_MAP = new Map([
  ...DEFAULT_EVENT_CODE_MAP,
  ["0", { key: "generic", labelPt: "Evento do dispositivo" }],
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
  if (TELEMETRY_DESCRIPTOR_MAP.has(key)) return TELEMETRY_DESCRIPTOR_MAP.get(key);
  if (ioFriendlyNames[key]) return { ...ioFriendlyNames[key], key };
  return null;
}

export function resolveEventDescriptor(code, { protocol } = {}) {
  if (code === undefined || code === null) return null;
  const normalized = String(code).trim();
  if (!normalized) return null;
  const protocolKey = normalizeProtocolKey(protocol);
  if (protocolKey === "iotm") {
    return IOTM_EVENT_CODE_MAP.get(normalized) || DEFAULT_EVENT_CODE_MAP.get(normalized) || null;
  }
  if (protocolKey === "gt06") {
    return GT06_EVENT_CODE_MAP.get(normalized) || DEFAULT_EVENT_CODE_MAP.get(normalized) || null;
  }
  return DEFAULT_EVENT_CODE_MAP.get(normalized) || null;
}
