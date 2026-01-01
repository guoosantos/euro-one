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
} from "../services/fallback-data.js";

const router = express.Router();

const DATABASE_UNAVAILABLE_CODES = new Set([
  "P1000",
  "P1001",
  "P1002",
  "P1003",
  "P1008",
  "P1010",
  "P1011",
  "P1017",
  "P2024",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

const AUTH_ERROR_CODES = {
  missingCredentials: "MISSING_CREDENTIALS",
  invalidCredentials: "INVALID_CREDENTIALS",
  authUnavailable: "AUTH_UNAVAILABLE",
};

function buildDatabaseUnavailableError(error) {
  const unavailable = createError(503, "Banco de dados indisponível ou mal configurado");
  unavailable.code = error?.code || "DATABASE_UNAVAILABLE";
  unavailable.details = {
    message: error?.message,
    stack: error?.stack,
  };
  return unavailable;
}

function buildAuthError(status, message, code) {
  const err = createError(status, message);
  if (code) {
    err.code = code;
  }
  return err;
}

function isDatabaseUnavailableError(error) {
  const status = Number(error?.status || error?.statusCode);
  const code = String(error?.code || error?.original?.code || "").toUpperCase();
  if (DATABASE_UNAVAILABLE_CODES.has(code)) return true;
  if (code === "DATABASE_UNAVAILABLE") return true;
  if (status === 503) {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("banco") || message.includes("database") || message.includes("prisma")) {
      return true;
    }
  }
  return false;
}

const baseAuthDeps = {
  verifyUserCredentials,
  sanitizeUser,
  buildSessionPayload,
  signSession,
  isPrismaAvailable,
  shouldUseDemoFallback,
  getFallbackUser,
  getFallbackClient,
  authenticateWithTraccar,
};

const authDeps = { ...baseAuthDeps };

export function __setAuthRouteDeps(overrides = {}) {
  Object.assign(authDeps, overrides);
}

export function __resetAuthRouteDeps() {
  Object.assign(authDeps, baseAuthDeps);
}

const handleLogin = async (req, res, next) => {
  try {
    const {
      verifyUserCredentials: verifyUserCredentialsFn,
      sanitizeUser: sanitizeUserFn,
      buildSessionPayload: buildSessionPayloadFn,
      signSession: signSessionFn,
      isPrismaAvailable: isPrismaAvailableFn,
      shouldUseDemoFallback: shouldUseDemoFallbackFn,
      getFallbackUser: getFallbackUserFn,
      getFallbackClient: getFallbackClientFn,
      authenticateWithTraccar: authenticateWithTraccarFn,
    } = authDeps;
    const { email, username, login, password } = req.body || {};
    const userLogin = String(email || username || login || "").trim();
    const userPassword = typeof password === "string" ? password : null;

    if (!userLogin || !userPassword) {
      throw buildAuthError(400, "Login e senha são obrigatórios", AUTH_ERROR_CODES.missingCredentials);
    }

    let traccarAuth = null;
    let traccarAuthError = null;
    try {
      traccarAuth = await authenticateWithTraccarFn(userLogin, userPassword);
    } catch (error) {
      const status = Number(error?.status || error?.statusCode);
      if (status === 401 || status === 403) {
        traccarAuthError = error;
      } else {
        throw error;
      }
    }
    const traccarUser = traccarAuth?.user || null;

    let user = null;
    let sessionPayload = null;
    let localAuthError = null;
    try {
      user = await verifyUserCredentialsFn(userLogin, userPassword, { allowFallback: true });
    } catch (error) {
      const status = Number(error?.status || error?.statusCode);
      if (status === 401) {
        throw buildAuthError(401, "Credenciais inválidas", AUTH_ERROR_CODES.invalidCredentials);
      }
      console.warn("[auth] Falha ao validar credenciais locais; seguindo com Traccar", error?.message || error);
      localAuthError = error;
      user = null;
    }

    if (user) {
      const sanitizedUser = sanitizeUserFn(user);
      try {
        sessionPayload = await buildSessionPayloadFn(user.id, sanitizedUser.role);
      } catch (error) {
        console.warn("[auth] Falha ao construir sessão local, seguindo com sessão Traccar", error?.message || error);
        sessionPayload = null;
      }
    }

    if (!user && traccarAuthError) {
      if (localAuthError) {
        const normalized = isDatabaseUnavailableError(localAuthError)
          ? buildDatabaseUnavailableError(localAuthError)
          : buildAuthError(503, "Falha ao validar credenciais", AUTH_ERROR_CODES.authUnavailable);
        throw normalized;
      }
      throw buildAuthError(401, "Credenciais inválidas", AUTH_ERROR_CODES.invalidCredentials);
    }

    if (!user) {
      if (traccarUser) {
        user = buildTraccarSessionUser(traccarUser, userLogin);
      } else if (
        localAuthError &&
        isDatabaseUnavailableError(localAuthError) &&
        !shouldUseDemoFallbackFn({ prismaAvailable: isPrismaAvailableFn() })
      ) {
        throw buildDatabaseUnavailableError(localAuthError);
      } else if (shouldUseDemoFallbackFn({ prismaAvailable: isPrismaAvailableFn() })) {
        const fallbackUser = getFallbackUserFn();
        const fallbackClient = getFallbackClientFn();
        user = sanitizeUserFn({
          ...fallbackUser,
          email: fallbackUser.email || userLogin,
          username: fallbackUser.username || userLogin,
          role: fallbackUser.role || "admin",
          clientId: fallbackUser.clientId || fallbackClient.id,
        });
      } else {
        throw buildAuthError(503, "Falha ao validar sessão e credenciais", AUTH_ERROR_CODES.authUnavailable);
      }
    }

    const sanitizedUser = sanitizeUserFn(user);
    if (!sessionPayload) {
      sessionPayload = {
        user: sanitizedUser,
        client: null,
        clientId: sanitizedUser.clientId ?? null,
        clients: [],
      };
    }
    const sessionUser = sessionPayload.user || sanitizedUser;
    const tokenPayload = {
      id: sessionUser.id,
      role: sessionUser.role,
      clientId: sessionPayload?.client?.id ?? sessionUser.clientId ?? null,
      name: sessionUser.name,
      email: sessionUser.email,
      username: sessionUser.username ?? null,
    };
    const token = signSessionFn(tokenPayload);
    return res.json({
      token,
      user: { ...sessionUser, clientId: tokenPayload.clientId },
      client: sessionPayload.client,
      clientId: tokenPayload.clientId,
      clients: sessionPayload.clients,
    });
  } catch (error) {
    const shouldLogStack =
      process.env.NODE_ENV !== "production" || String(process.env.AUTH_DEBUG || "").toLowerCase() === "true";
    console.error("[auth] falha no login", {
      message: error?.message || error,
      stack: shouldLogStack ? error?.stack : undefined,
    });
    const status = Number(error?.status || error?.statusCode);
    if (!status) {
      const normalized = isDatabaseUnavailableError(error)
        ? buildDatabaseUnavailableError(error)
        : null;
      if (normalized) return next(normalized);
    }
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

function buildTraccarSessionUser(traccarUser, fallbackLogin) {
  const traccarId = traccarUser?.id ? String(traccarUser.id) : null;
  const baseId = traccarId || String(fallbackLogin || "traccar");
  const email =
    traccarUser?.email
    || (String(fallbackLogin || "").includes("@") ? String(fallbackLogin).trim() : null);
  const username =
    traccarUser?.name
    || traccarUser?.username
    || (!email ? String(fallbackLogin || "").trim() : null);
  const name = traccarUser?.name || traccarUser?.username || String(fallbackLogin || "Usuário Traccar");
  const role = traccarUser?.administrator ? "admin" : "manager";

  return sanitizeUser({
    id: `traccar:${baseId}`,
    name,
    email,
    username,
    role,
    clientId: null,
    attributes: {
      traccarUserId: traccarId,
    },
  });
}

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
    console.error("[auth] falha ao construir sessão via Prisma", error?.message || error, error?.stack);
    if (error?.status || error?.statusCode) {
      throw error;
    }
    const code = String(error?.code || error?.original?.code || "").toUpperCase();
    if (DATABASE_UNAVAILABLE_CODES.has(code)) {
      throw buildDatabaseUnavailableError(error);
    }
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("prisma") || message.includes("database")) {
      throw buildDatabaseUnavailableError(error);
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

export { buildSessionPayload, handleLogin, __resetAuthRouteDeps };
export default router;
