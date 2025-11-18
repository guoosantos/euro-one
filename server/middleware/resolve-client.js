import createError from "http-errors";

/**
 * Middleware que preenche clientId com base no usuário logado
 * quando não for enviado explicitamente no corpo da requisição.
 * Caso permaneça ausente, deixa a validação original retornar 400.
 */
export function resolveClientIdMiddleware(req, _res, next) {
  try {
    if ((!req.body || !req.body.clientId) && req.user?.clientId) {
      req.body = { ...(req.body || {}), clientId: req.user.clientId };
    }
    // Se ainda não houver clientId, a validação da rota/modelo continuará tratando
    next();
  } catch (error) {
    next(createError(400, error.message || "Falha ao resolver clientId"));
  }
}

export default resolveClientIdMiddleware;
