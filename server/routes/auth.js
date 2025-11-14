import express from "express";
import createError from "http-errors";

import { loginTraccar } from "../services/traccar.js";
import { buildUserPayload, mapTraccarUserToRole } from "../utils/roles.js";
import { authenticate, signSession } from "../middleware/auth.js";

const router = express.Router();

function sanitize(user) {
  if (!user) return null;
  const { traccar, ...rest } = user;
  return rest;
}

router.post("/login", async (req, res, next) => {
  try {
    const { email, password, remember = true } = req.body || {};
    if (!email || !password) {
      throw createError(400, "E-mail e senha são obrigatórios");
    }

    const loginResult = await loginTraccar(email, password);
    const role = mapTraccarUserToRole(loginResult.user);
    const userPayload = buildUserPayload(loginResult.user);

    const token = signSession({
      ...userPayload,
      email,
      role,
      traccar: loginResult.session
        ? { type: "session", session: loginResult.session, token: loginResult.token }
        : { type: "basic", token: loginResult.token?.replace(/^Basic\s+/i, "") },
    });

    if (remember) {
      res.cookie("token", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 1000 * 60 * 60 * 12,
      });
    }

    res.json({
      token,
      user: sanitize({ ...userPayload, role }),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/session", authenticate, (req, res) => {
  res.json({
    user: sanitize(req.user),
  });
});

router.post("/logout", authenticate, (req, res) => {
  res.clearCookie("token");
  res.status(204).send();
});

export default router;
