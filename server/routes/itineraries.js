import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { resolveClientId } from "../middleware/client.js";
import { buildItineraryKml } from "../utils/kml.js";
import { listGeofences } from "../models/geofence.js";
import { getRouteById, listRoutes, updateRoute } from "../models/route.js";
import { getVehicleById, listVehicles } from "../models/vehicle.js";
import {
  listItineraries,
  getItineraryById,
  createItinerary,
  updateItinerary,
  deleteItinerary,
} from "../models/itinerary.js";
import {
  listDeployments,
  listLatestDeploymentsByItinerary,
  toHistoryEntries,
  getDeploymentById,
  updateDeployment,
} from "../models/xdm-deployment.js";
import { queueDeployment, embarkItinerary, disembarkItinerary } from "../services/xdm/deployment-service.js";
import {
  cleanupGeozoneForItem,
  cleanupGeozoneForItemWithReport,
  deleteItineraryGeozoneGroups,
  deleteItineraryGeozoneGroupsWithReport,
  diffRemovedItems,
  syncItineraryXdm,
} from "../services/xdm/itinerary-sync-service.js";
import { isNoPermissionError, logNoPermissionDiagnostics } from "../services/xdm/xdm-error.js";
import { getGeozoneGroupMapping, getGeozoneGroupMappingByScope } from "../models/xdm-geozone-group.js";
import { resolveVehicleDeviceUid } from "../services/xdm/resolve-vehicle-device-uid.js";
import { fetchDeviceGeozoneGroupIds } from "../services/xdm/device-geozone-group-service.js";
import { GEOZONE_GROUP_ROLE_LIST, ITINERARY_GEOZONE_GROUPS, buildItineraryGroupScopeKey } from "../services/xdm/xdm-geozone-group-roles.js";

const router = express.Router();

router.use(authenticate);

function resolveTargetClient(req, provided, { required = false } = {}) {
  if (req.user.role === "admin") {
    return provided || req.query?.clientId || req.user.clientId || null;
  }
  const clientId = req.user.clientId || null;
  if (required && !clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  return clientId;
}

function ensureSameClient(user, clientId) {
  if (user.role === "admin") return;
  if (!user.clientId || String(user.clientId) !== String(clientId)) {
    throw createError(403, "Operação não permitida para este cliente");
  }
}

function resolveRequestIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length) {
    return forwarded[0];
  }
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || null;
}

function normalizeDeploymentAction(action) {
  return action || "EMBARK";
}

function buildItineraryItems({ items, routeIds, existingItems = [], hasItems = false } = {}) {
  const baseItems = hasItems ? items : existingItems;
  const normalizedItems = Array.isArray(baseItems) ? baseItems : [];
  const normalizedRouteIds = Array.isArray(routeIds) ? routeIds : [];
  const combined = [
    ...normalizedItems,
    ...normalizedRouteIds.map((routeId) => ({ type: "route", id: String(routeId) })),
  ];
  const seen = new Set();
  const resolved = [];
  for (const entry of combined) {
    if (!entry || typeof entry !== "object") continue;
    const type = String(entry.type || "").toLowerCase();
    if (!type || !entry.id) continue;
    const id = String(entry.id);
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push({ ...entry, type, id });
  }
  return resolved;
}

export function __resolveBlockingEmbarkDeployments(deployments = []) {
  const activeStatuses = new Set(["DEPLOYED", "DEPLOYING", "QUEUED", "SYNCING"]);
  return (Array.isArray(deployments) ? deployments : []).filter(
    (deployment) =>
      normalizeDeploymentAction(deployment.action) === "EMBARK" && activeStatuses.has(deployment.status),
  );
}

