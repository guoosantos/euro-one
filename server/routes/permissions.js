import express from "express";

import { authenticate } from "../middleware/auth.js";
import { resolvePermissionContext } from "../middleware/permissions.js";
import { resolveAllowedMirrorOwnerIds } from "../utils/mirror-access.js";
import { resolveTenantScope } from "../utils/tenant-scope.js";

const router = express.Router();

router.use(authenticate);

router.get("/permissions/context", async (req, res, next) => {
  try {
    const context = await resolvePermissionContext(req);
    res.json(context);
  } catch (error) {
    next(error);
  }
});

router.get("/me/permissions", async (req, res, next) => {
  try {
    const user = req.user;
    const scope = await resolveTenantScope(user);
    const allowedMirrorOwners = resolveAllowedMirrorOwnerIds(user);
    const mirrorAllowAll = allowedMirrorOwners === null;
    const mirrorOwnerIds = Array.isArray(allowedMirrorOwners)
      ? allowedMirrorOwners.map((id) => String(id))
      : [];
    const clientIds = scope.isAdmin
      ? null
      : Array.from(scope.clientIds || []).map((id) => String(id));
    res.json({
      isAdmin: Boolean(scope.isAdmin),
      clientIds,
      mirrorAllowAll,
      mirrorOwnerIds,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
