import createError from "http-errors";

import { resolveTenant } from "./tenant.js";

export function resolveClientId(req, providedClientId, { required = true } = {}) {
  const tenant = resolveTenant(req, { requestedClientId: providedClientId, required });
  if (tenant.clientIdResolved) {
    if (process.env.DEBUG_MIRROR === "true") {
      console.debug("[tenant] clientId resolvido", { userId: req.user?.id, clientId: tenant.clientIdResolved });
    }
    return tenant.clientIdResolved;
  }
  if (required) {
    throw createError(401, "clientId é obrigatório");
  }
  return null;
}

export function resolveClientIdMiddleware(req, res, next) {
  try {
    const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: false });
    req.clientId = clientId;
    res.locals.clientId = clientId;
    next();
  } catch (error) {
    next(error);
  }
}

export function ensureSameTenant(user, clientId) {
  if (user?.role === "admin") return;
  if (!user?.clientId || String(user.clientId) !== String(clientId)) {
    throw createError(403, "Operação não permitida para este cliente");
  }
}

export default resolveClientIdMiddleware;
