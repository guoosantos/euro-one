import express from "express";

import { authenticate } from "../middleware/auth.js";

const router = express.Router();

router.use(authenticate);

router.get("/media/face/alerts", (_req, res) => {
  res.status(200).json({
    alerts: [],
    message: "Módulo de reconhecimento facial desativado no momento.",
  });
});

export default router;
