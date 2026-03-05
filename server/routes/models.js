import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { listModels } from "../models/model.js";
import { listDevices } from "../models/device.js";
import prisma, { isPrismaAvailable } from "../services/prisma.js";
import { buildInternalCode, normalizePrefix } from "../utils/internal-code.js";
import {
  buildModelDeviceCounts as buildModelDeviceCountsUtil,
  buildModelInternalSequences as buildModelInternalSequencesUtil,
  mergeDevicesForModelStats,
} from "../utils/model-stats.js";

const router = express.Router();

router.use(authenticate);

export function buildModelDeviceCounts(devices = []) {
  return buildModelDeviceCountsUtil(devices);
}

export function buildModelInternalSequences(devices = [], models = []) {
  return buildModelInternalSequencesUtil(devices, models);
}

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

router.get("/models", async (req, res, next) => {
  try {
    const clientId = resolveClientId(req);
    const models = listModels({ clientId, includeGlobal: true });
    const query = String(req.query?.query || "").trim().toLowerCase();
    const page = Math.max(1, Number(req.query?.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query?.pageSize) || 20));
    let dbDevices = [];
    if (isPrismaAvailable()) {
      try {
        dbDevices = await prisma.device.findMany({
          where: clientId ? { clientId: String(clientId) } : {},
          select: { id: true, modelId: true, vehicleId: true, uniqueId: true, traccarId: true, attributes: true },
        });
      } catch (dbError) {
        console.warn("[models] falha ao consultar devices no banco", dbError?.message || dbError);
      }
    }
    const legacyDevices = listDevices({ clientId });
    const devices = mergeDevicesForModelStats(dbDevices, legacyDevices);
    const counts = buildModelDeviceCounts(devices);
    const sequences = buildModelInternalSequences(devices, models);

    let payload = models.map((model) => {
      const modelCounts = counts.get(String(model.id)) || { available: 0, linked: 0, total: 0 };
      const prefix = normalizePrefix(model?.prefix ?? model?.internalPrefix ?? model?.codePrefix ?? null);
      const maxSequence = Math.max(Number(model.internalSequence) || 0, sequences.get(String(model.id)) || 0);
      const nextInternalCode = prefix ? buildInternalCode(prefix, maxSequence + 1) : null;
      return {
        ...model,
        availableCount: modelCounts.available,
        linkedCount: modelCounts.linked,
        totalCount: modelCounts.total,
        nextInternalCode,
      };
    });
    if (query) {
      payload = payload.filter((model) => {
        const haystack = [
          model.name,
          model.model,
          model.brand,
          model.vendor,
          model.protocol,
          model.id,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      });
    }

    const total = payload.length;
    const start = (page - 1) * pageSize;
    const paged = payload.slice(start, start + pageSize);
    res.json({
      models: paged,
      page,
      pageSize,
      total,
      hasMore: start + pageSize < total,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
