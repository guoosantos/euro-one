import { useCallback, useMemo } from "react";

import { useTenant } from "../tenant-context.jsx";
import { useGroups } from "../hooks/useGroups.js";

const PERMISSION_LEVELS = new Set(["none", "view", "full"]);
const DEFAULT_LEVEL = "full";

function normaliseLevel(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return PERMISSION_LEVELS.has(normalized) ? normalized : null;
}

export function resolvePermissionLevel(permissions, menuKey, pageKey, subKey) {
  if (!permissions || !menuKey || !pageKey) return DEFAULT_LEVEL;

  const menuPermissions = permissions?.[menuKey] || {};
  const pagePermission = menuPermissions?.[pageKey];

  if (subKey) {
    if (typeof pagePermission === "string") {
      return normaliseLevel(pagePermission) || DEFAULT_LEVEL;
    }
    const subpages = pagePermission?.subpages || {};
    const subLevel = normaliseLevel(subpages?.[subKey]);
    if (subLevel) return subLevel;
    const baseLevel = normaliseLevel(pagePermission?.level);
    if (baseLevel) return baseLevel;
    return DEFAULT_LEVEL;
  }

  if (typeof pagePermission === "string") {
    return normaliseLevel(pagePermission) || DEFAULT_LEVEL;
  }

  const baseLevel = normaliseLevel(pagePermission?.level);
  return baseLevel || DEFAULT_LEVEL;
}

export function usePermissionResolver() {
  const { user, role, tenantId } = useTenant();
  const permissionGroupId = user?.attributes?.permissionGroupId || null;
  const shouldLoadGroups = Boolean(permissionGroupId && role !== "admin");
  const { groups, loading } = useGroups({ params: shouldLoadGroups ? { clientId: tenantId } : {}, autoRefreshMs: 60_000 });

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
        return { level: "full", hasAccess: true, canView: true, isFull: true };
      }
      if (!permissionGroupId) {
        return { level: DEFAULT_LEVEL, hasAccess: true, canView: true, isFull: true };
      }

      if (loading) {
        return { level: "none", hasAccess: false, canView: false, isFull: false, loading: true };
      }

      const level = resolvePermissionLevel(permissions, menuKey, pageKey, subKey);
      return {
        level,
        hasAccess: level !== "none",
        canView: level !== "none",
        isFull: level === "full",
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

export default usePermissionGate;
