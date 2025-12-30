import express from "express";

import { authenticate } from "../middleware/auth.js";
import {
  getProtocolCommands,
  getProtocolEvents,
  getProtocolList,
  normalizeProtocolKey,
} from "../services/protocol-catalog.js";
import { getProtocolSeverity, updateProtocolSeverity } from "../services/event-severity.js";

const router = express.Router();

router.use(authenticate);

router.get("/protocols", (_req, res) => {
  res.json({ protocols: getProtocolList() });
});

router.get("/protocols/:protocol/commands", (req, res) => {
  const protocolKey = normalizeProtocolKey(req.params.protocol);
  const commands = getProtocolCommands(protocolKey);
  if (!commands) {
    return res.status(404).json({ message: "Protocolo não encontrado" });
  }
  return res.json({ protocol: protocolKey, commands });
});

router.get("/protocols/:protocol/events", (req, res) => {
  const protocolKey = normalizeProtocolKey(req.params.protocol);
  const events = getProtocolEvents(protocolKey);
  if (!events) {
    return res.status(404).json({ message: "Protocolo não encontrado" });
  }
  return res.json({ protocol: protocolKey, events });
});

router.get("/protocols/:protocol/events/severity", (req, res) => {
  const protocolKey = normalizeProtocolKey(req.params.protocol);
  const events = getProtocolEvents(protocolKey);
  if (!events) {
    return res.status(404).json({ message: "Protocolo não encontrado" });
  }
  const severity = getProtocolSeverity(protocolKey);
  return res.json({ protocol: protocolKey, severity });
});

router.put("/protocols/:protocol/events/severity", (req, res) => {
  const protocolKey = normalizeProtocolKey(req.params.protocol);
  const events = getProtocolEvents(protocolKey);
  if (!events) {
    return res.status(404).json({ message: "Protocolo não encontrado" });
  }

  const updates = Array.isArray(req.body?.updates)
    ? req.body.updates
    : req.body?.eventId
    ? [{ eventId: req.body.eventId, severity: req.body.severity, active: req.body.active }]
    : [];

  const next = updateProtocolSeverity(protocolKey, updates);
  return res.json({ protocol: protocolKey, severity: next });
});

export default router;
