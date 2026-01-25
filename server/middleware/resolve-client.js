import { resolveTenant } from "./tenant.js";

/**
 * Middleware que preenche clientId com base no usuário logado
 * quando não for enviado explicitamente no corpo da requisição.
 * Caso permaneça ausente, deixa a validação original retornar 400.
 */
export function resolveClientIdMiddleware(req, _res, next) {
  try {
    const tenant = resolveTenant(req, { requestedClientId: req.body?.clientId || req.query?.clientId, required: false });
    if (tenant?.clientIdResolved) {
      req.clientId = tenant.clientIdResolved;
      if (req.body && !req.body.clientId) {
        req.body = { ...(req.body || {}), clientId: tenant.clientIdResolved };
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}

export default resolveClientIdMiddleware;
