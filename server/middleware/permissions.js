import createError from "http-errors";

import prisma, { isPrismaAvailable } from "../services/prisma.js";
import { getGroupById } from "../models/group.js";
import { getFallbackUser, isFallbackEnabled } from "../services/fallback-data.js";

const PERMISSION_LEVELS = new Set(["none", "view", "full"]);
const DEFAULT_LEVEL = "none";

function normaliseLevel(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return PERMISSION_LEVELS.has(normalized) ? normalized : null;
}

function resolvePermissionLevel(permissions, menuKey, pageKey, subKey) {
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
      const level =
        context.level
        || resolvePermissionLevel(context.permissions, menuKey, pageKey, subKey);

      if (level === "none") {
        return next(createError(403, "Sem permissão para acessar este recurso"));
      }

      if (requireFull && level !== "full") {
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
