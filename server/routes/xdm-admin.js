import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import XdmClient from "../services/xdm/xdm-client.js";
import {
  discoverGeozoneGroupOverrideElementId,
  getGeozoneGroupOverrideConfig,
  resolveGeozoneGroupOverrideElementId,
} from "../services/xdm/xdm-override-resolver.js";
import { initStorage } from "../services/storage.js";

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

router.get("/xdm/override-elements", async (_req, res, next) => {
  if (!isDiagnosticsEnabled()) {
    return next(createError(404, "Rota não encontrada"));
  }

  await initStorage();
  const overrideConfig = getGeozoneGroupOverrideConfig();
  const { listOverrideElements } = await import("../models/xdm-override-element.js");
  const stored = listOverrideElements();

  const resolvedFromStorage = (() => {
    const dealerId = process.env.XDM_DEALER_ID || null;
    const configName = process.env.XDM_CONFIG_NAME || process.env.XDM_CONFIG_ID || null;
    const overrideKey = process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY || "geoGroup";
    if (!dealerId || !configName) return null;
    return stored.find(
      (item) =>
        String(item?.dealerId) === String(dealerId) &&
        String(item?.configName || "").trim().toLowerCase() === String(configName).trim().toLowerCase() &&
        String(item?.overrideKey || "").trim().toLowerCase() === String(overrideKey).trim().toLowerCase(),
    );
  })();

  const resolved =
    overrideConfig.isValid
      ? {
          dealerId: process.env.XDM_DEALER_ID || null,
          configName: process.env.XDM_CONFIG_NAME || process.env.XDM_CONFIG_ID || null,
          overrideKey: overrideConfig.overrideKey,
          overrideElementId: Number(overrideConfig.overrideId),
          source: "env",
        }
      : resolvedFromStorage
        ? {
            dealerId: resolvedFromStorage.dealerId,
            configName: resolvedFromStorage.configName,
            overrideKey: resolvedFromStorage.overrideKey,
            overrideElementId: resolvedFromStorage.overrideElementId,
            source: "storage",
          }
        : null;

  return res.status(200).json({
    env: {
      rawValue: overrideConfig.rawValue,
      overrideElementId: overrideConfig.overrideId,
      overrideIdValid: overrideConfig.isValid,
      overrideKey: overrideConfig.overrideKey,
      source: overrideConfig.source,
    },
    resolved,
    stored: stored.map((item) => ({
      dealerId: item.dealerId,
      configName: item.configName,
      overrideKey: item.overrideKey,
      overrideElementId: item.overrideElementId,
      source: item.source || "storage",
      updatedAt: item.updatedAt || null,
    })),
  });
});

router.post("/xdm/override-elements/discover", async (req, res, next) => {
  if (!isDiagnosticsEnabled()) {
    return next(createError(404, "Rota não encontrada"));
  }

  try {
    await initStorage();
    const resolved = await discoverGeozoneGroupOverrideElementId({
      correlationId: req.headers["x-correlation-id"] || "xdm-override-discovery",
    });
    return res.status(200).json({
      dealerId: resolved.dealerId,
      configName: resolved.configName,
      overrideKey: resolved.overrideKey,
      overrideElementId: resolved.overrideNumber,
      source: resolved.source,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
