import jwt from "jsonwebtoken";
import createError from "http-errors";

import { config } from "../config.js";
import { enforceUserAccess } from "./user-access.js";

export function signSession(payload) {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
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

export function authenticate(req, _res, next) {
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
    enforceUserAccess(req);
  } catch (accessError) {
    return next(accessError);
  }
  return next();
}

// Alias para compatibilidade com imports antigos
export const requireAuth = authenticate;

export function requireRole(...roles) {
  return (req, _res, next) => {
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
    if (role === "manager" && allowed.includes("user")) {
      return next();
    }
    return next(createError(403, "Permissão insuficiente"));
  };
}
