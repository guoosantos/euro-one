import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { resolveClientId } from "../middleware/client.js";
import { createRoute, deleteRoute, getRouteById, listRoutes } from "../models/route.js";

const router = express.Router();

router.use(authenticate);

router.get("/euro/routes", async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query?.clientId, { required: req.user.role !== "admin" });
    const routes = listRoutes(clientId ? { clientId } : {});
    return res.json({ data: routes, error: null });
  } catch (error) {
    return next(error);
  }
});

router.get("/euro/routes/:id", async (req, res, next) => {
  try {
    const route = getRouteById(req.params.id);
    if (!route) {
      throw createError(404, "Rota não encontrada");
    }
    const clientId = resolveClientId(req, req.query?.clientId || route.clientId, { required: true });
    if (clientId && String(route.clientId) !== String(clientId) && req.user.role !== "admin") {
      throw createError(403, "Rota não pertence ao cliente informado");
    }
    return res.json({ data: route, error: null });
  } catch (error) {
    return next(error);
  }
});

router.post("/euro/routes", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    const route = await createRoute({ ...req.body, clientId });
    return res.status(201).json({ data: route, error: null });
  } catch (error) {
    return next(error);
  }
});

router.delete("/euro/routes/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const route = getRouteById(req.params.id);
    if (!route) {
      throw createError(404, "Rota não encontrada");
    }
    const clientId = resolveClientId(req, req.query?.clientId || route.clientId, { required: true });
    if (clientId && String(route.clientId) !== String(clientId) && req.user.role !== "admin") {
      throw createError(403, "Rota não pertence ao cliente informado");
    }
    await deleteRoute(req.params.id);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
