import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { listModels } from "../models/model.js";
import { listDevices } from "../models/device.js";

const router = express.Router();

router.use(authenticate);

function resolveClientId(req) {
  if (req.user?.role === "admin") {
    return req.query?.clientId || req.user?.clientId || null;
  }
  if (!req.user?.clientId) {
    throw createError(400, "Usuário não vinculado a um cliente");
  }
  if (req.query?.clientId && String(req.query.clientId) !== String(req.user.clientId)) {
    throw createError(403, "Operação não permitida para este cliente");
  }
  return req.user.clientId;
}

router.get("/models", (req, res, next) => {
  try {
    const clientId = resolveClientId(req);
    const models = listModels({ clientId, includeGlobal: true });
    const devices = listDevices({ clientId });
    const counts = new Map();

    devices.forEach((device) => {
      if (!device?.modelId) return;
      const modelId = String(device.modelId);
      if (!counts.has(modelId)) {
        counts.set(modelId, { available: 0, linked: 0 });
      }
      const bucket = counts.get(modelId);
      if (device.vehicleId) {
        bucket.linked += 1;
      } else {
        bucket.available += 1;
      }
    });

    const payload = models.map((model) => {
      const modelCounts = counts.get(String(model.id)) || { available: 0, linked: 0 };
      return {
        ...model,
        availableCount: modelCounts.available,
        linkedCount: modelCounts.linked,
      };
    });
    res.json({ models: payload });
  } catch (error) {
    next(error);
  }
});

export default router;
