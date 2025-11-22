/**
 * Middleware de contexto de cliente.
 *
 * Versão compatível com o PR #40:
 * - exporta resolveClientId
 * - exporta resolveClientIdMiddleware
 * - export default = resolveClientIdMiddleware
 */

export function resolveClientId(req) {
  return (
    // se em algum lugar já tiver um objeto client:
    (req.client && (req.client.id || req.client.clientId)) ||
    // se já tiver sido setado em middlewares anteriores:
    req.clientId ||
    // querystring ?clientId=...
    (req.query && req.query.clientId) ||
    // header X-Client-Id
    req.headers["x-client-id"] ||
    null
  );
}

export function resolveClientIdMiddleware(req, res, next) {
  const clientId = resolveClientId(req);

  req.clientId = clientId;
  if (!res.locals) res.locals = {};
  res.locals.clientId = clientId;

  return next();
}

// default export para quem importar sem chaves
export default resolveClientIdMiddleware;
