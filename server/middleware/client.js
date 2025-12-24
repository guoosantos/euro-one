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

  // Admin pode operar em qualquer clientId (se não vier, tenta cair no clientId do usuário)
  if (user?.role === "admin") {
    if (clientId) return clientId;

    if (!required) {
      return user?.clientId ? String(user.clientId) : null;
    }

    if (user?.clientId) return String(user.clientId);

    throw createError(400, "clientId é obrigatório");
  }

  // Usuário não-admin precisa estar vinculado a um client
  const userClientId = user?.clientId;
  if (!userClientId) {
    if (!required) return clientId;
    throw createError(400, "Usuário não vinculado a um cliente");
  }

  // Se veio clientId no request e é diferente do do usuário => bloqueia
  if (clientId && String(clientId) !== String(userClientId)) {
    throw createError(403, "Operação não permitida para este cliente");
  }

  return String(userClientId);
}

// Middleware padrão que coloca clientId em req/res.locals (não obriga)
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

// Garante que o request não atravessa tenant (usa resolveClientId como “fonte da verdade”)
export function ensureSameTenant(req, res, next) {
  try {
    const resolved = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: true });
    req.clientId = resolved;
    res.locals.clientId = resolved;
    next();
  } catch (error) {
    next(error);
  }
}

export default resolveClientIdMiddleware;