async function resolveBlockingEmbarkDeployments({
  itinerary,
  latestDeployments,
  correlationId,
} = {}) {
  const blocking = __resolveBlockingEmbarkDeployments(latestDeployments);
  if (!blocking.length) return [];
  const mapping = getGeozoneGroupMapping({ itineraryId: itinerary.id, clientId: itinerary.clientId });
  const targetsMapping = getGeozoneGroupMappingByScope({
    scopeKey: buildItineraryGroupScopeKey(itinerary.id, ITINERARY_GEOZONE_GROUPS.targets.key),
    clientId: itinerary.clientId,
  });
  const entryMapping = getGeozoneGroupMappingByScope({
    scopeKey: buildItineraryGroupScopeKey(itinerary.id, ITINERARY_GEOZONE_GROUPS.entry.key),
    clientId: itinerary.clientId,
  });
  const storedGroupIds = itinerary.xdmGeozoneGroupIds || {};
  const targetGroupIds = {
    itinerary:
      storedGroupIds.itinerary || itinerary.xdmGeozoneGroupId || mapping?.xdmGeozoneGroupId || null,
    targets: storedGroupIds.targets || targetsMapping?.xdmGeozoneGroupId || null,
    entry: storedGroupIds.entry || entryMapping?.xdmGeozoneGroupId || null,
  };
  const hasAnyGroup = GEOZONE_GROUP_ROLE_LIST.some((role) => targetGroupIds[role.key]);
  if (!hasAnyGroup) return blocking;

  const vehicles = listVehicles({ clientId: itinerary.clientId }).reduce((acc, vehicle) => {
    acc.set(String(vehicle.id), vehicle);
    return acc;
  }, new Map());

  const verified = [];

  for (const deployment of blocking) {
    const vehicle = vehicles.get(String(deployment.vehicleId));
    const deviceUid = resolveVehicleDeviceUid(vehicle);
    if (!deviceUid) {
      verified.push(deployment);
      continue;
    }

    try {
      const currentGroupIds = await fetchDeviceGeozoneGroupIds({ deviceUid, correlationId });
      const matches = GEOZONE_GROUP_ROLE_LIST.some((role) => {
        const currentId = currentGroupIds?.[role.key] || null;
        const targetId = targetGroupIds[role.key] || null;
        return currentId && targetId && String(currentId) === String(targetId);
      });
      if (matches) {
        verified.push(deployment);
        continue;
      }
      updateDeployment(deployment.id, {
        status: "CLEARED",
        finishedAt: new Date().toISOString(),
        errorMessage: "Estado reconciliado: geozone group removido",
      });
    } catch (error) {
      console.warn("[itineraries] Falha ao validar geozone group no XDM", {
        itineraryId: itinerary.id,
        vehicleId: deployment.vehicleId,
        message: error?.message || error,
      });
      verified.push(deployment);
    }
  }

  return verified;
}

function withSyncStatus(itinerary) {
  const syncStatus =
    itinerary?.xdmSyncStatus ||
    (itinerary?.xdmGeozoneGroupId != null ? "OK" : "PENDING");
  return {
    ...itinerary,
    syncStatus,
    lastSyncError: itinerary?.xdmLastSyncError || null,
  };
}

router.get("/itineraries", async (req, res, next) => {
  try {
    const targetClientId = resolveTargetClient(req, req.query?.clientId, { required: req.user.role !== "admin" });
    const itineraries = listItineraries(targetClientId ? { clientId: targetClientId } : {})
      .map(withSyncStatus);
    return res.json({ data: itineraries, error: null });
  } catch (error) {
    return next(error);
  }
});

router.get("/itineraries/:id", async (req, res, next) => {
  try {
    const itinerary = getItineraryById(req.params.id);
    if (!itinerary) {
      throw createError(404, "Itinerário não encontrado");
    }
    ensureSameClient(req.user, itinerary.clientId);
    return res.json({ data: withSyncStatus(itinerary), error: null });
  } catch (error) {
    return next(error);
  }
});

