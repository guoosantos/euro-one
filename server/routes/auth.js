import express from "express";
import createError from "http-errors";
import { randomUUID } from "crypto";

import { authenticate, signSession } from "../middleware/auth.js";
import { listClients } from "../models/client.js";
import { resolveTenantScope } from "../utils/tenant-scope.js";
import { sanitizeUser, verifyUserCredentials } from "../models/user.js";
import prisma, { isPrismaAvailable } from "../services/prisma.js";
import {
  getFallbackClient,
  getFallbackUser,
  isDemoModeEnabled,
  shouldUseDemoFallback,
} from "../services/fallback-data.js";
import { recordAuditEvent, resolveRequestIp } from "../services/audit-log.js";

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
  missingTenant: "MISSING_TENANT",
  sessionCreationFailed: "SESSION_CREATION_FAILED",
  invalidRequest: "INVALID_REQUEST",
};

const DATA_URI_BASE64_PATTERN = /^data:[^;]+;base64,/i;
const BASE64ISH_PATTERN = /^[a-z0-9+/=\s]+$/i;
const MEDIA_LIKE_KEY_PATTERN = /(icon|logo|avatar|image|picture|photo|thumb|thumbnail|banner|signature|media|base64|svg)/i;
const MAX_SESSION_STRING_BYTES = Number(process.env.AUTH_SESSION_MAX_STRING_BYTES || 8 * 1024);
const MAX_SESSION_ATTRIBUTES_BYTES = Number(process.env.AUTH_SESSION_MAX_ATTRIBUTES_BYTES || 64 * 1024);
const SESSION_PRUNE_MAX_DEPTH = 8;
const SESSION_PRUNE_MAX_ARRAY_ITEMS = 500;
const SESSION_ATTRIBUTE_FALLBACK_KEYS = new Set([
  "locale",
  "timezone",
  "units",
  "theme",
  "companyName",
  "segment",
  "clientType",
  "brandColor",
  "brand_color",
  "accentColor",
  "accent_color",
  "permissionGroupId",
  "modules",
  "modulePermissions",
  "claims",
  "capabilities",
  "userAccess",
  "clientProfile",
  "deviceLimit",
  "userLimit",
  "homeClientId",
  "allowedMirrorOwnerIds",
]);

function estimateJsonBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null));
  } catch (_error) {
    return 0;
  }
}

function shouldDropSessionString(value, key) {
  if (typeof value !== "string") return false;
  const bytes = Buffer.byteLength(value);
  if (DATA_URI_BASE64_PATTERN.test(value)) return true;
  if (bytes <= MAX_SESSION_STRING_BYTES) return false;
  if (MEDIA_LIKE_KEY_PATTERN.test(String(key || ""))) return true;
  if (BASE64ISH_PATTERN.test(value) && value.length >= 1024) return true;
  return false;
}

function pruneSessionValue(value, path = [], depth = 0) {
  if (depth > SESSION_PRUNE_MAX_DEPTH) return undefined;
  if (typeof value === "string") {
    const key = path[path.length - 1];
    return shouldDropSessionString(value, key) ? undefined : value;
  }
  if (Array.isArray(value)) {
    const out = [];
    const limit = Math.min(value.length, SESSION_PRUNE_MAX_ARRAY_ITEMS);
    for (let index = 0; index < limit; index += 1) {
      const item = pruneSessionValue(value[index], path.concat(String(index)), depth + 1);
      if (typeof item !== "undefined") out.push(item);
    }
    return out;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entryValue] of Object.entries(value)) {
      const item = pruneSessionValue(entryValue, path.concat(key), depth + 1);
      if (typeof item !== "undefined") {
        out[key] = item;
      }
    }
    return out;
  }
  return value;
}

function pickSessionFallbackAttributes(attributes) {
  if (!attributes || typeof attributes !== "object") return {};
  const fallback = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!SESSION_ATTRIBUTE_FALLBACK_KEYS.has(key)) continue;
    const next = pruneSessionValue(value, [key], 0);
    if (typeof next !== "undefined") {
      fallback[key] = next;
    }
  }
  return fallback;
}

