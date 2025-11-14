import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { createUser, deleteUser, listUsers, updateUser } from "../services/traccar.js";
import { buildUserPayload } from "../utils/roles.js";

const router = express.Router();

router.use(authenticate);
router.use(requireRole("admin"));

router.get("/clients", async (_req, res, next) => {
  try {
    const managers = await listUsers({ all: true }, { asAdmin: true });
    const payload = managers
      .filter((user) => {
        const role = user?.attributes?.role || (user.administrator ? "admin" : null);
        return role === "manager" || (!user.administrator && (user.userLimit > 0 || user.deviceLimit > 0));
      })
      .map((user) => ({
        ...buildUserPayload(user),
        companyName: user?.attributes?.companyName || user.name,
      }));
    res.json({ clients: payload });
  } catch (error) {
    next(error);
  }
});

router.post("/clients", async (req, res, next) => {
  try {
    const { name, email, password, deviceLimit = 100, userLimit = 50, attributes = {} } = req.body || {};
    if (!name || !email || !password) {
      throw createError(400, "Nome, e-mail e senha são obrigatórios");
    }

    const payload = {
      name,
      email,
      password,
      administrator: false,
      readonly: false,
      disabled: false,
      deviceLimit,
      userLimit,
      attributes: {
        role: "manager",
        companyName: name,
        ...attributes,
      },
    };

    const created = await createUser(payload, { asAdmin: true });
    res.status(201).json({ client: buildUserPayload(created) });
  } catch (error) {
    next(error);
  }
});

router.put("/clients/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const payload = { ...req.body };
    if (payload.attributes) {
      payload.attributes.role = payload.attributes.role || "manager";
    }
    const updated = await updateUser(id, payload, { asAdmin: true });
    res.json({ client: buildUserPayload(updated) });
  } catch (error) {
    next(error);
  }
});

router.delete("/clients/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    await deleteUser(id, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
