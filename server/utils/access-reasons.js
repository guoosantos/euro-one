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

export function isAccessReason(value) {
  return Boolean(normalizeAccessReason(value));
}

export function resolveAccessReason(value) {
  if (!value) return null;
  if (typeof value === "string") return normalizeAccessReason(value);
  const direct = normalizeAccessReason(value.reason);
  if (direct) return direct;
  const nested = normalizeAccessReason(value?.response?.data?.reason || value?.data?.reason);
  if (nested) return nested;
  const payloadReason = normalizeAccessReason(value?.response?.data?.error?.reason);
  if (payloadReason) return payloadReason;
  return null;
}

export default ACCESS_REASONS;
