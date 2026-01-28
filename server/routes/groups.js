import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { authorizePermission, authorizePermissionOrEmpty } from "../middleware/permissions.js";
import { getClientById } from "../models/client.js";
import { createGroup, deleteGroup, getGroupById, listGroups, updateGroup } from "../models/group.js";
import { createTtlCache } from "../utils/ttl-cache.js";
import { isAdminGeneralClient } from "../utils/admin-general.js";
import { getEffectiveVehicleIds } from "../utils/mirror-scope.js";

const router = express.Router();

router.use(authenticate);

const groupCache = createTtlCache(30_000);
const groupCacheKeys = new Set();

function buildGroupCacheKey(clientId, scope = "all") {
  const resolvedClient = clientId === undefined || clientId === null || clientId === "" ? "all" : clientId;
  return `groups:${resolvedClient}:${scope}`;
}

function cacheGroups(key, value) {
  groupCacheKeys.add(key);
  return groupCache.set(key, value, 30_000);
}

function getCachedGroups(key) {
  return groupCache.get(key);
}

function invalidateGroupCache() {
  Array.from(groupCacheKeys).forEach((key) => {
    groupCache.delete(key);
    groupCacheKeys.delete(key);
  });
}

function ensureClientAccess(sessionUser, targetClientId) {
  if (sessionUser.role === "admin") {
    return;
  }
  if (!sessionUser.clientId || String(sessionUser.clientId) !== String(targetClientId)) {
    throw createError(403, "Operação não permitida para este cliente");
  }
}

function isGlobalPermissionGroup(group) {
  return group?.attributes?.scope === "global" || group?.attributes?.isGlobal;
}

async function isAdminGeneralUser(sessionUser) {
  if (sessionUser?.role !== "admin") return false;
  if (!sessionUser?.clientId) return false;
  const client = await getClientById(sessionUser.clientId);
  return isAdminGeneralClient(client);
}

function mergeGroups(primary = [], secondary = []) {
  const map = new Map(primary.map((group) => [group.id, group]));
  secondary.forEach((group) => {
    if (!map.has(group.id)) {
      map.set(group.id, group);
    }
  });
  return Array.from(map.values());
}

function resolveMirrorVehicleScope(req) {
  const vehicleIds = getEffectiveVehicleIds(req);
  if (!req.mirrorContext) return null;
  if (!vehicleIds || vehicleIds.length === 0) return [];
  return vehicleIds.map(String);
}

function ensureGroupWriteRole(req) {
  if (!req?.user) {
    throw createError(401, "Sessão não autenticada");
  }
  if (req.mirrorContext) {
    return;
  }
  const role = req.user.role;
  if (role === "admin" || role === "manager" || role === "tenant_admin") {
    return;
  }
  throw createError(403, "Permissão insuficiente");
}