router.post("/itineraries", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const clientId = resolveTargetClient(req, req.body?.clientId, { required: true });
    const items = buildItineraryItems({
      items: req.body?.items,
      routeIds: req.body?.routeIds,
      hasItems: Object.prototype.hasOwnProperty.call(req.body || {}, "items"),
    });
    const itinerary = createItinerary({ ...req.body, items, clientId });
    try {
      const synced = await syncItineraryXdm(itinerary.id, {
        clientId,
        correlationId: req.headers["x-correlation-id"] || null,
      });
      return res.status(201).json({ data: withSyncStatus(synced.itinerary), error: null });
    } catch (error) {
      if (isNoPermissionError(error)) {
        const updated = updateItinerary(itinerary.id, {
          xdmSyncStatus: "failed",
          xdmLastSyncError: "NO_PERMISSION",
          xdmLastError: "NO_PERMISSION",
          xdmLastSyncedAt: new Date().toISOString(),
        });
        logNoPermissionDiagnostics({
          error,
          correlationId: req.headers["x-correlation-id"] || null,
          method: req.method,
          path: req.originalUrl,
        });
        return res.status(201).json({
          data: withSyncStatus(updated),
          error: null,
          xdm: { ok: false, reason: "NO_PERMISSION" },
        });
      }

      updateItinerary(itinerary.id, {
        xdmSyncStatus: "ERROR",
        xdmLastSyncError: error?.message || "Falha ao sincronizar no XDM",
        xdmLastError: error?.message || "Falha ao sincronizar no XDM",
        xdmLastSyncedAt: new Date().toISOString(),
      });
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

router.put("/itineraries/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const existing = getItineraryById(req.params.id);
    if (!existing) {
      throw createError(404, "Itinerário não encontrado");
    }
    const clientId = resolveTargetClient(req, req.body?.clientId || existing.clientId, { required: true });
    ensureSameClient(req.user, clientId);
    const items = buildItineraryItems({
      items: req.body?.items,
      routeIds: req.body?.routeIds,
      existingItems: existing.items || [],
      hasItems: Object.prototype.hasOwnProperty.call(req.body || {}, "items"),
    });
    const updated = updateItinerary(req.params.id, { ...req.body, items, clientId: existing.clientId });

    let synced;
    try {
      synced = await syncItineraryXdm(updated.id, {
        clientId,
        correlationId: req.headers["x-correlation-id"] || null,
      });
    } catch (error) {
      updateItinerary(updated.id, {
        xdmSyncStatus: "ERROR",
        xdmLastSyncError: error?.message || "Falha ao sincronizar no XDM",
        xdmLastSyncedAt: new Date().toISOString(),
      });
      throw error;
    }

    const removedItems = diffRemovedItems(existing.items || [], synced.itinerary.items || []);
    await Promise.all(
      removedItems.map((item) =>
        cleanupGeozoneForItem({
          item,
          clientId,
          correlationId: req.headers["x-correlation-id"] || null,
          excludeItineraryId: updated.id,
          itineraryId: updated.id,
        }),
      ),
    );

    const deployments = listDeployments({ clientId }).filter(
      (deployment) => String(deployment.itineraryId) === String(updated.id),
    );
    const vehicles = listVehicles({ clientId }).reduce((acc, vehicle) => {
      acc.set(String(vehicle.id), vehicle);
      return acc;
    }, new Map());
    const latestByVehicle = new Map();
    deployments.forEach((deployment) => {
      const vehicleKey = String(deployment.vehicleId);
      const current = latestByVehicle.get(vehicleKey);
      const currentDate = current ? new Date(current.startedAt || 0).getTime() : 0;
      const nextDate = new Date(deployment.startedAt || 0).getTime();
      if (!current || nextDate > currentDate) {
        latestByVehicle.set(vehicleKey, deployment);
      }
    });

    const groupHashSummary = synced.groupHashes
      ? `itinerary=${synced.groupHashes.itinerary || ""}|targets=${synced.groupHashes.targets || ""}|entry=${synced.groupHashes.entry || ""}`
      : synced.groupHash || null;

    latestByVehicle.forEach((deployment) => {
      if (deployment.status !== "DEPLOYED") return;
      const vehicle = vehicles.get(String(deployment.vehicleId));
      if (!vehicle) return;
      queueDeployment({
        clientId,
        itineraryId: updated.id,
        vehicleId: vehicle.id,
        deviceImei: vehicle.deviceImei || vehicle.xdmDeviceUid || null,
        requestedByUserId: req.user?.id || null,
        requestedByName: req.user?.name || req.user?.email || req.user?.username || req.user?.id || "Usuário",
        ipAddress: resolveRequestIp(req),
        xdmGeozoneGroupId: synced.xdmGeozoneGroupId,
        xdmGeozoneGroupIds: synced.groupIds,
        groupHash: groupHashSummary,
        groupHashes: synced.groupHashes || null,
      });
    });

    return res.json({ data: withSyncStatus(synced.itinerary), error: null });
  } catch (error) {
    return next(error);
  }
});

