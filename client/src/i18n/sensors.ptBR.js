import xirgoSensors from "../../../xirgo_sensors_ID_Name_Description_ptBR.json" with { type: "json" };

const SENSOR_LABEL_OVERRIDES = {
  SENSOR_ARMED: "CAN: Alarme armado",
  SENSOR_LOCKED: "CAN: Portas travadas",
  SENSOR_DOORS_F_L: "CAN: Porta dianteira esquerda",
  SENSOR_DOORS_F_R: "CAN: Porta dianteira direita",
  SENSOR_DOORS_R_L: "CAN: Porta traseira esquerda",
  SENSOR_DOORS_R_R: "CAN: Porta traseira direita",
  SENSOR_BONNET: "CAN: Capô aberto",
  SENSOR_TRUNK: "CAN: Porta-malas aberto",
  SENSOR_FACTORY_ALARM: "CAN: Alarme de fábrica",
  SENSOR_IGNITION: "CAN: Ignição ligada",
  SENSOR_HEADLIGHT_INDICATOR: "CAN: Farol baixo",
  SENSOR_HIGH_BEAM_LIGHT_INDICATOR: "CAN: Farol alto",
  SENSOR_PARKING_LIGHT_INDICATOR: "CAN: Luz de posição",
  SENSOR_DRIVER_SEATBELT_WARNING: "CAN: Cinto motorista",
  SENSOR_PASSENGER_SEATBELT_WARNING: "CAN: Cinto passageiro",
  SENSOR_ENGINE_WORKING: "CAN: Motor ligado",
  SENSOR_HANDBRAKE: "CAN: Freio de mão",
  SENSOR_FOOT_BRAKE: "CAN: Freio de pé",
  SENSOR_KEY_INSERTED: "CAN: Chave inserida",
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
  [/driver seatbelt/gi, "cinto motorista"],
  [/passenger seatbelt/gi, "cinto passageiro"],
  [/engine on/gi, "motor ligado"],
  [/ignition on/gi, "ignição ligada"],
  [/handbrake/gi, "freio de mão"],
  [/footbrake/gi, "freio de pé"],
];

const truncateLabel = (value, maxLength = 42) => {
  if (!value) return value;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
};

export const normalizeSensorLabel = (label, name) => {
  const trimmed = String(label || "").trim();
  const nameKey = String(name || "").trim().toUpperCase();
  if (SENSOR_LABEL_OVERRIDES[nameKey]) return SENSOR_LABEL_OVERRIDES[nameKey];

  let cleaned = trimmed;
  cleaned = cleaned.replace(/Sinal do vehicle barramento CAN\s*to\s*indicar\s*/i, "CAN: ");
  cleaned = cleaned.replace(/Signal from vehicle CAN bus to indicate\s*/i, "CAN: ");
  cleaned = cleaned.replace(/indicator on$/i, "");
  cleaned = cleaned.replace(/warning lamp on$/i, "");

  SENSOR_LABEL_REPLACEMENTS.forEach(([regex, replacement]) => {
    cleaned = cleaned.replace(regex, replacement);
  });

  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (!cleaned) return trimmed;
  return truncateLabel(cleaned);
};

const byId = new Map(
  (xirgoSensors || [])
    .filter((entry) => entry && entry.ID !== undefined && entry.ID !== null)
    .map((entry) => [String(entry.ID), entry]),
);

const byName = new Map(
  (xirgoSensors || [])
    .filter((entry) => entry && entry.Name)
    .map((entry) => [String(entry.Name).trim().toUpperCase(), entry]),
);

const normalizeLookupKey = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_");

export const resolveSensorLabel = ({ id, name, key } = {}) => {
  const idKey = id !== null && id !== undefined ? String(id) : null;
  const nameKey = name ? normalizeLookupKey(name) : null;
  const keyName = key ? normalizeLookupKey(key) : null;

  const entry =
    (idKey && byId.get(idKey)) ||
    (nameKey && byName.get(nameKey)) ||
    (keyName && byName.get(keyName)) ||
    null;

  if (!entry) {
    return normalizeSensorLabel(key || name || "", name || key);
  }

  const baseLabel = entry.Description_ptBR || entry.Description || entry.Name || "";
  return normalizeSensorLabel(baseLabel, entry.Name);
};

export const sensorLabelsPtBR = new Map(
  (xirgoSensors || [])
    .filter((entry) => entry && entry.ID !== undefined && entry.ID !== null)
    .map((entry) => [String(entry.ID), resolveSensorLabel({ id: entry.ID, name: entry.Name })]),
);

export default sensorLabelsPtBR;
