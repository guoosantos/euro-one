import { buildColumnDefaults } from "./column-preferences.js";

export const EURO_PRESET_KEYS = [
  "deviceTime",
  "serverTime",
  "event",
  ["eventSeverity", "criticality"],
  "address",
  "ignition",
  ["geofence", "geozoneId"],
  "geozoneInside",
  ["input2", "digitalInput2", "signalIn2", "in2"],
  ["input4", "digitalInput4", "signalIn4", "in4"],
  "speed",
  "vehicleVoltage",
];

export function buildColumnPreset(columns = [], presetKeys = EURO_PRESET_KEYS) {
  const defaults = buildColumnDefaults(columns);
  const availableKeys = Array.isArray(columns) ? columns.map((column) => column.key) : [];
  const availableSet = new Set(availableKeys);
  const resolvedPresetKeys = [];
  const preset = new Set();
  presetKeys.forEach((entry) => {
    const candidates = Array.isArray(entry) ? entry : [entry];
    const resolved = candidates.find((key) => availableSet.has(key));
    if (resolved && !preset.has(resolved)) {
      preset.add(resolved);
      resolvedPresetKeys.push(resolved);
    }
  });
  const visible = Object.fromEntries(availableKeys.map((key) => [key, preset.has(key)]));
  const order = [
    ...resolvedPresetKeys,
    ...availableKeys.filter((key) => !preset.has(key)),
  ];
  return { ...defaults, visible, order };
}
