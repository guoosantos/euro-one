import createError from "http-errors";

const VIEW_ROLES = new Set(["admin", "tenant_admin", "manager"]);
const AUDIT_ROLES = new Set(["admin", "tenant_admin", "manager"]);
const MANAGE_ROLES = new Set(["admin", "tenant_admin"]);

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function pushCodes(target, value) {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach((entry) => pushCodes(target, entry));
    return;
  }
  if (typeof value === "string") {
    value
      .split(/[\s,;|]+/)
      .map((entry) => normalizeCode(entry))
      .filter(Boolean)
      .forEach((entry) => target.add(entry));
    return;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([key, enabled]) => {
      if (enabled === false || enabled === "false" || enabled === 0 || enabled === "0") return;
      const code = normalizeCode(key);
      if (code) target.add(code);
    });
  }
}

function extractTrustCenterCodes(user) {
  const attributes = user?.attributes && typeof user.attributes === "object" ? user.attributes : {};
  const codes = new Set();
  pushCodes(codes, user?.permissionCodes);
  pushCodes(codes, attributes.permissionCodes);
  pushCodes(codes, attributes.permissionsCodes);
  pushCodes(codes, attributes.trustCenterPermissions);
  pushCodes(codes, attributes.permissions?.trust_center);
  pushCodes(codes, attributes.permissions?.trustCenter);
  return codes;
}

export function hasTrustCenterPermission(req, code) {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) return false;

  const role = normalizeCode(req?.user?.role);
  if (role === "admin") return true;

  const codes = extractTrustCenterCodes(req?.user);
  return codes.has(normalizedCode);
}

export function canViewTrustCenter(req) {
  const role = normalizeCode(req?.user?.role);
  if (VIEW_ROLES.has(role)) return true;
  return hasTrustCenterPermission(req, "trust_center.view");
}

export function canViewTrustCenterAudit(req) {
  const role = normalizeCode(req?.user?.role);
  if (AUDIT_ROLES.has(role)) return true;
  return hasTrustCenterPermission(req, "trust_center.audit_view") || hasTrustCenterPermission(req, "trust_center.view");
}

export function canManageTrustCenterCounterKey(req) {
  const role = normalizeCode(req?.user?.role);
  if (MANAGE_ROLES.has(role)) return true;
  return hasTrustCenterPermission(req, "trust_center.manage_counter_key");
}

export function requireTrustCenterView(req, _res, next) {
  if (canViewTrustCenter(req)) return next();
  return next(createError(403, "Permissão trust_center.view é obrigatória"));
}

export function requireTrustCenterAuditView(req, _res, next) {
  if (canViewTrustCenterAudit(req)) return next();
  return next(createError(403, "Permissão trust_center.audit_view é obrigatória"));
}

export function requireTrustCenterManage(req, _res, next) {
  if (canManageTrustCenterCounterKey(req)) return next();
  return next(createError(403, "Permissão trust_center.manage_counter_key é obrigatória"));
}

export default {
  hasTrustCenterPermission,
  canViewTrustCenter,
  canViewTrustCenterAudit,
  canManageTrustCenterCounterKey,
  requireTrustCenterView,
  requireTrustCenterAuditView,
  requireTrustCenterManage,
};
