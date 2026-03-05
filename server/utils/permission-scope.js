const PERMISSION_LEVELS = new Set(["none", "view", "read", "full"]);
const DEFAULT_LEVEL = "none";
const ACCESS_RANK = { none: 0, read: 1, full: 2 };

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
      const access = normaliseLevel(value.access);
      if (access === "none") {
        return { visible: true, access: "none" };
      }
      return { visible: true, access: access || "read" };
    }
    const legacyLevel = normaliseLevel(value?.level) || DEFAULT_LEVEL;
    if (legacyLevel === "none") return { visible: false, access: null };
    return { visible: true, access: legacyLevel === "full" ? "full" : "read" };
  }
  return { visible: false, access: null };
}

function resolvePermissionEntry(permissions, menuKey, pageKey, subKey) {
  if (!permissions || !menuKey || !pageKey) return { visible: false, access: null };

  const menuPermissions = permissions?.[menuKey] || {};
  const pagePermission = menuPermissions?.[pageKey];

  if (subKey) {
    if (pagePermission && typeof pagePermission === "object") {
      const hasSubpages = Object.prototype.hasOwnProperty.call(pagePermission, "subpages");
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
      if (hasSubpages) {
        return { visible: false, access: null };
      }
      return baseEntry.visible ? baseEntry : { visible: false, access: null };
    }
    return normalizeEntry(pagePermission);
  }

  return normalizeEntry(pagePermission);
}

function hasAccess(entry) {
  return Boolean(entry?.visible) && entry?.access !== "none" && entry?.access !== null;
}

function canGrant(requestedEntry, allowedEntry) {
  if (!hasAccess(requestedEntry)) return true;
  if (!hasAccess(allowedEntry)) return false;
  const requestedRank = ACCESS_RANK[requestedEntry.access] ?? 0;
  const allowedRank = ACCESS_RANK[allowedEntry.access] ?? 0;
  return requestedRank <= allowedRank;
}

export function findPermissionExpansion(requestedPermissions = {}, allowedPermissions = {}) {
  if (!requestedPermissions || typeof requestedPermissions !== "object") return null;
  const allowed = allowedPermissions && typeof allowedPermissions === "object" ? allowedPermissions : {};

  for (const [menuKey, pages] of Object.entries(requestedPermissions)) {
    if (!pages || typeof pages !== "object") continue;
    for (const [pageKey, pageValue] of Object.entries(pages)) {
      if (!pageKey) continue;
      const requestedPage = normalizeEntry(pageValue);
      const allowedPage = resolvePermissionEntry(allowed, menuKey, pageKey);
      if (!canGrant(requestedPage, allowedPage)) {
        return { menuKey, pageKey, subKey: null };
      }
      if (pageValue && typeof pageValue === "object" && pageValue.subpages) {
        const subpages = pageValue.subpages || {};
        for (const [subKey, subValue] of Object.entries(subpages)) {
          const requestedSub = normalizeEntry(subValue);
          const allowedSub = resolvePermissionEntry(allowed, menuKey, pageKey, subKey);
          if (!canGrant(requestedSub, allowedSub)) {
            return { menuKey, pageKey, subKey };
          }
        }
      }
    }
  }

  return null;
}

export function isPermissionSubset(requestedPermissions = {}, allowedPermissions = {}) {
  return !findPermissionExpansion(requestedPermissions, allowedPermissions);
}

export default {
  findPermissionExpansion,
  isPermissionSubset,
};
