import { buildColumnDefaults } from "./column-preferences.js";

export const EURO_PRESET_KEYS = [
  "gpsTime",
  "event",
  "address",
  "speed",
  "direction",
  "vehicleState",
  "ignition",
  "vehicleVoltage",
  "batteryLevel",
  "distance",
  "totalDistance",
  "ioDetails",
  "geozoneInside",
  "geozoneId",
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