router.delete("/itineraries/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const existing = getItineraryById(req.params.id);
    if (!existing) {
      throw createError(404, "Itinerário não encontrado");
    }
    ensureSameClient(req.user, existing.clientId);
    const latestDeployments = listLatestDeploymentsByItinerary({
      clientId: existing.clientId,
      itineraryId: existing.id,
    });
    const correlationId = req.headers["x-correlation-id"] || null;
    const blockingDeployments = await resolveBlockingEmbarkDeployments({
      itinerary: existing,
      latestDeployments,
      correlationId,
    });
    if (blockingDeployments.length) {
      throw createError(409, "Há dispositivos embarcados neste itinerário. Faça o desembarque antes de excluir.");
    }

    let xdmWarning = null;

    try {
      await deleteItineraryGeozoneGroups({
        itineraryId: existing.id,
        clientId: existing.clientId,
        correlationId,
      });
    } catch (error) {
      if (isNoPermissionError(error)) {
        xdmWarning = { ok: false, reason: "NO_PERMISSION" };
        logNoPermissionDiagnostics({
          error,
          correlationId,
          method: req.method,
          path: req.originalUrl,
        });
      } else {
        throw error;
      }
    }

    const items = existing.items || [];
    await Promise.all(
      items.map(async (item) => {
        try {
          await cleanupGeozoneForItem({
            item,
            clientId: existing.clientId,
            correlationId,
            excludeItineraryId: existing.id,
          });
        } catch (error) {
          if (isNoPermissionError(error)) {
            xdmWarning = xdmWarning || { ok: false, reason: "NO_PERMISSION" };
            logNoPermissionDiagnostics({
              error,
              correlationId,
              method: req.method,
              path: req.originalUrl,
            });
            return;
          }
          throw error;
        }
      }),
    );

    await deleteItinerary(req.params.id);
    if (xdmWarning) {
      return res.status(200).json({ ok: true, xdm: xdmWarning });
    }
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.get("/itineraries/:id/export/kml", async (req, res, next) => {
  try {
    const itinerary = getItineraryById(req.params.id);
    if (!itinerary) {
      throw createError(404, "Itinerário não encontrado");
    }
    ensureSameClient(req.user, itinerary.clientId);
    const clientId = resolveClientId(req, req.query?.clientId, { required: false }) || itinerary.clientId;

    const geofenceItems = (itinerary.items || []).filter((item) => item.type === "geofence").map((item) => item.id);
    const routeItems = (itinerary.items || []).filter((item) => item.type === "route").map((item) => item.id);

    let geofences = [];
    if (geofenceItems.length) {
      try {
        geofences = (await listGeofences({ clientId })).filter((item) => geofenceItems.includes(String(item.id)));
      } catch (error) {
        console.warn("[itineraries] Falha ao carregar cercas para exportação", error?.message || error);
      }
    }

    const routes = routeItems.length ? listRoutes({ clientId }).filter((item) => routeItems.includes(String(item.id))) : [];

    const kml = buildItineraryKml({
      name: itinerary.name,
      geofences,
      routes,
    });

    res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
    return res.send(kml);
  } catch (error) {
    return next(error);
  }
});

router.get("/itineraries/embark/history", async (req, res, next) => {
  try {
    const clientId = resolveTargetClient(req, req.query?.clientId, { required: req.user.role !== "admin" });
    const deployments = listDeployments(clientId ? { clientId } : {});
    const vehicles = listVehicles(clientId ? { clientId } : {}).reduce((acc, vehicle) => {
      acc.set(String(vehicle.id), vehicle);
      return acc;
    }, new Map());
    const itineraries = listItineraries(clientId ? { clientId } : {}).reduce((acc, itinerary) => {
      acc.set(String(itinerary.id), itinerary);
      return acc;
    }, new Map());

    const history = toHistoryEntries({ deploymentsList: deployments, vehiclesById: vehicles, itinerariesById: itineraries })
      .map((entry) => {
        const status = entry.status || "SYNCING";
        const statusLabel =
          status === "DEPLOYED"
            ? "Deployed"
            : status === "CLEARED"
              ? "Desembarcado"
            : status === "DEPLOYING"
              ? "Deploying"
              : status === "FAILED"
                ? "Failed"
                : status === "TIMEOUT"
                  ? "Timeout"
                  : "Enviado";
        const result =
          status === "DEPLOYED"
            ? entry.result || "Aplicado com sucesso"
            : status === "CLEARED"
              ? entry.result || "Desembarque concluído"
            : status === "DEPLOYING"
              ? "Deploy disparado"
              : status === "FAILED"
                ? entry.result || "Falha no deploy"
                : status === "TIMEOUT"
                  ? "Timeout ao aplicar configuração"
                  : "Sincronizando cercas";
        return { ...entry, status: statusLabel, result };
      });

    return res.json({ data: history, error: null });
  } catch (error) {
    return next(error);
  }
});

router.get("/itineraries/:id/embark/history", async (req, res, next) => {
  try {
    const itinerary = getItineraryById(req.params.id);
    if (!itinerary) {
      throw createError(404, "Itinerário não encontrado");
    }
    ensureSameClient(req.user, itinerary.clientId);

    const deployments = listDeployments({ clientId: itinerary.clientId }).filter(
      (deployment) => String(deployment.itineraryId) === String(itinerary.id),
    );
    const vehicles = listVehicles({ clientId: itinerary.clientId }).reduce((acc, vehicle) => {
      acc.set(String(vehicle.id), vehicle);
      return acc;
    }, new Map());
    const itineraries = new Map([[String(itinerary.id), itinerary]]);

    const history = toHistoryEntries({ deploymentsList: deployments, vehiclesById: vehicles, itinerariesById: itineraries });
    return res.json({ data: history, error: null });
  } catch (error) {
    return next(error);
  }
});

router.post("/itineraries/:itineraryId/embark", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const itineraryId = req.params.itineraryId;
    const itinerary = getItineraryById(itineraryId);
    if (!itinerary) {
      throw createError(404, "Itinerário não encontrado");
    }
    const clientId = resolveTargetClient(req, req.body?.clientId || itinerary.clientId, { required: true });
    ensureSameClient(req.user, clientId);

    const vehicleIds = Array.isArray(req.body?.vehicleIds) ? req.body.vehicleIds.map(String) : [];
    if (!vehicleIds.length) {
      throw createError(400, "Informe veículos para embarcar");
    }

    const dryRun = Boolean(req.body?.dryRun);
    const configId = req.body?.configId ?? null;
    const bufferMetersRaw = req.body?.xdmBufferMeters ?? req.body?.bufferMeters ?? null;
    const bufferMeters = bufferMetersRaw == null ? null : Number(bufferMetersRaw);

    const response = await embarkItinerary({
      clientId,
      itineraryId,
      vehicleIds,
      configId,
      bufferMeters,
      dryRun,
      correlationId: req.headers["x-correlation-id"] || null,
      requestedByUserId: req.user?.id || null,
      requestedByName: req.user?.name || req.user?.email || req.user?.username || req.user?.id || "Usuário",
      ipAddress: resolveRequestIp(req),
    });

    console.info("[itineraries] embarcado com sucesso", {
      itineraryId: String(itineraryId),
      vehicles: response?.vehicles?.length || 0,
    });

    return res.status(201).json({ data: response, error: null });
  } catch (error) {
    return next(error);
  }
});

