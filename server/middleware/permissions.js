import createError from "http-errors";

import prisma, { isPrismaAvailable } from "../services/prisma.js";
import { getGroupById } from "../models/group.js";
import { getFallbackUser, isFallbackEnabled } from "../services/fallback-data.js";

const PERMISSION_LEVELS = new Set(["none", "view", "read", "full"]);
const DEFAULT_LEVEL = "none";
const MIRROR_FALLBACK_PERMISSIONS = {
  primary: {
    home: "read",
    monitoring: "read",
    trips: "read",
    devices: {
      visible: true,
      access: "read",
      subpages: {
        "devices-list": "read",
        "devices-chips": "read",
        "devices-models": "read",
        "devices-stock": "read",
      },
    },
    commands: {
      visible: true,
      access: "read",
      subpages: {
        list: "read",
        advanced: "read",
        create: "none",
      },
    },
    events: {
      visible: true,
      access: "read",
      subpages: {
        report: "read",
        severity: "none",
      },
    },
  },
  fleet: {
    vehicles: "read",
    documents: {
      visible: true,
      access: "read",
      subpages: {
        drivers: "read",
        contracts: "read",
      },
    },
    services: {
      visible: true,
      access: "read",
      subpages: {
        "service-orders": "read",
        "service-orders-all": "read",
        "service-orders-installation": "read",
        "service-orders-maintenance": "read",
        "service-orders-removal": "read",
        "service-orders-socorro": "read",
        "service-orders-remanejamento": "read",
        "service-orders-reinstall": "read",
        appointments: "read",
        technicians: "read",
      },
    },
    routes: "read",
    geofences: "read",
    targets: "read",
    itineraries: "read",
    deliveries: "read",
  },
  telemetry: {
    "euro-view": {
      visible: true,
      access: "read",
      subpages: {
        videos: "read",
        face: "read",
        live: "read",
      },
    },
    "euro-can": {
      visible: true,
      access: "read",
      subpages: {
        fuel: "read",
        compliance: "read",
        "driver-behavior": "read",
        maintenance: "read",
      },
    },
  },
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

export async function resolvePermissionContext(req) {
  if (!req.user) {
    throw createError(401, "Sessão não autenticada");
  }

  if (req.user.role === "admin") {
    return { permissions: null, level: "full", isFull: true, permissionGroupId: null };
  }

  const mirrorPermissionGroupId = req.mirrorContext?.permissionGroupId ?? null;
  if (req.mirrorContext) {
    if (!mirrorPermissionGroupId) {
      return { permissions: MIRROR_FALLBACK_PERMISSIONS, level: null, isFull: false, permissionGroupId: null };
    }

    const mirrorGroup = getGroupById(mirrorPermissionGroupId);
    const permissions =
      mirrorGroup?.attributes?.kind === "PERMISSION_GROUP"
        ? mirrorGroup?.attributes?.permissions || {}
        : mirrorGroup?.attributes?.permissions || {};

    return { permissions, level: null, isFull: false, permissionGroupId: mirrorPermissionGroupId };
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
    return { permissions: null, level: "full", isFull: true, permissionGroupId: null };
  }

  const permissionGroup = getGroupById(permissionGroupId);
  const permissions =
    permissionGroup?.attributes?.kind === "PERMISSION_GROUP"
      ? permissionGroup?.attributes?.permissions || {}
      : permissionGroup?.attributes?.permissions || {};

  return { permissions, level: null, isFull: false, permissionGroupId };
}

export function authorizePermission({ menuKey, pageKey, subKey, requireFull = false }) {
  return async (req, _res, next) => {
    try {
      const context = await resolvePermissionContext(req);
      const resolved =
        context.level
          ? { visible: true, access: context.level }
          : resolvePermissionEntry(context.permissions, menuKey, pageKey, subKey);

      if (!resolved.visible || resolved.access === "none") {
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
  resolvePermissionContext,
};
