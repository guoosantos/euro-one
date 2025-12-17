import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import {
  createGeofenceGroup,
  deleteGeofenceGroup,
  getGeofenceGroupById,
  listGeofenceGroups,
  updateGeofenceGroup,
} from "../models/geofence-group.js";

const router = express.Router();

router.use(authenticate);

function resolveClientId(req, provided) {
  if (req.user.role === "admin") {
    return provided || req.query?.clientId || req.user.clientId || null;
  }
  return req.user.clientId || null;
}

function ensureSameTenant(user, clientId) {
  if (user.role === "admin") return;
  if (!user.clientId || String(user.clientId) !== String(clientId)) {
    throw createError(403, "Operação não permitida para este cliente");
  }
}

router.get("/geofence-groups", async (req, res, next) => {
  try {
    const targetClientId = resolveClientId(req, req.query?.clientId);
    if (!targetClientId && req.user.role !== "admin") {
      return res.json({ groups: [] });
    }
    const groups = await listGeofenceGroups(targetClientId ? { clientId: targetClientId } : {});
    return res.json({ groups });
  } catch (error) {
    return next(error);
  }
});

router.post("/geofence-groups", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const { name, description = null, color = null } = req.body || {};
    const clientId = resolveClientId(req, req.body?.clientId);
    if (!clientId) {
      throw createError(400, "clientId é obrigatório");
    }
    const group = await createGeofenceGroup({ clientId, name, description, color });
    return res.status(201).json({ group });
  } catch (error) {
    return next(error);
  }
});

router.put("/geofence-groups/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await getGeofenceGroupById(id);
    if (!existing) {
      throw createError(404, "Grupo não encontrado");
    }
    ensureSameTenant(req.user, existing.clientId);
    if (req.user.role !== "admin" && req.body?.clientId && String(req.body.clientId) !== String(existing.clientId)) {
      throw createError(403, "Não é permitido mover grupos para outro cliente");
    }
    const group = await updateGeofenceGroup(id, { ...req.body, clientId: req.user.role === "admin" ? req.body?.clientId : existing.clientId });
    return res.json({ group });
  } catch (error) {
    return next(error);
  }
});

router.delete("/geofence-groups/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await getGeofenceGroupById(id);
    if (!existing) {
      throw createError(404, "Grupo não encontrado");
    }
    ensureSameTenant(req.user, existing.clientId);
    await deleteGeofenceGroup(id);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
