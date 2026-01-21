import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { requireAdminGeneral } from "../middleware/admin-general.js";
import { authorizePermission } from "../middleware/permissions.js";
import { getClientById, listClients } from "../models/client.js";
import { createGroup, getGroupById, listGroups, updateGroup } from "../models/group.js";
import { createMirror, deleteMirror, getMirrorById, listMirrors, updateMirror } from "../models/mirror.js";

const router = express.Router();

router.use(authenticate);

const RECEIVER_TYPES = new Set([
  "GERENCIADORA",
  "SEGURADORA",
  "GERENCIADORA DE RISCO",
  "COMPANHIA DE SEGURO",
  "COMPANHIA DE SEGUROS",
]);

function ensureOwnerAccess(sessionUser, ownerClientId) {
  if (sessionUser.role === "admin") {
    return;
  }
  if (!sessionUser.clientId || String(sessionUser.clientId) !== String(ownerClientId)) {
    throw createError(403, "Operação não permitida para este cliente");
  }
}

function ensureTargetAccess(sessionUser, targetClientId) {
  if (sessionUser.role === "admin") {
    return;
  }
  if (!sessionUser.clientId || String(sessionUser.clientId) !== String(targetClientId)) {
    throw createError(403, "Operação não permitida para este cliente");
  }
}

function resolveClientType(client) {
  return (
    client?.attributes?.clientProfile?.clientType
    || client?.attributes?.clientType
    || ""
  );
}

function isReceiverType(clientType) {
  return RECEIVER_TYPES.has(String(clientType || "").toUpperCase());
}

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

function resolveAllowedVehicleIds(req) {
  if (req.user?.role === "admin") return null;
  const userAccess = req.user?.attributes?.userAccess || {};
  if (userAccess.vehicleAccess?.mode === "all") return null;
  if (userAccess.vehicleAccess?.mode !== "selected") return null;
  const allowedIds = new Set((userAccess.vehicleAccess?.vehicleIds || []).map(String));
  const groupIds = Array.isArray(userAccess.vehicleGroupIds)
    ? userAccess.vehicleGroupIds
    : userAccess.vehicleGroupId
      ? [userAccess.vehicleGroupId]
      : [];
  if (groupIds.length && req.user?.clientId) {
    listGroups({ clientId: req.user.clientId })
      .filter(
        (group) =>
          groupIds.some((id) => String(id) === String(group.id))
          && group.attributes?.kind === "VEHICLE_GROUP",
      )
      .forEach((group) => {
        (group.attributes?.vehicleIds || []).forEach((id) => allowedIds.add(String(id)));
      });
  }
  return allowedIds;
}

async function ensureTemporaryGroup({ ownerClientId, vehicleIds, endAt, createdBy }) {
  const owner = await getClientById(ownerClientId);
  if (!owner) {
    throw createError(404, "Cliente de origem não encontrado");
  }
  const dateLabel = new Date().toISOString().slice(0, 10);
  const name = `TEMP - ${owner.name || ownerClientId} - ${dateLabel}`;
  return createGroup({
    name,
    description: "Grupo temporário criado para espelhamento",
    clientId: ownerClientId,
    attributes: {
      kind: "VEHICLE_GROUP",
      vehicleIds,
      temporary: true,
      expiresAt: endAt || null,
      expired: false,
      createdBy: createdBy || null,
    },
  });
}

function markTemporaryGroupExpired(mirror) {
  if (!mirror?.vehicleGroupId || !mirror?.endAt) return;
  const end = new Date(mirror.endAt);
  if (Number.isNaN(end.getTime())) return;
  if (end > new Date()) return;
  const group = getGroupById(mirror.vehicleGroupId);
  if (!group?.attributes?.temporary || group.attributes?.expired) return;
  updateGroup(group.id, {
    attributes: {
      ...group.attributes,
      expired: true,
      expiredAt: new Date().toISOString(),
    },
  });
}

