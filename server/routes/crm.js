import express from "express";

import { authenticate } from "../middleware/auth.js";
import { resolveClientId, resolveClientIdMiddleware } from "../middleware/client.js";
import {
  addCrmContact,
  createCrmClient,
  getCrmClient,
  listCrmClients,
  listCrmClientsWithUpcomingEvents,
  listCrmContacts,
  updateCrmClient,
} from "../models/crm.js";
import { createCrmTag, deleteCrmTag, listCrmTags } from "../models/crm-tags.js";

const router = express.Router();

router.use(authenticate);
router.use(resolveClientIdMiddleware);

router.get("/clients", (req, res, next) => {
  try {
    const createdByUserId = req.query.view === "mine" ? req.user?.id : undefined;
    const clients = listCrmClients({ clientId: req.clientId, user: req.user, createdByUserId });
    res.json({ clients });
  } catch (error) {
    next(error);
  }
});

router.post("/clients", (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    const client = createCrmClient({ ...req.body, clientId, createdByUserId: req.user?.id });
    res.status(201).json({ client });
  } catch (error) {
    next(error);
  }
});

router.get("/clients/:id", (req, res, next) => {
  try {
    const client = getCrmClient(req.params.id, { clientId: req.clientId, user: req.user });
    res.json({ client });
  } catch (error) {
    next(error);
  }
});

router.put("/clients/:id", (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId || req.clientId, { required: false });
    const client = updateCrmClient(req.params.id, req.body, { clientId, user: req.user });
    res.json({ client });
  } catch (error) {
    next(error);
  }
});

router.get("/alerts", (req, res, next) => {
  try {
    const contractWithinDays = Number.isFinite(Number(req.query.contractWithinDays))
      ? Number(req.query.contractWithinDays)
      : undefined;
    const trialWithinDays = Number.isFinite(Number(req.query.trialWithinDays))
      ? Number(req.query.trialWithinDays)
      : undefined;

    const createdByUserId = req.query.view === "mine" ? req.user?.id : undefined;

    const alerts = listCrmClientsWithUpcomingEvents({
      clientId: req.clientId,
      contractWithinDays,
      trialWithinDays,
      user: req.user,
      createdByUserId,
    });
    res.json(alerts);
  } catch (error) {
    next(error);
  }
});

router.get("/clients/:id/contacts", (req, res, next) => {
  try {
    const createdByUserId = req.query.view === "mine" ? req.user?.id : undefined;
    const contacts = listCrmContacts(req.params.id, {
      clientId: req.clientId,
      user: req.user,
      createdByUserId,
    });
    res.json({ contacts });
  } catch (error) {
    next(error);
  }
});

router.post("/clients/:id/contacts", (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId || req.clientId, { required: false });
    const contact = addCrmContact(req.params.id, req.body, { clientId, user: req.user });
    res.status(201).json({ contact });
  } catch (error) {
    next(error);
  }
});

router.get("/tags", (req, res, next) => {
  try {
    const tags = listCrmTags({ clientId: req.clientId });
    res.json({ tags });
  } catch (error) {
    next(error);
  }
});

router.post("/tags", (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId || req.clientId, { required: false });
    const tag = createCrmTag({ ...req.body, clientId });
    res.status(201).json({ tag });
  } catch (error) {
    next(error);
  }
});

router.delete("/tags/:id", (req, res, next) => {
  try {
    deleteCrmTag(req.params.id, { clientId: req.clientId });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
