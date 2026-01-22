const ADMIN_GENERAL_NAMES = new Set(["EURO ONE", "EURO ST"]);

export function normalizeAdminClientName(name) {
  const normalized = String(name || "").trim();
  if (!normalized) return "";
  if (ADMIN_GENERAL_NAMES.has(normalized.toUpperCase())) {
    return "EURO ONE";
  }
  return normalized;
}

export function isAdminGeneralClientName(name) {
  const normalized = normalizeAdminClientName(name);
  return normalized.toUpperCase() === "EURO ONE";
}

export function isAdminGeneralClient(client) {
  return isAdminGeneralClientName(client?.name);
}
