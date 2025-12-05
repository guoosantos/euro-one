// server/middleware/resolve-client.js

import { resolveClientIdMiddleware as baseMiddleware } from "./client.js";

// Export default (usado em routes/core.js)
export default function resolveClientIdMiddleware(req, res, next) {
  return baseMiddleware(req, res, next);
}

// Export nomeado (usado em outros lugares, se precisar)
export { baseMiddleware as resolveClientIdMiddleware };
