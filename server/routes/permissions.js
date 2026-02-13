import express from "express";
import { randomUUID } from "crypto";

import { authenticate } from "../middleware/auth.js";
import { resolvePermissionContext } from "../middleware/permissions.js";
import { resolveMePermissions } from "../utils/me-permissions.js";

const router = express.Router();

router.use(authenticate);

router.get("/permissions/context", async (req, res, next) => {
  const startedAt = Date.now();
  const correlationId =
    req.get?.("x-correlation-id") ||
    req.get?.("x-request-id") ||
    randomUUID();
  res.set("X-Correlation-Id", correlationId);
  try {
    const context = await resolvePermissionContext(req);
    res.json(context);
    console.info("[permissions-context] done", {
      correlationId,
      ms: Date.now() - startedAt,
      userId: req.user?.id ? String(req.user.id) : null,
      permissionGroupId: context?.permissionGroupId ?? null,
    });
  } catch (error) {
    console.warn("[permissions-context] error", {
      correlationId,
      ms: Date.now() - startedAt,
      message: error?.message || String(error),
      status: error?.status || error?.response?.status || null,
    });
    next(error);
  }
});

router.get("/me/permissions", async (req, res, next) => {
  const startedAt = Date.now();
  const correlationId =
    req.get?.("x-correlation-id") ||
    req.get?.("x-request-id") ||
    randomUUID();
  res.set("X-Correlation-Id", correlationId);
  try {
    const payload = await resolveMePermissions(req.user);
    res.json(payload);
    console.info("[me-permissions] done", {
      correlationId,
      ms: Date.now() - startedAt,
      userId: req.user?.id ? String(req.user.id) : null,
      mirrorAllowAll: payload?.mirrorAllowAll ?? null,
    });
  } catch (error) {
    console.warn("[me-permissions] error", {
      correlationId,
      ms: Date.now() - startedAt,
      message: error?.message || String(error),
      status: error?.status || error?.response?.status || null,
    });
    next(error);
  }
});

export default router;
