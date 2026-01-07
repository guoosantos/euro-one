import { buildColumnDefaults } from "./column-preferences.js";

export const EURO_PRESET_KEYS = [
  "deviceTime",
  "event",
  "address",
  "ignition",
  "geozoneId",
  "geozoneInside",
  "speed",
  "topSpeed",
  "vehicleVoltage",
  "digitalInput2",
  "signalIn2",
  "in2",
  "digitalInput4",
  "signalIn4",
  "in4",
  "digitalInput5",
  "signalIn5",
  "in5",
  "digitalOutput1",
  "out1",
  "digitalOutput2",
  "out2",
  "sensor_dtc",
];

export const EURO_IOTM_PRESET_KEYS = [
  "deviceTime",
  "event",
  "address",
  "ignition",
  "geozoneId",
  "geofence",
  "geozoneInside",
  "geozoneInsidePrimary",
  "speed",
  "topSpeed",
  "vehicleVoltage",
  "digitalInput2",
  "digitalInput4",
  "digitalInput5",
  "digitalOutput1",
  "digitalOutput2",
  "sensor_dtc",
];

export function buildColumnPreset(columns = [], presetKeys = EURO_PRESET_KEYS) {
  const defaults = buildColumnDefaults(columns);
  const availableKeys = Array.isArray(columns) ? columns.map((column) => column.key) : [];
  const preset = new Set(presetKeys);
  const visible = Object.fromEntries(availableKeys.map((key) => [key, preset.has(key)]));
  const order = [
    ...presetKeys.filter((key) => availableKeys.includes(key)),
    ...availableKeys.filter((key) => !preset.has(key)),
  ];
  return { ...defaults, visible, order };
}
