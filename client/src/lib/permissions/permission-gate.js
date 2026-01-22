import { useCallback, useMemo } from "react";

import { useTenant } from "../tenant-context.jsx";
import { useGroups } from "../hooks/useGroups.js";

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
      const normalizedAccess = normaliseLevel(value.access);
      if (normalizedAccess === "none") {
        return { visible: false, access: null };
      }
      const access = normalizedAccess || "read";
      return { visible, access: visible ? access : null };
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

export function usePermissionResolver() {
  const { user, role, tenantId } = useTenant();
  const permissionGroupId = user?.attributes?.permissionGroupId || null;
  const shouldLoadGroups = Boolean(permissionGroupId && role !== "admin");
  const { groups, loading } = useGroups({ params: shouldLoadGroups ? { clientId: tenantId } : {}, autoRefreshMs: 0 });

  const permissionGroup = useMemo(() => {
    if (!permissionGroupId) return null;
    const list = Array.isArray(groups) ? groups : [];
    return list.find((group) => String(group.id) === String(permissionGroupId)) || null;
  }, [groups, permissionGroupId]);

  const permissions =
    permissionGroup?.attributes?.permissions && typeof permissionGroup.attributes.permissions === "object"
      ? permissionGroup.attributes.permissions
      : null;

  const getPermission = useCallback(
    ({ menuKey, pageKey, subKey }) => {
      if (role === "admin") {
        return {
          level: UI_LEVELS.full,
          hasAccess: true,
          canShow: true,
          canView: true,
          canRead: true,
          isFull: true,
        };
      }
      if (!permissionGroupId) {
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

      const entry = resolvePermissionEntry(permissions, menuKey, pageKey, subKey);
      const rawLevel = entry.visible ? (entry.access === "full" ? "full" : "read") : "none";
      const level = toUiLevel(rawLevel);
      return {
        level,
        hasAccess: entry.visible,
        canShow: entry.visible,
        canView: entry.visible,
        canRead: entry.visible,
        isFull: level === UI_LEVELS.full,
      };
    },
    [loading, permissionGroupId, permissions, role],
  );

  return useMemo(
    () => ({
      getPermission,
      loading,
      permissionGroup,
    }),
    [getPermission, loading, permissionGroup],
  );
}

export function usePermissionGate({ menuKey, pageKey, subKey }) {
  const { getPermission, loading } = usePermissionResolver();
  const permission = getPermission({ menuKey, pageKey, subKey });
  return { ...permission, loading };
}

export function usePermissions() {
  const { getPermission, loading } = usePermissionResolver();
  const canShow = useCallback(
    (permission) => {
      if (!permission) return true;
      return getPermission(permission).canShow;
    },
    [getPermission],
  );

  return useMemo(
    () => ({
      getPermission,
      canShow,
      loading,
    }),
    [canShow, getPermission, loading],
  );
}

export default usePermissionGate;
