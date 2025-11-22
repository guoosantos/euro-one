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
    if (clientId) return clientId;
    if (!required) {
      return user?.clientId ? String(user.clientId) : null;
    }
    if (user?.clientId) {
      return String(user.clientId);
    }
    throw createError(400, "clientId é obrigatório");
  }

  const userClientId = user?.clientId;
  if (!userClientId) {
    if (!required) {
      return clientId;
    }
    throw createError(400, "Usuário não vinculado a um cliente");
  }

  if (clientId && String(clientId) !== String(userClientId)) {
    throw createError(403, "Operação não permitida para este cliente");
  }

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

export default resolveClientIdMiddleware;
