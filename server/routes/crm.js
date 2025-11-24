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

const router = express.Router();

router.use(authenticate);
router.use(resolveClientIdMiddleware);

router.get("/clients", (req, res, next) => {
  try {
    const clients = listCrmClients({ clientId: req.clientId });
    res.json({ clients });
  } catch (error) {
    next(error);
  }
});

router.post("/clients", (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    const client = createCrmClient({ ...req.body, clientId });
    res.status(201).json({ client });
  } catch (error) {
    next(error);
  }
});

router.get("/clients/:id", (req, res, next) => {
  try {
    const client = getCrmClient(req.params.id, { clientId: req.clientId });
    res.json({ client });
  } catch (error) {
    next(error);
  }
});

router.put("/clients/:id", (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId || req.clientId, { required: false });
    const client = updateCrmClient(req.params.id, req.body, { clientId });
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

    const alerts = listCrmClientsWithUpcomingEvents({
      clientId: req.clientId,
      contractWithinDays,
      trialWithinDays,
    });
    res.json(alerts);
  } catch (error) {
    next(error);
  }
});

router.get("/clients/:id/contacts", (req, res, next) => {
  try {
    const contacts = listCrmContacts(req.params.id, { clientId: req.clientId });
    res.json({ contacts });
  } catch (error) {
    next(error);
  }
});

router.post("/clients/:id/contacts", (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId || req.clientId, { required: false });
    const contact = addCrmContact(req.params.id, req.body, { clientId });
    res.status(201).json({ contact });
  } catch (error) {
    next(error);
  }
});

export default router;