function sanitizeSessionAttributes(attributes) {
  if (!attributes || typeof attributes !== "object") {
    return {};
  }
  const pruned = pruneSessionValue(attributes, ["attributes"], 0);
  const normalized = pruned && typeof pruned === "object" ? pruned : {};
  if (estimateJsonBytes(normalized) <= MAX_SESSION_ATTRIBUTES_BYTES) {
    return normalized;
  }
  const fallback = pickSessionFallbackAttributes(normalized);
  if (estimateJsonBytes(fallback) <= MAX_SESSION_ATTRIBUTES_BYTES) {
    return fallback;
  }
  return {};
}

function sanitizeSessionUser(user) {
  if (!user || typeof user !== "object") return user;
  if (!Object.prototype.hasOwnProperty.call(user, "attributes")) return { ...user };
  return {
    ...user,
    attributes: sanitizeSessionAttributes(user.attributes),
  };
}

function sanitizeSessionClient(client) {
  if (!client || typeof client !== "object") return client;
  if (!Object.prototype.hasOwnProperty.call(client, "attributes")) return { ...client };
  return {
    ...client,
    attributes: sanitizeSessionAttributes(client.attributes),
  };
}

function sanitizeSessionPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const next = { ...payload };
  if (next.user) next.user = sanitizeSessionUser(next.user);
  if (next.client) next.client = sanitizeSessionClient(next.client);
  if (Array.isArray(next.clients)) {
    next.clients = next.clients.map((client) => sanitizeSessionClient(client));
  }
  return next;
}

function buildDatabaseUnavailableError(error) {
  const unavailable = createError(503, "Banco de dados indisponível ou mal configurado");
  unavailable.code = error?.code || "DATABASE_UNAVAILABLE";
  unavailable.errorCode = unavailable.code;
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
    err.errorCode = code;
  }
  return err;
}

function shouldExposeDetails() {
  return process.env.NODE_ENV !== "production"
    || String(process.env.AUTH_DEBUG || "").toLowerCase() === "true";
}

function buildAuthCookieOptions(remember) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    ...(remember === false ? {} : { maxAge: 7 * 24 * 60 * 60 * 1000 }),
  };
}

function buildTokenAttributes(attributes) {
  const permissionGroupId = attributes?.permissionGroupId ?? null;
  if (!permissionGroupId) return {};
  return { permissionGroupId };
}

function normaliseAuthError(error, defaultStatus = 500) {
  if (!error) {
    return {
      status: defaultStatus,
      message: "Erro interno no servidor",
      errorCode: "UNEXPECTED_ERROR",
      details: null,
    };
  }

  const status = Number(error?.status || error?.statusCode) || defaultStatus;
  const errorCode = error?.errorCode || error?.code || null;
  const details = error?.details || {
    message: error?.message,
    stack: error?.stack,
    cause: error?.cause?.message || undefined,
  };

  if (isDatabaseUnavailableError(error)) {
    return {
      status: 503,
      message: "Banco de dados indisponível ou mal configurado",
      errorCode: errorCode || "DATABASE_UNAVAILABLE",
      details,
    };
  }

  if (status === 401) {
    return {
      status,
      message: "Usuário ou senha inválidos",
      errorCode: errorCode || AUTH_ERROR_CODES.invalidCredentials,
      details,
    };
  }

  if (status === 400) {
    return {
      status,
      message: error?.message || "Campos obrigatórios: usuário e senha",
      errorCode: errorCode || AUTH_ERROR_CODES.invalidRequest,
      details,
    };
  }

  if (status === 502) {
    return {
      status,
      message: error?.message || "Serviço de autenticação indisponível",
      errorCode: errorCode || AUTH_ERROR_CODES.authUnavailable,
      details,
    };
  }

  if (status === 503) {
    return {
      status,
      message: error?.message || "Falha ao validar credenciais",
      errorCode: errorCode || AUTH_ERROR_CODES.authUnavailable,
      details,
    };
  }

  return {
    status: status || 500,
    message: error?.message || "Erro interno no servidor",
    errorCode: errorCode || "UNEXPECTED_ERROR",
    details,
  };
}

