import createError from "http-errors";

/**
 * Decide de onde vem o clientId:
 * - parâmetro explícito (providedClientId)
 * - body.clientId
 * - req.client / req.clientId
 * - query.clientId
 * - header X-Client-Id
 */
function pickClientId(req, providedClientId) {
  // prioridade: valor explícito passado na chamada
  if (providedClientId != null && providedClientId !== "") {
    return providedClientId;
  }

  // body (útil pra POST/PUT)
  if (req?.body?.clientId) {
    return req.body.clientId;
  }

  // anexado por algum middleware anterior
  if (req?.client?.id) {
    return req.client.id;
  }
  if (req?.client?.clientId) {
    return req.client.clientId;
  }
  if (req?.clientId) {
    return req.clientId;
  }

  // query string
  if (req?.query?.clientId) {
    return req.query.clientId;
  }

  // header
  const headerValue = req?.get ? req.get("X-Client-Id") : req?.headers?.["x-client-id"];
  if (headerValue) {
    return headerValue;
  }

  return null;
}

/**
 * Resolve o clientId respeitando:
 * - regra de admin (pode escolher clientId, com restrições)
 * - regra de usuário comum (sempre amarrado ao user.clientId)
 *
 * NÃO mexe em req/res diretamente: quem faz isso é o middleware abaixo.
 */
export function resolveClientId(req, providedClientId, options = {}) {
  const { required = true } = options;
  const candidate = pickClientId(req, providedClientId);
  const clientId = candidate != null && candidate !== "" ? String(candidate) : null;
  const user = req?.user;

  // Usuário admin
  if (user?.role === "admin") {
    // Se veio explicitamente (body/query/header), usa
    if (clientId) {
      return clientId;
    }

    // Se não é obrigatório, pode ficar sem ou cair no clientId padrão do admin
    if (!required) {
      return user?.clientId ? String(user.clientId) : null;
    }

    // required = true: se admin tiver clientId padrão, usa; senão erro
    if (user?.clientId) {
      return String(user.clientId);
    }

    throw createError(400, "clientId é obrigatório");
  }

  // Usuário comum: precisa estar vinculado a um cliente
  const userClientId = user?.clientId;
  if (!userClientId) {
    if (!required) {
      return clientId;
    }
    throw createError(400, "Usuário não vinculado a um cliente");
  }

  // Se veio clientId explícito diferente do do usuário, bloqueia
  if (clientId && String(clientId) !== String(userClientId)) {
    throw createError(403, "Operação não permitida para este cliente");
  }

  return String(userClientId);
}

/**
 * Middleware pra usar no Express:
 *   router.use(resolveClientIdMiddleware)
 *
 * - NUNCA quebra com TypeError (checa se req/res existem).
 * - Preenche req.clientId, req.context.clientId e res.locals.clientId.
 */
export function resolveClientIdMiddleware(req, res, next) {
  try {
    const explicitClientId =
      req?.body?.clientId ??
      req?.query?.clientId ??
      (req?.get ? req.get("X-Client-Id") : req?.headers?.["x-client-id"]) ??
      null;

    // aqui required:false porque algumas rotas aceitam não ter clientId
    const clientId = resolveClientId(req, explicitClientId, { required: false });

    // garante que não vamos fazer undefined.clientId = ...
    if (req && typeof req === "object") {
      req.clientId = clientId;

      // contexto opcional, se alguém quiser usar depois
      if (!req.context || typeof req.context !== "object") {
        req.context = {};
      }
      req.context.clientId = clientId;
    }

    if (res && typeof res === "object") {
      if (!res.locals || typeof res.locals !== "object") {
        res.locals = {};
      }
      res.locals.clientId = clientId;
    }

    if (typeof next === "function") {
      next();
    }
  } catch (error) {
    if (typeof next === "function") {
      next(error);
    } else {
      // fallback se alguém chamar isso fora do pipeline do Express
      throw error;
    }
  }
}

export default resolveClientIdMiddleware;
