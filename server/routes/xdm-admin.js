import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import XdmClient from "../services/xdm/xdm-client.js";
import { getGeozoneGroupOverrideConfig } from "../services/xdm/xdm-override-resolver.js";

const router = express.Router();

router.use(authenticate, requireRole("admin"));

function isDiagnosticsEnabled() {
  const value = process.env.XDM_DIAGNOSTICS_ENABLED;
  if (!value) return false;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function truncate(value, maxLength = 300) {
  if (!value) return null;
  const text = String(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

router.get("/xdm/diagnostics", async (_req, res, next) => {
  if (!isDiagnosticsEnabled()) {
    return next(createError(404, "Rota não encontrada"));
  }

  const overrideConfig = getGeozoneGroupOverrideConfig();
  const xdmClient = new XdmClient();
  const payload = {
    authUrl: xdmClient.authUrl || null,
    baseUrl: xdmClient.baseUrl || null,
    clientId: xdmClient.clientId || null,
    dealerId: process.env.XDM_DEALER_ID || null,
    configName: process.env.XDM_CONFIG_NAME || null,
    overrideId: overrideConfig.overrideId,
    overrideKey: overrideConfig.overrideKey,
    overrideIdValid: overrideConfig.isValid,
    overrideSource: overrideConfig.source,
    tokenOk: false,
  };

  try {
    await xdmClient.getToken({ correlationId: "xdm-diagnostics" });
    payload.tokenOk = true;
    return res.status(200).json(payload);
  } catch (error) {
    const body = truncate(error?.details?.response || error?.body || error?.response || null);
    return res.status(502).json({
      ...payload,
      tokenOk: false,
      error: error?.message || "Falha ao autenticar no XDM",
      body,
    });
  }
});

export default router;
