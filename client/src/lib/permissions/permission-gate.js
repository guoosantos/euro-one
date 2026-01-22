import { useCallback, useEffect, useMemo, useState } from "react";

import api from "../api.js";
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

export function usePermissionResolver() {
  const { user, role, tenantId } = useTenant();
  const [permissionContext, setPermissionContext] = useState({
    permissions: null,
    isFull: true,
    permissionGroupId: null,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadPermissionContext() {
      if (!user) {
        setPermissionContext({ permissions: null, isFull: true, permissionGroupId: null });
        return;
      }
      if (role === "admin") {
        setPermissionContext({ permissions: null, isFull: true, permissionGroupId: null });
        return;
      }
      setLoading(true);
      try {
        const params = tenantId === null || tenantId === undefined ? {} : { clientId: tenantId };
        const response = await api.get("permissions/context", { params });
        if (cancelled) return;
        const payload = response?.data || {};
        const permissions =
          payload?.permissions && typeof payload.permissions === "object" ? payload.permissions : null;
        setPermissionContext({
          permissions,
          isFull: Boolean(payload?.isFull || payload?.level === "full"),
          permissionGroupId: payload?.permissionGroupId ?? null,
        });
      } catch (error) {
        if (cancelled) return;
        console.warn("Falha ao carregar permissões", error);
        setPermissionContext({ permissions: null, isFull: false, permissionGroupId: null });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPermissionContext();

    return () => {
      cancelled = true;
    };
  }, [role, tenantId, user]);

  const getPermission = useCallback(
    ({ menuKey, pageKey, subKey }) => {
      if (role === "admin" || permissionContext.isFull) {
        return {
          level: UI_LEVELS.full,
          hasAccess: true,
          canShow: true,
          canView: true,
          canRead: true,
          isFull: true,
        };
      }
      if (!permissionContext.permissions) {
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

      const entry = resolvePermissionEntry(permissionContext.permissions, menuKey, pageKey, subKey);
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
    [loading, permissionContext, role],
  );

  return useMemo(
    () => ({
      getPermission,
      loading,
      permissionGroupId: permissionContext.permissionGroupId,
    }),
    [getPermission, loading, permissionContext.permissionGroupId],
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
