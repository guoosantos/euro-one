import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { buildRoutesKml, parseRoutePlacemarks } from "../utils/kml.js";
import { createRoute, deleteRoute, getRouteById, listRoutes, updateRoute } from "../models/route.js";

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

router.get("/routes/export/kml", async (req, res, next) => {
  try {
    const targetClientId = resolveClientId(req, req.query?.clientId);
    if (!targetClientId) {
      throw createError(400, "clientId é obrigatório para exportar");
    }
    const routes = await listRoutes({ clientId: targetClientId });
    const kml = buildRoutesKml(routes);
    res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
    return res.send(kml);
  } catch (error) {
    return next(error);
  }
});

router.post("/routes/import/kml", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const { kml, clientId: providedClientId, color = null } = req.body || {};
    const targetClientId = resolveClientId(req, providedClientId);
    if (!targetClientId) {
      throw createError(400, "clientId é obrigatório");
    }
    if (!kml) {
      throw createError(400, "Arquivo KML é obrigatório");
    }
    const placemarks = parseRoutePlacemarks(kml);
    if (!placemarks.length) {
      throw createError(400, "Nenhuma rota válida encontrada no KML");
    }
    const created = [];
    for (const placemark of placemarks) {
      const route = await createRoute({
        clientId: targetClientId,
        name: placemark.name,
        color,
        points: placemark.points,
      });
      created.push(route);
    }
    return res.status(201).json({ routes: created, imported: created.length });
  } catch (error) {
    return next(error);
  }
});

router.get("/routes", async (req, res, next) => {
  try {
    const targetClientId = resolveClientId(req, req.query?.clientId);
    if (!targetClientId && req.user.role !== "admin") {
      return res.json({ routes: [] });
    }
    const routes = await listRoutes(targetClientId ? { clientId: targetClientId } : {});
    return res.json({ routes });
  } catch (error) {
    return next(error);
  }
});

router.get("/routes/:id", async (req, res, next) => {
  try {
    const route = await getRouteById(req.params.id);
    if (!route) {
      throw createError(404, "Rota não encontrada");
    }
    ensureSameTenant(req.user, route.clientId);
    return res.json({ route });
  } catch (error) {
    return next(error);
  }
});

router.post("/routes", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const targetClientId = resolveClientId(req, req.body?.clientId);
    if (!targetClientId) {
      throw createError(400, "clientId é obrigatório");
    }
    const route = await createRoute({
      ...req.body,
      clientId: targetClientId,
    });
    return res.status(201).json({ route });
  } catch (error) {
    return next(error);
  }
});

router.put("/routes/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const existing = await getRouteById(req.params.id);
    if (!existing) {
      throw createError(404, "Rota não encontrada");
    }
    ensureSameTenant(req.user, existing.clientId);
    if (req.user.role !== "admin" && req.body?.clientId && String(req.body.clientId) !== String(existing.clientId)) {
      throw createError(403, "Não é permitido mover rotas para outro cliente");
    }
    const route = await updateRoute(req.params.id, {
      ...req.body,
      clientId: req.user.role === "admin" ? req.body?.clientId || existing.clientId : existing.clientId,
    });
    return res.json({ route });
  } catch (error) {
    return next(error);
  }
});

router.delete("/routes/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const existing = await getRouteById(req.params.id);
    if (!existing) {
      throw createError(404, "Rota não encontrada");
    }
    ensureSameTenant(req.user, existing.clientId);
    await deleteRoute(req.params.id);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