function respondAuthError(res, error) {
  const normalized = normaliseAuthError(error);
  const payload = {
    error: normalized.message,
    errorCode: normalized.errorCode,
  };

  if (shouldExposeDetails()) {
    payload.details = normalized.details;
  }

  return res.status(normalized.status).json(payload);
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
      throw buildAuthError(400, "Campos obrigatórios: usuário e senha", AUTH_ERROR_CODES.missingCredentials);
    }

    if (!userLogin || !userPassword) {
      throw buildAuthError(400, "Campos obrigatórios: usuário e senha", AUTH_ERROR_CODES.missingCredentials);
    }

    console.info("[auth] início do login", { userLogin });

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
      if (
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
    const safeSessionPayload = sanitizeSessionPayload(sessionPayload);
    const sessionUser = safeSessionPayload.user || sanitizedUser;
    const resolvedClientId = safeSessionPayload?.client?.id ?? sessionUser.clientId ?? null;
    if (!resolvedClientId) {
      console.warn("[auth] usuário sem tenant associado", { userId: sessionUser.id, login: userLogin });
      const tenantError = buildAuthError(403, "Usuário sem tenant associado", AUTH_ERROR_CODES.missingTenant);
      tenantError.details = { userId: sessionUser.id, login: userLogin, clientId: sessionUser.clientId ?? null };
      throw tenantError;
    }
    const tokenPayload = {
      id: sessionUser.id,
      role: sessionUser.role,
      clientId: resolvedClientId,
      name: sessionUser.name,
      email: sessionUser.email,
      username: sessionUser.username ?? null,
      attributes: buildTokenAttributes(sessionUser.attributes),
    };
    try {
      const token = signSessionFn(tokenPayload);
      const cookieOptions = buildAuthCookieOptions(remember);
      res.cookie("token", token, cookieOptions);
      console.info("[auth] sessão criada", { userId: sessionUser.id, clientId: resolvedClientId });
      recordAuditEvent({
        clientId: resolvedClientId,
        category: "access",
        action: "LOGIN",
        status: "Concluído",
        sentAt: new Date().toISOString(),
        user: { id: sessionUser.id, name: sessionUser.name || sessionUser.email || null },
        ipAddress: resolveRequestIp(req),
        details: {
          userAgent: req.headers["user-agent"] || null,
          origin: req.headers.origin || null,
        },
      });
      return res.json({
        token,
        user: { ...sessionUser, clientId: tokenPayload.clientId },
        client: safeSessionPayload.client,
        clientId: tokenPayload.clientId,
        clients: safeSessionPayload.clients,
      });
    } catch (error) {
      const shouldLogStack =
        process.env.NODE_ENV !== "production" || String(process.env.AUTH_DEBUG || "").toLowerCase() === "true";
      console.error("[auth] falha ao criar sessão", {
        message: error?.message || error,
        stack: shouldLogStack ? error?.stack : undefined,
      });
      const sessionError = buildAuthError(500, "Falha ao criar sessão", AUTH_ERROR_CODES.sessionCreationFailed);
      sessionError.details = shouldLogStack ? error?.stack : error?.message;
      throw sessionError;
    }
  } catch (error) {
    const shouldLogStack = shouldExposeDetails();
    const normalized = normaliseAuthError(error);
    console.error("[auth] falha no login", {
      message: error?.message || error,
      status: normalized.status,
      errorCode: normalized.errorCode,
      stack: shouldLogStack ? error?.stack : undefined,
      traccar: error?.traccar || error?.details?.response || error?.response?.data || null,
    });

    return respondAuthError(res, error);
  }
};

router.post("/login", handleLogin);
router.post("/auth/login", handleLogin);

const handleRefresh = async (req, res, next) => {
  try {
    const sessionPayload = sanitizeSessionPayload(await buildSessionPayload(req.user.id));
    const sessionUser = sessionPayload.user;
    const resolvedClientId = sessionPayload?.client?.id ?? sessionUser?.clientId ?? null;
    if (!resolvedClientId) {
      console.warn("[auth] refresh sem tenant associado", { userId: sessionUser?.id ?? req.user?.id });
      const tenantError = buildAuthError(403, "Usuário sem tenant associado", AUTH_ERROR_CODES.missingTenant);
      tenantError.details = { userId: sessionUser?.id ?? req.user?.id, clientId: sessionUser?.clientId ?? null };
      return respondAuthError(res, tenantError);
    }
    const tokenPayload = {
      id: sessionUser.id,
      role: sessionUser.role,
      clientId: resolvedClientId,
      name: sessionUser.name,
      email: sessionUser.email,
      username: sessionUser.username ?? null,
      attributes: buildTokenAttributes(sessionUser.attributes),
    };
    const token = signSession(tokenPayload);
    const cookieOptions = buildAuthCookieOptions(req.body?.remember);
    res.cookie("token", token, cookieOptions);
    console.info("[auth] sessão atualizada", { userId: sessionUser.id, clientId: resolvedClientId });
    return res.json({
      token,
      user: { ...sessionUser, clientId: tokenPayload.clientId },
      client: sessionPayload.client,
      clientId: tokenPayload.clientId,
      clients: sessionPayload.clients,
    });
  } catch (error) {
    const shouldLogStack = shouldExposeDetails();
    const normalized = normaliseAuthError(error);
    console.error("[auth] falha no refresh", {
      message: error?.message || error,
      status: normalized.status,
      errorCode: normalized.errorCode,
      stack: shouldLogStack ? error?.stack : undefined,
    });
    return respondAuthError(res, error);
  }
};

