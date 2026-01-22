import createError from "http-errors";

function pickClientId(req, providedClientId) {
  if (req?.client?.id) return req.client.id;
  if (req?.client?.clientId) return req.client.clientId;
  if (req?.clientId) return req.clientId;
  if (providedClientId) return providedClientId;
  if (req?.query?.clientId) return req.query.clientId;
  const headerValue = req?.get ? req.get("X-Client-Id") : req?.headers?.["x-client-id"];
  if (headerValue) return headerValue;
  return null;
}

export function resolveClientId(req, providedClientId, { required = true } = {}) {
  const candidate = pickClientId(req, providedClientId);
  const clientId = candidate != null ? String(candidate) : null;
  const user = req?.user;

  if (user?.role === "admin") {
    if (clientId) {
      console.info("[tenant] clientId resolvido (admin)", { userId: user?.id, clientId });
      return clientId;
    }
    if (!required) {
      const resolved = user?.clientId ? String(user.clientId) : null;
      if (resolved) {
        console.info("[tenant] clientId resolvido (admin)", { userId: user?.id, clientId: resolved });
      }
      return resolved;
    }
    if (user?.clientId) {
      const resolved = String(user.clientId);
      console.info("[tenant] clientId resolvido (admin)", { userId: user?.id, clientId: resolved });
      return resolved;
    }
    console.warn("[tenant] clientId ausente para admin", { userId: user?.id });
    throw createError(401, "clientId é obrigatório");
  }

  const userClientId = user?.clientId;
  if (!userClientId) {
    console.warn("[tenant] usuário sem tenant associado", { userId: user?.id, role: user?.role });
    throw createError(401, "Usuário sem tenant associado");
  }

  if (clientId && String(clientId) !== String(userClientId)) {
    if (req?.mirrorContext?.ownerClientId && String(req.mirrorContext.ownerClientId) === String(clientId)) {
      console.info("[tenant] clientId resolvido (mirror)", { userId: user?.id, clientId: String(clientId) });
      return String(clientId);
    }
    throw createError(403, "Operação não permitida para este cliente");
  }

  if (!clientId && req?.mirrorContext?.ownerClientId) {
    console.info("[tenant] clientId resolvido (mirror)", { userId: user?.id, clientId: req.mirrorContext.ownerClientId });
    return String(req.mirrorContext.ownerClientId);
  }

  console.info("[tenant] clientId resolvido", { userId: user?.id, clientId: String(userClientId) });
  return String(userClientId);
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
