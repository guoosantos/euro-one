import createError from "http-errors";

import prisma, { isPrismaAvailable } from "../services/prisma.js";
import { getGroupById } from "../models/group.js";
import { getFallbackUser, isFallbackEnabled } from "../services/fallback-data.js";

const PERMISSION_LEVELS = new Set(["none", "view", "read", "full"]);
const DEFAULT_LEVEL = "none";

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
      const access = normaliseLevel(value.access) || "read";
      return { visible, access: visible ? access : null };
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
    return normalizeEntry(pagePermission);
  }

  return normalizeEntry(pagePermission);
}

async function resolvePermissionContext(req) {
  if (!req.user) {
    throw createError(401, "Sessão não autenticada");
  }

  if (req.user.role === "admin") {
    return { permissions: null, level: "full", isFull: true };
  }

  let user = null;
  if (isPrismaAvailable()) {
    user = await prisma.user.findUnique({ where: { id: String(req.user.id) } }).catch(() => null);
  }

  if (!user && isFallbackEnabled()) {
    user = getFallbackUser();
  }

  const permissionGroupId = user?.attributes?.permissionGroupId;
  if (!permissionGroupId) {
    return { permissions: null, level: "full", isFull: true };
  }

  const permissionGroup = getGroupById(permissionGroupId);
  const permissions =
    permissionGroup?.attributes?.kind === "PERMISSION_GROUP"
      ? permissionGroup?.attributes?.permissions || {}
      : permissionGroup?.attributes?.permissions || {};

  return { permissions, level: null, isFull: false };
}

export function authorizePermission({ menuKey, pageKey, subKey, requireFull = false }) {
  return async (req, _res, next) => {
    try {
      const context = await resolvePermissionContext(req);
      const resolved =
        context.level
          ? { visible: true, access: context.level }
          : resolvePermissionEntry(context.permissions, menuKey, pageKey, subKey);

      if (!resolved.visible) {
        return next(createError(403, "Sem permissão para acessar este recurso"));
      }

      if (requireFull && resolved.access !== "full") {
        return next(createError(403, "Acesso restrito para esta operação"));
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export default {
  authorizePermission,
};
