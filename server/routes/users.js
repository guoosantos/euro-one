import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { requireAdminGeneral } from "../middleware/admin-general.js";
import { authorizePermission, resolvePermissionContext, invalidatePermissionContextCache } from "../middleware/permissions.js";
import { invalidateContextCache } from "./context.js";
import { getAdminGeneralClient, getClientById } from "../models/client.js";
import { getGroupById } from "../models/group.js";
import { ensureClientInScope, resolveTenantScope } from "../utils/tenant-scope.js";
import { findPermissionExpansion } from "../utils/permission-scope.js";
import {
  createUser,
  deleteUser,
  getUserById,
  listUsers,
  updateUser,
} from "../models/user.js";
import { getUserPreferences, resetUserPreferences, saveUserPreferences } from "../models/user-preferences.js";
import { createUserConfigTransferLog } from "../models/user-config-transfer.js";
import { listAuditEvents } from "../services/audit-log.js";

const router = express.Router();

router.use(authenticate);
router.use("/users", async (req, _res, next) => {
  try {
    if (req.user?.role !== "admin") {
      return next();
    }
    const adminGeneralClient = await getAdminGeneralClient();
    if (!adminGeneralClient) {
      throw createError(404, "Cliente ADMIN GERAL não encontrado");
    }
    if (!req.user.clientId || String(req.user.clientId) !== String(adminGeneralClient.id)) {
      throw createError(403, "Acesso permitido apenas para o ADMIN GERAL");
    }
    return next();
  } catch (error) {
    return next(error);
  }
});

async function ensureClientAccess(sessionUser, clientId) {
  if (sessionUser.role === "admin") {
    return;
  }
  await ensureClientInScope(sessionUser, clientId);
}

async function isAdminGeneralUser(sessionUser) {
  if (sessionUser?.role !== "admin") return false;
  if (!sessionUser?.clientId) return false;
  const adminGeneralClient = await getAdminGeneralClient().catch(() => null);
  if (!adminGeneralClient) return false;
  return String(sessionUser.clientId) === String(adminGeneralClient.id);
}

async function ensurePermissionGroupAssignment(req, permissionGroupId) {
  if (permissionGroupId === undefined || permissionGroupId === null || permissionGroupId === "") {
    return;
  }
  if (await isAdminGeneralUser(req.user)) {
    return;
  }
  const group = getGroupById(permissionGroupId);
  if (!group) {
    throw createError(404, "Grupo de permissões não encontrado");
  }
  if (group.attributes?.kind !== "PERMISSION_GROUP") {
    throw createError(400, "Grupo informado não é um grupo de permissões");
  }
  const context = await resolvePermissionContext(req);
  if (context?.isFull) {
    return;
  }
  const allowedPermissions = context?.permissions || {};
  const violation = findPermissionExpansion(group.attributes?.permissions || {}, allowedPermissions);
  if (violation) {
    throw createError(403, "Permissão insuficiente para conceder acesso fora do seu escopo");
  }
}

function ensureTenantAdminOwnClient(sessionUser, targetClientId) {
  if (sessionUser?.role !== "tenant_admin") return;
  if (!sessionUser?.clientId) {
    throw createError(403, "Cliente do administrador não identificado");
  }
  if (!targetClientId || String(targetClientId) !== String(sessionUser.clientId)) {
    throw createError(403, "Administrador do cliente só pode operar no próprio tenant");
  }
}

