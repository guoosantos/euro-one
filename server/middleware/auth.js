import jwt from "jsonwebtoken";
import createError from "http-errors";
import { config } from "../config.js";

export function signSession(payload) {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

function extractToken(req) {
  const auth = req.headers?.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  if (req.cookies?.token) {
    return req.cookies.token;
  }
  return null;
}

// Rotas públicas (NUNCA podem exigir token)
const PUBLIC_PATHS = [
  "/api/login",
  "/api/health",
  "/health",
];

function isPublicPath(req) {
  const url = req.originalUrl || req.url || "";
  return PUBLIC_PATHS.some((p) => url === p || url.startsWith(p + "/"));
}

export function authenticate(req, _res, next) {
  // Libera rotas públicas
  if (isPublicPath(req)) {
    return next();
  }

  const token = extractToken(req);
  if (!token) {
    return next(createError(401, "Token ausente"));
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.sessionToken = token;
    req.user = decoded;
    return next();
  } catch (error) {
    return next(createError(401, "Token inválido ou expirado"));
  }
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
