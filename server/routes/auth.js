import express from "express";
import createError from "http-errors";
import { randomUUID } from "crypto";

import { authenticate, signSession } from "../middleware/auth.js";
import { listClients } from "../models/client.js";
import { sanitizeUser, verifyUserCredentials } from "../models/user.js";
import prisma, { isPrismaAvailable } from "../services/prisma.js";
import { buildTraccarUnavailableError, loginTraccar, isTraccarConfigured } from "../services/traccar.js";
import {
  getFallbackClient,
  getFallbackUser,
  isDemoModeEnabled,
  shouldUseDemoFallback,
  resolveFallbackCredentials,
} from "../services/fallback-data.js";

const router = express.Router();

const handleLogin = async (req, res, next) => {
  try {
    const { email, username, login, password } = req.body || {};
    const userLogin = String(email || username || login || "").trim();
    const userPassword = typeof password === "string" ? password : null;

    if (!userLogin || !userPassword) {
      throw createError(400, "Login e senha são obrigatórios");
    }

    await authenticateWithTraccar(userLogin, userPassword);

    const prismaAvailable = isPrismaAvailable();
    const fallbackAllowed = shouldUseDemoFallback({ prismaAvailable });
    const fallbackCredentials = fallbackAllowed ? resolveFallbackCredentials(userLogin, userPassword) : null;

    let user = null;
    if (prismaAvailable && !fallbackCredentials) {
      try {
        user = await verifyUserCredentials(userLogin, userPassword, { allowFallback: fallbackAllowed });
      } catch (error) {
        const status = Number(error?.status || error?.statusCode);
        if (status === 401) {
          throw createError(401, "Credenciais inválidas");
        }
        console.error("[auth] Falha ao validar credenciais locais; bloqueando fallback", error?.message || error);
        throw createError(503, "Falha interna ao validar credenciais");
      }
    }

    if (!user && fallbackCredentials) {
      user = sanitizeUser(fallbackCredentials);
    }

    if (!user) {
      if (!prismaAvailable) {
        if (!fallbackAllowed) {
          throw createError(503, "Banco de dados indisponível e modo demo desabilitado");
        }
        const fallbackUser = getFallbackUser();
        const fallbackClient = getFallbackClient();
        user = sanitizeUser({
          ...fallbackUser,
          email: fallbackUser.email || userLogin,
          username: fallbackUser.username || userLogin,
          role: fallbackUser.role || "admin",
          clientId: fallbackUser.clientId || fallbackClient.id,
        });
      } else {
        throw createError(401, "Credenciais inválidas");
      }
    }

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
};

router.post("/login", handleLogin);
router.post("/auth/login", handleLogin);

const handleSession = async (req, res, next) => {
  try {
    const payload = await buildSessionPayload(req.user.id, req.user.role);
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
};

async function authenticateWithTraccar(login, password) {
  if (!isTraccarConfigured()) {
    console.warn("[auth] TRACCAR_BASE_URL ausente, pulando validação no Traccar");
    return { ok: true, skipped: true };
  }
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
    console.warn("[auth] Falha ao validar sessão no Traccar, permitindo login local", error?.message || error);
    return { ok: false, skipped: true, reason: "traccar-unavailable" };
  }
}

async function buildSessionPayload(
  userId,
  roleHint = null,
  { prismaClient = prisma, isPrismaAvailableFn = isPrismaAvailable, listClientsFn = listClients } = {},
) {
  const prismaAvailable = isPrismaAvailableFn();
  const fallbackAllowed = shouldUseDemoFallback({ prismaAvailable });

  if (fallbackAllowed && isDemoModeEnabled()) {
    const fallbackUser = sanitizeUser(getFallbackUser());
    const client = getFallbackClient();
    const resolvedUser = { ...fallbackUser, clientId: fallbackUser.clientId || client.id };
    return { user: resolvedUser, client, clientId: resolvedUser.clientId, clients: [client] };
  }

  if (!prismaAvailable) {
    if (!fallbackAllowed) {
      throw createError(503, "Banco de dados indisponível e modo demo desabilitado");
    }
    const fallbackUser = sanitizeUser(getFallbackUser());
    const client = getFallbackClient();
    const resolvedUser = { ...fallbackUser, clientId: fallbackUser.clientId || client.id };
    return { user: resolvedUser, client, clientId: resolvedUser.clientId, clients: [client] };
  }

  try {
    const stored = await prismaClient.user.findUnique({
      where: { id: String(userId) },
      include: { client: true },
    });

    if (!stored) {
      throw createError(404, "Usuário não encontrado");
    }

    const user = sanitizeUser(stored);
    const preference = await prismaClient.userPreference.findUnique({
      where: { userId: user.id },
      include: { client: true },
    });

    const availableClients =
      user.role === "admin" ? await listClientsFn() : user.client ? [user.client] : [];

    const preferredId = preference?.clientId || user.clientId || availableClients[0]?.id || null;
    const resolvedClient = availableClients.find((item) => String(item.id) === String(preferredId))
      || availableClients[0]
      || null;

    if (!preference && resolvedClient) {
      await prismaClient.userPreference
        .upsert({
          where: { userId: user.id },
          update: { clientId: resolvedClient.id, updatedAt: new Date() },
          create: { id: randomUUID(), userId: user.id, clientId: resolvedClient.id },
        })
        .catch(() => null);
    }

    const resolved = resolvedClient ? { ...resolvedClient } : null;
    const userWithClient = { ...user, clientId: user.clientId ?? resolved?.id ?? null };

    if (!userWithClient.clientId && user.role !== "admin") {
      throw createError(400, "Usuário não vinculado a um cliente");
    }

    return {
      user: userWithClient,
      client: resolved,
      clientId: userWithClient.clientId,
      clients: availableClients,
    };
  } catch (error) {
    console.error("[auth] falha ao construir sessão via Prisma", error?.message || error);
    if (error?.status || error?.statusCode) {
      throw error;
    }
    throw createError(500, "Falha ao montar sessão do usuário");
  }
}

router.get("/session", authenticate, (req, res, next) => handleSession(req, res, next));
router.get("/auth/session", authenticate, (req, res, next) => handleSession(req, res, next));

const handleLogout = (req, res) => {
  res.clearCookie("token");
  res.status(204).send();
};

router.post("/logout", authenticate, (req, res) => handleLogout(req, res));
router.post("/auth/logout", authenticate, (req, res) => handleLogout(req, res));

export { buildSessionPayload, handleLogin };
export default router;