function normalizePermissionGroupId(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function normalizeTransferMode(value) {
  if (!value) return "OVERWRITE";
  const normalized = String(value).trim().toUpperCase();
  return normalized === "MERGE" ? "MERGE" : "OVERWRITE";
}

function uniqueList(items = []) {
  return Array.from(new Set(items.map((item) => String(item)).filter(Boolean)));
}

function resolveVehicleGroupIds(userAccess) {
  if (!userAccess) return [];
  const groupIds = Array.isArray(userAccess.vehicleGroupIds)
    ? userAccess.vehicleGroupIds
    : userAccess.vehicleGroupId
      ? [userAccess.vehicleGroupId]
      : [];
  return uniqueList(groupIds);
}

function mergeUserAccess(source = {}, target = {}) {
  const sourceAccess = source || {};
  const targetAccess = target || {};
  const mergedGroupIds = uniqueList([
    ...resolveVehicleGroupIds(targetAccess),
    ...resolveVehicleGroupIds(sourceAccess),
  ]);
  const sourceVehicleAccess = sourceAccess.vehicleAccess || {};
  const targetVehicleAccess = targetAccess.vehicleAccess || {};
  const mergedVehicleIds = uniqueList([
    ...(targetVehicleAccess.vehicleIds || []),
    ...(sourceVehicleAccess.vehicleIds || []),
  ]);
  return {
    ...sourceAccess,
    ...targetAccess,
    vehicleAccess: {
      ...sourceVehicleAccess,
      ...targetVehicleAccess,
      vehicleIds: mergedVehicleIds,
    },
    vehicleGroupIds: mergedGroupIds,
  };
}

async function transferUserConfig({ fromUserId, toUserId, mode, req }) {
  const source = await getUserById(fromUserId, { includeSensitive: true });
  if (!source) {
    throw createError(404, "Usuário origem não encontrado");
  }
  const target = await getUserById(toUserId, { includeSensitive: true });
  if (!target) {
    throw createError(404, "Usuário destino não encontrado");
  }

  if (req.user.role !== "admin") {
    ensureTenantAdminOwnClient(req.user, source.clientId);
    ensureTenantAdminOwnClient(req.user, target.clientId);
    await ensureClientAccess(req.user, source.clientId);
    await ensureClientAccess(req.user, target.clientId);
    if (String(source.clientId) !== String(target.clientId)) {
      throw createError(403, "Usuários devem pertencer ao mesmo cliente");
    }
    if (source.role === "admin" || target.role === "admin") {
      throw createError(403, "Não é permitido transferir acesso de administradores");
    }
  }

  const normalizedMode = normalizeTransferMode(mode);
  const sourceAttributes = source.attributes || {};
  const targetAttributes = target.attributes || {};
  const nextUserAccess =
    normalizedMode === "MERGE"
      ? mergeUserAccess(sourceAttributes.userAccess || {}, targetAttributes.userAccess || {})
      : sourceAttributes.userAccess || targetAttributes.userAccess;

  const nextPermissionGroupId =
    normalizedMode === "MERGE"
      ? targetAttributes.permissionGroupId || sourceAttributes.permissionGroupId || null
      : sourceAttributes.permissionGroupId || null;

  const nextMirrorAccess =
    normalizedMode === "MERGE"
      ? targetAttributes.mirrorAccess || sourceAttributes.mirrorAccess
      : sourceAttributes.mirrorAccess || targetAttributes.mirrorAccess;

  const nextAttributes = {
    ...targetAttributes,
    userAccess: nextUserAccess || targetAttributes.userAccess,
    permissionGroupId: nextPermissionGroupId,
    mirrorAccess: nextMirrorAccess,
  };

  await ensurePermissionGroupAssignment(req, nextPermissionGroupId);

  const updated = await updateUser(toUserId, { attributes: nextAttributes });

  const sourcePreferences = getUserPreferences(fromUserId);
  const targetPreferences = getUserPreferences(toUserId);
  if (normalizedMode === "OVERWRITE") {
    if (sourcePreferences) {
      saveUserPreferences(toUserId, sourcePreferences);
    } else {
      resetUserPreferences(toUserId);
    }
  } else if (normalizedMode === "MERGE" && !targetPreferences && sourcePreferences) {
    saveUserPreferences(toUserId, sourcePreferences);
  }

  const logEntry = createUserConfigTransferLog({
    fromUserId,
    toUserId,
    performedBy: req.user?.id || null,
    mode: normalizedMode,
    clientId: target.clientId || null,
  });

  return { updated, logEntry };
}

router.get(
  "/users",
  authorizePermission({ menuKey: "admin", pageKey: "users" }),
  async (req, res, next) => {
  try {
    if (req.user.role === "admin") {
      const { clientId } = req.query;
      const filterClientId = clientId === "" || typeof clientId === "undefined" ? undefined : clientId;
      const users = await listUsers({ clientId: filterClientId });
      return res.json({ users });
    }

    const scope = await resolveTenantScope(req.user);
    const requestedClientId =
      req.query?.clientId && req.query.clientId !== "" ? String(req.query.clientId) : null;
    const targetClientId = requestedClientId || req.user.clientId;
    if (!targetClientId) {
      return res.json({ users: [] });
    }
    if (!scope.clientIds.has(String(targetClientId))) {
      throw createError(403, "Permissão insuficiente para acessar este cliente");
    }
    const users = await listUsers({ clientId: targetClientId });
    return res.json({ users });
  } catch (error) {
    return next(error);
  }
  },
);

router.post(
  "/users",
  authorizePermission({ menuKey: "admin", pageKey: "users", requireFull: true }),
  async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      role = "user",
      username,
      clientId,
      permissionGroupId,
      attributes = {},
    } = req.body || {};
    if (!name || !email || !password) {
      throw createError(400, "Nome, e-mail e senha são obrigatórios");
    }
    const resolvedUsername = username || email;

    if (req.user.role !== "admin" && role !== "user") {
      throw createError(403, "Somente administradores podem criar papéis avançados");
    }

    let targetClientId = req.user.role === "admin" ? clientId : clientId || req.user.clientId;
    let adminClientId = null;
    if (role === "admin") {
      const adminGeneralClient = await getAdminGeneralClient();
      if (!adminGeneralClient) {
        throw createError(404, "Cliente ADMIN GERAL não encontrado");
      }
      adminClientId = targetClientId ? String(targetClientId) : String(adminGeneralClient.id);
      if (String(adminClientId) !== String(adminGeneralClient.id)) {
        throw createError(400, "Administradores globais devem pertencer ao cliente EURO ONE");
      }
    } else {
      if (!targetClientId) {
        throw createError(400, "clientId é obrigatório para usuários não administradores");
      }
      ensureTenantAdminOwnClient(req.user, targetClientId);
      await ensureClientAccess(req.user, targetClientId);
      const client = await getClientById(targetClientId);
      if (!client) {
        throw createError(404, "Cliente associado não encontrado");
      }
    }

    const resolvedPermissionGroupId = normalizePermissionGroupId(
      permissionGroupId !== undefined ? permissionGroupId : attributes.permissionGroupId,
    );
    const normalizedAttributes = {
      ...attributes,
      permissionGroupId: resolvedPermissionGroupId ?? null,
    };

    await ensurePermissionGroupAssignment(req, resolvedPermissionGroupId);

    const user = await createUser({
      name,
      email,
      username: resolvedUsername,
      password,
      role,
      clientId: role === "admin" ? adminClientId : targetClientId,
      attributes: normalizedAttributes,
    });
    return res.status(201).json({ user });
  } catch (error) {
    return next(error);
  }
  },
);