router.post("/itineraries/:itineraryId/disembark", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const itineraryId = req.params.itineraryId;
    const itinerary = getItineraryById(itineraryId);
    if (!itinerary) {
      throw createError(404, "Itinerário não encontrado");
    }
    const clientId = resolveTargetClient(req, req.body?.clientId || itinerary.clientId, { required: true });
    ensureSameClient(req.user, clientId);

    const vehicleIds = Array.isArray(req.body?.vehicleIds) ? req.body.vehicleIds.map(String) : [];
    const dryRun = Boolean(req.body?.dryRun);

    const response = await disembarkItinerary({
      clientId,
      itineraryId,
      vehicleIds,
      dryRun,
      correlationId: req.headers["x-correlation-id"] || null,
      requestedByUserId: req.user?.id || null,
      requestedByName: req.user?.name || req.user?.email || req.user?.username || req.user?.id || "Usuário",
      ipAddress: resolveRequestIp(req),
    });

    console.info("[itineraries] desembarcado com sucesso", {
      itineraryId: String(itineraryId),
      vehicles: response?.vehicles?.length || 0,
    });

    return res.status(201).json({ data: response, error: null });
  } catch (error) {
    return next(error);
  }
});

router.post("/itineraries/disembark", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const clientId = resolveTargetClient(req, req.body?.clientId, { required: true });
    const vehicleIds = Array.isArray(req.body?.vehicleIds) ? req.body.vehicleIds.map(String) : [];
    const itineraryIds = Array.isArray(req.body?.itineraryIds) ? req.body.itineraryIds.map(String) : [];
    if (!itineraryIds.length) {
      throw createError(400, "Informe itinerários para desembarcar");
    }

    const dryRun = Boolean(req.body?.dryRun);
    const cleanupOptions = req.body?.options?.cleanup || {};
    const cleanupGroups = Boolean(cleanupOptions?.deleteGeozoneGroup);
    const cleanupGeozones = Boolean(cleanupOptions?.deleteGeozones);

    const ipAddress = resolveRequestIp(req);
    const userLabel = req.user?.name || req.user?.email || req.user?.username || req.user?.id || "Usuário";
    const correlationId = req.headers["x-correlation-id"] || null;

    const summary = { success: 0, failed: 0, errors: [] };
    const results = [];
    const cleanup = { geozoneGroups: [], geozones: [] };

    for (const itineraryId of itineraryIds) {
      const itinerary = getItineraryById(itineraryId);
      if (!itinerary) {
        summary.failed += 1;
        summary.errors.push({ itineraryId: String(itineraryId), message: "Itinerário não encontrado" });
        continue;
      }
      if (String(itinerary.clientId) !== String(clientId)) {
        summary.failed += 1;
        summary.errors.push({ itineraryId: String(itineraryId), message: "Itinerário não pertence ao cliente" });
        continue;
      }

      let response;
      try {
        response = await disembarkItinerary({
          clientId,
          itineraryId: itinerary.id,
          vehicleIds,
          dryRun,
          correlationId,
          requestedByUserId: req.user?.id || null,
          requestedByName: userLabel,
          ipAddress,
        });
      } catch (error) {
        summary.failed += 1;
        summary.errors.push({ itineraryId: String(itinerary.id), message: error?.message || "Falha ao desembarcar" });
        continue;
      }

      (response?.vehicles || []).forEach((vehicle) => {
        const status = vehicle.status || "failed";
        const entry = {
          itineraryId: String(itinerary.id),
          itineraryName: itinerary.name || null,
          vehicleId: String(vehicle.vehicleId || vehicle.id || ""),
          status,
          message: vehicle.message || null,
          deviceUid: vehicle.deviceUid || null,
        };
        results.push(entry);
        if (status === "failed") {
          summary.failed += 1;
          summary.errors.push({
            itineraryId: String(itinerary.id),
            vehicleId: entry.vehicleId,
            message: vehicle.message || "Falha ao desembarcar",
          });
        } else {
          summary.success += 1;
        }
      });

      if (cleanupGroups) {
        const mapping = getGeozoneGroupMapping({ itineraryId: itinerary.id, clientId });
        const targetsMapping = getGeozoneGroupMappingByScope({
          scopeKey: buildItineraryGroupScopeKey(itinerary.id, ITINERARY_GEOZONE_GROUPS.targets.key),
          clientId,
        });
        const entryMapping = getGeozoneGroupMappingByScope({
          scopeKey: buildItineraryGroupScopeKey(itinerary.id, ITINERARY_GEOZONE_GROUPS.entry.key),
          clientId,
        });
        const storedGroupIds = itinerary.xdmGeozoneGroupIds || {};
        const hasGroup = GEOZONE_GROUP_ROLE_LIST.some((role) => {
          if (role.key === ITINERARY_GEOZONE_GROUPS.itinerary.key) {
            return Boolean(storedGroupIds.itinerary || itinerary.xdmGeozoneGroupId || mapping?.xdmGeozoneGroupId);
          }
          if (role.key === ITINERARY_GEOZONE_GROUPS.targets.key) {
            return Boolean(storedGroupIds.targets || targetsMapping?.xdmGeozoneGroupId);
          }
          if (role.key === ITINERARY_GEOZONE_GROUPS.entry.key) {
            return Boolean(storedGroupIds.entry || entryMapping?.xdmGeozoneGroupId);
          }
          return false;
        });
        if (!hasGroup) {
          cleanup.geozoneGroups.push({
            itineraryId: String(itinerary.id),
            status: "skipped",
            reason: "not_found",
          });
        } else {
          try {
            const cleanupResults = await deleteItineraryGeozoneGroupsWithReport({
              itineraryId: itinerary.id,
              clientId,
              correlationId,
            });
            cleanupResults.forEach((entry) => {
              cleanup.geozoneGroups.push({
                itineraryId: String(itinerary.id),
                role: entry.role,
                status: entry.status,
                reason: entry.reason || null,
                xdmGeozoneGroupId: entry.xdmGeozoneGroupId || null,
              });
            });
          } catch (error) {
            if (isNoPermissionError(error)) {
              logNoPermissionDiagnostics({
                error,
                correlationId,
                method: req.method,
                path: req.originalUrl,
              });
              cleanup.geozoneGroups.push({
                itineraryId: String(itinerary.id),
                status: "failed",
                reason: "NO_PERMISSION",
              });
            } else {
              cleanup.geozoneGroups.push({
                itineraryId: String(itinerary.id),
                status: "failed",
                reason: error?.message || "Falha ao excluir geozone group",
              });
            }
          }
        }
      }

      if (cleanupGeozones) {
        const items = itinerary.items || [];
        for (const item of items) {
          const cleanupResult = await cleanupGeozoneForItemWithReport({
            item,
            clientId,
            correlationId,
            excludeItineraryId: itinerary.id,
            itineraryId: itinerary.id,
          });
          cleanup.geozones.push({
            itineraryId: String(itinerary.id),
            itemType: item?.type || null,
            itemId: item?.id ? String(item.id) : null,
            ...cleanupResult,
          });
        }
      }
    }

    const cleanupBlocked = [
      ...cleanup.geozoneGroups.filter((entry) => entry.status === "skipped" && entry.reason === "in_use"),
      ...cleanup.geozones.filter((entry) => entry.status === "skipped" && entry.reason === "in_use"),
    ];
    if (cleanupBlocked.length) {
      console.warn("[itineraries] limpeza parcial no XDM: itens não removidos por dependência", {
        total: cleanupBlocked.length,
        items: cleanupBlocked,
      });
    }

    return res.status(201).json({ data: { summary, results, cleanup }, error: null });
  } catch (error) {
    return next(error);
  }
});

