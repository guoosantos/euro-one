import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { getClientById } from "../models/client.js";
import { createMirror, deleteMirror, getMirrorById, listMirrors, updateMirror } from "../models/mirror.js";

const router = express.Router();

router.use(authenticate);

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

router.get("/mirrors", (req, res, next) => {
  try {
    const { ownerClientId, targetClientId } = req.query || {};
    if (req.user.role !== "admin") {
      if (targetClientId) {
        ensureTargetAccess(req.user, targetClientId);
        const mirrors = listMirrors({ targetClientId });
        return res.json({ mirrors });
      }
      const resolvedOwner = ownerClientId || req.user.clientId;
      ensureOwnerAccess(req.user, resolvedOwner);
      const mirrors = listMirrors({ ownerClientId: resolvedOwner });
      return res.json({ mirrors });
    }

    const mirrors = listMirrors({
      ownerClientId: ownerClientId || undefined,
      targetClientId: targetClientId || undefined,
    });
    return res.json({ mirrors });
  } catch (error) {
    return next(error);
  }
});

router.post("/mirrors", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const {
      ownerClientId,
      targetClientId,
      targetType,
      vehicleIds = [],
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

    const mirror = createMirror({
      ownerClientId: resolvedOwnerId,
      targetClientId,
      targetType,
      vehicleIds,
      permissionGroupId,
      startAt,
      endAt,
    });

    return res.status(201).json({ mirror });
  } catch (error) {
    return next(error);
  }
});

router.put("/mirrors/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = getMirrorById(id);
    if (!existing) {
      throw createError(404, "Espelhamento não encontrado");
    }
    if (req.user.role !== "admin") {
      ensureOwnerAccess(req.user, existing.ownerClientId);
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

    const mirror = updateMirror(id, req.body || {});
    return res.json({ mirror });
  } catch (error) {
    return next(error);
  }
});

router.delete("/mirrors/:id", requireRole("manager", "admin"), (req, res, next) => {
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
});

export default router;
