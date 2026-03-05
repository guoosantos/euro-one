export const ACCESS_REASONS = {
  NO_VEHICLES_ASSIGNED: "NO_VEHICLES_ASSIGNED",
  ACCESS_EXPIRED: "ACCESS_EXPIRED",
  USER_BLOCKED: "USER_BLOCKED",
  TENANT_DISABLED: "TENANT_DISABLED",
  FORBIDDEN_SCOPE: "FORBIDDEN_SCOPE",
};

const ACCESS_REASON_SET = new Set(Object.values(ACCESS_REASONS));

export function normalizeAccessReason(value) {
  if (!value) return null;
  const normalized = String(value).trim().toUpperCase();
  return ACCESS_REASON_SET.has(normalized) ? normalized : null;
}

export function resolveAccessReason(source) {
  if (!source) return null;
  if (typeof source === "string") return normalizeAccessReason(source);
  const direct = normalizeAccessReason(source.reason);
  if (direct) return direct;
  const nested = normalizeAccessReason(source?.response?.data?.reason || source?.data?.reason);
  if (nested) return nested;
  return null;
}

export function isAccessReason(value) {
  return Boolean(normalizeAccessReason(value));
}

export function isBlockingAccessReason(value) {
  const reason = normalizeAccessReason(value);
  if (!reason) return false;
  return [
    ACCESS_REASONS.ACCESS_EXPIRED,
    ACCESS_REASONS.USER_BLOCKED,
    ACCESS_REASONS.TENANT_DISABLED,
    ACCESS_REASONS.FORBIDDEN_SCOPE,
  ].includes(reason);
}

export function isNoVehiclesReason(value) {
  return normalizeAccessReason(value) === ACCESS_REASONS.NO_VEHICLES_ASSIGNED;
}

export default ACCESS_REASONS;
