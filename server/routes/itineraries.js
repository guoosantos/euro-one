import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { resolveClientId } from "../middleware/client.js";
import { buildItineraryKml } from "../utils/kml.js";
import { listGeofences } from "../models/geofence.js";
import { listRoutes } from "../models/route.js";
import { getVehicleById, listVehicles } from "../models/vehicle.js";
import {
  listItineraries,
  getItineraryById,
  createItinerary,
  updateItinerary,
  deleteItinerary,
} from "../models/itinerary.js";
import { addEmbarkEntries, getEmbarkPairIndex, listEmbarkHistory } from "../models/itinerary-embark.js";

const router = express.Router();

router.use(authenticate);

function resolveTargetClient(req, provided, { required = false } = {}) {
  if (req.user.role === "admin") {
    return provided || req.query?.clientId || req.user.clientId || null;
  }
  const clientId = req.user.clientId || null;
  if (required && !clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  return clientId;
}

function ensureSameClient(user, clientId) {
  if (user.role === "admin") return;
  if (!user.clientId || String(user.clientId) !== String(clientId)) {
    throw createError(403, "Operação não permitida para este cliente");
  }
}

function resolveRequestIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length) {
    return forwarded[0];
  }
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || null;
}

router.get("/itineraries", async (req, res, next) => {
  try {
    const targetClientId = resolveTargetClient(req, req.query?.clientId, { required: req.user.role !== "admin" });
    const itineraries = listItineraries(targetClientId ? { clientId: targetClientId } : {});
    return res.json({ data: itineraries, error: null });
  } catch (error) {
    return next(error);
  }
});

router.get("/itineraries/:id", async (req, res, next) => {
  try {
    const itinerary = getItineraryById(req.params.id);
    if (!itinerary) {
      throw createError(404, "Itinerário não encontrado");
    }
    ensureSameClient(req.user, itinerary.clientId);
    return res.json({ data: itinerary, error: null });
  } catch (error) {
    return next(error);
  }
});

router.post("/itineraries", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const clientId = resolveTargetClient(req, req.body?.clientId, { required: true });
    const itinerary = createItinerary({ ...req.body, clientId });
    return res.status(201).json({ data: itinerary, error: null });
  } catch (error) {
    return next(error);
  }
});

router.put("/itineraries/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const existing = getItineraryById(req.params.id);
    if (!existing) {
      throw createError(404, "Itinerário não encontrado");
    }
    const clientId = resolveTargetClient(req, req.body?.clientId || existing.clientId, { required: true });
    ensureSameClient(req.user, clientId);
    const updated = updateItinerary(req.params.id, { ...req.body, clientId: existing.clientId });
    return res.json({ data: updated, error: null });
  } catch (error) {
    return next(error);
  }
});

router.delete("/itineraries/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const existing = getItineraryById(req.params.id);
    if (!existing) {
      throw createError(404, "Itinerário não encontrado");
    }
    ensureSameClient(req.user, existing.clientId);
    await deleteItinerary(req.params.id);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.get("/itineraries/:id/export/kml", async (req, res, next) => {
  try {
    const itinerary = getItineraryById(req.params.id);
    if (!itinerary) {
      throw createError(404, "Itinerário não encontrado");
    }
    ensureSameClient(req.user, itinerary.clientId);
    const clientId = resolveClientId(req, req.query?.clientId, { required: false }) || itinerary.clientId;

    const geofenceItems = (itinerary.items || []).filter((item) => item.type === "geofence").map((item) => item.id);
    const routeItems = (itinerary.items || []).filter((item) => item.type === "route").map((item) => item.id);

    let geofences = [];
    if (geofenceItems.length) {
      try {
        geofences = (await listGeofences({ clientId })).filter((item) => geofenceItems.includes(String(item.id)));
      } catch (error) {
        console.warn("[itineraries] Falha ao carregar cercas para exportação", error?.message || error);
      }
    }

    const routes = routeItems.length ? listRoutes({ clientId }).filter((item) => routeItems.includes(String(item.id))) : [];

    const kml = buildItineraryKml({
      name: itinerary.name,
      geofences,
      routes,
    });

    res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
    return res.send(kml);
  } catch (error) {
    return next(error);
  }
});

router.get("/itineraries/embark/history", async (req, res, next) => {
  try {
    const clientId = resolveTargetClient(req, req.query?.clientId, { required: req.user.role !== "admin" });
    const history = listEmbarkHistory(clientId ? { clientId } : {});
    return res.json({ data: history, error: null });
  } catch (error) {
    return next(error);
  }
});

router.post("/itineraries/embark", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const clientId = resolveTargetClient(req, req.body?.clientId, { required: true });
    const vehicleIds = Array.isArray(req.body?.vehicleIds) ? req.body.vehicleIds.map(String) : [];
    const itineraryIds = Array.isArray(req.body?.itineraryIds) ? req.body.itineraryIds.map(String) : [];
    if (!vehicleIds.length || !itineraryIds.length) {
      throw createError(400, "Informe veículos e itinerários para embarcar");
    }

    const ipAddress = resolveRequestIp(req);
    const userLabel = req.user?.name || req.user?.email || req.user?.username || req.user?.id || "Usuário";

    const vehicles = listVehicles(clientId ? { clientId } : {}).reduce((acc, vehicle) => {
      acc.set(String(vehicle.id), vehicle);
      return acc;
    }, new Map());

    const historyIndex = getEmbarkPairIndex();
    const entries = [];
    let success = 0;
    let failed = 0;

    vehicleIds.forEach((vehicleId) => {
      const vehicle = vehicles.get(String(vehicleId)) || getVehicleById(vehicleId);
      itineraryIds.forEach((itineraryId) => {
        const itinerary = getItineraryById(itineraryId);
        const entryBase = {
          clientId: String(clientId),
          itineraryId: String(itineraryId),
          itineraryName: itinerary?.name || null,
          vehicleId: String(vehicleId),
          vehicleName: vehicle?.name || null,
          plate: vehicle?.plate || null,
          brand: vehicle?.brand || null,
          model: vehicle?.model || null,
          sentAt: new Date().toISOString(),
          receivedAt: null,
          sentBy: req.user?.id || null,
          sentByName: userLabel,
          ipAddress,
        };

        if (!itinerary) {
          failed += 1;
          entries.push({ ...entryBase, status: "Falhou", result: "Itinerário não encontrado" });
          return;
        }
        if (String(itinerary.clientId) !== String(clientId)) {
          failed += 1;
          entries.push({ ...entryBase, status: "Falhou", result: "Itinerário não pertence ao cliente" });
          return;
        }
        if (!vehicle || String(vehicle.clientId) !== String(clientId)) {
          failed += 1;
          entries.push({ ...entryBase, status: "Falhou", result: "Veículo não encontrado para o cliente" });
          return;
        }

        const pairKey = `${itineraryId}:${vehicleId}`;
        if (historyIndex.has(pairKey)) {
          failed += 1;
          entries.push({ ...entryBase, status: "Falhou", result: "Embarque já enviado para este veículo" });
          return;
        }

        success += 1;
        entries.push({ ...entryBase, status: "Enviado", result: "Embarque enviado" });
        historyIndex.add(pairKey);
      });
    });

    const stored = addEmbarkEntries(entries);
    return res.status(201).json({ data: { entries: stored, summary: { success, failed } }, error: null });
  } catch (error) {
    return next(error);
  }
});

export default router;