router.put(
  "/users/:id",
  authorizePermission({ menuKey: "admin", pageKey: "users", requireFull: true }),
  async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await getUserById(id, { includeSensitive: true });
    if (!existing) {
      throw createError(404, "Usuário não encontrado");
    }

    if (req.user.role !== "admin") {
      ensureTenantAdminOwnClient(req.user, existing.clientId);
      await ensureClientAccess(req.user, existing.clientId);
      if (existing.role === "admin") {
        throw createError(403, "Não é permitido atualizar administradores globais");
      }
      if (req.body.role && req.body.role !== "user") {
        throw createError(403, "Somente administradores podem alterar papéis");
      }
      if (req.body.clientId) {
        ensureTenantAdminOwnClient(req.user, req.body.clientId);
        await ensureClientAccess(req.user, req.body.clientId);
      }
    } else {
      if (req.body.role && req.body.role !== "admin") {
        const nextClientId = req.body.clientId ?? existing.clientId;
        if (!nextClientId) {
          throw createError(400, "clientId é obrigatório para usuários não administradores");
        }
        const client = await getClientById(nextClientId);
        if (!client) {
          throw createError(404, "Cliente associado não encontrado");
        }
      }
      if (req.body.role === "admin" || existing.role === "admin") {
        const adminGeneralClient = await getAdminGeneralClient();
        if (!adminGeneralClient) {
          throw createError(404, "Cliente ADMIN GERAL não encontrado");
        }
        const nextClientId = req.body.clientId ?? existing.clientId ?? null;
        if (!nextClientId || String(nextClientId) !== String(adminGeneralClient.id)) {
          throw createError(400, "Administradores globais devem pertencer ao cliente EURO ONE");
        }
      }
    }

    const payload = { ...req.body };
    if (payload.password === "") {
      delete payload.password;
    }
    const permissionGroupSource = Object.prototype.hasOwnProperty.call(req.body || {}, "permissionGroupId")
      ? req.body.permissionGroupId
      : Object.prototype.hasOwnProperty.call(req.body?.attributes || {}, "permissionGroupId")
        ? req.body.attributes.permissionGroupId
        : undefined;
    const resolvedPermissionGroupId = normalizePermissionGroupId(permissionGroupSource);
    if (resolvedPermissionGroupId !== undefined) {
      payload.attributes = {
        ...(existing.attributes || {}),
        ...(payload.attributes || {}),
        permissionGroupId: resolvedPermissionGroupId,
      };
    }

    if (resolvedPermissionGroupId !== undefined) {
      await ensurePermissionGroupAssignment(req, resolvedPermissionGroupId);
    }

    const user = await updateUser(id, payload);
    if (resolvedPermissionGroupId !== undefined) {
      invalidatePermissionContextCache();
      invalidateContextCache();
    }
    return res.json({ user });
  } catch (error) {
    return next(error);
  }
  },
);

