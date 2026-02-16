function normalizeTechnicianText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectTechnicianAliasValues(user) {
  const attributes = user?.attributes && typeof user.attributes === "object" ? user.attributes : {};
  return [user?.name, attributes.technicianName, attributes.displayName, attributes.fullName]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

export function resolveTechnicianAliases(user, { normalized = false } = {}) {
  const aliases = collectTechnicianAliasValues(user);
  const mapped = normalized
    ? aliases.map((entry) => normalizeTechnicianText(entry))
    : aliases.map((entry) => entry.trim());
  return Array.from(new Set(mapped.filter(Boolean)));
}

export function createTechnicianNameMatcher(user) {
  if (!user || user.role !== "technician") return null;

  const aliases = resolveTechnicianAliases(user, { normalized: true });
  if (!aliases.length) {
    return () => false;
  }

  const aliasSet = new Set(aliases);
  return (technicianName) => aliasSet.has(normalizeTechnicianText(technicianName));
}

export default createTechnicianNameMatcher;
