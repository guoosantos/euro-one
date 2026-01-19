import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { createClient, deleteClient, getClientById, listClients, updateClient } from "../models/client.js";
import { deleteUsersByClientId, listUsers } from "../models/user.js";
import { deleteGroupsByClientId } from "../models/group.js";

const router = express.Router();

router.use(authenticate);

router.get("/clients", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const allClients = await listClients();
    if (req.user.role === "admin") {
      return res.json({ clients: allClients });
    }
    const clientId = req.user.clientId;
    if (!clientId) {
      return res.json({ clients: [] });
    }
    const client = await getClientById(clientId);
    return res.json({ clients: client ? [client] : [] });
  } catch (error) {
    return next(error);
  }
});

router.get("/clients/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (req.user.role !== "admin" && String(req.user.clientId) !== String(id)) {
      throw createError(403, "Permissão insuficiente para visualizar este cliente");
    }
    const client = await getClientById(id);
    if (!client) {
      throw createError(404, "Cliente não encontrado");
    }
    return res.json({ client });
  } catch (error) {
    return next(error);
  }
});

router.post("/clients", requireRole("admin"), async (req, res, next) => {
  try {
    const { name, deviceLimit, userLimit, attributes = {} } = req.body || {};
    if (!name) {
      throw createError(400, "Nome é obrigatório");
    }
    const client = await createClient({
      name,
      deviceLimit,
      userLimit,
      attributes: { companyName: attributes.companyName || name, ...attributes },
    });
    return res.status(201).json({ client });
  } catch (error) {
    return next(error);
  }
});

router.put("/clients/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (req.user.role !== "admin" && String(req.user.clientId) !== String(id)) {
      throw createError(403, "Permissão insuficiente para atualizar este cliente");
    }
    const client = await updateClient(id, req.body || {});
    return res.json({ client });
  } catch (error) {
    return next(error);
  }
});

router.delete("/clients/:id", requireRole("admin"), (req, res, next) => {
  try {
    const { id } = req.params;
    deleteClient(id);
    deleteUsersByClientId(id);
    deleteGroupsByClientId(id);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.get("/clients/:id/users", requireRole("admin"), (req, res, next) => {
  try {
    const { id } = req.params;
    const users = listUsers({ clientId: id });
    return res.json({ users });
  } catch (error) {
    return next(error);
  }
});

export default router;