router.get("/mirrors/context", authorizePermission({ menuKey: "admin", pageKey: "mirrors" }), async (req, res, next) => {
  try {
    if (req.user.role === "admin") {
      const allClients = await listClients();
      const targets = allClients.filter((client) => isReceiverType(resolveClientType(client)));
      return res.json({
        mode: "admin",
        clientType: "ADMIN",
        targets,
        owners: allClients,
      });
    }

    const currentClient = await getClientById(req.user.clientId);
    const clientType = resolveClientType(currentClient);
    if (isReceiverType(clientType)) {
      const mirrors = listMirrors({ targetClientId: req.user.clientId }).filter((mirror) => isMirrorActive(mirror));
      const ownerIds = Array.from(new Set(mirrors.map((mirror) => mirror.ownerClientId).filter(Boolean)));
      const directory = await listClients();
      const owners = directory.filter((client) => ownerIds.includes(String(client.id)));
      return res.json({
        mode: "target",
        clientType,
        owners,
        targets: [],
      });
    }

    const directory = await listClients();
    const targets = directory.filter((client) => isReceiverType(resolveClientType(client)));
    return res.json({
      mode: "owner",
      clientType,
      owners: [],
      targets,
    });
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/mirrors",
  authorizePermission({ menuKey: "admin", pageKey: "mirrors" }),
  async (req, res, next) => {
    try {
      const { ownerClientId, targetClientId } = req.query || {};
      const allowedVehicleIds = resolveAllowedVehicleIds(req);
      const clientDirectory = await listClients();
      const clientNameMap = new Map(clientDirectory.map((client) => [String(client.id), client.name]));
      if (req.user.role !== "admin") {
        if (targetClientId) {
          ensureTargetAccess(req.user, targetClientId);
          const mirrors = listMirrors({ targetClientId }).map((mirror) => {
            const group = mirror.vehicleGroupId ? getGroupById(mirror.vehicleGroupId) : null;
            return {
              ...mirror,
              vehicleIds: allowedVehicleIds
                ? (mirror.vehicleIds || []).filter((id) => allowedVehicleIds.has(String(id)))
                : mirror.vehicleIds || [],
              ownerClientName: clientNameMap.get(String(mirror.ownerClientId)) || null,
              targetClientName: clientNameMap.get(String(mirror.targetClientId)) || null,
              vehicleGroupName: group?.name || null,
            };
          });
          mirrors.forEach(markTemporaryGroupExpired);
          return res.json({ mirrors });
        }
        const resolvedOwner = ownerClientId || req.user.clientId;
        ensureOwnerAccess(req.user, resolvedOwner);
        const mirrors = listMirrors({ ownerClientId: resolvedOwner }).map((mirror) => {
          const group = mirror.vehicleGroupId ? getGroupById(mirror.vehicleGroupId) : null;
          return {
            ...mirror,
            vehicleIds: allowedVehicleIds
              ? (mirror.vehicleIds || []).filter((id) => allowedVehicleIds.has(String(id)))
              : mirror.vehicleIds || [],
            ownerClientName: clientNameMap.get(String(mirror.ownerClientId)) || null,
            targetClientName: clientNameMap.get(String(mirror.targetClientId)) || null,
            vehicleGroupName: group?.name || null,
          };
        });
        mirrors.forEach(markTemporaryGroupExpired);
        return res.json({ mirrors });
      }

      const mirrors = listMirrors({
        ownerClientId: ownerClientId || undefined,
        targetClientId: targetClientId || undefined,
      }).map((mirror) => {
        const group = mirror.vehicleGroupId ? getGroupById(mirror.vehicleGroupId) : null;
        return {
          ...mirror,
          vehicleIds: mirror.vehicleIds || [],
          ownerClientName: clientNameMap.get(String(mirror.ownerClientId)) || null,
          targetClientName: clientNameMap.get(String(mirror.targetClientId)) || null,
          vehicleGroupName: group?.name || null,
        };
      });
      mirrors.forEach(markTemporaryGroupExpired);
      return res.json({ mirrors });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/mirrors",
  authorizePermission({ menuKey: "admin", pageKey: "mirrors", requireFull: true }),
  requireRole("manager", "admin"),
  async (req, res, next) => {
  try {
    const {
      ownerClientId,
      targetClientId,
      targetType,
      vehicleIds = [],
      vehicleGroupId = null,
      permissionGroupId = null,
      startAt = null,
      endAt = null,
    } = req.body || {};

    const resolvedOwnerId = req.user.role === "admin" ? ownerClientId : req.user.clientId;
    if (!resolvedOwnerId) {
      throw createError(400, "ownerClientId é obrigatório");
    }
    ensureOwnerAccess(req.user, resolvedOwnerId);

    const ownerClient = await getClientById(resolvedOwnerId);
    if (!ownerClient) {
      throw createError(404, "Cliente de origem não encontrado");
    }
    const targetClient = await getClientById(targetClientId);
    if (!targetClient) {
      throw createError(404, "Cliente recebedor não encontrado");
    }

    const ownerType = resolveClientType(ownerClient);
    if (req.user.role !== "admin" && isReceiverType(ownerType)) {
      throw createError(403, "Somente clientes finais podem criar espelhamentos");
    }

    let resolvedVehicleGroupId = vehicleGroupId ? String(vehicleGroupId) : null;
    let resolvedVehicleIds = Array.isArray(vehicleIds) ? vehicleIds.map(String) : [];
    if (resolvedVehicleGroupId) {
      const group = getGroupById(resolvedVehicleGroupId);
      if (!group || String(group.clientId) !== String(resolvedOwnerId)) {
        throw createError(404, "Grupo de veículos não encontrado");
      }
      resolvedVehicleIds = Array.isArray(group.attributes?.vehicleIds)
        ? group.attributes.vehicleIds.map(String)
        : [];
    } else if (resolvedVehicleIds.length) {
      const tempGroup = await ensureTemporaryGroup({
        ownerClientId: resolvedOwnerId,
        vehicleIds: resolvedVehicleIds,
        endAt,
        createdBy: req.user?.id,
      });
      resolvedVehicleGroupId = tempGroup.id;
    }

    const allowedVehicleIds = resolveAllowedVehicleIds(req);
    if (allowedVehicleIds && resolvedVehicleIds.some((id) => !allowedVehicleIds.has(String(id)))) {
      throw createError(403, "Veículos informados não disponíveis para este usuário");
    }

    const mirror = createMirror({
      ownerClientId: resolvedOwnerId,
      targetClientId,
      targetType,
      vehicleIds: resolvedVehicleIds,
      vehicleGroupId: resolvedVehicleGroupId,
      permissionGroupId,
      startAt,
      endAt,
      createdBy: req.user?.id || null,
      createdByName: req.user?.name || req.user?.email || null,
    });

    return res.status(201).json({ mirror });
  } catch (error) {
    return next(error);
  }
  },
);

router.put(
  "/mirrors/:id",
  authorizePermission({ menuKey: "admin", pageKey: "mirrors", requireFull: true }),
  requireRole("manager", "admin"),
  async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = getMirrorById(id);
    if (!existing) {
      throw createError(404, "Espelhamento não encontrado");
    }
    const isOwner = String(req.user.clientId) === String(existing.ownerClientId);
    const isTarget = String(req.user.clientId) === String(existing.targetClientId);
    if (req.user.role !== "admin" && !isOwner && !isTarget) {
      throw createError(403, "Operação não permitida para este cliente");
    }

    if (req.user.role === "admin" && Object.prototype.hasOwnProperty.call(req.body || {}, "ownerClientId")) {
      const ownerClient = await getClientById(req.body.ownerClientId);
      if (!ownerClient) {
        throw createError(404, "Cliente de origem não encontrado");
      }
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "targetClientId")) {
      const targetClient = await getClientById(req.body.targetClientId);
      if (!targetClient) {
        throw createError(404, "Cliente recebedor não encontrado");
      }
    }

    if (req.user.role !== "admin" && isTarget && !isOwner) {
      const mirror = updateMirror(id, { permissionGroupId: req.body?.permissionGroupId || null });
      return res.json({ mirror });
    }

    const updates = { ...(req.body || {}) };
    let resolvedVehicleGroupId = updates.vehicleGroupId ? String(updates.vehicleGroupId) : existing.vehicleGroupId || null;
    let resolvedVehicleIds = Array.isArray(updates.vehicleIds)
      ? updates.vehicleIds.map(String)
      : existing.vehicleIds || [];
    if (resolvedVehicleGroupId) {
      const group = getGroupById(resolvedVehicleGroupId);
      if (!group || String(group.clientId) !== String(existing.ownerClientId)) {
        throw createError(404, "Grupo de veículos não encontrado");
      }
      resolvedVehicleIds = Array.isArray(group.attributes?.vehicleIds)
        ? group.attributes.vehicleIds.map(String)
        : [];
    } else if (Array.isArray(updates.vehicleIds) && updates.vehicleIds.length) {
      const tempGroup = await ensureTemporaryGroup({
        ownerClientId: existing.ownerClientId,
        vehicleIds: resolvedVehicleIds,
        endAt: updates.endAt || existing.endAt,
        createdBy: req.user?.id,
      });
      resolvedVehicleGroupId = tempGroup.id;
    }

    const allowedVehicleIds = resolveAllowedVehicleIds(req);
    if (allowedVehicleIds && resolvedVehicleIds.some((id) => !allowedVehicleIds.has(String(id)))) {
      throw createError(403, "Veículos informados não disponíveis para este usuário");
    }

    updates.vehicleIds = resolvedVehicleIds;
    updates.vehicleGroupId = resolvedVehicleGroupId;

    const mirror = updateMirror(id, updates);
    return res.json({ mirror });
  } catch (error) {
    return next(error);
  }
  },
);

router.delete(
  "/mirrors/:id",
  authorizePermission({ menuKey: "admin", pageKey: "mirrors", requireFull: true }),
  requireRole("manager", "admin"),
  requireAdminGeneral,
  (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = getMirrorById(id);
    if (!existing) {
      throw createError(404, "Espelhamento não encontrado");
    }
    if (req.user.role !== "admin") {
      ensureOwnerAccess(req.user, existing.ownerClientId);
    }
    deleteMirror(id);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
  },
);

export default router;
