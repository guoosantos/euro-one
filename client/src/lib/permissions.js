import { resolvePermissionEntry } from "./permissions/permission-gate.js";
import { buildMenuAccessContext, canShowMenuItem } from "./permissions/menu-access.js";

function normalizePermissionInput(moduleKey, pageKey, subKey) {
  if (!moduleKey) return null;
  if (typeof moduleKey === "object") return moduleKey;
  if (typeof moduleKey !== "string") return null;
  return {
    menuKey: moduleKey,
    pageKey: pageKey ?? null,
    subKey: subKey ?? null,
  };
}

export function resolvePermissionAccess(permission, { user, permissionContext, isGlobalAdmin } = {}) {
  if (!permission) {
    return {
      canShow: true,
      hasAccess: true,
      isFull: true,
      entry: { visible: true, access: "full" },
    };
  }

  const context = permissionContext ?? { permissions: null, isFull: false, permissionGroupId: null };
  const isAdmin = Boolean(isGlobalAdmin || user?.role === "admin");
  if (isGlobalAdmin) {
    return {
      canShow: true,
      hasAccess: true,
      isFull: true,
      entry: { visible: true, access: "full" },
    };
  }
  if (isAdmin && permission?.menuKey === "admin") {
    return {
      canShow: true,
      hasAccess: true,
      isFull: true,
      entry: { visible: true, access: "full" },
    };
  }
  const adminHasScopedPermissions = isAdmin && Boolean(context.permissionGroupId);
  if ((isAdmin && !adminHasScopedPermissions) || context.isFull) {
    return {
      canShow: true,
      hasAccess: true,
      isFull: true,
      entry: { visible: true, access: "full" },
    };
  }
  if (!context.permissions) {
    return {
      canShow: false,
      hasAccess: false,
      isFull: false,
      entry: { visible: false, access: null },
    };
  }

  const entry = resolvePermissionEntry(
    context.permissions,
    permission.menuKey,
    permission.pageKey,
    permission.subKey,
  );
  const canShow = Boolean(entry.visible);
  const hasAccess = Boolean(entry.visible && entry.access && entry.access !== "none");
  const isFull = entry.access === "full";
  return { canShow, hasAccess, isFull, entry };
}

export function resolvePermissionDecision(
  moduleKey,
  {
    user,
    tenant,
    permissionContext,
    isGlobalAdmin,
    permissionsReady = true,
    readOnly = false,
    menuAccessContext,
    pageKey,
    subKey,
  } = {},
) {
  const permission = normalizePermissionInput(moduleKey, pageKey, subKey);
  if (!permission) {
    const ready = Boolean(permissionsReady);
    const isFull = !readOnly;
    return {
      ready,
      allowedByTenant: true,
      canShow: true,
      hasAccess: true,
      isFull,
      requireFull: false,
      allowed: ready,
      readOnly: Boolean(readOnly),
    };
  }

  const ready = Boolean(permissionsReady);
  const accessContext = menuAccessContext ?? buildMenuAccessContext({ tenant, user, isGlobalAdmin });
  const allowedByTenant = canShowMenuItem({ permission, context: accessContext });
  const access = resolvePermissionAccess(permission, { user, permissionContext, isGlobalAdmin });
  const requireFull = Boolean(permission.requireFull);
  const effectiveIsFull = access.isFull && !readOnly;
  const allowed = ready && allowedByTenant && access.hasAccess && (!requireFull || effectiveIsFull);
  return {
    ready,
    allowedByTenant,
    requireFull,
    allowed,
    ...access,
    isFull: effectiveIsFull,
    readOnly: Boolean(readOnly),
  };
}

export function canAccess(moduleKey, options = {}) {
  return resolvePermissionDecision(moduleKey, options).allowed;
}

export default canAccess;
