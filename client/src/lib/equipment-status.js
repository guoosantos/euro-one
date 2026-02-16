export const EQUIPMENT_STATUS_VALUES = Object.freeze([
  "HABILITADO",
  "DESABILITADO",
  "ESTOQUE NOVO",
  "ESTOQUE USADO",
  "RETIRADO COM O TÉCNICO",
  "DEFEITO",
]);

const EQUIPMENT_STATUS_BY_TOKEN = Object.freeze({
  HABILITADO: "HABILITADO",
  DESABILITADO: "DESABILITADO",
  "ESTOQUE NOVO": "ESTOQUE NOVO",
  "ESTOQUE USADO": "ESTOQUE USADO",
  "RETIRADO COM O TECNICO": "RETIRADO COM O TÉCNICO",
  DEFEITO: "DEFEITO",
});

const DEFAULT_STATUS = "ESTOQUE NOVO";

function normalizeToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function normalizeEquipmentStatusValue(value, { fallback = DEFAULT_STATUS } = {}) {
  const normalized = EQUIPMENT_STATUS_BY_TOKEN[normalizeToken(value)] || null;
  if (normalized) return normalized;
  return EQUIPMENT_STATUS_BY_TOKEN[normalizeToken(fallback)] || DEFAULT_STATUS;
}

export const EQUIPMENT_STATUS_OPTIONS = Object.freeze(
  EQUIPMENT_STATUS_VALUES.map((value) => ({ value, label: value })),
);
