import jwt from "jsonwebtoken";
import createError from "http-errors";

import { config } from "../config.js";
import prisma, { isPrismaAvailable } from "../services/prisma.js";
import { enforceUserAccess } from "./user-access.js";
import { resolveTenant } from "./tenant.js";

export function signSession(payload) {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

const ROLE_SYNC_TTL_MS = (() => {
  const raw = Number(process.env.ROLE_SYNC_TTL_MS || 60_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000;
})();
const roleSyncCache = new Map();

function getCachedUser(userId) {
  const cached = roleSyncCache.get(String(userId));
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    roleSyncCache.delete(String(userId));
    return null;
  }
  return cached;
}

function cacheUser(userId, data) {
  roleSyncCache.set(String(userId), {
    data,
    expiresAt: Date.now() + ROLE_SYNC_TTL_MS,
  });
}

function extractTokenFromCookies(req) {
  if (req.cookies?.token) {
    return req.cookies.token;
  }

  const cookieHeader = req.headers?.cookie || "";
  return cookieHeader
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((pair) => {
      const [key, ...rest] = pair.split("=");
      return [key, rest.join("=")];
    })
    .reduce((acc, [key, value]) => (key === "token" ? value : acc), null);
}

export function extractToken(req) {
  const auth = req.headers?.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }

  const cookieToken = extractTokenFromCookies(req);
  if (cookieToken) {
    return cookieToken;
  }

  try {
    const url = new URL(req.originalUrl || req.url || "", "http://localhost");
    const queryToken = url.searchParams.get("token");
    return queryToken || null;
  } catch {
    return null;
  }
}

async function rehydrateUserFromStore(req, res) {
  if (!req.user?.id || !isPrismaAvailable()) {
    return;
  }
  const userId = String(req.user.id);
  const cached = getCachedUser(userId);
  let stored = cached?.data ?? null;
  if (!stored) {
    stored = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        clientId: true,
        name: true,
        email: true,
        username: true,
        attributes: true,
      },
    });
    if (!stored) {
      throw createError(401, "Sessão inválida");
    }
    cacheUser(userId, stored);
  }

  const previousRole = req.user.role;
  const previousClientId = req.user.clientId ?? null;
  const previousPermissionGroupId = req.user?.attributes?.permissionGroupId ?? null;
  const storedPermissionGroupId = stored?.attributes?.permissionGroupId ?? null;

  req.user.role = stored.role;
  req.user.clientId = stored.clientId ?? req.user.clientId ?? null;
  req.user.attributes = { ...(req.user.attributes || {}), ...(stored.attributes || {}) };
  if (!req.clientId) {
    req.clientId = req.user.clientId ?? null;
  }

  const roleChanged = previousRole !== stored.role;
  const clientChanged = previousClientId !== req.user.clientId;
  const permissionChanged = previousPermissionGroupId !== storedPermissionGroupId;

  if (process.env.DEBUG_ROLE === "true" && (roleChanged || clientChanged || permissionChanged)) {
    console.info("[auth] sessão reidratada a partir do banco", {
      path: req.originalUrl || req.url,
      method: req.method,
      userId,
      tokenRole: previousRole,
      dbRole: stored.role,
      tokenClientId: previousClientId,
      dbClientId: req.user.clientId ?? null,
      tokenPermissionGroupId: previousPermissionGroupId,
      dbPermissionGroupId: storedPermissionGroupId,
    });
  }

  if (res && (roleChanged || clientChanged)) {
    const tokenPayload = {
      id: stored.id,
      role: stored.role,
      clientId: req.user.clientId ?? stored.clientId ?? null,
      name: stored.name,
      email: stored.email,
      username: stored.username ?? null,
    };
    const token = signSession(tokenPayload);
    res.cookie("token", token, buildRoleSyncCookieOptions());
    req.sessionToken = token;
  }
}

export async function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return next(createError(401, "Token ausente"));
  }
  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
    req.sessionToken = token;
    req.user = {
      ...decoded,
      clientId: decoded?.clientId ?? null,
    };
    if (decoded?.traccar) {
      req.traccar = decoded.traccar;
    }
    if (!req.clientId) {
      req.clientId = req.user.clientId ?? null;
    }
  } catch (error) {
    return next(createError(401, "Token inválido ou expirado"));
  }
  try {
    await rehydrateUserFromStore(req, res);
  } catch (rehydrateError) {
    return next(rehydrateError);
  }
  try {
    resolveTenant(req, { required: false });
  } catch (tenantError) {
    return next(tenantError);
  }
  if (process.env.DEBUG_MIRROR === "true" && req.mirrorContext) {
    console.info("[auth] mirror resolved", {
      path: req.originalUrl || req.url,
      method: req.method,
      userId: req.user?.id ? String(req.user.id) : null,
      userClientId: req.user?.clientId ? String(req.user.clientId) : null,
      ownerClientId: req.mirrorContext?.ownerClientId ? String(req.mirrorContext.ownerClientId) : null,
      targetClientId: req.mirrorContext?.targetClientId ? String(req.mirrorContext.targetClientId) : null,
      mirrorId: req.mirrorContext?.mirrorId ? String(req.mirrorContext.mirrorId) : null,
    });
  }
  try {
    enforceUserAccess(req);
  } catch (accessError) {
    return next(accessError);
  }
  return next();
}

// Alias para compatibilidade com imports antigos
export const requireAuth = authenticate;

function buildRoleSyncCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

export function requireRole(...roles) {
  return async (req, res, next) => {
    const allowed = roles.flat();
    if (!req.user) {
      return next(createError(401, "Sessão não autenticada"));
    }
    if (allowed.length === 0 || allowed.includes("any")) {
      return next();
    }

    const role = req.user.role;
    if (allowed.includes(role)) {
      return next();
    }

    // Hierarquia simples: admin > manager > user
    if (role === "admin") {
      return next();
    }
    if (role === "tenant_admin") {
      if (allowed.includes("manager") || allowed.includes("user") || allowed.includes("tenant_admin")) {
        return next();
      }
    }
    if (role === "manager" && allowed.includes("user")) {
      return next();
    }
    const isMirrorRead =
      req.mirrorContext?.mode === "target" && ["GET", "HEAD"].includes(req.method);
    if (isMirrorRead) {
      if (process.env.DEBUG_MIRROR === "true") {
        console.info("[auth] bypass requireRole for mirror read", {
          path: req.originalUrl || req.url,
          method: req.method,
          role,
          allowed,
          mirrorId: req.mirrorContext?.mirrorId ? String(req.mirrorContext.mirrorId) : null,
          ownerClientId: req.mirrorContext?.ownerClientId ? String(req.mirrorContext.ownerClientId) : null,
        });
      }
      return next();
    }
    if (process.env.DEBUG_MIRROR === "true") {
      console.warn("[auth] requireRole denied", {
        path: req.originalUrl || req.url,
        method: req.method,
        role,
        allowed,
        mirrorContext: req.mirrorContext
          ? {
              mode: req.mirrorContext.mode,
              ownerClientId: req.mirrorContext.ownerClientId,
              targetClientId: req.mirrorContext.targetClientId,
              mirrorId: req.mirrorContext.mirrorId,
            }
          : null,
      });
    }
    return next(createError(403, "Permissão insuficiente"));
  };
}