const handleSession = async (req, res, next) => {
  try {
    const payload = sanitizeSessionPayload(await buildSessionPayload(req.user.id, req.user.role));
    console.info("[auth] sessão restaurada", {
      userId: payload?.user?.id || req.user?.id,
      clientId: payload?.clientId ?? payload?.client?.id ?? payload?.user?.clientId ?? null,
      bytes: estimateJsonBytes(payload),
    });
    return res.json(payload);
  } catch (error) {
    const message = String(error?.message || "");
    if (
      Number(error?.status || error?.statusCode) === 400 &&
      (message.includes("Usuário não vinculado") || message.includes("clientId"))
    ) {
      console.warn("[auth] sessão sem tenant associado", { userId: req.user?.id });
      const tenantError = buildAuthError(400, "Usuário sem tenant associado", AUTH_ERROR_CODES.missingTenant);
      return respondAuthError(res, tenantError);
    }
    return next(error);
  }
};

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

    let availableClients = [];
    if (user.role === "admin") {
      availableClients = await listClientsFn();
    } else {
      const allClients = await listClientsFn();
      const scope = await resolveTenantScope(user, { listClientsFn, clients: allClients });
      availableClients = allClients.filter((client) => scope.clientIds.has(String(client.id)));
    }

    const availableClientIds = new Set(availableClients.map((client) => String(client.id)));
    const preferredId =
      preference?.clientId && availableClientIds.has(String(preference.clientId)) ? preference.clientId : null;
    const userClientId = user.clientId ? String(user.clientId) : null;
    const fallbackId =
      userClientId && (availableClientIds.size === 0 || availableClientIds.has(userClientId))
        ? userClientId
        : availableClients[0]?.id || null;
    const resolvedClientId = preferredId || fallbackId || null;
    const resolvedClient =
      (resolvedClientId
        ? availableClients.find((item) => String(item.id) === String(resolvedClientId))
        : null) || availableClients[0] || null;

    if (resolvedClientId) {
      const shouldUpdatePreference = !preference || String(preference.clientId) !== String(resolvedClientId);
      if (shouldUpdatePreference) {
        await prismaClient.userPreference
          .upsert({
            where: { userId: user.id },
            update: { clientId: resolvedClientId, updatedAt: new Date() },
            create: { id: randomUUID(), userId: user.id, clientId: resolvedClientId },
          })
          .catch(() => null);
      }
    }

    const resolved = resolvedClient ? { ...resolvedClient } : null;
    const userWithClient = { ...user, clientId: resolvedClientId ?? user.clientId ?? resolved?.id ?? null };

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
router.post("/refresh", authenticate, (req, res, next) => handleRefresh(req, res, next));
router.post("/auth/refresh", authenticate, (req, res, next) => handleRefresh(req, res, next));

const handleLogout = (req, res) => {
  try {
    recordAuditEvent({
      clientId: req.user?.clientId ?? null,
      category: "access",
      action: "LOGOUT",
      status: "Concluído",
      sentAt: new Date().toISOString(),
      user: { id: req.user?.id ?? null, name: req.user?.name || req.user?.email || null },
      ipAddress: resolveRequestIp(req),
      details: {
        userAgent: req.headers["user-agent"] || null,
      },
    });
  } catch (error) {
    console.warn("[auth] falha ao registrar logout no audit", error?.message || error);
  }
  res.clearCookie("token");
  res.status(204).send();
};

router.post("/logout", authenticate, (req, res) => handleLogout(req, res));
router.post("/auth/logout", authenticate, (req, res) => handleLogout(req, res));

export { buildSessionPayload, handleLogin };
export default router;
