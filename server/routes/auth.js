import express from "express";
import createError from "http-errors";

import { authenticate, signSession } from "../middleware/auth.js";
import { listClients } from "../models/client.js";
import { sanitizeUser, verifyUserCredentials } from "../models/user.js";
import prisma from "../services/prisma.js";

const router = express.Router();

router.post("/login", async (req, res, next) => {
  try {
    const { email, username, login, password } = req.body || {};
    const userLogin = email || username || login;
    const user = await verifyUserCredentials(userLogin, password);
    const sanitizedUser = sanitizeUser(user);
    const sessionPayload = await buildSessionPayload(user.id, sanitizedUser.role);
    const tokenPayload = {
      id: sanitizedUser.id,
      role: sanitizedUser.role,
      clientId: sessionPayload?.client?.id ?? sanitizedUser.clientId ?? null,
      name: sanitizedUser.name,
      email: sanitizedUser.email,
      username: sanitizedUser.username ?? null,
    };
    const token = signSession(tokenPayload);
    return res.json({
      token,
      user: { ...sanitizedUser, clientId: tokenPayload.clientId },
      client: sessionPayload.client,
      clients: sessionPayload.clients,
    });
  } catch (error) {
    return next(error);
  }
});

async function buildSessionPayload(userId, roleHint = null) {
  const stored = await prisma.user.findUnique({
    where: { id: String(userId) },
    include: { client: true },
  });
  if (!stored) {
    throw createError(404, "Usuário não encontrado");
  }

  const user = sanitizeUser(stored);
  const preference = await prisma.userPreference.findUnique({
    where: { userId: user.id },
    include: { client: true },
  });

  const availableClients = user.role === "admin"
    ? await listClients()
    : user.client
      ? [user.client]
      : [];

  const preferredId = preference?.clientId || user.clientId || null;
  const resolvedClient = availableClients.find((item) => String(item.id) === String(preferredId))
    || availableClients[0]
    || null;

  return { user, client: resolvedClient, clients: availableClients };
}

router.get("/session", authenticate, async (req, res, next) => {
  try {
    const payload = await buildSessionPayload(req.user.id, req.user.role);
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/logout", authenticate, (req, res) => {
  res.clearCookie("token");
  res.status(204).send();
});

export default router;
