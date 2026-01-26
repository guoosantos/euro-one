import { useCallback, useMemo } from "react";

import { useTenant } from "../tenant-context.jsx";

const PERMISSION_LEVELS = new Set(["none", "view", "read", "full"]);
const DEFAULT_LEVEL = "none";
const UI_LEVELS = {
  none: "NO_ACCESS",
  read: "READ_ONLY",
  full: "FULL",
};

function normaliseLevel(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "view") return "read";
  return PERMISSION_LEVELS.has(normalized) ? normalized : null;
}

function normalizeEntry(value) {
  if (typeof value === "string") {
    const level = normaliseLevel(value) || DEFAULT_LEVEL;
    if (level === "none") return { visible: false, access: null };
    return { visible: true, access: level === "full" ? "full" : "read" };
  }
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "visible")) {
      const visible = Boolean(value.visible);
      if (!visible) {
        return { visible: false, access: null };
      }
      const normalizedAccess = normaliseLevel(value.access);
      if (normalizedAccess === "none") {
        return { visible: true, access: "none" };
      }
      const access = normalizedAccess || "read";
      return { visible: true, access };
    }
    const legacyLevel = normaliseLevel(value?.level) || DEFAULT_LEVEL;
    if (legacyLevel === "none") return { visible: false, access: null };
    return { visible: true, access: legacyLevel === "full" ? "full" : "read" };
  }
  return { visible: false, access: null };
}

export function resolvePermissionEntry(permissions, menuKey, pageKey, subKey) {
  if (!permissions || !menuKey || !pageKey) return { visible: false, access: null };

  const menuPermissions = permissions?.[menuKey] || {};
  const pagePermission = menuPermissions?.[pageKey];

  if (subKey) {
    if (pagePermission && typeof pagePermission === "object") {
      const subpages = pagePermission?.subpages || {};
      const subValue = subpages?.[subKey];
      const baseEntry = normalizeEntry(pagePermission);
      if (subValue !== undefined) {
        const subEntry = normalizeEntry(subValue);
        if (!baseEntry.visible) {
          return { visible: false, access: null };
        }
        return subEntry;
      }
      return baseEntry.visible ? baseEntry : { visible: false, access: null };
    }
    const legacy = normalizeEntry(pagePermission);
    return legacy;
  }

  return normalizeEntry(pagePermission);
}

function toUiLevel(access) {
  return UI_LEVELS[access] || UI_LEVELS.none;
}

export function createPermissionResolver({ useTenantHook = useTenant } = {}) {
  return function usePermissionResolver() {
    const { role, permissionContext, permissionLoading } = useTenantHook();
    const context = permissionContext ?? { permissions: null, isFull: true, permissionGroupId: null };
    const loading = Boolean(permissionLoading);

    const getPermission = useCallback(
      ({ menuKey, pageKey, subKey }) => {
        if (role === "admin" || context.isFull) {
          return {
            level: UI_LEVELS.full,
            hasAccess: true,
            canShow: true,
            canView: true,
            canRead: true,
            isFull: true,
          };
        }
        if (!context.permissions) {
          return {
            level: UI_LEVELS.none,
            hasAccess: false,
            canShow: false,
            canView: false,
            canRead: false,
            isFull: false,
          };
        }

        if (loading) {
          return {
            level: UI_LEVELS.none,
            hasAccess: false,
            canShow: false,
            canView: false,
            canRead: false,
            isFull: false,
            loading: true,
          };
        }

        const entry = resolvePermissionEntry(context.permissions, menuKey, pageKey, subKey);
        const rawLevel = entry.visible
          ? entry.access === "full"
            ? "full"
            : entry.access === "none"
              ? "none"
              : "read"
          : "none";
        const level = toUiLevel(rawLevel);
        const hasAccess = entry.visible && entry.access !== "none" && entry.access !== null;
        return {
          level,
          hasAccess,
          canShow: entry.visible,
          canView: hasAccess,
          canRead: hasAccess,
          isFull: level === UI_LEVELS.full,
        };
      },
      [context, loading, role],
    );

    return useMemo(
      () => ({
        getPermission,
        loading,
        permissionGroupId: context.permissionGroupId,
      }),
      [getPermission, loading, context.permissionGroupId],
    );
  };
}

export const usePermissionResolver = createPermissionResolver();

export function usePermissionGate({ menuKey, pageKey, subKey }) {
  const { getPermission, loading } = usePermissionResolver();
  const permission = getPermission({ menuKey, pageKey, subKey });
  return { ...permission, loading };
}

export function usePermissions() {
  const { getPermission, loading } = usePermissionResolver();
  const canShow = useCallback(
    (permissionOrMenuKey, pageKey, subKey) => {
      if (!permissionOrMenuKey) return true;
      if (typeof permissionOrMenuKey === "string") {
        return getPermission({ menuKey: permissionOrMenuKey, pageKey, subKey }).canShow;
      }
      return getPermission(permissionOrMenuKey).canShow;
    },
    [getPermission],
  );
  const canAccess = useCallback(
    (permissionOrMenuKey, pageKey, subKey) => {
      if (!permissionOrMenuKey) return true;
      if (typeof permissionOrMenuKey === "string") {
        return getPermission({ menuKey: permissionOrMenuKey, pageKey, subKey }).hasAccess;
      }
      return getPermission(permissionOrMenuKey).hasAccess;
    },
    [getPermission],
  );

  return useMemo(
    () => ({
      getPermission,
      canShow,
      canAccess,
      loading,
    }),
    [canAccess, canShow, getPermission, loading],
  );
}

export default usePermissionGate;
