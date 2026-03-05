import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { resolveClientId } from "../middleware/client.js";
import { authorizePermission } from "../middleware/permissions.js";
import { createRoute, deleteRoute, getRouteById, listRoutes, updateRoute } from "../models/route.js";

const router = express.Router();

router.use(authenticate);

router.get(
  "/euro/routes",
  authorizePermission({ menuKey: "fleet", pageKey: "routes" }),
  async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query?.clientId, { required: req.user.role !== "admin" });
    const routes = listRoutes(clientId ? { clientId } : {});
    return res.json({ data: routes, error: null });
  } catch (error) {
    return next(error);
  }
  },
);

router.get(
  "/euro/routes/:id",
  authorizePermission({ menuKey: "fleet", pageKey: "routes" }),
  async (req, res, next) => {
  try {
    const route = getRouteById(req.params.id);
    if (!route) {
      throw createError(404, "Rota não encontrada");
    }
    const clientId = resolveClientId(req, req.query?.clientId || route.clientId, { required: true });
    if (clientId && String(route.clientId) !== String(clientId) && req.user.role !== "admin") {
      throw createError(404, "Rota não encontrada");
    }
    return res.json({ data: route, error: null });
  } catch (error) {
    return next(error);
  }
  },
);

router.post(
  "/euro/routes",
  authorizePermission({ menuKey: "fleet", pageKey: "routes", requireFull: true }),
  async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    const route = await createRoute({ ...req.body, clientId });
    return res.status(201).json({ data: route, error: null });
  } catch (error) {
    return next(error);
  }
  },
);

router.put(
  "/euro/routes/:id",
  authorizePermission({ menuKey: "fleet", pageKey: "routes", requireFull: true }),
  async (req, res, next) => {
  try {
    const existing = getRouteById(req.params.id);
    if (!existing) {
      throw createError(404, "Rota não encontrada");
    }
    const clientId = resolveClientId(req, req.body?.clientId || existing.clientId, { required: true });
    if (clientId && String(existing.clientId) !== String(clientId) && req.user.role !== "admin") {
      throw createError(404, "Rota não encontrada");
    }
    const updated = await updateRoute(req.params.id, { ...req.body, clientId: existing.clientId });
    return res.json({ data: updated, error: null });
  } catch (error) {
    return next(error);
  }
  },
);

router.delete(
  "/euro/routes/:id",
  authorizePermission({ menuKey: "fleet", pageKey: "routes", requireFull: true }),
  async (req, res, next) => {
  try {
    const route = getRouteById(req.params.id);
    if (!route) {
      throw createError(404, "Rota não encontrada");
    }
    const clientId = resolveClientId(req, req.query?.clientId || route.clientId, { required: true });
    if (clientId && String(route.clientId) !== String(clientId) && req.user.role !== "admin") {
      throw createError(404, "Rota não encontrada");
    }
    await deleteRoute(req.params.id);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
  },
);

export default router;
