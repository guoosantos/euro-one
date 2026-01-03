import express from "express";
import createError from "http-errors";
import { randomUUID } from "crypto";

import { authenticate, signSession } from "../middleware/auth.js";
import { listClients } from "../models/client.js";
import { sanitizeUser, verifyUserCredentials } from "../models/user.js";
import prisma, { isPrismaAvailable } from "../services/prisma.js";
import { loginTraccar, isTraccarConfigured } from "../services/traccar.js";
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

const TRACCAR_NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "ETIMEDOUT",
]);

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

    const loginBody = req.body;
    const { email, username, login, password, remember } = loginBody || {};
    const userLogin = String(email || username || login || "").trim();
    const userPassword = typeof password === "string" ? password : null;

    console.info("[auth] login request", {
      userLogin,
      origin: req.headers.origin || null,
      userAgent: req.headers["user-agent"] || null,
      forwardedFor: req.headers["x-forwarded-for"] || null,
      authHeaders: {
        authorization: Boolean(req.headers.authorization),
        cookie: Boolean(req.headers.cookie),
      },
      env: {
        hasTraccarUrl: Boolean(process.env.TRACCAR_URL),
        hasTraccarBaseUrl: Boolean(process.env.TRACCAR_BASE_URL),
        hasTraccarUser: Boolean(process.env.TRACCAR_USER || process.env.TRACCAR_ADMIN_USER),
        hasTraccarPassword: Boolean(process.env.TRACCAR_PASSWORD || process.env.TRACCAR_ADMIN_PASSWORD),
      },
    });

    if (!loginBody || typeof loginBody !== "object") {
      console.warn("[auth] body ausente ou inválido no login");
      return res.status(400).json({ error: "Campos obrigatórios: usuário e senha" });
    }

    if (!userLogin || !userPassword) {
      return res.status(400).json({ error: "Campos obrigatórios: usuário e senha" });
    }

    console.info("[auth] início do login", { userLogin });

    let traccarAuth = null;
    try {
      traccarAuth = await authenticateWithTraccarFn(userLogin, userPassword);
      if (!traccarAuth?.ok) {
        console.warn("[auth] resposta inesperada do Traccar", {
          userLogin,
          status: traccarAuth?.status || traccarAuth?.error?.code,
          response: traccarAuth?.error || null,
        });
        return res.status(502).json({ error: "Erro ao autenticar no Traccar" });
      }
      if (traccarAuth?.ok) {
        console.info("[auth] autenticação Traccar OK", { userLogin, traccarUserId: traccarAuth?.user?.id });
      }
    } catch (error) {
      const status = Number(error?.status || error?.statusCode);
      console.warn("[auth] falha ao autenticar no Traccar", {
        userLogin,
        status: status || error?.traccar?.status || null,
        message: error?.message || error,
        response: error?.traccar?.response || error?.details?.response || error?.response?.data || null,
      });
      if (status === 401 || status === 403) {
        return res.status(401).json({ error: "Usuário ou senha inválidos" });
      }
      if (status === 502) {
        return res.status(502).json({ error: error?.message || "Servidor Traccar indisponível" });
      }
      return res.status(502).json({ error: "Erro ao autenticar no Traccar" });
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
        console.info("[auth] sessão local montada", {
          userId: sanitizedUser.id,
          clientId: sessionPayload?.clientId ?? sanitizedUser.clientId ?? null,
        });
      } catch (error) {
        console.warn("[auth] Falha ao construir sessão local, seguindo com sessão Traccar", error?.message || error);
        sessionPayload = null;
      }
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
    const resolvedClientId = sessionPayload?.client?.id ?? sessionUser.clientId ?? null;
    if (!resolvedClientId) {
      console.warn("[auth] usuário sem tenant associado", { userId: sessionUser.id, login: userLogin });
      return res.status(400).json({ error: "Usuário sem tenant associado" });
    }
    const traccarContext = traccarAuth?.ok
      ? traccarAuth?.session
        ? { type: "session", session: traccarAuth.session }
        : traccarAuth?.token
        ? { type: "token", token: traccarAuth.token }
        : null
      : null;
    const tokenPayload = {
      id: sessionUser.id,
      role: sessionUser.role,
      clientId: resolvedClientId,
      name: sessionUser.name,
      email: sessionUser.email,
      username: sessionUser.username ?? null,
      traccar: traccarContext,
    };
    try {
      const token = signSessionFn(tokenPayload);
      const cookieOptions = {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        ...(remember === false ? {} : { maxAge: 7 * 24 * 60 * 60 * 1000 }),
      };
      res.cookie("token", token, cookieOptions);
      console.info("[auth] sessão criada", { userId: sessionUser.id, clientId: resolvedClientId });
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
      console.error("[auth] falha ao criar sessão", {
        message: error?.message || error,
        stack: shouldLogStack ? error?.stack : undefined,
      });
      return res.status(500).json({ error: "Falha ao criar sessão" });
    }
  } catch (error) {
    const shouldLogStack =
      process.env.NODE_ENV !== "production" || String(process.env.AUTH_DEBUG || "").toLowerCase() === "true";
    console.error("[auth] falha no login", {
      message: error?.message || error,
      stack: shouldLogStack ? error?.stack : undefined,
      traccar: error?.traccar || error?.details?.response || error?.response?.data || null,
    });
    const status = Number(error?.status || error?.statusCode);
    if (status === 400) {
      return res.status(400).json({ error: error?.message || "Campos obrigatórios: usuário e senha" });
    }
    if (status === 401) {
      return res.status(401).json({ error: "Usuário ou senha inválidos" });
    }
    if (status === 502) {
      return res.status(502).json({ error: error?.message || "Servidor Traccar indisponível" });
    }
    if (status === 503) {
      return res.status(503).json({ error: error?.message || "Falha ao validar credenciais" });
    }
    if (!status) {
      const normalized = isDatabaseUnavailableError(error)
        ? buildDatabaseUnavailableError(error)
        : null;
      if (normalized) {
        return res.status(normalized.status || 503).json({ error: normalized.message });
      }
    }
    return res.status(500).json({ error: "Erro interno no servidor" });
  }
};