router.get(
  "/users/:id/audit",
  authorizePermission({ menuKey: "admin", pageKey: "users" }),
  async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await getUserById(id);
    if (!existing) {
      throw createError(404, "Usuário não encontrado");
    }
    if (req.user.role !== "admin") {
      ensureTenantAdminOwnClient(req.user, existing.clientId);
      await ensureClientAccess(req.user, existing.clientId);
      if (existing.role === "admin") {
        throw createError(403, "Não é permitido consultar administradores globais");
      }
    }

    const categories = req.query?.categories
      ? String(req.query.categories)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
      : null;

    const events = listAuditEvents({
      clientId: existing.clientId ?? null,
      userId: id,
      from: req.query?.from,
      to: req.query?.to,
      categories,
    });
    const sorted = events.sort((a, b) => {
      const aTime = new Date(a.sentAt || a.respondedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.sentAt || b.respondedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    });
    return res.json({ data: sorted });
  } catch (error) {
    return next(error);
  }
  },
);

router.delete(
  "/users/:id",
  authorizePermission({ menuKey: "admin", pageKey: "users", requireFull: true }),
  async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await getUserById(id, { includeSensitive: true });
    if (!existing) {
      throw createError(404, "Usuário não encontrado");
    }
    if (req.user.role !== "admin") {
      ensureTenantAdminOwnClient(req.user, existing.clientId);
      await ensureClientAccess(req.user, existing.clientId);
      if (existing.role !== "user") {
        throw createError(403, "Somente administradores podem remover este usuário");
      }
    }
    await deleteUser(id);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
  },
);

router.post(
  "/users/:id/transfer-access",
  authorizePermission({ menuKey: "admin", pageKey: "users", requireFull: true }),
  async (req, res, next) => {
  try {
    const { id } = req.params;
    const { toUserId, mode } = req.body || {};
    if (!toUserId) {
      throw createError(400, "toUserId é obrigatório");
    }
    const { updated, logEntry } = await transferUserConfig({
      fromUserId: id,
      toUserId,
      mode: mode || "OVERWRITE",
      req,
    });
    return res.json({ user: updated, log: logEntry });
  } catch (error) {
    return next(error);
  }
  },
);

router.post(
  "/users/:id/transfer-config",
  authorizePermission({ menuKey: "admin", pageKey: "users", requireFull: true }),
  async (req, res, next) => {
  try {
    const { id } = req.params;
    const { fromUserId, mode } = req.body || {};
    if (!fromUserId) {
      throw createError(400, "fromUserId é obrigatório");
    }
    const { updated, logEntry } = await transferUserConfig({
      fromUserId,
      toUserId: id,
      mode: mode || "OVERWRITE",
      req,
    });
    return res.json({ user: updated, log: logEntry });
  } catch (error) {
    return next(error);
  }
  },
);

export default router;
