import express from "express";

import { authenticate } from "../middleware/auth.js";
import { resolvePermissionContext } from "../middleware/permissions.js";

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

export default router;