router.post("/itineraries/embark", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const clientId = resolveTargetClient(req, req.body?.clientId, { required: true });
    const vehicleIds = Array.isArray(req.body?.vehicleIds) ? req.body.vehicleIds.map(String) : [];
    const itineraryIds = Array.isArray(req.body?.itineraryIds) ? req.body.itineraryIds.map(String) : [];
    if (!vehicleIds.length || !itineraryIds.length) {
      throw createError(400, "Informe veículos e itinerários para embarcar");
    }

    const bufferMetersRaw = req.body?.xdmBufferMeters ?? req.body?.bufferMeters ?? null;
    const bufferMeters = bufferMetersRaw == null ? null : Number(bufferMetersRaw);
    const ipAddress = resolveRequestIp(req);
    const userLabel = req.user?.name || req.user?.email || req.user?.username || req.user?.id || "Usuário";

    const vehicles = listVehicles(clientId ? { clientId } : {}).reduce((acc, vehicle) => {
      acc.set(String(vehicle.id), vehicle);
      return acc;
    }, new Map());
    const itinerariesById = new Map();
    for (const itineraryId of itineraryIds) {
      const itinerary = getItineraryById(itineraryId);
      itinerariesById.set(String(itineraryId), itinerary || null);
      if (!itinerary || !Number.isFinite(bufferMeters) || bufferMeters <= 0) continue;
      const routeIds = (itinerary.items || [])
        .filter((item) => item.type === "route")
        .map((item) => String(item.id));
      for (const routeId of routeIds) {
        const route = await getRouteById(routeId);
        if (!route) continue;
        const metadata = route.metadata && typeof route.metadata === "object" ? { ...route.metadata } : {};
        if (metadata.xdmBufferMeters === bufferMeters) continue;
        await updateRoute(routeId, { metadata: { ...metadata, xdmBufferMeters: bufferMeters } });
      }
    }

    const entries = [];
    let success = 0;
    let failed = 0;

    for (const vehicleId of vehicleIds) {
      const vehicle = vehicles.get(String(vehicleId)) || getVehicleById(vehicleId);
      for (const itineraryId of itineraryIds) {
        const itinerary = itinerariesById.get(String(itineraryId)) || getItineraryById(itineraryId);
        const entryBase = {
          clientId: String(clientId),
          itineraryId: String(itineraryId),
          itineraryName: itinerary?.name || null,
          vehicleId: String(vehicleId),
          vehicleName: vehicle?.name || null,
          plate: vehicle?.plate || null,
          brand: vehicle?.brand || null,
          model: vehicle?.model || null,
          sentAt: new Date().toISOString(),
          receivedAt: null,
          sentBy: req.user?.id || null,
          sentByName: userLabel,
          ipAddress,
        };

        if (!itinerary) {
          failed += 1;
          entries.push({ ...entryBase, status: "Falhou", result: "Itinerário não encontrado" });
          return;
        }
        if (String(itinerary.clientId) !== String(clientId)) {
          failed += 1;
          entries.push({ ...entryBase, status: "Falhou", result: "Itinerário não pertence ao cliente" });
          return;
        }
        if (!vehicle || String(vehicle.clientId) !== String(clientId)) {
          failed += 1;
          entries.push({ ...entryBase, status: "Falhou", result: "Veículo não encontrado para o cliente" });
          return;
        }

        const { deployment, status } = queueDeployment({
          clientId,
          itineraryId,
          vehicleId,
          deviceImei: vehicle.deviceImei,
          requestedByUserId: req.user?.id || null,
          requestedByName: userLabel,
          ipAddress,
        });

        success += 1;
        entries.push({
          ...entryBase,
          status: status === "ACTIVE" ? "Deploying" : status === "ALREADY_DEPLOYED" ? "Deployed" : "Enviado",
          result:
            status === "ACTIVE"
              ? "Deploy em andamento"
              : status === "ALREADY_DEPLOYED"
                ? "Já embarcado"
                : "Deploy enfileirado",
          deploymentId: deployment?.id || null,
        });
      }
    }
    return res.status(201).json({ data: { entries, summary: { success, failed } }, error: null });
  } catch (error) {
    return next(error);
  }
});

router.get("/deployments/:id", async (req, res, next) => {
  try {
    const deployment = getDeploymentById(req.params.id);
    if (!deployment) {
      throw createError(404, "Deploy não encontrado");
    }
    ensureSameClient(req.user, deployment.clientId);
    return res.json({ data: deployment, error: null });
  } catch (error) {
    return next(error);
  }
});

export default router;
