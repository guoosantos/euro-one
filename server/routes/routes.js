import express from "express";

import { authenticate } from "../middleware/auth.js";
import { resolveClientId, resolveClientIdMiddleware } from "../middleware/client.js";
import { createRoute, deleteRoute, getRouteById, listRoutes, updateRoute } from "../models/route.js";

const router = express.Router();

router.use(authenticate);

router.get("/routes", resolveClientIdMiddleware, async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const routes = listRoutes({ clientId });
    res.json({ data: routes, error: null });
  } catch (error) {
    next(error);
  }
});

router.get("/routes/:id", resolveClientIdMiddleware, async (req, res, next) => {
  try {
    const route = getRouteById(req.params.id);
    if (!route) {
      return res.status(404).json({ data: null, error: { message: "Rota não encontrada" } });
    }
    if (req.clientId && String(route.clientId) !== String(req.clientId)) {
      return res.status(403).json({ data: null, error: { message: "Rota não pertence a este cliente" } });
    }
    res.json({ data: route, error: null });
  } catch (error) {
    next(error);
  }
});

router.post("/routes", resolveClientIdMiddleware, async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    const route = await createRoute({ ...req.body, clientId });
    res.status(201).json({ data: route, error: null });
  } catch (error) {
    next(error);
  }
});

router.put("/routes/:id", resolveClientIdMiddleware, async (req, res, next) => {
  try {
    const existing = getRouteById(req.params.id);
    if (!existing) {
      return res.status(404).json({ data: null, error: { message: "Rota não encontrada" } });
    }
    const clientId = resolveClientId(req, req.body?.clientId || existing.clientId, { required: true });
    if (clientId && String(existing.clientId) !== String(clientId)) {
      return res.status(403).json({ data: null, error: { message: "Rota não pertence a este cliente" } });
    }
    const updated = await updateRoute(req.params.id, { ...req.body, clientId: existing.clientId });
    res.json({ data: updated, error: null });
  } catch (error) {
    next(error);
  }
});

router.delete("/routes/:id", resolveClientIdMiddleware, async (req, res, next) => {
  try {
    const existing = getRouteById(req.params.id);
    if (!existing) {
      return res.status(404).json({ data: null, error: { message: "Rota não encontrada" } });
    }
    if (req.clientId && String(existing.clientId) !== String(req.clientId)) {
      return res.status(403).json({ data: null, error: { message: "Rota não pertence a este cliente" } });
    }
    await deleteRoute(req.params.id);
    res.json({ data: true, error: null });
  } catch (error) {
    next(error);
  }
});

export default router;
