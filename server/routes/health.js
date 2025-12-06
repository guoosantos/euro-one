import express from "express";

import { getTraccarApiHealth } from "../services/traccar.js";
import { getTraccarSyncState } from "../services/traccar-sync.js";
import { getTraccarDbHealth } from "../services/traccar-db.js";

const router = express.Router();

router.get("/", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/traccar", async (_req, res) => {
  const [traccarDb, traccarApi] = await Promise.all([getTraccarDbHealth(), getTraccarApiHealth()]);
  const sync = getTraccarSyncState();

  const payload = {
    traccarDb,
    traccarApi,
    sync,
  };

  if (!traccarDb.ok || !traccarApi.ok) {
    const statusCode = Number(traccarDb.code || traccarApi.code) || 503;
    return res.status(statusCode).json(payload);
  }

  res.json(payload);
});

export default router;
