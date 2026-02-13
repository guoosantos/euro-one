import createError from "http-errors";

import prisma, { isPrismaAvailable } from "../services/prisma.js";
import { withTimeout } from "../utils/async-timeout.js";
import { getClientById } from "../models/client.js";
import { createTtlCache } from "../utils/ttl-cache.js";
import { getGroupById } from "../models/group.js";
import { getFallbackUser, isFallbackEnabled } from "../services/fallback-data.js";
import { ACCESS_REASONS } from "../utils/access-reasons.js";

const PERMISSION_LEVELS = new Set(["none", "view", "read", "full"]);
const DEFAULT_LEVEL = "none";
const PRESENTATION_MENU_KEYS = new Set(["business", "primary", "fleet", "telemetry", "admin"]);
const PRESENTATION_CACHE_TTL_MS = Number(process.env.PRESENTATION_CACHE_TTL_MS) || 60_000;
const PRESENTATION_CACHE_MAX = Number(process.env.PRESENTATION_CACHE_MAX) || 1000;
const PERMISSION_CONTEXT_CACHE_TTL_MS = Number(process.env.PERMISSION_CONTEXT_CACHE_TTL_MS) || 90_000;
const PERMISSION_CONTEXT_CACHE_MAX = Number(process.env.PERMISSION_CONTEXT_CACHE_MAX) || 5000;
const MIRROR_MODE_ENABLED = process.env.MIRROR_MODE_ENABLED === "true";
const PRISMA_TIMEOUT_MS = Number(process.env.PRISMA_TIMEOUT_MS) || 4000;
const presentationCache = createTtlCache({ defaultTtlMs: PRESENTATION_CACHE_TTL_MS, maxSize: PRESENTATION_CACHE_MAX });
const presentationClientCache = createTtlCache({ defaultTtlMs: PRESENTATION_CACHE_TTL_MS, maxSize: PRESENTATION_CACHE_MAX });
const permissionContextCache = createTtlCache({
  defaultTtlMs: PERMISSION_CONTEXT_CACHE_TTL_MS,
  maxSize: PERMISSION_CONTEXT_CACHE_MAX,
});
const permissionGroupIdCache = createTtlCache({
  defaultTtlMs: PERMISSION_CONTEXT_CACHE_TTL_MS,
  maxSize: PERMISSION_CONTEXT_CACHE_MAX,
});
const NO_PRESENTATION = Symbol("no-presentation");
export const MIRROR_FALLBACK_PERMISSIONS = {
  primary: {
    home: "read",
    monitoring: {
      visible: true,
      access: "read",
      subpages: {
        alerts: "read",
        "alerts-conjugated": "read",
        positions: "read",
        telemetry: "read",
      },
    },
    services: {
      visible: true,
      access: "read",
      subpages: {
        "service-orders": "read",
      },
    },
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
        "history-response": "read",
      },
    },
    events: {
      visible: true,
      access: "read",
      subpages: {
        report: "read",
        severity: "none",
        "report-active-filter": "read",
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
  admin: {
    users: {
      visible: true,
      access: "read",
      subpages: {
        "users-vehicle-groups": "full",
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

function isPermissionMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).some((key) => PRESENTATION_MENU_KEYS.has(key));
}

function normalizePresentationCandidate(candidate) {
  if (!candidate) return null;
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    if (candidate.permissions && isPermissionMap(candidate.permissions)) {
      return candidate.permissions;
    }
    if (isPermissionMap(candidate)) {
      return candidate;
    }
  }
  return null;
}

function extractPresentationPermissions(attributes) {
  if (!attributes || typeof attributes !== "object") return null;
  const candidates = [
    attributes.presentationPermissions,
    attributes.presentation,
    attributes.apresentacao,
    attributes.apresentacaoPermissions,
    attributes.menuPresentation,
    attributes.menuPermissions,
    attributes.presentationMenu,
    attributes.menuConfig,
    attributes.modules,
    attributes.modulePermissions,
  ];
  for (const candidate of candidates) {
    const normalized = normalizePresentationCandidate(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function extractPresentationGroupId(attributes) {
  if (!attributes || typeof attributes !== "object") return null;
  const candidates = [
    attributes.presentationPermissionGroupId,
    attributes.apresentacaoPermissionGroupId,
    attributes.menuPermissionGroupId,
    attributes.presentationGroupId,
  ];
  for (const candidate of candidates) {
    if (candidate) return String(candidate);
  }
  return null;
}

function getPresentationCacheKey(clientId, version) {
  return `presentation:${String(clientId)}:${version || "na"}`;
}

export function invalidatePresentationCache(clientId) {
  if (!clientId) {
    presentationCache.clear();
    presentationClientCache.clear();
    return;
  }
  presentationCache.clear();
  presentationClientCache.delete(String(clientId));
}

export function invalidatePermissionContextCache() {
  permissionContextCache.clear();
  permissionGroupIdCache.clear();
}

async function resolvePresentationPayload(req) {
  const clientId =
    req?.clientId ??
    req?.tenant?.clientIdResolved ??
    req?.mirrorContext?.ownerClientId ??
    req?.user?.clientId ??
    null;
  if (!clientId) return null;
  const cachedClient = presentationClientCache.get(String(clientId));
  const client = cachedClient || (await getClientById(clientId).catch(() => null));
  if (client && !cachedClient) {
    presentationClientCache.set(String(clientId), client);
  }
  const attributes = client?.attributes || null;
  const clientVersion = client?.updatedAt || attributes?.updatedAt || null;
  let permissions = extractPresentationPermissions(attributes);
  let presentationGroup = null;
  if (!permissions) {
    const groupId = extractPresentationGroupId(attributes);
    if (groupId) {
      presentationGroup = getGroupById(groupId);
      if (presentationGroup?.attributes?.kind === "PERMISSION_GROUP") {
        permissions = presentationGroup.attributes.permissions || null;
      }
    }
  }
  const groupVersion = presentationGroup?.updatedAt || null;
  const version = [clientVersion, groupVersion].filter(Boolean).join("|") || null;
  const cacheKey = getPresentationCacheKey(clientId, version);
  const cached = presentationCache.get(cacheKey);
  if (cached) {
    return cached === NO_PRESENTATION ? { permissions: null, version } : { permissions: cached, version };
  }
  presentationCache.set(cacheKey, permissions || NO_PRESENTATION);
  return { permissions: permissions || null, version };
}

async function resolvePresentationPermissions(req) {
  const payload = await resolvePresentationPayload(req);
  return payload?.permissions || null;
}

function buildPermissionContextCacheKey({
  userId,
  effectiveClientId,
  ownerClientId,
  permissionGroupId,
  mirrorModeEnabled,
  presentationVersion,
}) {
  return [
    "permctx",
    userId || "anon",
    effectiveClientId ?? "none",
    ownerClientId ?? "none",
    permissionGroupId ?? "none",
    mirrorModeEnabled ? "mirror-on" : "mirror-off",
    presentationVersion || "na",
  ].join(":");
}

function minAccess(left, right) {
  const ranks = { none: 0, read: 1, full: 2 };
  const leftRank = ranks[left] ?? 0;
  const rightRank = ranks[right] ?? 0;
  return leftRank <= rightRank ? left : right;
}

function intersectEntries(leftEntry, rightEntry, parentVisible = true) {
  const visible = parentVisible && leftEntry.visible && rightEntry.visible;
  if (!visible) {
    return { visible: false, access: null };
  }
  const access = minAccess(leftEntry.access ?? "none", rightEntry.access ?? "none");
  return { visible: true, access };
}

function listSubpageKeys(entry) {
  if (!entry || typeof entry !== "object") return [];
  const subpages = entry.subpages;
  if (!subpages || typeof subpages !== "object") return [];
  return Object.keys(subpages);
}

function applyPresentationPermissions(permissions, presentation) {
  if (!permissions || typeof permissions !== "object") return permissions;
  if (!presentation || typeof presentation !== "object") return permissions;
  if (Object.keys(presentation).length === 0) return permissions;

  const merged = {};
  const menuKeys = Object.keys(permissions);
  menuKeys.forEach((menuKey) => {
    const baseMenu = permissions?.[menuKey] || {};
    const presentationMenu = presentation?.[menuKey] || {};
    const pageKeys = new Set([
      ...Object.keys(baseMenu || {}),
      ...Object.keys(presentationMenu || {}),
    ]);
    if (!pageKeys.size) return;
    const nextMenu = {};
    pageKeys.forEach((pageKey) => {
      const basePage = baseMenu?.[pageKey];
      const presentationPage = presentationMenu?.[pageKey];
      const baseEntry = normalizeEntry(basePage);
      const presentationEntry = normalizeEntry(presentationPage);
      const mergedEntry = intersectEntries(baseEntry, presentationEntry);
      const subKeys = new Set([
        ...listSubpageKeys(basePage),
        ...listSubpageKeys(presentationPage),
      ]);
      if (subKeys.size > 0) {
        const subpages = {};
        subKeys.forEach((subKey) => {
          const baseSub = resolvePermissionEntry({ [menuKey]: { [pageKey]: basePage } }, menuKey, pageKey, subKey);
          const presentationSub = resolvePermissionEntry(
            { [menuKey]: { [pageKey]: presentationPage } },
            menuKey,
            pageKey,
            subKey,
          );
          subpages[subKey] = intersectEntries(baseSub, presentationSub, mergedEntry.visible);
        });
        nextMenu[pageKey] = { ...mergedEntry, subpages };
      } else {
        nextMenu[pageKey] = mergedEntry;
      }
    });
    merged[menuKey] = nextMenu;
  });

  return merged;
}

function canBypassAdminPermission(req, menuKey) {
  return req?.user?.role === "admin" && menuKey === "admin";
}

function canBypassAdminPermissionList(req, permissions) {
  if (req?.user?.role !== "admin") return false;
  if (!Array.isArray(permissions)) return false;
  return permissions.some((permission) => permission?.menuKey === "admin");
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

export async function resolvePermissionContext(req) {
  if (!req.user) {
    throw createError(401, "Sessão não autenticada");
  }
  if (req._permissionContext) {
    return req._permissionContext;
  }
  if (req._permissionContextPromise) {
    return req._permissionContextPromise;
  }

  const resolverPromise = (async () => {
    const isAdminUser = req.user?.role === "admin";
    const presentationPayload = isAdminUser ? null : await resolvePresentationPayload(req);
    const presentationPermissions = presentationPayload?.permissions || null;
    const presentationVersion = presentationPayload?.version || null;
    const applyPresentation = (permissions) =>
      isAdminUser ? permissions : applyPresentationPermissions(permissions, presentationPermissions);

    const shouldDebugMirror = process.env.DEBUG_MIRROR === "true";
    const logMirrorPermissions = ({ permissionGroupIdUsed, usedFallback }) => {
      if (!shouldDebugMirror) return;
      console.info("[permissions] mirror context", {
        userId: req.user?.id ? String(req.user.id) : null,
        userClientId: req.user?.clientId ? String(req.user.clientId) : null,
        ownerClientId: req.mirrorContext?.ownerClientId ? String(req.mirrorContext.ownerClientId) : null,
        targetClientId: req.mirrorContext?.targetClientId ? String(req.mirrorContext.targetClientId) : null,
        mirrorId: req.mirrorContext?.mirrorId ? String(req.mirrorContext.mirrorId) : null,
        permissionGroupIdUsed: permissionGroupIdUsed ? String(permissionGroupIdUsed) : null,
        usedFallback: Boolean(usedFallback),
      });
    };

    const effectiveClientId =
      req?.clientId ??
      req?.tenant?.clientIdResolved ??
      req?.mirrorContext?.ownerClientId ??
      req?.user?.clientId ??
      null;
    const ownerClientId = req?.mirrorContext?.ownerClientId ?? null;

    if (req.user.role === "admin") {
      const adminPermissionGroupId = req.user?.attributes?.permissionGroupId ?? null;
      const cacheKey = buildPermissionContextCacheKey({
        userId: req.user?.id,
        effectiveClientId,
        ownerClientId,
        permissionGroupId: adminPermissionGroupId,
        mirrorModeEnabled: MIRROR_MODE_ENABLED,
        presentationVersion,
      });
      const cached = permissionContextCache.get(cacheKey);
      if (cached) return cached;
      if (!adminPermissionGroupId) {
        const payload = { permissions: null, level: "full", isFull: true, permissionGroupId: null };
        permissionContextCache.set(cacheKey, payload);
        return payload;
      }
      const adminGroup = getGroupById(adminPermissionGroupId);
      const adminPermissions =
        adminGroup?.attributes?.kind === "PERMISSION_GROUP"
          ? adminGroup?.attributes?.permissions || {}
          : adminGroup?.attributes?.permissions || {};
      if (!adminGroup || !adminPermissions || Object.keys(adminPermissions).length === 0) {
        const payload = { permissions: null, level: "full", isFull: true, permissionGroupId: null };
        permissionContextCache.set(cacheKey, payload);
        return payload;
      }
      const payload = {
        permissions: applyPresentation(adminPermissions),
        level: null,
        isFull: false,
        permissionGroupId: adminPermissionGroupId,
      };
      permissionContextCache.set(cacheKey, payload);
      return payload;
    }

    const mirrorPermissionGroupId = req.mirrorContext?.permissionGroupId ?? null;
    if (req.mirrorContext) {
      if (!mirrorPermissionGroupId) {
        // Se o mirror não tem grupo explícito, usamos o grupo do usuário para evitar
        // "vazar" módulos de outros tenants via fallback genérico.
        let fallbackPermissionGroupId = req.user?.attributes?.permissionGroupId ?? null;
        let fallbackUser = null;
        if (!fallbackPermissionGroupId) {
          fallbackPermissionGroupId = permissionGroupIdCache.get(String(req.user.id));
        }
        if (!fallbackPermissionGroupId && isPrismaAvailable()) {
          fallbackUser = await withTimeout(
            prisma.user.findUnique({ where: { id: String(req.user.id) } }),
            PRISMA_TIMEOUT_MS,
            { label: "prisma.user.findUnique(mirror-fallback)" },
          ).catch(() => null);
          fallbackPermissionGroupId = fallbackUser?.attributes?.permissionGroupId ?? null;
        }
        if (!fallbackUser && !fallbackPermissionGroupId && isFallbackEnabled()) {
          fallbackUser = getFallbackUser();
          fallbackPermissionGroupId = fallbackUser?.attributes?.permissionGroupId ?? null;
        }
        if (fallbackPermissionGroupId) {
          permissionGroupIdCache.set(String(req.user.id), fallbackPermissionGroupId);
        }

        const cacheKey = buildPermissionContextCacheKey({
          userId: req.user?.id,
          effectiveClientId,
          ownerClientId,
          permissionGroupId: fallbackPermissionGroupId,
          mirrorModeEnabled: MIRROR_MODE_ENABLED,
          presentationVersion,
        });
        const cached = permissionContextCache.get(cacheKey);
        if (cached) return cached;

        if (fallbackPermissionGroupId) {
          const fallbackGroup = getGroupById(fallbackPermissionGroupId);
          const fallbackPermissions =
            fallbackGroup?.attributes?.kind === "PERMISSION_GROUP"
              ? fallbackGroup?.attributes?.permissions || {}
              : fallbackGroup?.attributes?.permissions || {};
          if (fallbackGroup && fallbackPermissions && Object.keys(fallbackPermissions).length > 0) {
            logMirrorPermissions({ permissionGroupIdUsed: fallbackPermissionGroupId, usedFallback: false });
            const payload = {
              permissions: applyPresentation(fallbackPermissions),
              level: null,
              isFull: false,
              permissionGroupId: fallbackPermissionGroupId,
            };
            permissionContextCache.set(cacheKey, payload);
            return payload;
          }
        }

        logMirrorPermissions({ permissionGroupIdUsed: null, usedFallback: true });
        const payload = {
          permissions: applyPresentation(MIRROR_FALLBACK_PERMISSIONS),
          level: null,
          isFull: false,
          permissionGroupId: null,
        };
        permissionContextCache.set(cacheKey, payload);
        return payload;
      }

      const cacheKey = buildPermissionContextCacheKey({
        userId: req.user?.id,
        effectiveClientId,
        ownerClientId,
        permissionGroupId: mirrorPermissionGroupId,
        mirrorModeEnabled: MIRROR_MODE_ENABLED,
        presentationVersion,
      });
      const cached = permissionContextCache.get(cacheKey);
      if (cached) return cached;

      const mirrorGroup = getGroupById(mirrorPermissionGroupId);
      const permissions = mirrorGroup?.attributes?.permissions || null;
      const isPermissionGroup = mirrorGroup?.attributes?.kind === "PERMISSION_GROUP";

      if (!mirrorGroup || !isPermissionGroup || !permissions || Object.keys(permissions).length === 0) {
        logMirrorPermissions({ permissionGroupIdUsed: mirrorPermissionGroupId, usedFallback: true });
        const payload = {
          permissions: applyPresentation(MIRROR_FALLBACK_PERMISSIONS),
          level: null,
          isFull: false,
          permissionGroupId: null,
        };
        permissionContextCache.set(cacheKey, payload);
        return payload;
      }

      logMirrorPermissions({ permissionGroupIdUsed: mirrorPermissionGroupId, usedFallback: false });
      const payload = {
        permissions: applyPresentation(permissions),
        level: null,
        isFull: false,
        permissionGroupId: mirrorPermissionGroupId,
      };
      permissionContextCache.set(cacheKey, payload);
      return payload;
    }

    let permissionGroupId = req.user?.attributes?.permissionGroupId ?? null;
    let user = null;
    if (!permissionGroupId) {
      permissionGroupId = permissionGroupIdCache.get(String(req.user.id));
    }
    if (!permissionGroupId && isPrismaAvailable()) {
      user = await withTimeout(
        prisma.user.findUnique({ where: { id: String(req.user.id) } }),
        PRISMA_TIMEOUT_MS,
        { label: "prisma.user.findUnique(permission-group)" },
      ).catch(() => null);
      permissionGroupId = user?.attributes?.permissionGroupId ?? null;
    }

    if (!user && !permissionGroupId && isFallbackEnabled()) {
      user = getFallbackUser();
      permissionGroupId = user?.attributes?.permissionGroupId ?? null;
    }

    if (permissionGroupId) {
      permissionGroupIdCache.set(String(req.user.id), permissionGroupId);
    }

    const cacheKey = buildPermissionContextCacheKey({
      userId: req.user?.id,
      effectiveClientId,
      ownerClientId,
      permissionGroupId,
      mirrorModeEnabled: MIRROR_MODE_ENABLED,
      presentationVersion,
    });
    const cached = permissionContextCache.get(cacheKey);
    if (cached) return cached;

    if (!permissionGroupId) {
      const payload = {
        permissions: applyPresentation(null),
        level: null,
        isFull: false,
        permissionGroupId: null,
      };
      permissionContextCache.set(cacheKey, payload);
      return payload;
    }

    const permissionGroup = getGroupById(permissionGroupId);
    const permissions =
      permissionGroup?.attributes?.kind === "PERMISSION_GROUP"
        ? permissionGroup?.attributes?.permissions || {}
        : permissionGroup?.attributes?.permissions || {};

    const payload = {
      permissions: applyPresentation(permissions),
      level: null,
      isFull: false,
      permissionGroupId,
    };
    permissionContextCache.set(cacheKey, payload);
    return payload;
  })();

  req._permissionContextPromise = resolverPromise;
  const resolved = await resolverPromise;
  req._permissionContext = resolved;
  req._permissionContextPromise = null;
  return resolved;
}

export function authorizePermission({ menuKey, pageKey, subKey, requireFull = false }) {
  return async (req, _res, next) => {
    try {
      if (canBypassAdminPermission(req, menuKey)) {
        return next();
      }
      const context = await resolvePermissionContext(req);
      const resolved =
        context.level
          ? { visible: true, access: context.level }
          : resolvePermissionEntry(context.permissions, menuKey, pageKey, subKey);
      if (process.env.DEBUG_MIRROR === "true") {
        console.info("[permissions] evaluated", {
          path: req.originalUrl || req.url,
          method: req.method,
          menuKey,
          pageKey,
          subKey: subKey || null,
          resolved,
          requireFull,
          permissionGroupId: context.permissionGroupId ? String(context.permissionGroupId) : null,
          isFull: Boolean(context.isFull),
          level: context.level || null,
        });
      }

      if (!resolved.visible || resolved.access === "none") {
        console.warn("[permissions] denied", {
          path: req.originalUrl || req.url,
          method: req.method,
          userId: req.user?.id ? String(req.user.id) : null,
          clientId: req.user?.clientId ? String(req.user.clientId) : null,
          menuKey,
          pageKey,
          subKey: subKey || null,
          resolved,
          requireFull,
          permissionGroupId: context.permissionGroupId ? String(context.permissionGroupId) : null,
        });
        return next(createError(403, "Sem permissão para acessar este recurso", {
          reason: ACCESS_REASONS.FORBIDDEN_SCOPE,
        }));
      }

      if (requireFull && resolved.access !== "full") {
        console.warn("[permissions] denied (requireFull)", {
          path: req.originalUrl || req.url,
          method: req.method,
          userId: req.user?.id ? String(req.user.id) : null,
          clientId: req.user?.clientId ? String(req.user.clientId) : null,
          menuKey,
          pageKey,
          subKey: subKey || null,
          resolved,
          requireFull,
          permissionGroupId: context.permissionGroupId ? String(context.permissionGroupId) : null,
        });
        return next(createError(403, "Acesso restrito para esta operação", {
          reason: ACCESS_REASONS.FORBIDDEN_SCOPE,
        }));
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function authorizeAnyPermission({ permissions = [], requireFull = false }) {
  return async (req, _res, next) => {
    try {
      if (canBypassAdminPermissionList(req, permissions)) {
        return next();
      }
      if (!Array.isArray(permissions) || permissions.length === 0) {
        return next();
      }
      const context = await resolvePermissionContext(req);
      const hasAccess = permissions.some((permission) => {
        if (!permission) return false;
        const resolved =
          context.level
            ? { visible: true, access: context.level }
            : resolvePermissionEntry(context.permissions, permission.menuKey, permission.pageKey, permission.subKey);
        const needsFull = permission.requireFull || requireFull;
        if (!resolved.visible || resolved.access === "none" || resolved.access === null) {
          return false;
        }
        if (needsFull && resolved.access !== "full") {
          return false;
        }
        return true;
      });

      if (!hasAccess) {
        console.warn("[permissions] denied (any)", {
          path: req.originalUrl || req.url,
          method: req.method,
          userId: req.user?.id ? String(req.user.id) : null,
          clientId: req.user?.clientId ? String(req.user.clientId) : null,
          permissions: permissions.map((permission) => ({
            menuKey: permission?.menuKey,
            pageKey: permission?.pageKey,
            subKey: permission?.subKey,
            requireFull: Boolean(permission?.requireFull || requireFull),
          })),
          permissionGroupId: context.permissionGroupId ? String(context.permissionGroupId) : null,
        });
        return next(createError(403, "Sem permissão para acessar este recurso", {
          reason: ACCESS_REASONS.FORBIDDEN_SCOPE,
        }));
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function authorizePermissionOrEmpty({
  menuKey,
  pageKey,
  subKey,
  requireFull = false,
  emptyPayload,
  allowMethods = ["GET", "HEAD"],
}) {
  return async (req, res, next) => {
    try {
      if (canBypassAdminPermission(req, menuKey)) {
        return next();
      }
      const context = await resolvePermissionContext(req);
      const resolved =
        context.level
          ? { visible: true, access: context.level }
          : resolvePermissionEntry(context.permissions, menuKey, pageKey, subKey);
      if (process.env.DEBUG_MIRROR === "true") {
        console.info("[permissions] evaluated", {
          path: req.originalUrl || req.url,
          method: req.method,
          menuKey,
          pageKey,
          subKey: subKey || null,
          resolved,
          requireFull,
          permissionGroupId: context.permissionGroupId ? String(context.permissionGroupId) : null,
          isFull: Boolean(context.isFull),
          level: context.level || null,
          allowMethods,
        });
      }

      const hasAccess =
        resolved.visible &&
        resolved.access !== "none" &&
        (!requireFull || resolved.access === "full");

      if (hasAccess) {
        return next();
      }

      if (allowMethods.includes(req.method)) {
        const payload = typeof emptyPayload === "function" ? emptyPayload(req) : emptyPayload;
        return res.status(200).json(payload ?? { data: [], total: 0 });
      }

      return next(createError(403, "Sem permissão para acessar este recurso", {
        reason: ACCESS_REASONS.FORBIDDEN_SCOPE,
      }));
    } catch (error) {
      return next(error);
    }
  };
}

export default {
  authorizePermission,
  authorizeAnyPermission,
  authorizePermissionOrEmpty,
  resolvePermissionContext,
  invalidatePresentationCache,
  invalidatePermissionContextCache,
};
