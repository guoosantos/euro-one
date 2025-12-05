import express from "express";

import { authenticate } from "../middleware/auth.js";
import { resolveClientId, resolveClientIdMiddleware } from "../middleware/client.js";
import * as crmModel from "../models/crm.js";
import * as crmPipelineModel from "../models/crm-pipeline.js";
import * as crmTagsModel from "../models/crm-tags.js";
import { createTtlCache } from "../utils/ttl-cache.js";

const router = express.Router();

const deps = {
  authenticate,
  resolveClientId,
  resolveClientIdMiddleware,
  ...crmModel,
  ...crmPipelineModel,
  ...crmTagsModel,
};

router.use((req, res, next) => deps.authenticate(req, res, next));
router.use((req, res, next) => deps.resolveClientIdMiddleware(req, res, next));

const crmCache = createTtlCache(30_000);
const crmCacheKeys = new Set();

function buildTagCacheKey(clientId) {
  return `tags:${clientId || "all"}`;
}

function cacheTags(key, value) {
  crmCacheKeys.add(key);
  return crmCache.set(key, value, 30_000);
}

function getCachedTags(key) {
  return crmCache.get(key);
}

function invalidateTagCache() {
  Array.from(crmCacheKeys).forEach((key) => {
    crmCache.delete(key);
    crmCacheKeys.delete(key);
  });
}

router.get("/clients", async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === "admin";
    const view = !isAdmin || req.query.view === "mine" ? "mine" : "all";
    const createdByUserId = view === "mine" ? req.user?.id : undefined;
    const clients = await deps.listCrmClients({
      clientId: req.clientId,
      user: req.user,
      createdByUserId,
      view,
    });
    res.json({ clients });
  } catch (error) {
    next(error);
  }
});

router.post("/clients", async (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.body?.clientId, { required: true });
    const client = await deps.createCrmClient({ ...req.body, clientId }, { user: req.user });
    res.status(201).json({ client });
  } catch (error) {
    next(error);
  }
});

router.get("/clients/:id", async (req, res, next) => {
  try {
    const client = await deps.getCrmClient(req.params.id, { clientId: req.clientId, user: req.user });
    res.json({ client });
  } catch (error) {
    next(error);
  }
});

router.put("/clients/:id", async (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.body?.clientId || req.clientId, { required: false });
    const client = await deps.updateCrmClient(req.params.id, req.body, { clientId, user: req.user });
    res.json({ client });
  } catch (error) {
    next(error);
  }
});

router.get("/alerts", async (req, res, next) => {
  try {
    const contractWithinDays = Number.isFinite(Number(req.query.contractWithinDays))
      ? Number(req.query.contractWithinDays)
      : undefined;
    const trialWithinDays = Number.isFinite(Number(req.query.trialWithinDays))
      ? Number(req.query.trialWithinDays)
      : undefined;

    const isAdmin = req.user?.role === "admin";
    const view = !isAdmin || req.query.view === "mine" ? "mine" : "all";
    const createdByUserId = view === "mine" ? req.user?.id : undefined;

    const alerts = await deps.listCrmClientsWithUpcomingEvents({
      clientId: req.clientId,
      contractWithinDays,
      trialWithinDays,
      user: req.user,
      createdByUserId,
      view,
    });
    res.json(alerts);
  } catch (error) {
    next(error);
  }
});

router.get("/pipeline", async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === "admin";
    const view = !isAdmin || req.query.view === "mine" ? "mine" : "all";
    const stages = await deps.listPipelineStages({ clientId: req.clientId });
    const deals = await deps.listDeals({ clientId: req.clientId, user: req.user, view });
    const clients = await deps.listCrmClients({ clientId: req.clientId, user: req.user, view });
    const clientNameById = new Map(clients.map((item) => [item.id, item.name]));
    const decoratedDeals = deals.map((deal) => ({
      ...deal,
      clientName: deal.clientName || clientNameById.get(deal.crmClientId) || deal.title,
    }));
    res.json({ stages, deals: decoratedDeals });
  } catch (error) {
    next(error);
  }
});

router.post("/deals", async (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.body?.clientId || req.clientId, { required: false });
    const deal = await deps.createDeal({ ...req.body, clientId }, { clientId, user: req.user });
    res.status(201).json({ deal });
  } catch (error) {
    next(error);
  }
});

router.put("/deals/:id/stage", async (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.body?.clientId || req.clientId, { required: false });
    const deal = await deps.moveDealToStage(req.params.id, req.body?.stageId, {
      clientId,
      onWon: (wonDeal) => deps.handleDealWon(wonDeal, { user: req.user }),
    });
    res.json({ deal });
  } catch (error) {
    next(error);
  }
});

router.get("/activities", async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === "admin";
    const view = !isAdmin || req.query.view === "mine" ? "mine" : "all";
    const activities = await deps.listActivities({ clientId: req.clientId, user: req.user, view });
    res.json({ activities });
  } catch (error) {
    next(error);
  }
});

router.post("/activities", async (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.body?.clientId || req.clientId, { required: false });
    const activity = await deps.createActivity(req.body, { clientId, user: req.user });
    res.status(201).json({ activity });
  } catch (error) {
    next(error);
  }
});

router.get("/reminders", async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === "admin";
    const view = !isAdmin || req.query.view === "mine" ? "mine" : "all";
    const reminders = await deps.listReminders({ clientId: req.clientId, user: req.user, view });
    res.json({ reminders });
  } catch (error) {
    next(error);
  }
});

router.post("/reminders", async (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.body?.clientId || req.clientId, { required: false });
    const reminder = await deps.createReminder(req.body, { clientId, user: req.user });
    res.status(201).json({ reminder });
  } catch (error) {
    next(error);
  }
});

router.get("/clients/:id/contacts", async (req, res, next) => {
  try {
    const createdByUserId = req.query.view === "mine" ? req.user?.id : undefined;
    const contacts = await deps.listCrmContacts(req.params.id, {
      clientId: req.clientId,
      user: req.user,
      createdByUserId,
    });
    res.json({ contacts });
  } catch (error) {
    next(error);
  }
});

router.post("/clients/:id/contacts", async (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.body?.clientId || req.clientId, { required: false });
    const contact = await deps.addCrmContact(req.params.id, req.body, { clientId, user: req.user });
    res.status(201).json({ contact });
  } catch (error) {
    next(error);
  }
});

router.get("/tags", async (req, res, next) => {
  try {
    const cacheKey = buildTagCacheKey(req.clientId);
    const cached = getCachedTags(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const tags = await deps.listCrmTags({ clientId: req.clientId });
    const payload = { tags };

    cacheTags(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.post("/tags", async (req, res, next) => {
  try {
    const clientId = deps.resolveClientId(req, req.body?.clientId || req.clientId, { required: false });
    const tag = await deps.createCrmTag({ ...req.body, clientId });
    invalidateTagCache();
    res.status(201).json({ tag });
  } catch (error) {
    next(error);
  }
});

router.delete("/tags/:id", async (req, res, next) => {
  try {
    await deps.deleteCrmTag(req.params.id, { clientId: req.clientId });
    invalidateTagCache();
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export function __setCrmRouteMocks(overrides = {}) {
  Object.assign(deps, overrides);
}

export function __resetCrmRouteMocks() {
  Object.assign(deps, {
    authenticate,
    resolveClientId,
    resolveClientIdMiddleware,
    ...crmModel,
    ...crmPipelineModel,
    ...crmTagsModel,
  });
}

export default router;
