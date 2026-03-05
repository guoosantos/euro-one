function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeRole(value) {
  const role = normalizeText(value);
  if (!role) return "user";
  return role;
}

export function isTechnicianProfile(attributes) {
  if (!attributes || typeof attributes !== "object") return false;
  const candidates = [
    attributes.profile,
    attributes.userProfile,
    attributes.roleProfile,
    attributes.position,
    attributes.jobTitle,
    attributes.function,
    attributes.userType,
    attributes.category,
    attributes.type,
  ];
  return candidates.some((value) => {
    const normalized = normalizeText(value);
    if (!normalized) return false;
    return normalized.includes("tecnico") || normalized.includes("technician");
  });
}

export function resolveEffectiveUserRole(userLike, roleHint = null) {
  const baseRole = normalizeRole(roleHint ?? userLike?.role);
  if (baseRole === "technician") return "technician";
  if (baseRole !== "user") return baseRole;
  if (isTechnicianProfile(userLike?.attributes)) return "technician";
  return "user";
}

