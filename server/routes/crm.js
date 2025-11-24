import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { resolveClientId, resolveClientIdMiddleware } from "../middleware/client.js";
import { listCrmClients, createCrmClient, updateCrmClient, listCrmContacts, createCrmContact, listCrmClientsWithUpcomingEvents } from "../models/crm.js";

const router = express.Router();

router.use(authenticate);

router.get("/clients", resolveClientIdMiddleware, (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query?.clientId);
    const clients = listCrmClients({ clientId });
    res.json({ clients });
  } catch (error) {
    next(error);
  }
});

router.post("/clients", resolveClientIdMiddleware, (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    const client = createCrmClient({ ...req.body, clientId });
    res.status(201).json({ client });
  } catch (error) {
    next(error);
  }
});

router.put("/clients/:id", resolveClientIdMiddleware, (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId);
    const current = listCrmClients({ id: req.params.id })?.[0];
    if (!current) throw createError(404, "Cliente não encontrado");
    if (clientId && String(current.clientId) !== String(clientId)) {
      throw createError(403, "Cliente não pertence a este tenant");
    }
    const updated = updateCrmClient(req.params.id, { ...req.body, clientId: current.clientId });
    res.json({ client: updated });
  } catch (error) {
    next(error);
  }
});

router.get("/clients/:id/contacts", resolveClientIdMiddleware, (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query?.clientId);
    const client = listCrmClients({ id: req.params.id })?.[0];
    if (!client) throw createError(404, "Cliente não encontrado");
    if (clientId && String(client.clientId) !== String(clientId)) {
      throw createError(403, "Cliente não pertence a este tenant");
    }
    const clientContacts = listCrmContacts({ crmClientId: req.params.id, clientId: client.clientId });
    res.json({ contacts: clientContacts });
  } catch (error) {
    next(error);
  }
});

router.post("/clients/:id/contacts", resolveClientIdMiddleware, (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: true });
    const client = listCrmClients({ id: req.params.id })?.[0];
    if (!client) throw createError(404, "Cliente não encontrado");
    if (clientId && String(client.clientId) !== String(clientId)) {
      throw createError(403, "Cliente não pertence a este tenant");
    }
    const contact = createCrmContact({ ...req.body, clientId, crmClientId: req.params.id });
    res.status(201).json({ contact });
  } catch (error) {
    next(error);
  }
});

router.get("/alerts", resolveClientIdMiddleware, (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query?.clientId);
    const contractWithinDays = req.query?.contractWithinDays ? Number(req.query.contractWithinDays) : 30;
    const trialWithinDays = req.query?.trialWithinDays ? Number(req.query.trialWithinDays) : 7;
    const alerts = listCrmClientsWithUpcomingEvents({ clientId, contractWithinDays, trialWithinDays });
    res.json(alerts);
  } catch (error) {
    next(error);
  }
});

export default router;
