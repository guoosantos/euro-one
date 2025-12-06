import express from "express";
import createError from "http-errors";
import { randomUUID } from "crypto";

import { authenticate, signSession } from "../middleware/auth.js";
import { listClients } from "../models/client.js";
import { sanitizeUser, verifyUserCredentials } from "../models/user.js";
import prisma from "../services/prisma.js";
import { buildTraccarUnavailableError, loginTraccar } from "../services/traccar.js";

const router = express.Router();

router.post("/login", async (req, res, next) => {
  try {
    const { email, username, login, password } = req.body || {};
    const userLogin = String(email || username || login || "").trim();
    const userPassword = typeof password === "string" ? password : null;

    if (!userLogin || !userPassword) {
      throw createError(400, "Login e senha são obrigatórios");
    }

    const user = await verifyUserCredentials(userLogin, userPassword).catch((error) => {
      if (Number(error?.status || error?.statusCode) === 401) {
        throw createError(401, "Credenciais inválidas");
      }
      throw error;
    });

    await authenticateWithTraccar(userLogin, userPassword);

    const sanitizedUser = sanitizeUser(user);
    const sessionPayload = await buildSessionPayload(user.id, sanitizedUser.role);
    const sessionUser = sessionPayload.user || sanitizedUser;
    const tokenPayload = {
      id: sessionUser.id,
      role: sessionUser.role,
      clientId: sessionPayload?.client?.id ?? sessionUser.clientId ?? null,
      name: sessionUser.name,
      email: sessionUser.email,
      username: sessionUser.username ?? null,
    };
    const token = signSession(tokenPayload);
    return res.json({
      token,
      user: { ...sessionUser, clientId: tokenPayload.clientId },
      client: sessionPayload.client,
      clientId: tokenPayload.clientId,
      clients: sessionPayload.clients,
    });
  } catch (error) {
    return next(error);
  }
});

async function authenticateWithTraccar(login, password) {
  try {
    const traccarAuth = await loginTraccar(login, password);
    if (traccarAuth?.ok) {
      return traccarAuth;
    }

    const status = Number(traccarAuth?.error?.code || traccarAuth?.status || traccarAuth?.statusCode);
    if (status === 401 || status === 403) {
      throw createError(401, "Credenciais inválidas");
    }

    throw buildTraccarUnavailableError(traccarAuth?.error || traccarAuth, { endpoint: "/session" });
  } catch (error) {
    if (Number(error?.status || error?.statusCode) === 401) {
      throw error;
    }

    throw buildTraccarUnavailableError(error, { endpoint: "/session" });
  }
}

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

  const preferredId = preference?.clientId || user.clientId || availableClients[0]?.id || null;
  const resolvedClient = availableClients.find((item) => String(item.id) === String(preferredId))
    || availableClients[0]
    || null;

  if (!preference && resolvedClient) {
    await prisma.userPreference
      .upsert({
        where: { userId: user.id },
        update: { clientId: resolvedClient.id, updatedAt: new Date() },
        create: { id: randomUUID(), userId: user.id, clientId: resolvedClient.id },
      })
      .catch(() => null);
  }

  const resolved = resolvedClient ? { ...resolvedClient } : null;
  const userWithClient = { ...user, clientId: user.clientId ?? resolved?.id ?? null };

  return { user: userWithClient, client: resolved, clientId: userWithClient.clientId, clients: availableClients };
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
