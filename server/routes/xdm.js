import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { resolveClientId } from "../middleware/client.js";
import { applyGeozoneGroupToDevice } from "../services/xdm/device-geozone-group-service.js";

const router = express.Router();

router.use(authenticate);

router.post("/xdm/geozone-group/apply", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    const { deviceUid, geofenceIds, itineraryId, groupName, geofences } = req.body || {};

    if (!deviceUid) {
      throw createError(400, "deviceUid é obrigatório");
    }

    if (!itineraryId && (!Array.isArray(geofenceIds) || geofenceIds.length === 0)) {
      throw createError(400, "geofenceIds ou itineraryId é obrigatório");
    }

    const geofencesById =
      Array.isArray(geofences) && geofences.length
        ? new Map(geofences.map((geofence) => [String(geofence.id), geofence]))
        : null;

    const result = await applyGeozoneGroupToDevice({
      clientId,
      deviceUid,
      geofenceIds,
      itineraryId,
      groupName,
      geofencesById,
    });

    return res.status(200).json({ data: result, error: null });
  } catch (error) {
    return next(error);
  }
});

export default router;
