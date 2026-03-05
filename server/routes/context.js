import express from "express";
import createError from "http-errors";
import { randomUUID } from "crypto";

import { config } from "../config.js";
import { getEnvInfo } from "../utils/env.js";
import { authenticate } from "../middleware/auth.js";
import { resolvePermissionContext } from "../middleware/permissions.js";
import { resolveTenant } from "../middleware/tenant.js";
import { createTtlCache } from "../utils/ttl-cache.js";
import { getClientById, listClients } from "../models/client.js";
import { listMirrors } from "../models/mirror.js";
import { resolveAllowedMirrorOwnerIds } from "../utils/mirror-access.js";

const router = express.Router();

const CONTEXT_CACHE_TTL_MS = Number(process.env.CONTEXT_CACHE_TTL_MS) || 60_000;
const CONTEXT_CACHE_MAX = Number(process.env.CONTEXT_CACHE_MAX) || 2000;
const contextCache = createTtlCache({ defaultTtlMs: CONTEXT_CACHE_TTL_MS, maxSize: CONTEXT_CACHE_MAX });

function isMirrorActive(mirror, now = new Date()) {
  if (!mirror) return false;
  const start = mirror.startAt ? new Date(mirror.startAt) : null;
  const end = mirror.endAt ? new Date(mirror.endAt) : null;
  if (start && Number.isNaN(start.getTime())) return false;
  if (end && Number.isNaN(end.getTime())) return false;
  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
}

function dedupeClients(list = []) {
  const map = new Map();
  list.forEach((client) => {
    if (!client?.id) return;
    const key = String(client.id);
    if (!map.has(key)) {
      map.set(key, client);
    }
  });
  return Array.from(map.values());
}

function toTechnicianClientView(client) {
  const attrs = client?.attributes || {};
  const address = attrs.address || attrs.endereco || {};
  const city =
    attrs.city ||
    attrs.cidade ||
    address.city ||
    address.cidade ||
    address.town ||
    address.municipio ||
    null;
  const state =
    attrs.state ||
    attrs.uf ||
    attrs.estado ||
    address.state ||
    address.uf ||
    address.estado ||
    null;
  return {
    id: client?.id,
    name: client?.name,
    city: city || null,
    state: state || null,
  };
}

