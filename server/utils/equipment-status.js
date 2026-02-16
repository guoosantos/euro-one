export const EQUIPMENT_STATUS_VALUES = Object.freeze([
  "HABILITADO",
  "DESABILITADO",
  "ESTOQUE NOVO",
  "ESTOQUE USADO",
  "RETIRADO COM O TÉCNICO",
  "DEFEITO",
]);

export const DEFAULT_EQUIPMENT_STATUS_LINKED = "HABILITADO";
export const DEFAULT_EQUIPMENT_STATUS_UNLINKED = "ESTOQUE NOVO";
export const UNLINKED_EQUIPMENT_STATUS = "ESTOQUE USADO";

const EQUIPMENT_STATUS_CANONICAL_BY_TOKEN = Object.freeze({
  HABILITADO: "HABILITADO",
  DESABILITADO: "DESABILITADO",
  "ESTOQUE NOVO": "ESTOQUE NOVO",
  "ESTOQUE USADO": "ESTOQUE USADO",
  "RETIRADO COM O TECNICO": "RETIRADO COM O TÉCNICO",
  DEFEITO: "DEFEITO",
});

function normalizeStatusToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function toCanonicalEquipmentStatus(value) {
  const token = normalizeStatusToken(value);
  if (!token) return null;
  return EQUIPMENT_STATUS_CANONICAL_BY_TOKEN[token] || null;
}

export function isKnownEquipmentStatus(value) {
  return Boolean(toCanonicalEquipmentStatus(value));
}

export function resolveDefaultEquipmentStatus({ linked = false } = {}) {
  return linked ? DEFAULT_EQUIPMENT_STATUS_LINKED : DEFAULT_EQUIPMENT_STATUS_UNLINKED;
}

export function normalizeEquipmentStatus(value, { linked = false } = {}) {
  return toCanonicalEquipmentStatus(value) || resolveDefaultEquipmentStatus({ linked });
}
