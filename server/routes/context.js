import express from "express";
import createError from "http-errors";

import { config } from "../config.js";
import { getEnvInfo } from "../utils/env.js";
import { authenticate } from "../middleware/auth.js";
import { resolveExplicitClientIds, resolveTenant } from "../middleware/tenant.js";
import { getClientById, listClients } from "../models/client.js";
import { listMirrors } from "../models/mirror.js";

const router = express.Router();

function isMirrorActive(mirror, now = new Date()) {
  if (!mirror) return false;
  const start = mirror.startAt ? new Date(mirror.startAt) : null;
  const end = mirror.endAt ? new Date(mirror.endAt) : null;
  if (start && Number.isNaN(start.getTime())) return false;
  if (end && Number.isNaN(end.getTime())) return false;
  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
}

function dedupeClients(list = []) {
  const map = new Map();
  list.forEach((client) => {
    if (!client?.id) return;
    const key = String(client.id);
    if (!map.has(key)) {
      map.set(key, client);
    }
  });
  return Array.from(map.values());
}

router.use(authenticate);

router.get("/context", async (req, res, next) => {
  try {
    const tenant = resolveTenant(req, { requestedClientId: req.query?.clientId, required: false });
    const user = req.user;
    if (!user) {
      throw createError(401, "Sessão não autenticada");
    }

    const isAdmin = user.role === "admin";
    let clients = [];

    if (isAdmin) {
      clients = await listClients();
    } else if (user.clientId) {
      const ownClient = await getClientById(user.clientId).catch(() => null);
      const explicitIds = resolveExplicitClientIds(user);
      let explicitClients = [];
      if (explicitIds.length) {
        const directory = await listClients();
        explicitClients = directory.filter((client) => explicitIds.includes(String(client.id)));
      }
      const mirrorOwners = config.features?.mirrorMode
        ? listMirrors({ targetClientId: user.clientId })
          .filter((mirror) => isMirrorActive(mirror))
          .map((mirror) => String(mirror.ownerClientId))
        : [];
      let ownerClients = [];
      if (mirrorOwners.length) {
        const directory = await listClients();
        ownerClients = directory.filter((client) => mirrorOwners.includes(String(client.id)));
      }
      clients = dedupeClients([...(ownerClients || []), ...(explicitClients || []), ...(ownClient ? [ownClient] : [])]);
    }
    if (!isAdmin && user.clientId && clients.length === 0) {
      clients = [
        {
          id: user.clientId,
          name: user.attributes?.companyName || user.name || "Cliente",
          attributes: user.attributes || {},
        },
      ];
    }

    const mirror = tenant.mirrorContext
      ? {
          ownerClientId: tenant.mirrorContext.ownerClientId,
          targetClientId: tenant.mirrorContext.targetClientId,
          mirrorId: tenant.mirrorContext.mirrorId,
          permissionGroupId: tenant.mirrorContext.permissionGroupId,
          vehicleGroupId: tenant.mirrorContext.vehicleGroupId ?? null,
          allowedVehicleCount: tenant.mirrorContext.vehicleIds?.length || 0,
          allowedDeviceCount: tenant.mirrorContext.deviceIds?.length || 0,
        }
      : null;

    const mirrorModeEnabled = Boolean(config.features?.mirrorMode);
    const responsePayload = {
      clientId: tenant.clientIdResolved ?? null,
      clients,
      mirror,
      mirrorModeEnabled,
    };

    if (isAdmin) {
      const envInfo = getEnvInfo();
      responsePayload.envPathCarregado = envInfo.envPath;
      responsePayload.dotenvOverride = envInfo.override;
      responsePayload.features = {
        mirrorModeEnabled,
        tenantFallbackToSelfEnabled: Boolean(config.features?.tenantFallbackToSelf),
      };
    }

    return res.json(responsePayload);
  } catch (error) {
    return next(error);
  }
});

export default router;
