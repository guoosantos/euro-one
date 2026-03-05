import createError from "http-errors";

export const TRUST_CENTER_PERMISSIONS = Object.freeze({
  VIEW: "trust_center.view",
  AUDIT_VIEW: "trust_center.audit_view",
  MANAGE_COUNTER_KEY: "trust_center.manage_counter_key",
});

const ALL_TRUST_CENTER_PERMISSIONS = new Set(Object.values(TRUST_CENTER_PERMISSIONS));

function normalizeToken(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

function parseArrayPermissions(source, set) {
  if (!Array.isArray(source)) return;
  source.forEach((entry) => {
    const token = normalizeToken(entry);
    if (token && ALL_TRUST_CENTER_PERMISSIONS.has(token)) {
      set.add(token);
    }
  });
}

function parseObjectPermissions(source, set) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return;
  Object.entries(source).forEach(([key, value]) => {
    if (value !== true) return;
    const token = normalizeToken(`trust_center.${key}`);
    if (token && ALL_TRUST_CENTER_PERMISSIONS.has(token)) {
      set.add(token);
    }
  });
}

function resolveRoleFallbackPermissions(role) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (["admin", "tenant_admin", "manager"].includes(normalizedRole)) {
    return new Set(ALL_TRUST_CENTER_PERMISSIONS);
  }
  if (normalizedRole === "user") {
    return new Set([TRUST_CENTER_PERMISSIONS.VIEW]);
  }
  return new Set();
}

export function resolveTrustCenterPermissionSet(user) {
  const resolved = resolveRoleFallbackPermissions(user?.role);
  const attributes = user?.attributes && typeof user.attributes === "object" ? user.attributes : {};

  parseArrayPermissions(attributes.trustCenterPermissions, resolved);
  parseArrayPermissions(attributes.trust_center_permissions, resolved);

  const permissionBag = attributes.permissions && typeof attributes.permissions === "object"
    ? attributes.permissions
    : {};

  parseArrayPermissions(permissionBag.trustCenter, resolved);
  parseArrayPermissions(permissionBag.trust_center, resolved);
  parseObjectPermissions(permissionBag.trustCenterFlags, resolved);
  parseObjectPermissions(permissionBag.trust_center_flags, resolved);

  return resolved;
}

export function hasTrustCenterPermission(user, permission) {
  const required = normalizeToken(permission);
  if (!required || !ALL_TRUST_CENTER_PERMISSIONS.has(required)) {
    return false;
  }
  return resolveTrustCenterPermissionSet(user).has(required);
}

export function authorizeTrustCenter(permission) {
  const required = normalizeToken(permission);

  return (req, _res, next) => {
    try {
      if (!req.user) {
        throw createError(401, "Sessão não autenticada");
      }

      if (!required || !ALL_TRUST_CENTER_PERMISSIONS.has(required)) {
        throw createError(500, "Permissão Trust Center inválida");
      }

      if (!hasTrustCenterPermission(req.user, required)) {
        throw createError(403, "Sem permissão para acessar o Trust Center");
      }

      req.trustCenterPermissions = resolveTrustCenterPermissionSet(req.user);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function getTrustCenterPermissionPayload(user) {
  const set = resolveTrustCenterPermissionSet(user);
  return {
    [TRUST_CENTER_PERMISSIONS.VIEW]: set.has(TRUST_CENTER_PERMISSIONS.VIEW),
    [TRUST_CENTER_PERMISSIONS.AUDIT_VIEW]: set.has(TRUST_CENTER_PERMISSIONS.AUDIT_VIEW),
    [TRUST_CENTER_PERMISSIONS.MANAGE_COUNTER_KEY]: set.has(TRUST_CENTER_PERMISSIONS.MANAGE_COUNTER_KEY),
  };
}

export default {
  TRUST_CENTER_PERMISSIONS,
  resolveTrustCenterPermissionSet,
  hasTrustCenterPermission,
  authorizeTrustCenter,
  getTrustCenterPermissionPayload,
};