function normaliseVehicleIds(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function applyMirrorVehicleScope(group, allowedVehicleIds) {
  if (!allowedVehicleIds) return group;
  if (!group?.attributes || group.attributes.kind !== "VEHICLE_GROUP") return group;
  const vehicleIds = normaliseVehicleIds(group.attributes.vehicleIds);
  const scoped = vehicleIds.filter((id) => allowedVehicleIds.has(String(id)));
  return {
    ...group,
    attributes: {
      ...group.attributes,
      vehicleIds: scoped,
    },
  };
}

router.get(
  "/groups",
  authorizePermissionOrEmpty({
    menuKey: "admin",
    pageKey: "users",
    emptyPayload: { groups: [] },
  }),
  (req, res, next) => {
  try {
    const scope = req.user.role === "admin" ? "admin" : "user";
    const globalPermissionGroups = listGroups()
      .filter((group) => group.attributes?.kind === "PERMISSION_GROUP" && isGlobalPermissionGroup(group));
    const mirrorVehicleScope = resolveMirrorVehicleScope(req);
    const allowedVehicleIds = mirrorVehicleScope ? new Set(mirrorVehicleScope) : null;
    const effectiveClientId = req.mirrorContext?.ownerClientId || req.user.clientId;
    if (req.user.role === "admin") {
      const { clientId } = req.query;
      const filterClientId = clientId === "" || typeof clientId === "undefined" ? undefined : clientId;
      const cacheKey = buildGroupCacheKey(filterClientId, scope);
      if (!req.mirrorContext) {
        const cached = getCachedGroups(cacheKey);
        if (cached) {
          return res.json(cached);
        }
      }
      const groups = filterClientId === undefined
        ? listGroups()
        : mergeGroups(listGroups({ clientId: filterClientId }), globalPermissionGroups);
      const filteredGroups = allowedVehicleIds
        ? groups
          .filter((group) => group?.attributes?.kind === "VEHICLE_GROUP")
          .map((group) => applyMirrorVehicleScope(group, allowedVehicleIds))
          .filter((group) => group.attributes?.vehicleIds?.length)
        : groups;
      const payload = { groups: filteredGroups };
      if (!req.mirrorContext) {
        cacheGroups(cacheKey, payload);
      }
      return res.json(payload);
    }

    if (!effectiveClientId) {
      return res.json({ groups: [] });
    }

    const cacheKey = buildGroupCacheKey(effectiveClientId, scope);
    if (!req.mirrorContext) {
      const cached = getCachedGroups(cacheKey);
      if (cached) {
        return res.json(cached);
      }
    }
    const groups = mergeGroups(listGroups({ clientId: effectiveClientId }), globalPermissionGroups);
    const filteredGroups = allowedVehicleIds
      ? groups
        .filter((group) => group?.attributes?.kind === "VEHICLE_GROUP")
        .map((group) => applyMirrorVehicleScope(group, allowedVehicleIds))
        .filter((group) => group.attributes?.vehicleIds?.length)
      : groups;
    const payload = { groups: filteredGroups };
    if (!req.mirrorContext) {
      cacheGroups(cacheKey, payload);
    }
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
  },
);

router.post(
  "/groups",
  authorizePermission({ menuKey: "admin", pageKey: "users", subKey: "users-vehicle-groups", requireFull: true }),
  async (req, res, next) => {
  try {
    ensureGroupWriteRole(req);
    const { name, description = null, attributes = {}, clientId } = req.body || {};
    if (!name) {
      throw createError(400, "Nome é obrigatório");
    }

    let targetClientId = clientId;
    if (req.user.role !== "admin") {
      targetClientId = req.user.clientId;
    }
    if (req.mirrorContext) {
      targetClientId = req.mirrorContext.ownerClientId;
    }
    if (!targetClientId) {
      throw createError(400, "clientId é obrigatório");
    }

    let client = null;
    try {
      client = await getClientById(targetClientId);
    } catch (error) {
      if (req.mirrorContext && error?.status === 503) {
        client = { id: targetClientId, name: null, attributes: {} };
      } else {
        throw error;
      }
    }
    if (!client) {
      throw createError(404, "Cliente associado não encontrado");
    }

    const nextAttributes = { ...attributes };
    if (req.mirrorContext && nextAttributes.kind !== "VEHICLE_GROUP") {
      throw createError(403, "Espelho permite apenas grupos de veículos");
    }
    if (
      nextAttributes.kind === "PERMISSION_GROUP"
      && (await isAdminGeneralUser(req.user))
      && isAdminGeneralClient(client)
    ) {
      nextAttributes.scope = "global";
    } else {
      delete nextAttributes.scope;
      delete nextAttributes.isGlobal;
    }
    const mirrorVehicleScope = resolveMirrorVehicleScope(req);
    if (mirrorVehicleScope && nextAttributes.kind === "VEHICLE_GROUP") {
      const allowedVehicleIds = new Set(mirrorVehicleScope);
      const scopedVehicleIds = normaliseVehicleIds(nextAttributes.vehicleIds).filter((id) =>
        allowedVehicleIds.has(String(id)),
      );
      nextAttributes.vehicleIds = scopedVehicleIds;
    }

    const group = createGroup({
      name,
      description,
      attributes: nextAttributes,
      clientId: targetClientId,
    });

    invalidateGroupCache();
    return res.status(201).json({ group });
  } catch (error) {
    return next(error);
  }
  },
);

router.put(
  "/groups/:id",
  authorizePermission({ menuKey: "admin", pageKey: "users", subKey: "users-vehicle-groups", requireFull: true }),
  async (req, res, next) => {
  try {
    ensureGroupWriteRole(req);
    const { id } = req.params;
    const existing = getGroupById(id);
    if (!existing) {
      throw createError(404, "Grupo não encontrado");
    }

    if (isGlobalPermissionGroup(existing) && !(await isAdminGeneralUser(req.user))) {
      throw createError(403, "Perfis globais só podem ser alterados pelo ADMIN GERAL");
    }

    if (req.mirrorContext) {
      if (String(existing.clientId) !== String(req.mirrorContext.ownerClientId)) {
        throw createError(404, "Grupo não encontrado");
      }
      if (existing.attributes?.kind !== "VEHICLE_GROUP") {
        throw createError(403, "Espelho permite apenas grupos de veículos");
      }
    } else if (req.user.role !== "admin") {
      ensureClientAccess(req.user, existing.clientId);
      if (req.body?.clientId && String(req.body.clientId) !== String(req.user.clientId)) {
        throw createError(403, "Não é permitido mover grupos para outro cliente");
      }
    } else if (Object.prototype.hasOwnProperty.call(req.body || {}, "clientId")) {
      if (!req.body.clientId) {
        throw createError(400, "clientId é obrigatório");
      }
      const client = await getClientById(req.body.clientId);
      if (!client) {
        throw createError(404, "Cliente associado não encontrado");
      }
    }

    const payload = { ...req.body };
    delete payload.clientId;

    const updates = { ...payload };
    if (req.user.role === "admin" && Object.prototype.hasOwnProperty.call(req.body || {}, "clientId")) {
      updates.clientId = req.body.clientId;
    }
    if (Object.prototype.hasOwnProperty.call(updates, "attributes")) {
      if (!isGlobalPermissionGroup(existing)) {
        delete updates.attributes?.scope;
        delete updates.attributes?.isGlobal;
      }
    }

    if (req.mirrorContext) {
      if (updates.attributes?.kind && updates.attributes.kind !== "VEHICLE_GROUP") {
        throw createError(403, "Espelho permite apenas grupos de veículos");
      }
      const mirrorVehicleScope = resolveMirrorVehicleScope(req);
      if (mirrorVehicleScope && updates.attributes?.vehicleIds) {
        const allowedVehicleIds = new Set(mirrorVehicleScope);
        updates.attributes.vehicleIds = normaliseVehicleIds(updates.attributes.vehicleIds).filter((vehicleId) =>
          allowedVehicleIds.has(String(vehicleId)),
        );
      }
    }

    const group = updateGroup(id, updates);
    invalidateGroupCache();
    return res.json({ group });
  } catch (error) {
    return next(error);
  }
  },
);

router.delete(
  "/groups/:id",
  authorizePermission({ menuKey: "admin", pageKey: "users", subKey: "users-vehicle-groups", requireFull: true }),
  async (req, res, next) => {
  try {
    ensureGroupWriteRole(req);
    const { id } = req.params;
    const existing = getGroupById(id);
    if (!existing) {
      throw createError(404, "Grupo não encontrado");
    }
    if (isGlobalPermissionGroup(existing) && !(await isAdminGeneralUser(req.user))) {
      throw createError(403, "Perfis globais só podem ser removidos pelo ADMIN GERAL");
    }
    if (req.mirrorContext) {
      if (String(existing.clientId) !== String(req.mirrorContext.ownerClientId)) {
        throw createError(404, "Grupo não encontrado");
      }
      if (existing.attributes?.kind !== "VEHICLE_GROUP") {
        throw createError(403, "Espelho permite apenas grupos de veículos");
      }
    } else if (req.user.role !== "admin") {
      ensureClientAccess(req.user, existing.clientId);
    }
    deleteGroup(id);
    invalidateGroupCache();
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
  },
);

export default router;
