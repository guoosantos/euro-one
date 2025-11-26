import express from "express";

import { authenticate } from "../middleware/auth.js";
import { getUserPreferences, resetUserPreferences, saveUserPreferences } from "../models/user-preferences.js";

const router = express.Router();

router.use(authenticate);

router.get("/user/preferences", (req, res, next) => {
  try {
    const preferences = getUserPreferences(req.user.id) || {
      userId: req.user.id,
      monitoringTableColumns: null,
      routeReportColumns: null,
      tripsReportColumns: null,
      monitoringDefaultFilters: null,
    };
    return res.json({ preferences });
  } catch (error) {
    return next(error);
  }
});

router.put("/user/preferences", (req, res, next) => {
  try {
    const preferences = saveUserPreferences(req.user.id, req.body || {});
    return res.json({ preferences });
  } catch (error) {
    return next(error);
  }
});

router.delete("/user/preferences", (req, res, next) => {
  try {
    const preferences = resetUserPreferences(req.user.id);
    return res.json({ preferences });
  } catch (error) {
    return next(error);
  }
});

export default router;
