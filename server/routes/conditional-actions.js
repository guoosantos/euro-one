import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { authorizePermission } from "../middleware/permissions.js";
import { resolveClientId } from "../middleware/client.js";
import {
  createConditionalActionRule,
  deleteConditionalActionRule,
  duplicateConditionalActionRule,
  getConditionalActionRuleById,
  listConditionalActionEvents,
  listConditionalActionHistory,
  listConditionalActionRules,
  toggleConditionalActionRule,
  updateConditionalActionRule,
} from "../models/conditional-action.js";
import { ingestConditionalActions, invalidateConditionalActionRulesCache } from "../services/conditional-action-engine.js";

const router = express.Router();

router.use(authenticate);

function resolveActor(req) {
  const name = req.user?.name || req.user?.username || req.user?.email || null;
  const id = req.user?.id ? String(req.user.id) : null;
  return { id, name };
}

function parsePositiveInt(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parseBoolean(value, fallback = null) {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "sim", "on", "ativo", "ativa"].includes(normalized)) return true;
  if (["0", "false", "no", "nao", "não", "off", "inativo", "inativa"].includes(normalized)) return false;
  return fallback;
}

router.get(
  "/conditional-actions/rules",
  authorizePermission({ menuKey: "primary", pageKey: "events", subKey: "report" }),
  (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.query?.clientId, { required: false });
      const items = listConditionalActionRules({
        clientId,
        search: req.query?.search || "",
        status: req.query?.status || "",
      });
      return res.json({ data: items, total: items.length });
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/conditional-actions/rules/:id",
  authorizePermission({ menuKey: "primary", pageKey: "events", subKey: "report" }),
  (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.query?.clientId, { required: false });
      const item = getConditionalActionRuleById(req.params.id, { clientId });
      if (!item) {
        throw createError(404, "Regra condicional não encontrada");
      }
      return res.json({ data: item });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/conditional-actions/rules",
  authorizePermission({ menuKey: "primary", pageKey: "events", subKey: "severity", requireFull: true }),
  (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: true });
      const actor = resolveActor(req);
      const created = createConditionalActionRule({
        clientId,
        payload: req.body || {},
        createdBy: actor.id,
        createdByName: actor.name,
      });
      invalidateConditionalActionRulesCache(clientId);
      return res.status(201).json({ data: created });
    } catch (error) {
      return next(error);
    }
  },
);

router.put(
  "/conditional-actions/rules/:id",
  authorizePermission({ menuKey: "primary", pageKey: "events", subKey: "severity", requireFull: true }),
  (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: true });
      const actor = resolveActor(req);
      const updated = updateConditionalActionRule(req.params.id, {
        clientId,
        payload: req.body || {},
        updatedBy: actor.id,
        updatedByName: actor.name,
      });
      if (!updated) {
        throw createError(404, "Regra condicional não encontrada");
      }
      invalidateConditionalActionRulesCache(clientId);
      return res.json({ data: updated });
    } catch (error) {
      return next(error);
    }
  },
);

router.patch(
  "/conditional-actions/rules/:id/toggle",
  authorizePermission({ menuKey: "primary", pageKey: "events", subKey: "severity", requireFull: true }),
  (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: true });
      const actor = resolveActor(req);
      const toggled = toggleConditionalActionRule(req.params.id, {
        clientId,
        active: parseBoolean(req.body?.active, null),
        updatedBy: actor.id,
        updatedByName: actor.name,
      });
      if (!toggled) {
        throw createError(404, "Regra condicional não encontrada");
      }
      invalidateConditionalActionRulesCache(clientId);
      return res.json({ data: toggled });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/conditional-actions/rules/:id/duplicate",
  authorizePermission({ menuKey: "primary", pageKey: "events", subKey: "severity", requireFull: true }),
  (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: true });
      const actor = resolveActor(req);
      const duplicated = duplicateConditionalActionRule(req.params.id, {
        clientId,
        createdBy: actor.id,
        createdByName: actor.name,
      });
      if (!duplicated) {
        throw createError(404, "Regra condicional não encontrada");
      }
      invalidateConditionalActionRulesCache(clientId);
      return res.status(201).json({ data: duplicated });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  "/conditional-actions/rules/:id",
  authorizePermission({ menuKey: "primary", pageKey: "events", subKey: "severity", requireFull: true }),
  (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: true });
      const deleted = deleteConditionalActionRule(req.params.id, { clientId });
      if (!deleted) {
        throw createError(404, "Regra condicional não encontrada");
      }
      invalidateConditionalActionRulesCache(clientId);
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/conditional-actions/history",
  authorizePermission({ menuKey: "primary", pageKey: "events", subKey: "report" }),
  (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.query?.clientId, { required: false });
      const page = parsePositiveInt(req.query?.page, 1);
      const limit = parsePositiveInt(req.query?.limit, 100);
      const payload = listConditionalActionHistory({
        clientId,
        ruleId: req.query?.ruleId,
        vehicleId: req.query?.vehicleId,
        deviceId: req.query?.deviceId,
        from: req.query?.from,
        to: req.query?.to,
        trigger: req.query?.trigger,
        status: req.query?.status,
        search: req.query?.search || "",
        page,
        limit,
      });
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/conditional-actions/events",
  authorizePermission({ menuKey: "primary", pageKey: "events", subKey: "report" }),
  (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.query?.clientId, { required: false });
      const deviceIds = Array.isArray(req.query?.deviceIds)
        ? req.query.deviceIds
        : req.query?.deviceIds
          ? String(req.query.deviceIds).split(",")
          : [];
      const data = listConditionalActionEvents({
        clientId,
        deviceIds,
        from: req.query?.from,
        to: req.query?.to,
      });
      return res.json({ data, total: data.length });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/conditional-actions/evaluate",
  authorizePermission({ menuKey: "primary", pageKey: "events", subKey: "severity", requireFull: true }),
  async (req, res, next) => {
    try {
      const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: true });
      const events = await ingestConditionalActions({
        clientId,
        vehicleId: req.body?.vehicleId || null,
        deviceId: req.body?.deviceId || null,
        vehicle: req.body?.vehicle || null,
        vehicleLabel: req.body?.vehicleLabel || null,
        plate: req.body?.plate || null,
        position: req.body?.position || null,
        attributes: req.body?.attributes || {},
        events: Array.isArray(req.body?.events) ? req.body.events : [],
      });
      return res.json({ data: events, total: events.length });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;

