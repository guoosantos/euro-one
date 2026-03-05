import express from "express";
import { randomUUID } from "crypto";

import { authenticate } from "../middleware/auth.js";
import { resolvePermissionContext } from "../middleware/permissions.js";
import { buildContextPayload } from "./context.js";
import { resolveMePermissions } from "../utils/me-permissions.js";
import { resolveMirrorsContextPayload } from "./mirrors.js";

const router = express.Router();

router.use(authenticate);

router.get("/bootstrap", async (req, res, next) => {
  const correlationId =
    req.get?.("x-correlation-id") ||
    req.get?.("x-request-id") ||
    randomUUID();
  const startedAt = Date.now();
  res.set("X-Correlation-Id", correlationId);
  try {
    const permissionContext = await resolvePermissionContext(req);
    const context = await buildContextPayload(req, { permissionContext });
    const mePermissions = await resolveMePermissions(req.user);
    const mirrorsContext = await resolveMirrorsContextPayload(req);
    res.json({
      context,
      permissionContext,
      mePermissions,
      mirrorsContext,
    });
    console.info("[bootstrap] done", {
      correlationId,
      ms: Date.now() - startedAt,
      userId: req.user?.id ? String(req.user.id) : null,
      clientId: context?.clientId ?? null,
      mirrorMode: context?.mirrorModeEnabled ?? null,
    });
  } catch (error) {
    console.warn("[bootstrap] error", {
      correlationId,
      ms: Date.now() - startedAt,
      message: error?.message || String(error),
      status: error?.status || error?.response?.status || null,
    });
    return next(error);
  }
});

export default router;
