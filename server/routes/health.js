import express from "express";

import { getTraccarHealth } from "../services/traccar.js";
import { getTraccarSyncState } from "../services/traccar-sync.js";

const router = express.Router();

router.get("/", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/traccar", async (_req, res) => {
  const health = await getTraccarHealth();
  const sync = getTraccarSyncState();

  const payload = {
    ...health,
    sync,
  };

  if (health.status === "error") {
    const statusCode = Number(health.code) || 503;
    return res.status(statusCode).json(payload);
  }

  res.json(payload);
});

export default router;
