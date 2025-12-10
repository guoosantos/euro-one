import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { resolveClientIdMiddleware } from "../middleware/resolve-client.js";
import { resolveClientId } from "../middleware/client.js";
import { findDeviceByTraccarIdInDb, listDevices } from "../models/device.js";
import { fetchEvents, isTraccarDbConfigured } from "../services/traccar-db.js";
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

/**
 * Relatórios de viagens (Trips) – chama o Traccar direto com Accept: application/json
 */
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

    const type = req.query.type || "all";
    const wantsCsv = String(req.query.format || "").toLowerCase() === "csv";

    // IMPORTANTE: base SEM /api, e o path JÁ com /api/...
    const baseUrl = process.env.TRACCAR_URL || "http://localhost:8082";
    const url = new URL("/api/reports/trips", baseUrl);
    url.searchParams.set("deviceId", deviceId);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    url.searchParams.set("type", type);

    const username = process.env.TRACCAR_USERNAME || "admin";
    const password = process.env.TRACCAR_PASSWORD || "admin";
    const authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: wantsCsv ? "text/csv" : "application/json",
        Authorization: authHeader,
      },
    });

    if (!response.ok) {
      throw buildTraccarUnavailableError(
        createError(503, `Falha ao gerar relatório no Traccar (status ${response.status})`),
        { stage: "reports-trips-http", status: response.status }
      );
    }

    if (wantsCsv) {
      const buffer = Buffer.from(await response.arrayBuffer());
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=trips-${deviceId}.csv`);
      res.send(buffer);
      return;
    }

    const trips = await response.json();

    res.json({
      data: {
        deviceId,
        from,
        to,
        trips,
      },
      error: null,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/events", resolveClientIdMiddleware, async (req, res, next) => {
  try {
    ensureDbReady();

    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const rawDeviceIds = req.query.deviceIds ?? req.query.deviceId;
    const requestedIds = Array.isArray(rawDeviceIds)
      ? rawDeviceIds
      : typeof rawDeviceIds === "string"
      ? rawDeviceIds.split(",")
      : [];

    let deviceIds = requestedIds.map((value) => String(value).trim()).filter(Boolean);

    if (deviceIds.some((value) => !/^\d+$/.test(value))) {
      throw createError(400, "deviceId inválido");
    }

    if (!deviceIds.length) {
      const clientDevices = listDevices({ clientId });
      deviceIds = clientDevices
        .filter((item) => item?.traccarId)
        .map((item) => String(item.traccarId))
        .filter(Boolean);
    } else {
      await Promise.all(deviceIds.map((id) => ensureDeviceAllowed(id, clientId)));
    }

    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const defaultTo = now.toISOString();

    const from = parseDate(req.query.from ?? defaultFrom, "from");
    const to = parseDate(req.query.to ?? defaultTo, "to");
    const limit = Number(req.query.limit) || 200;

    const events = deviceIds.length ? await fetchEvents(deviceIds, from, to, limit) : [];

    res.json({
      data: {
        events,
        deviceIds,
        from,
        to,
      },
      error: null,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Eventos – continuam usando o serviço baseado no banco do Traccar
 */
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

    const events = await fetchEvents([deviceId], from, to, limit);
    res.json({ deviceId, from, to, events });
  } catch (error) {
    next(error);
  }
});

export default router;
