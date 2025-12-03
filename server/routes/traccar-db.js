import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { resolveClientIdMiddleware } from "../middleware/resolve-client.js";
import { resolveClientId } from "../middleware/client.js";
import { findDeviceByTraccarIdInDb, listDevices } from "../models/device.js";
import { fetchEvents, fetchTripsByDevice, isTraccarDbConfigured } from "../services/traccar-db.js";
import { buildTraccarUnavailableError } from "../services/traccar.js";

const router = express.Router();

router.use(authenticate);

function ensureDbReady() {
  if (!isTraccarDbConfigured()) {
    throw buildTraccarUnavailableError(createError(503, "Banco do Traccar não configurado"), {
      stage: "db-config",
    });
  }
}

async function ensureDeviceAllowed(deviceId, clientId) {
  const devices = listDevices({ clientId });
  const match = devices.find((item) => item.traccarId && String(item.traccarId) === String(deviceId));
  if (match) return match;

  const dbRecord = await findDeviceByTraccarIdInDb(deviceId, { clientId });
  if (dbRecord) return dbRecord;

  throw createError(404, "Dispositivo não encontrado para este cliente");
}

function parseDate(value, label) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createError(400, `Data inválida em ${label}`);
  }
  return parsed.toISOString();
}

router.get("/traccar/reports/trips", resolveClientIdMiddleware, async (req, res, next) => {
  try {
    ensureDbReady();
    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const deviceId = req.query.deviceId;
    if (!deviceId) {
      throw createError(400, "deviceId é obrigatório");
    }

    await ensureDeviceAllowed(deviceId, clientId);

    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to");
    if (!from || !to) {
      throw createError(400, "Período obrigatório: from e to");
    }

    const trips = await fetchTripsByDevice(deviceId, from, to);
    res.json({ deviceId, from, to, trips });
  } catch (error) {
    next(error);
  }
});

router.get("/traccar/events", resolveClientIdMiddleware, async (req, res, next) => {
  try {
    ensureDbReady();
    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const deviceId = req.query.deviceId;
    if (!deviceId) {
      throw createError(400, "deviceId é obrigatório");
    }

    await ensureDeviceAllowed(deviceId, clientId);

    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to");
    const limit = Number(req.query.limit) || 50;

    const events = await fetchEvents(deviceId, from, to, limit);
    res.json({ deviceId, from, to, events });
  } catch (error) {
    next(error);
  }
});

export default router;
