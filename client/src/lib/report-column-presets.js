import { buildColumnDefaults } from "./column-preferences.js";

export const EURO_PRESET_KEYS = [
  "deviceTime",
  "serverTime",
  "event",
  ["eventSeverity", "criticality"],
  "address",
  ["geofence", "geozoneId", "geozoneid"],
  ["geozoneinside", "geozoneInside", "geozoneInsidePrimary"],
  "ignition",
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
  if (!resolvedPresetKeys.length && availableKeys.length) {
    const fallbackKeys = ["event", "deviceTime", "address"];
    fallbackKeys.forEach((key) => {
      if (availableSet.has(key) && !preset.has(key)) {
        preset.add(key);
        resolvedPresetKeys.push(key);
      }
    });
    if (!resolvedPresetKeys.length) {
      resolvedPresetKeys.push(...availableKeys.slice(0, 3));
      resolvedPresetKeys.forEach((key) => preset.add(key));
    }
  }
  const visible = Object.fromEntries(availableKeys.map((key) => [key, preset.has(key)]));
  const order = [
    ...resolvedPresetKeys,
    ...availableKeys.filter((key) => !preset.has(key)),
  ];
  return { ...defaults, visible, order };
}
