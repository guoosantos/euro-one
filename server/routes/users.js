import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { buildUserPayload } from "../utils/roles.js";
import { createUser, deleteUser, listUsers, updateUser } from "../services/traccar.js";

const router = express.Router();

router.use(authenticate);
router.use(requireRole("manager", "admin"));

function resolveClientId(reqBody, sessionUser) {
  if (sessionUser.role === "admin") {
    return reqBody.clientId || reqBody.managerId || undefined;
  }
  return sessionUser.id;
}

router.get("/users", async (req, res, next) => {
  try {
    const { clientId } = req.query;
    const context = req.user.role === "admin" ? null : req.user;
    const users = await listUsers({}, { asAdmin: req.user.role === "admin", context });
    const filtered = users
      .filter((user) => {
        if (user.administrator) return req.user.role === "admin";
        if (req.user.role === "admin" && clientId) {
          return (
            user?.attributes?.administratorId === Number(clientId) ||
            user?.administratorId === Number(clientId) ||
            user?.attributes?.managerId === Number(clientId)
          );
        }
        if (req.user.role === "manager") {
          return !user.administrator;
        }
        return true;
      })
      .map((user) => ({ ...buildUserPayload(user), administratorId: user.administratorId }));

    res.json({ users: filtered });
  } catch (error) {
    next(error);
  }
});

router.post("/users", async (req, res, next) => {
  try {
    const { name, email, password, role = "user", deviceLimit = 0, userLimit = 0, attributes = {} } = req.body || {};
    if (!name || !email || !password) {
      throw createError(400, "Nome, e-mail e senha são obrigatórios");
    }

    const clientId = resolveClientId(req.body || {}, req.user);
    if (!clientId) {
      throw createError(400, "Cliente associado obrigatório");
    }

    const payload = {
      name,
      email,
      password,
      administrator: role === "admin",
      readonly: role === "viewer",
      disabled: false,
      deviceLimit,
      userLimit,
      attributes: {
        role,
        managerId: clientId,
        ...attributes,
      },
    };

    const created = await createUser(payload, {
      asAdmin: req.user.role === "admin",
      context: req.user,
      clientId,
    });

    res.status(201).json({ user: buildUserPayload(created) });
  } catch (error) {
    next(error);
  }
});

router.put("/users/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const payload = { ...req.body };
    if (payload.attributes) {
      payload.attributes.role = payload.attributes.role || "user";
    }
    const updated = await updateUser(id, payload, { asAdmin: req.user.role === "admin", context: req.user });
    res.json({ user: buildUserPayload(updated) });
  } catch (error) {
    next(error);
  }
});

router.delete("/users/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    await deleteUser(id, { asAdmin: req.user.role === "admin", context: req.user });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
