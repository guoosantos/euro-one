import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { getClientById } from "../models/client.js";
import { createGroup, deleteGroup, getGroupById, listGroups, updateGroup } from "../models/group.js";

const router = express.Router();

router.use(authenticate);

function ensureClientAccess(sessionUser, targetClientId) {
  if (sessionUser.role === "admin") {
    return;
  }
  if (!sessionUser.clientId || String(sessionUser.clientId) !== String(targetClientId)) {
    throw createError(403, "Operação não permitida para este cliente");
  }
}

router.get("/groups", (req, res, next) => {
  try {
    if (req.user.role === "admin") {
      const { clientId } = req.query;
      const filterClientId = clientId === "" || typeof clientId === "undefined" ? undefined : clientId;
      const groups = listGroups({ clientId: filterClientId });
      return res.json({ groups });
    }

    if (!req.user.clientId) {
      return res.json({ groups: [] });
    }

    const groups = listGroups({ clientId: req.user.clientId });
    return res.json({ groups });
  } catch (error) {
    return next(error);
  }
});

router.post("/groups", requireRole("manager", "admin"), (req, res, next) => {
  try {
    const { name, description = null, attributes = {}, clientId } = req.body || {};
    if (!name) {
      throw createError(400, "Nome é obrigatório");
    }

    let targetClientId = clientId;
    if (req.user.role !== "admin") {
      targetClientId = req.user.clientId;
    }
    if (!targetClientId) {
      throw createError(400, "clientId é obrigatório");
    }

    const client = getClientById(targetClientId);
    if (!client) {
      throw createError(404, "Cliente associado não encontrado");
    }

    const group = createGroup({
      name,
      description,
      attributes,
      clientId: targetClientId,
    });

    return res.status(201).json({ group });
  } catch (error) {
    return next(error);
  }
});

router.put("/groups/:id", requireRole("manager", "admin"), (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = getGroupById(id);
    if (!existing) {
      throw createError(404, "Grupo não encontrado");
    }

    if (req.user.role !== "admin") {
      ensureClientAccess(req.user, existing.clientId);
      if (req.body?.clientId && String(req.body.clientId) !== String(req.user.clientId)) {
        throw createError(403, "Não é permitido mover grupos para outro cliente");
      }
    } else if (Object.prototype.hasOwnProperty.call(req.body || {}, "clientId")) {
      if (!req.body.clientId) {
        throw createError(400, "clientId é obrigatório");
      }
      const client = getClientById(req.body.clientId);
      if (!client) {
        throw createError(404, "Cliente associado não encontrado");
      }
    }

    const payload = { ...req.body };
    delete payload.clientId;

    const updates = { ...payload };
    if (req.user.role === "admin" && Object.prototype.hasOwnProperty.call(req.body || {}, "clientId")) {
      updates.clientId = req.body.clientId;
    }

    const group = updateGroup(id, updates);
    return res.json({ group });
  } catch (error) {
    return next(error);
  }
});

router.delete("/groups/:id", requireRole("manager", "admin"), (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = getGroupById(id);
    if (!existing) {
      throw createError(404, "Grupo não encontrado");
    }
    if (req.user.role !== "admin") {
      ensureClientAccess(req.user, existing.clientId);
    }
    deleteGroup(id);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
