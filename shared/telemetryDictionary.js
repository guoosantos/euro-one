import { iotmEventCatalog } from "./iotmEventCatalog.js";
import iotmIoCatalog from "./iotmIoCatalog.pt-BR.json" assert { type: "json" };
import iotmDiagnosticCatalog from "./iotmDiagnosticEventCatalog.pt-BR.json" assert { type: "json" };

const BASE_TELEMETRY_ATTRIBUTES = [
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

const IOTM_IO_ENTRIES = (iotmIoCatalog || [])
  .filter((entry) => entry && entry.key && entry.labelPt)
  .map((entry) => ({
    key: entry.key,
    labelPt: entry.labelPt,
    type: entry.type || null,
    unit: entry.unit || null,
    priority: entry.priority ?? 250,
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

export const telemetryAliases = { ...BASE_TELEMETRY_ALIASES, ...IOTM_TELEMETRY_ALIASES };

const BASE_IO_FRIENDLY_NAMES = {
  io157: { key: "handBrake", labelPt: "Freio de Mão", type: "boolean" },
  io19: { key: "signalIn5", labelPt: "Entrada 5", type: "boolean" },
  io16: { key: "signalIn2", labelPt: "Entrada 2", type: "boolean" },
  io18: { key: "signalIn4", labelPt: "Entrada 4", type: "boolean" },
  io148: { key: "digitalOutput1", labelPt: "Saída 1", type: "boolean" },
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

const IOTM_IO_FRIENDLY_NAMES = [...(iotmIoCatalog || []), ...IOTM_SENSOR_RANGE_ENTRIES]
  .filter((entry) => entry && entry.id !== undefined && entry.id !== null && entry.labelPt)
  .reduce((acc, entry) => {
    const id = String(entry.id).trim();
    if (!id) return acc;
    acc[`io${id}`.toLowerCase()] = {
      key: entry.key || `iotmIo${id}`,
      labelPt: entry.labelPt,
      type: entry.type || null,
      unit: entry.unit || null,
    };
    return acc;
  }, {});

export const ioFriendlyNames = { ...BASE_IO_FRIENDLY_NAMES, ...IOTM_IO_FRIENDLY_NAMES };

const DEFAULT_EVENT_CODE_MAP = new Map([
  ["3", { key: "ignitionOn", labelPt: "Ignição ligada" }],
  ["4", { key: "ignitionOff", labelPt: "Ignição desligada" }],
  ["21", { key: "gpsJamming", labelPt: "Interferência GPS" }],
  ["69", { key: "gsmJamming", labelPt: "Interferência GSM" }],
  ["70", { key: "jamming", labelPt: "Interferência detectada" }],
  ["98", { key: "doorFrontLeft", labelPt: "Porta dianteira esquerda" }],
  ["100", { key: "doorRearRight", labelPt: "Porta traseira direita" }],
  ["133", { key: "driverSeatbelt", labelPt: "Cinto motorista" }],
  ["134", { key: "passengerSeatbelt", labelPt: "Cinto passageiro" }],
  ["136", { key: "lowBeam", labelPt: "Farol baixo" }],
  ["137", { key: "highBeam", labelPt: "Farol alto" }],
  ["139", { key: "handBrake", labelPt: "Freio de mão" }],
  ["141", { key: "engineWorking", labelPt: "Motor em funcionamento" }],
  ["145", { key: "gsmJamming", labelPt: "Interferência GSM" }],
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

const IOTM_DIAGNOSTIC_CODE_MAP = new Map(
  (iotmDiagnosticCatalog || []).map((item) => [
    String(item.id).toLowerCase(),
    { key: `iotm_diag_${item.id}`, labelPt: item.labelPt, severity: item.severity, description: item.description },
  ]),
);

function resolveDiagnosticTemplate(code) {
  const normalized = String(code || "").trim().toLowerCase();
  if (!normalized) return null;
  const matchRegister = normalized.match(/^f(2[0-7])=(.+)$/);
  if (matchRegister) {
    const register = matchRegister[1];
    const value = matchRegister[2];
    const registerMap = {
      "20": "Bits 24-31 do registro de falhas",
      "21": "Bits 16-23 do registro de falhas",
      "22": "Bits 8-15 do registro de falhas",
      "23": "Bits 0-7 do registro de falhas",
      "24": "Bits 24-31 do registro PC",
      "25": "Bits 16-23 do registro PC",
      "26": "Bits 8-15 do registro PC",
      "27": "Bits 0-7 do registro PC",
    };
    const label = registerMap[register];
    if (label) {
      return { key: `iotm_diag_f${register}`, labelPt: `${label}: ${value}`, severity: "info" };
    }
  }
  const matchApn = normalized.match(/^f200=(.+)$/);
  if (matchApn) {
    return {
      key: "iotm_diag_f200",
      labelPt: `APN índice ${matchApn[1]}`,
      severity: "info",
    };
  }
  const matchScript = normalized.match(/^f(\\d+)=([0-9]+)$/);
  if (matchScript) {
    const funId = Number(matchScript[1]);
    const warId = matchScript[2];
    if (funId >= 140 && funId < 145) {
      return { key: `iotm_diag_f${funId}`, labelPt: `Evento de script (${funId}): ${warId}`, severity: "warning" };
    }
  }
  const matchPowerTime = normalized.match(/^f(240|250)\\+?source=(\\d+)$/);
  if (matchPowerTime) {
    const kind = matchPowerTime[1] === "240" ? "atrasada" : "adiantada";
    const seconds = matchPowerTime[2];
    return {
      key: `iotm_diag_f${matchPowerTime[1]}`,
      labelPt: `Hora do sistema ${kind}: ${seconds}s`,
      severity: "warning",
    };
  }
  const matchTacho = normalized.match(/^f104=(\\d+)$/);
  if (matchTacho) {
    return {
      key: "iotm_diag_f104",
      labelPt: `Tacógrafo digital: evento ${matchTacho[1]}`,
      severity: "info",
    };
  }
  const matchTachoExt = normalized.match(/^f11([6-9])=(\\d+)$/);
  if (matchTachoExt) {
    const group = Number(matchTachoExt[1]);
    const offsetMap = { 6: "1-8", 7: "9-16", 8: "17-24", 9: "25-30" };
    const range = offsetMap[group];
    if (range) {
      return {
        key: `iotm_diag_f11${group}`,
        labelPt: `Tacógrafo: parâmetros estendidos ${range} (${matchTachoExt[2]})`,
        severity: "info",
      };
    }
  }
  const matchSpecial = normalized.match(/^f106=(.+)$/);
  if (matchSpecial) {
    return {
      key: "iotm_diag_f106",
      labelPt: `Sequência especial de eventos: ${matchSpecial[1]}`,
      severity: "info",
    };
  }
  const matchTachoData = normalized.match(/^f12([1-9])=(\\d+)$/);
  if (matchTachoData) {
    return {
      key: `iotm_diag_f12${matchTachoData[1]}`,
      labelPt: `Tacógrafo: byte de dados ${matchTachoData[1]} (${matchTachoData[2]})`,
      severity: "info",
    };
  }
  const matchTachoError = normalized.match(/^f12(8|9)=(\\d+)$/);
  if (matchTachoError) {
    const kind = matchTachoError[1] === "8" ? "subtipo" : "tipo";
    return {
      key: `iotm_diag_f12${matchTachoError[1]}`,
      labelPt: `Tacógrafo: erro ${kind} ${matchTachoError[2]}`,
      severity: "warning",
    };
  }
  const matchFlashSub = normalized.match(/^f112=(\\d+)$/);
  if (matchFlashSub) {
    return {
      key: "iotm_diag_f112",
      labelPt: `Apagamento de subseção flash (1h): ${matchFlashSub[1]}`,
      severity: "info",
    };
  }
  const matchFlashSector = normalized.match(/^f113=(\\d+)$/);
  if (matchFlashSector) {
    return {
      key: "iotm_diag_f113",
      labelPt: `Apagamento de setor flash (1h): ${matchFlashSector[1]}`,
      severity: "info",
    };
  }
  const matchFileOps = normalized.match(/^f17([4-9])=(.+)$/);
  if (matchFileOps) {
    return {
      key: `iotm_diag_f17${matchFileOps[1]}`,
      labelPt: `Tacógrafo: operação ${matchFileOps[1]} (${matchFileOps[2]})`,
      severity: "info",
    };
  }
  const matchScriptDetail = normalized.match(/^f(14\\d)=(\\d+)$/);
  if (matchScriptDetail) {
    return {
      key: `iotm_diag_f${matchScriptDetail[1]}`,
      labelPt: `Script: evento ${matchScriptDetail[2]}`,
      severity: "warning",
    };
  }
  const matchCanbase = normalized.match(/^f180\\+?source=(\\d+)$/);
  if (matchCanbase) {
    return {
      key: "iotm_diag_f180",
      labelPt: `CAN base: evento de origem ${matchCanbase[1]}`,
      severity: "warning",
    };
  }
  const matchF130 = normalized.match(/^f130=(\\d+)$/);
  if (matchF130) {
    const id = matchF130[1];
    if (["252", "253", "254", "255"].includes(id)) return null;
    return { key: "iotm_diag_f130", labelPt: `Sensor Cargojot ${id}`, severity: "info" };
  }
  return null;
}

function normalizeProtocolKey(protocol) {
  return String(protocol || "").trim().toLowerCase();
}

export function resolveTelemetryDescriptor(key) {
  if (TELEMETRY_DESCRIPTOR_MAP.has(key)) return TELEMETRY_DESCRIPTOR_MAP.get(key);
  if (ioFriendlyNames[key]) return { ...ioFriendlyNames[key], key };
  if (/^\\d+$/.test(String(key))) {
    return { key: `iotmSensor${key}`, labelPt: `Sensor ${key}`, type: null, unit: null };
  }
  return null;
}

export function resolveEventDescriptor(code, { protocol } = {}) {
  if (code === undefined || code === null) return null;
  const normalized = String(code).trim();
  if (!normalized) return null;
  const protocolKey = normalizeProtocolKey(protocol);
  if (protocolKey === "iotm") {
    const diagnostic =
      IOTM_DIAGNOSTIC_CODE_MAP.get(normalized.toLowerCase()) || resolveDiagnosticTemplate(normalized);
    if (diagnostic) return diagnostic;
    return IOTM_EVENT_CODE_MAP.get(normalized) || DEFAULT_EVENT_CODE_MAP.get(normalized) || null;
  }
  if (protocolKey === "gt06") {
    return GT06_EVENT_CODE_MAP.get(normalized) || DEFAULT_EVENT_CODE_MAP.get(normalized) || null;
  }
  return DEFAULT_EVENT_CODE_MAP.get(normalized) || null;
}
