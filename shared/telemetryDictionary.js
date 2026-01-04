export const telemetryAttributeCatalog = [
  {
    key: "vehicleVoltage",
    labelPt: "Tensão do Veículo (V)",
    type: "number",
    unit: "V",
    priority: 30,
  },
  {
    key: "batteryLevel",
    labelPt: "Nível de Bateria (%)",
    type: "number",
    unit: "%",
    priority: 40,
  },
  {
    key: "battery",
    labelPt: "Bateria (V)",
    type: "number",
    unit: "V",
    priority: 45,
  },
  {
    key: "power",
    labelPt: "Tensão do Veículo (V)",
    type: "number",
    unit: "V",
    priority: 50,
  },
  {
    key: "deviceTemp",
    labelPt: "Temperatura do Dispositivo (°C)",
    type: "number",
    unit: "°C",
    priority: 120,
  },
  {
    key: "handBrake",
    labelPt: "Freio de Mão",
    type: "boolean",
    unit: null,
    priority: 140,
  },
  {
    key: "fuelUsed",
    labelPt: "Combustível Usado",
    type: "number",
    unit: "L",
    priority: 160,
  },
  {
    key: "acceleration",
    labelPt: "Aceleração",
    type: "number",
    unit: "m/s²",
    priority: 170,
  },
  {
    key: "obdOdometer",
    labelPt: "Odômetro OBD",
    type: "number",
    unit: "km",
    priority: 180,
  },
  {
    key: "hours",
    labelPt: "Horas de Motor",
    type: "number",
    unit: "h",
    priority: 190,
  },
  {
    key: "rssi",
    labelPt: "RSSI / Sinal",
    type: "number",
    unit: null,
    priority: 200,
  },
  {
    key: "sat",
    labelPt: "Satélites",
    type: "number",
    unit: null,
    priority: 210,
  },
  {
    key: "hdop",
    labelPt: "HDOP",
    type: "number",
    unit: null,
    priority: 220,
  },
];

const TELEMETRY_DESCRIPTOR_MAP = new Map(telemetryAttributeCatalog.map((item) => [item.key, item]));

export const telemetryAliases = {
  handbrake: "handBrake",
  devicetemp: "deviceTemp",
  blocked: "digitalOutput1",
};

export const ioFriendlyNames = {
  io157: { key: "handBrake", labelPt: "Freio de Mão", type: "boolean" },
};

export function resolveTelemetryDescriptor(key) {
  if (TELEMETRY_DESCRIPTOR_MAP.has(key)) return TELEMETRY_DESCRIPTOR_MAP.get(key);
  if (ioFriendlyNames[key]) return { ...ioFriendlyNames[key], key };
  return null;
}