function resolveClientsLimit(req) {
  const rawLimit = req.query?.limit ?? process.env.CONTEXT_CLIENTS_LIMIT ?? 200;
  const parsed = Number(rawLimit);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildContextCacheKey({
  userId,
  clientId,
  ownerClientId,
  permissionGroupId,
  mirrorModeEnabled,
  clientsLimit,
}) {
  return [
    "context",
    userId || "anon",
    clientId ?? "none",
    ownerClientId ?? "none",
    permissionGroupId ?? "none",
    mirrorModeEnabled ? "mirror-on" : "mirror-off",
    clientsLimit ?? "nolimit",
  ].join(":");
}

export function invalidateContextCache() {
  contextCache.clear();
}

export async function buildContextPayload(req, { permissionContext } = {}) {
  const ownerHeader = req.get("X-Owner-Client-Id");
  const requestedClientId =
    config.features?.mirrorMode && ownerHeader ? ownerHeader : req.query?.clientId;
  const tenant = resolveTenant(req, { requestedClientId, required: false });
  const user = req.user;
  if (!user) {
    throw createError(401, "Sessão não autenticada");
  }

  const mirrorModeEnabled = Boolean(config.features?.mirrorMode);
  const resolvedPermissionContext = permissionContext || await resolvePermissionContext(req);
  const clientsLimit = resolveClientsLimit(req);
  const cacheKey = buildContextCacheKey({
    userId: user?.id ? String(user.id) : null,
    clientId: tenant.clientIdResolved ?? null,
    ownerClientId: tenant.mirrorContext?.ownerClientId ?? null,
    permissionGroupId: resolvedPermissionContext?.permissionGroupId ?? null,
    mirrorModeEnabled,
    clientsLimit,
  });
  const cached = contextCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const isAdmin = user.role === "admin";
  let clients = [];
  let clientsHasMore = false;

  if (isAdmin) {
    const list = await listClients();
    if (clientsLimit && list.length > clientsLimit) {
      clients = list.slice(0, clientsLimit);
      clientsHasMore = true;
    } else {
      clients = list;
    }
  } else if (user.clientId) {
    const ownClient = await getClientById(user.clientId).catch(() => null);
    const allowedMirrorOwners = resolveAllowedMirrorOwnerIds(user);
    const mirrorOwners = config.features?.mirrorMode
      ? listMirrors({ targetClientId: user.clientId })
        .filter((mirror) => isMirrorActive(mirror))
        .map((mirror) => String(mirror.ownerClientId))
      : [];
    const effectiveMirrorOwners = Array.isArray(allowedMirrorOwners)
      ? allowedMirrorOwners.map((ownerId) => String(ownerId))
      : null;
    const filteredOwners = Array.isArray(effectiveMirrorOwners)
      ? mirrorOwners.filter((ownerId) => effectiveMirrorOwners.includes(String(ownerId)))
      : mirrorOwners;
    let ownerClients = [];
    if (filteredOwners.length) {
      const directory = await listClients();
      ownerClients = directory.filter((client) => filteredOwners.includes(String(client.id)));
    }
    clients = dedupeClients([...(ownerClients || []), ...(ownClient ? [ownClient] : [])]);
  }
  if (!isAdmin && user.clientId && clients.length === 0) {
    clients = [
      {
        id: user.clientId,
        name: user.attributes?.companyName || user.name || "Cliente",
        attributes: user.attributes || {},
      },
    ];
  }

  if (user.role === "technician") {
    clients = clients.map(toTechnicianClientView);
  }

  const mirror = tenant.mirrorContext
    ? {
        ownerClientId: tenant.mirrorContext.ownerClientId,
        targetClientId: tenant.mirrorContext.targetClientId,
        mirrorId: tenant.mirrorContext.mirrorId,
        permissionGroupId: tenant.mirrorContext.permissionGroupId,
        vehicleGroupId: tenant.mirrorContext.vehicleGroupId ?? null,
        allowedVehicleCount: tenant.mirrorContext.vehicleIds?.length || 0,
        allowedDeviceCount: tenant.mirrorContext.deviceIds?.length || 0,
      }
    : null;

  const resolvedTenantId = tenant.clientIdResolved ?? null;
  const resolvedTenantName = resolvedTenantId
    ? clients.find((client) => String(client.id) === String(resolvedTenantId))?.name ?? null
    : null;
  const responsePayload = {
    clientId: tenant.clientIdResolved ?? null,
    clients,
    clientsHasMore,
    mirror,
    mirrorModeEnabled,
    permissionContext: resolvedPermissionContext,
    user: {
      id: user.id,
      role: user.role,
      userRole: user.role,
      isGlobalAdmin: isAdmin,
      tenantId: resolvedTenantId,
      tenantName: resolvedTenantName,
    },
  };

  if (isAdmin) {
    const envInfo = getEnvInfo();
    responsePayload.envPathCarregado = envInfo.envPath;
    responsePayload.dotenvOverride = envInfo.override;
    responsePayload.features = {
      mirrorModeEnabled,
      tenantFallbackToSelfEnabled: Boolean(config.features?.tenantFallbackToSelf),
    };
  }

  contextCache.set(cacheKey, responsePayload);
  return responsePayload;
}

router.use(authenticate);

router.get("/context", async (req, res, next) => {
  const correlationId =
    req.get?.("x-correlation-id") ||
    req.get?.("x-request-id") ||
    randomUUID();
  const startedAt = Date.now();
  res.set("X-Correlation-Id", correlationId);
  try {
    console.info("[context] start", {
      correlationId,
      userId: req.user?.id ? String(req.user.id) : null,
      userClientId: req.user?.clientId ? String(req.user.clientId) : null,
      requestedClientId: req.query?.clientId ? String(req.query.clientId) : null,
      mirrorMode: req.get?.("X-Mirror-Mode") || null,
    });
    const responsePayload = await buildContextPayload(req);
    res.json(responsePayload);
    console.info("[context] done", {
      correlationId,
      ms: Date.now() - startedAt,
      clientId: responsePayload.clientId ?? null,
      clients: Array.isArray(responsePayload.clients) ? responsePayload.clients.length : 0,
      mirror: Boolean(responsePayload.mirror),
      mirrorModeEnabled: responsePayload.mirrorModeEnabled,
    });
    return undefined;
  } catch (error) {
    console.warn("[context] error", {
      correlationId,
      ms: Date.now() - startedAt,
      message: error?.message || String(error),
      code: error?.code || null,
      status: error?.status || error?.response?.status || null,
    });
    return next(error);
  }
});

export default router;
