import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { createGeofence, deleteGeofence, getGeofenceById, listGeofences, updateGeofence } from "../models/geofence.js";
import { listGeofenceGroups } from "../models/geofence-group.js";
import { buildGeofencesKml, parseGeofencePlacemarks } from "../utils/kml.js";

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

router.get("/geofences/export/kml", async (req, res, next) => {
  try {
    const targetClientId = resolveClientId(req, req.query?.clientId);
    if (!targetClientId) {
      throw createError(400, "clientId é obrigatório para exportar");
    }
    const geofences = await listGeofences({ clientId: targetClientId });
    const kml = buildGeofencesKml(geofences);
    res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
    return res.send(kml);
  } catch (error) {
    return next(error);
  }
});

router.post("/geofences/import/kml", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const { kml, clientId: providedClientId, groupId = null, color = null } = req.body || {};
    const targetClientId = resolveClientId(req, providedClientId);
    if (!targetClientId) {
      throw createError(400, "clientId é obrigatório");
    }
    if (!kml) {
      throw createError(400, "Arquivo KML é obrigatório");
    }
    if (groupId) {
      const groups = await listGeofenceGroups({ clientId: targetClientId });
      const exists = groups.some((group) => String(group.id) === String(groupId));
      if (!exists) {
        throw createError(400, "Grupo de geofence inválido para este cliente");
      }
    }

    const placemarks = parseGeofencePlacemarks(kml);
    if (!placemarks.length) {
      throw createError(400, "Nenhuma geometria válida encontrada no KML");
    }

    const created = [];
    for (const placemark of placemarks) {
      const geofence = await createGeofence({
        clientId: targetClientId,
        groupId,
        name: placemark.name,
        type: "polygon",
        points: placemark.points,
        color,
      });
      created.push(geofence);
    }

    return res.status(201).json({ geofences: created, imported: created.length });
  } catch (error) {
    return next(error);
  }
});

router.get("/geofences", async (req, res, next) => {
  try {
    const targetClientId = resolveClientId(req, req.query?.clientId);
    if (!targetClientId && req.user.role !== "admin") {
      return res.json({ geofences: [] });
    }
    const { groupId } = req.query || {};
    const geofences = await listGeofences({
      ...(targetClientId ? { clientId: targetClientId } : {}),
      ...(groupId ? { groupId } : {}),
    });
    return res.json({ geofences });
  } catch (error) {
    return next(error);
  }
});

router.get("/geofences/:id", async (req, res, next) => {
  try {
    const geofence = await getGeofenceById(req.params.id);
    if (!geofence) {
      throw createError(404, "Geofence não encontrada");
    }
    ensureSameTenant(req.user, geofence.clientId);
    return res.json({ geofence });
  } catch (error) {
    return next(error);
  }
});

router.post("/geofences", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const targetClientId = resolveClientId(req, req.body?.clientId);
    if (!targetClientId) {
      throw createError(400, "clientId é obrigatório");
    }
    const geofence = await createGeofence({
      ...req.body,
      clientId: targetClientId,
    });
    return res.status(201).json({ geofence });
  } catch (error) {
    return next(error);
  }
});

router.put("/geofences/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const existing = await getGeofenceById(req.params.id);
    if (!existing) {
      throw createError(404, "Geofence não encontrada");
    }
    ensureSameTenant(req.user, existing.clientId);
    if (req.user.role !== "admin" && req.body?.clientId && String(req.body.clientId) !== String(existing.clientId)) {
      throw createError(403, "Não é permitido mover geofences para outro cliente");
    }
    const geofence = await updateGeofence(req.params.id, {
      ...req.body,
      clientId: req.user.role === "admin" ? req.body?.clientId || existing.clientId : existing.clientId,
    });
    return res.json({ geofence });
  } catch (error) {
    return next(error);
  }
});

router.delete("/geofences/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const existing = await getGeofenceById(req.params.id);
    if (!existing) {
      throw createError(404, "Geofence não encontrada");
    }
    ensureSameTenant(req.user, existing.clientId);
    await deleteGeofence(req.params.id);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
