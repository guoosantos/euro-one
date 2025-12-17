import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";

import { getClientById } from "../models/client.js";

import {
  createGeofenceGroup,
  deleteGeofenceGroup,
  getGeofenceGroupById,
  listGeofenceGroups,

  setGeofencesForGroup,

  updateGeofenceGroup,
} from "../models/geofence-group.js";

const router = express.Router();

router.use(authenticate);


function ensureClientAccess(sessionUser, targetClientId) {
  if (sessionUser.role === "admin") return;
  if (!sessionUser.clientId || String(sessionUser.clientId) !== String(targetClientId)) {

    throw createError(403, "Operação não permitida para este cliente");
  }
}


router.get("/geofence-groups", (req, res, next) => {
  try {
    const includeGeofences = String(req.query.includeGeofences || "") === "true";
    if (req.user.role === "admin") {
      const { clientId } = req.query;
      const resolvedClientId = clientId === "" || typeof clientId === "undefined" ? undefined : clientId;
      const groups = listGeofenceGroups({ clientId: resolvedClientId, includeGeofences });
      return res.json({ groups });
    }

    if (!req.user.clientId) {
      return res.json({ groups: [] });
    }
    const groups = listGeofenceGroups({ clientId: req.user.clientId, includeGeofences });

    return res.json({ groups });
  } catch (error) {
    return next(error);
  }
});


router.get("/geofence-groups/:id", (req, res, next) => {
  try {
    const includeGeofences = String(req.query.includeGeofences || "") === "true";
    const existing = getGeofenceGroupById(req.params.id, { includeGeofences });
    if (!existing) {
      throw createError(404, "Grupo não encontrado");
    }
    ensureClientAccess(req.user, existing.clientId);
    return res.json({ group: existing });
  } catch (error) {
    return next(error);
  }
});

router.post("/geofence-groups", requireRole("manager", "admin"), (req, res, next) => {
  try {
    const { name, description = null, color = null, geofenceIds = [], clientId } = req.body || {};
    if (!name) {
      throw createError(400, "Nome é obrigatório");
    }

    let targetClientId = clientId;
    if (req.user.role !== "admin") {
      targetClientId = req.user.clientId;
    }
    if (!targetClientId) {
      throw createError(400, "clientId é obrigatório");
    }
    const client = getClientById(targetClientId);
    if (!client) {
      throw createError(404, "Cliente associado não encontrado");
    }

    const group = createGeofenceGroup({
      name,
      description,
      color,
      clientId: targetClientId,
    });

    let payload = group;
    if (Array.isArray(geofenceIds) && geofenceIds.length) {
      payload = setGeofencesForGroup(group.id, geofenceIds, { clientId: targetClientId });
    }

    return res.status(201).json({ group: payload });
  } catch (error) {
    return next(error);
  }
});

router.put("/geofence-groups/:id", requireRole("manager", "admin"), (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = getGeofenceGroupById(id);
    if (!existing) {
      throw createError(404, "Grupo não encontrado");
    }

    if (req.user.role !== "admin") {
      ensureClientAccess(req.user, existing.clientId);
      if (req.body?.clientId && String(req.body.clientId) !== String(req.user.clientId)) {
        throw createError(403, "Não é permitido mover grupos para outro cliente");
      }
    } else if (Object.prototype.hasOwnProperty.call(req.body || {}, "clientId")) {
      if (!req.body.clientId) {
        throw createError(400, "clientId é obrigatório");
      }
      const client = getClientById(req.body.clientId);
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

    const group = updateGeofenceGroup(id, updates);
    return res.json({ group });

  } catch (error) {
    return next(error);
  }
});


router.put("/geofence-groups/:id/geofences", requireRole("manager", "admin"), (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = getGeofenceGroupById(id);
    if (!existing) {
      throw createError(404, "Grupo não encontrado");
    }
    ensureClientAccess(req.user, existing.clientId);
    if (!Array.isArray(req.body?.geofenceIds)) {
      throw createError(400, "geofenceIds precisa ser um array");
    }
    const group = setGeofencesForGroup(id, req.body.geofenceIds, { clientId: existing.clientId });

    return res.json({ group });
  } catch (error) {
    return next(error);
  }
});


router.delete("/geofence-groups/:id", requireRole("manager", "admin"), (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = getGeofenceGroupById(id);
    if (!existing) {
      throw createError(404, "Grupo não encontrado");
    }
    ensureClientAccess(req.user, existing.clientId);
    deleteGeofenceGroup(id);

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
