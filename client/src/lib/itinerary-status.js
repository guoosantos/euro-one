const STATUS_TRANSLATIONS = {
  CONFIRMED: { upper: "CONFIRMADO", title: "Confirmado" },
  EMBARKED_CONFIRMED: { upper: "CONFIRMADO", title: "Confirmado" },
  EMBARKED: { upper: "EMBARCADO", title: "Embarcado" },
  DISEMBARKED: { upper: "DESEMBARCADO", title: "Desembarcado" },
  DISEMBARK: { upper: "DESEMBARCADO", title: "Desembarcado" },
  CONCLUDED: { upper: "CONCLUÍDO", title: "Concluído" },
  DEPLOYED: { upper: "CONCLUÍDO", title: "Concluído" },
  OK: { upper: "EMBARCADO", title: "Embarcado" },
  PENDING: { upper: "PENDENTE", title: "Pendente" },
  FAILED: { upper: "FALHOU", title: "Falhou" },
  ERROR: { upper: "ERRO", title: "Erro" },
  CANCELED: { upper: "CANCELADO", title: "Cancelado" },
  CANCELLED: { upper: "CANCELADO", title: "Cancelado" },
  FINISHED: { upper: "FINALIZADO", title: "Finalizado" },
  NONE: { upper: "SEM STATUS", title: "Sem status" },
};

const normalizeStatusText = (value) => String(value ?? "").trim();

const resolveStatusKey = (value) => {
  const normalized = normalizeStatusText(value);
  if (!normalized) return null;
  const upper = normalized.toUpperCase();
  if (STATUS_TRANSLATIONS[upper]) return upper;
  if (upper.includes("DISEMBARK") || upper.includes("DESEMBARC")) return "DISEMBARKED";
  if (upper.includes("EMBARK") || upper.includes("EMBARC")) return "EMBARKED";
  if (upper.includes("CONFIRM")) return "CONFIRMED";
  if (upper.includes("CONCLU")) return "CONCLUDED";
  if (upper.includes("FINALIZ")) return "FINISHED";
  if (upper.includes("CANCEL")) return "CANCELED";
  if (upper.includes("PEND")) return "PENDING";
  if (upper.includes("FALH")) return "FAILED";
  if (upper.includes("ERRO")) return "ERROR";
  return null;
};

export function translateItineraryStatusLabel(value, { style = "upper", fallback = "—" } = {}) {
  const normalized = normalizeStatusText(value);
  if (!normalized) return fallback;
  const key = resolveStatusKey(normalized);
  if (!key) {
    return style === "upper" ? normalized.toUpperCase() : normalized;
  }
  const entry = STATUS_TRANSLATIONS[key];
  if (!entry) return style === "upper" ? normalized.toUpperCase() : normalized;
  return entry[style] || entry.upper || entry.title || normalized;
}

export function isDisembarkedActionLabel(value) {
  const normalized = normalizeStatusText(value).toLowerCase();
  return normalized.startsWith("desembarcado");
}

export function isDisembarkedStatus(value) {
  const key = resolveStatusKey(value);
  if (key === "DISEMBARKED") return true;
  const normalized = normalizeStatusText(value).toLowerCase();
  return normalized.includes("desembarc");
}

export function isEmbarkedConfirmedStatus(value) {
  const key = resolveStatusKey(value);
  if (!key) {
    const normalized = normalizeStatusText(value).toUpperCase();
    if (!normalized) return false;
    if (normalized.includes("DESEMBARC")) return false;
    if (normalized.includes("CONCLU") || normalized.includes("CONFIRM") || normalized.includes("EMBARCADO")) return true;
    return false;
  }
  if (key === "DISEMBARKED") return false;
  return ["CONFIRMED", "EMBARKED_CONFIRMED", "CONCLUDED", "DEPLOYED", "EMBARKED"].includes(key);
}

export { STATUS_TRANSLATIONS };