router.post("/login", handleLogin);
router.post("/auth/login", handleLogin);

const handleSession = async (req, res, next) => {
  try {
    const payload = await buildSessionPayload(req.user.id, req.user.role);
    console.info("[auth] sessão restaurada", {
      userId: payload?.user?.id || req.user?.id,
      clientId: payload?.clientId ?? payload?.client?.id ?? payload?.user?.clientId ?? null,
    });
    return res.json(payload);
  } catch (error) {
    const message = String(error?.message || "");
    if (
      Number(error?.status || error?.statusCode) === 400 &&
      (message.includes("Usuário não vinculado") || message.includes("clientId"))
    ) {
      console.warn("[auth] sessão sem tenant associado", { userId: req.user?.id });
      return res.status(401).json({ error: "Usuário sem tenant associado" });
    }
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
    console.warn("[auth] TRACCAR_BASE_URL ausente, não é possível autenticar no Traccar");
    const error = createError(502, "Servidor Traccar indisponível");
    error.traccar = { status: null, response: null, reason: "missing-base-url" };
    throw error;
  }
  const traccarAuth = await loginTraccar(login, password);
  if (traccarAuth?.ok) {
    return traccarAuth;
  }

  const status = Number(traccarAuth?.error?.code || traccarAuth?.status || traccarAuth?.statusCode);
  const errorCode = traccarAuth?.error?.code;
  const errorCodeNormalized = typeof errorCode === "string" ? errorCode.toUpperCase() : null;

  if (status === 401 || status === 403) {
    throw createError(401, "Usuário ou senha inválidos");
  }

  if (
    TRACCAR_NETWORK_ERROR_CODES.has(errorCodeNormalized)
    || status === 502
    || status === 503
    || status === 504
  ) {
    const error = createError(502, "Servidor Traccar indisponível");
    error.traccar = {
      status: status || errorCodeNormalized,
      response: traccarAuth?.error || null,
    };
    throw error;
  }

  const error = createError(502, "Erro ao autenticar no Traccar");
  error.traccar = {
    status: status || errorCodeNormalized,
    response: traccarAuth?.error || null,
  };
  throw error;
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

export { buildSessionPayload, handleLogin };
export default router;
