import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { listModels } from "../models/model.js";

const router = express.Router();

router.use(authenticate);

function resolveClientId(req) {
  if (req.user?.role === "admin") {
    return req.query?.clientId || req.user?.clientId || null;
  }
  if (!req.user?.clientId) {
    throw createError(400, "Usuário não vinculado a um cliente");
  }
  if (req.query?.clientId && String(req.query.clientId) !== String(req.user.clientId)) {
    throw createError(403, "Operação não permitida para este cliente");
  }
  return req.user.clientId;
}

router.get("/models", (req, res, next) => {
  try {
    const clientId = resolveClientId(req);
    const models = listModels({ clientId, includeGlobal: true });
    res.json({ models });
  } catch (error) {
    next(error);
  }
});

export default router;
