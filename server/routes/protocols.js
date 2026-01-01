import express from "express";

import { authenticate } from "../middleware/auth.js";
import {
  getProtocolCommandAllowlist,
  getProtocolCommands,
  getProtocolEvents,
  getProtocolList,
  normalizeProtocolKey,
} from "../services/protocol-catalog.js";
import { traccarProxy } from "../services/traccar.js";
import { getProtocolSeverity, updateProtocolSeverity } from "../services/event-severity.js";

const router = express.Router();

router.use(authenticate);

router.get("/protocols", (_req, res) => {
  res.json({ protocols: getProtocolList() });
});

router.get("/protocols/:protocol/commands", (req, res) => {
  const protocolKey = normalizeProtocolKey(req.params.protocol);

  const buildKey = (command) => command?.id || command?.code || command?.type || command?.name || null;
  const allowlist = getProtocolCommandAllowlist(protocolKey);
  const filterCommands = (commands) => {
    if (!Array.isArray(commands)) return [];
    let filtered = commands.filter((command) => buildKey(command));
    if (Array.isArray(allowlist) && allowlist.length) {
      filtered = filtered.filter((command) => allowlist.includes(buildKey(command)));
    }
    return filtered.map((command) => {
      const key = buildKey(command);
      return {
        ...command,
        id: command?.id || command?.code || key,
        code: command?.code || command?.id || key,
        type: command?.type || command?.code || command?.id || key,
        name: command?.name || command?.description || key,
        parameters: Array.isArray(command?.parameters) ? command.parameters : [],
      };
    });
  };

  const fallback = getProtocolCommands(protocolKey);
  if (!fallback) {
    return res.status(404).json({ message: "Protocolo não encontrado" });
  }

  return traccarProxy("get", `/protocols/${protocolKey}/commands`, { asAdmin: true })
    .then((data) => {
      if (data?.ok === false || data?.error) {
        const commands = filterCommands(fallback);
        return res.json({ protocol: protocolKey, commands });
      }
      const resolved = Array.isArray(data) ? data : data?.commands || data?.items || [];
      const commands = filterCommands(resolved);
      return res.json({ protocol: protocolKey, commands: commands.length ? commands : filterCommands(fallback) });
    })
    .catch((_error) => {
      const commands = filterCommands(fallback);
      return res.json({ protocol: protocolKey, commands });
    });
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
