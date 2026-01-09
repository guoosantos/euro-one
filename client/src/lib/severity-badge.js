const SEVERITY_BADGE_CLASSES = {
  info: "border-white/50 bg-white text-slate-900",
  warning: "border-purple-400/70 bg-purple-500/30 text-purple-50",
  low: "border-emerald-400/70 bg-emerald-500/30 text-emerald-50",
  medium: "border-amber-400/70 bg-amber-500/30 text-amber-50",
  high: "border-orange-400/70 bg-orange-500/30 text-orange-50",
  critical: "border-red-400/70 bg-red-500/30 text-red-50",
};

const SEVERITY_LABELS = {
  info: "Informativa",
  warning: "Alerta",
  low: "Baixa",
  medium: "Moderada",
  high: "Alta",
  critical: "Crítica",
};

export function normalizeSeverityToken(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "info";
  if (["informativa", "info"].includes(normalized)) return "info";
  if (["alerta", "warning"].includes(normalized)) return "warning";
  if (["critica", "crítica", "critical"].includes(normalized)) return "critical";
  if (["alta", "high"].includes(normalized)) return "high";
  if (["moderada", "media", "média", "medium", "moderate"].includes(normalized)) return "medium";
  if (["baixa", "low"].includes(normalized)) return "low";
  return normalized;
}

export function getSeverityBadgeClassName(value) {
  const token = normalizeSeverityToken(value);
  return SEVERITY_BADGE_CLASSES[token] || SEVERITY_BADGE_CLASSES.info;
}

export function resolveSeverityLabel(value) {
  const token = normalizeSeverityToken(value);
  return SEVERITY_LABELS[token] || String(value || "—");
}
