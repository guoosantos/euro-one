import express from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { ensureSameTenant, resolveClientId } from "../middleware/client.js";
import { listDevicesFromDb } from "../models/device.js";
import {
  deleteEventMapping,
  deleteTelemetryFieldMapping,
  listEventMappings,
  listTelemetryFieldMappings,
  upsertEventMapping,
  upsertTelemetryFieldMapping,
} from "../models/tracker-mapping.js";
import { fetchDevicesMetadata, isTraccarDbConfigured } from "../services/traccar-db.js";

const router = express.Router();

router.use(authenticate, requireRole("admin"));

router.get("/tracker/devices", async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const metadata = isTraccarDbConfigured() ? await fetchDevicesMetadata() : [];
    const persisted = await listDevicesFromDb({ clientId });
    const persistedByTraccarId = new Map(persisted.map((device) => [String(device.traccarId), device]));

    const merged = metadata.map((item) => {
      const match = persistedByTraccarId.get(String(item.id));
      return {
        id: String(item.id),
        uniqueId: item.uniqueId || match?.uniqueId || null,
        name: item.name || match?.name || match?.uniqueId || null,
        status: item.status || "unknown",
        lastUpdate: item.lastUpdate || match?.updatedAt || null,
        protocol: match?.model?.protocol || match?.attributes?.protocol || null,
        clientId: match?.clientId || null,
        vehicleId: match?.vehicleId || null,
      };
    });

    return res.json({ devices: merged });
  } catch (error) {
    next(error);
  }
});

router.get("/tracker/mappings", async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const deviceId = req.query?.deviceId || null;
    const protocol = req.query?.protocol || null;

    const telemetry = await listTelemetryFieldMappings({ clientId, deviceId, protocol });
    const events = await listEventMappings({ clientId, deviceId, protocol });

    return res.json({ telemetry, events });
  } catch (error) {
    next(error);
  }
});

router.post("/tracker/mappings/telemetry", async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    ensureSameTenant(req.user, clientId);
    const mapping = await upsertTelemetryFieldMapping({ ...req.body, clientId });
    return res.status(201).json({ mapping });
  } catch (error) {
    next(error);
  }
});

router.put("/tracker/mappings/telemetry/:id", async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    ensureSameTenant(req.user, clientId);
    const mapping = await upsertTelemetryFieldMapping({ ...req.body, id: req.params.id, clientId });
    return res.json({ mapping });
  } catch (error) {
    next(error);
  }
});

router.delete("/tracker/mappings/telemetry/:id", async (req, res, next) => {
  try {
    const mapping = await deleteTelemetryFieldMapping(req.params.id);
    return res.json({ mapping });
  } catch (error) {
    next(error);
  }
});

router.post("/tracker/mappings/events", async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    ensureSameTenant(req.user, clientId);
    const mapping = await upsertEventMapping({ ...req.body, clientId });
    return res.status(201).json({ mapping });
  } catch (error) {
    next(error);
  }
});

router.put("/tracker/mappings/events/:id", async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    ensureSameTenant(req.user, clientId);
    const mapping = await upsertEventMapping({ ...req.body, id: req.params.id, clientId });
    return res.json({ mapping });
  } catch (error) {
    next(error);
  }
});

router.delete("/tracker/mappings/events/:id", async (req, res, next) => {
  try {
    const mapping = await deleteEventMapping(req.params.id);
    return res.json({ mapping });
  } catch (error) {
    next(error);
  }
});

export default router;
