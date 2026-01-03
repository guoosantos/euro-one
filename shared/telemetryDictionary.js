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
