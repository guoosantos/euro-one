import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { authorizePermission } from "../middleware/permissions.js";
import { getClientById } from "../models/client.js";
import {
  createUser,
  deleteUser,
  getUserById,
  listUsers,
  updateUser,
} from "../models/user.js";

const router = express.Router();

router.use(authenticate);
router.use(requireRole("manager", "admin"));

function ensureClientAccess(sessionUser, clientId) {
  if (sessionUser.role === "admin") {
    return;
  }
  if (!sessionUser.clientId || String(sessionUser.clientId) !== String(clientId)) {
    throw createError(403, "Operação não permitida para este cliente");
  }
}

router.get(
  "/users",
  authorizePermission({ menuKey: "admin", pageKey: "users" }),
  async (req, res, next) => {
  try {
    if (req.user.role === "admin") {
      const { clientId } = req.query;
      const filterClientId = clientId === "" || typeof clientId === "undefined" ? undefined : clientId;
      const users = await listUsers({ clientId: filterClientId });
      return res.json({ users });
    }
    if (!req.user.clientId) {
      return res.json({ users: [] });
    }
    const users = await listUsers({ clientId: req.user.clientId });
    return res.json({ users });
  } catch (error) {
    return next(error);
  }
  },
);

router.post(
  "/users",
  authorizePermission({ menuKey: "admin", pageKey: "users", requireFull: true }),
  async (req, res, next) => {
  try {
    const { name, email, password, role = "user", username, clientId, attributes = {} } = req.body || {};
    if (!name || !email || !password) {
      throw createError(400, "Nome, e-mail e senha são obrigatórios");
    }
    const resolvedUsername = username || email;

    if (req.user.role !== "admin" && role !== "user") {
      throw createError(403, "Somente administradores podem criar papéis avançados");
    }

    const targetClientId = req.user.role === "admin" ? clientId : req.user.clientId;
    if (role !== "admin") {
      if (!targetClientId) {
        throw createError(400, "clientId é obrigatório para usuários não administradores");
      }
      ensureClientAccess(req.user, targetClientId);
      const client = getClientById(targetClientId);
      if (!client) {
        throw createError(404, "Cliente associado não encontrado");
      }
    }

    const user = await createUser({
      name,
      email,
      username: resolvedUsername,
      password,
      role,
      clientId: role === "admin" ? null : targetClientId,
      attributes,
    });
    return res.status(201).json({ user });
  } catch (error) {
    return next(error);
  }
  },
);

router.put(
  "/users/:id",
  authorizePermission({ menuKey: "admin", pageKey: "users", requireFull: true }),
  async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await getUserById(id, { includeSensitive: true });
    if (!existing) {
      throw createError(404, "Usuário não encontrado");
    }

    if (req.user.role !== "admin") {
      ensureClientAccess(req.user, existing.clientId);
      if (existing.role === "admin") {
        throw createError(403, "Não é permitido atualizar administradores globais");
      }
      if (req.body.role && req.body.role !== "user") {
        throw createError(403, "Somente administradores podem alterar papéis");
      }
      if (req.body.clientId && String(req.body.clientId) !== String(req.user.clientId)) {
        throw createError(403, "Não é permitido mover usuários para outro cliente");
      }
    } else if (req.body.role && req.body.role !== "admin") {
      const nextClientId = req.body.clientId ?? existing.clientId;
      if (!nextClientId) {
        throw createError(400, "clientId é obrigatório para usuários não administradores");
      }
      const client = getClientById(nextClientId);
      if (!client) {
        throw createError(404, "Cliente associado não encontrado");
      }
    }

    const payload = { ...req.body };
    if (payload.password === "") {
      delete payload.password;
    }

    const user = await updateUser(id, payload);
    return res.json({ user });
  } catch (error) {
    return next(error);
  }
  },
);

router.delete(
  "/users/:id",
  authorizePermission({ menuKey: "admin", pageKey: "users", requireFull: true }),
  (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = getUserById(id, { includeSensitive: true });
    if (!existing) {
      throw createError(404, "Usuário não encontrado");
    }
    if (req.user.role !== "admin") {
      ensureClientAccess(req.user, existing.clientId);
      if (existing.role !== "user") {
        throw createError(403, "Somente administradores podem remover este usuário");
      }
    }
    deleteUser(id);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
  },
);

router.post(
  "/users/:id/transfer-access",
  authorizePermission({ menuKey: "admin", pageKey: "users", requireFull: true }),
  async (req, res, next) => {
  try {
    const { id } = req.params;
    const { toUserId } = req.body || {};
    if (!toUserId) {
      throw createError(400, "toUserId é obrigatório");
    }
    const source = await getUserById(id, { includeSensitive: true });
    if (!source) {
      throw createError(404, "Usuário origem não encontrado");
    }
    const target = await getUserById(toUserId, { includeSensitive: true });
    if (!target) {
      throw createError(404, "Usuário destino não encontrado");
    }
    if (req.user.role !== "admin") {
      ensureClientAccess(req.user, source.clientId);
      ensureClientAccess(req.user, target.clientId);
      if (String(source.clientId) !== String(target.clientId)) {
        throw createError(403, "Usuários devem pertencer ao mesmo cliente");
      }
      if (source.role === "admin" || target.role === "admin") {
        throw createError(403, "Não é permitido transferir acesso de administradores");
      }
    }

    const sourceAttributes = source.attributes || {};
    const targetAttributes = target.attributes || {};
    const nextAttributes = {
      ...targetAttributes,
      userAccess: sourceAttributes.userAccess || targetAttributes.userAccess,
      permissionGroupId: sourceAttributes.permissionGroupId || null,
      mirrorAccess: sourceAttributes.mirrorAccess || targetAttributes.mirrorAccess,
    };

    const updated = await updateUser(toUserId, { attributes: nextAttributes });
    return res.json({ user: updated });
  } catch (error) {
    return next(error);
  }
  },
);

export default router;
