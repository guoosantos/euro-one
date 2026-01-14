import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { resolveClientId } from "../middleware/client.js";
import { buildItineraryKml } from "../utils/kml.js";
import { listGeofences } from "../models/geofence.js";
import { getRouteById, listRoutes, updateRoute } from "../models/route.js";
import { getVehicleById, listVehicles } from "../models/vehicle.js";
import { listEmbarkHistory, addEmbarkEntries } from "../models/itinerary-embark.js";
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
import {
  getGeozoneGroupMapping,
  getGeozoneGroupMappingByScope,
  listGeozoneGroupMappings,
} from "../models/xdm-geozone-group.js";
import { resolveVehicleDeviceUid } from "../services/xdm/resolve-vehicle-device-uid.js";
import { fetchDeviceGeozoneGroupIds } from "../services/xdm/device-geozone-group-service.js";
import { GEOZONE_GROUP_ROLE_LIST, ITINERARY_GEOZONE_GROUPS, buildItineraryGroupScopeKey } from "../services/xdm/xdm-geozone-group-roles.js";
import { buildItinerarySnapshot } from "../services/xdm/itinerary-snapshot.js";

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

function normalizePipelineStatusLabel(label) {
  const normalized = String(label || "").toUpperCase().trim();
  if (!normalized) return null;
  if (normalized.includes("EMBARC")) return "EMBARCADO";
  if (normalized.includes("ENVIAD")) return "ENVIADO";
  if (normalized.includes("PEND")) return "PENDENTE";
  if (normalized.includes("FALHOU") && normalized.includes("ENVIO")) return "FALHOU (ENVIO)";
  if (normalized.includes("FALHOU") && normalized.includes("APLIC")) return "FALHOU (EQUIPAMENTO)";
  if (normalized.includes("FALHOU") && normalized.includes("EQUIP")) return "FALHOU (EQUIPAMENTO)";
  if (normalized.includes("FALHOU")) return "FALHOU (EQUIPAMENTO)";
  return normalized;
}

function resolveStatusLabel(status, preferredLabel = null) {
  const normalizedPreferred = normalizePipelineStatusLabel(preferredLabel);
  if (normalizedPreferred) return normalizedPreferred;
  const normalized = String(status || "").toUpperCase();
  if (["APPLIED", "EMBARKED"].includes(normalized)) return "EMBARCADO";
  if (["QUEUED"].includes(normalized)) return "ENVIADO";
  if (["DEPLOYING", "SYNCING", "STARTED", "RUNNING"].includes(normalized)) return "PENDENTE";
  if (["FAILED", "TIMEOUT"].includes(normalized)) return "FALHOU (EQUIPAMENTO)";
  if (["ERROR", "INVALID", "REJECTED"].includes(normalized)) return "FALHOU (ENVIO)";
  if (["DEPLOYED", "CLEARED"].includes(normalized)) return "PENDENTE";
  return "PENDENTE";
}

function resolveExpectedGroupIds(deployment) {
  if (!deployment) return null;
  if ((deployment.action || "EMBARK") === "DISEMBARK") {
    return { itinerary: null, targets: null, entry: null };
  }
  if (deployment.xdmGeozoneGroupIds) return deployment.xdmGeozoneGroupIds;
  if (deployment.xdmGeozoneGroupId) {
    return { itinerary: deployment.xdmGeozoneGroupId };
  }
  return null;
}

function matchesGroupIds(expected, current) {
  if (!expected) return false;
  const expectedKeys = GEOZONE_GROUP_ROLE_LIST.filter((role) => expected[role.key] != null);
  if (!expectedKeys.length) {
    return !current?.itinerary && !current?.targets && !current?.entry;
  }
  return expectedKeys.every((role) => String(expected[role.key]) === String(current?.[role.key] ?? ""));
}

function resolveXdmStatus({ deployment, xdmGroupIds, xdmError }) {
  if (xdmError) {
    return {
      code: "ERROR",
      label: "FALHOU (ENVIO)",
      configLabel: "Falha no envio",
      matchesExpected: false,
      detail: xdmError,
    };
  }
  const deploymentStatus = String(deployment?.status || "").toUpperCase();
  const expectedGroupIds = resolveExpectedGroupIds(deployment);
  const matched = matchesGroupIds(expectedGroupIds, xdmGroupIds);
  const hasEmbarked = Boolean(xdmGroupIds?.itinerary);

  if (["ERROR", "INVALID", "REJECTED"].includes(deploymentStatus)) {
    return {
      code: deploymentStatus || "ERROR",
      label: "FALHOU (ENVIO)",
      configLabel: "Falha no envio",
      matchesExpected: matched,
    };
  }
  if (["FAILED", "TIMEOUT"].includes(deploymentStatus)) {
    return {
      code: deploymentStatus || "FAILED",
      label: "FALHOU (EQUIPAMENTO)",
      configLabel: "Falha na atualização",
      matchesExpected: matched,
    };
  }
  if (deploymentStatus === "QUEUED") {
    return {
      code: "ENVIADO",
      label: "ENVIADO",
      configLabel: "Aguardando confirmação",
      matchesExpected: matched,
    };
  }
  if (matched) {
    return {
      code: "EMBARCADO",
      label: "EMBARCADO",
      configLabel: "Equipamento atualizou",
      matchesExpected: true,
    };
  }
  if (["SYNCING", "DEPLOYING", "STARTED", "RUNNING", "DEPLOYED", "CLEARED"].includes(deploymentStatus)) {
    return {
      code: "PENDENTE",
      label: "PENDENTE",
      configLabel: "Aguardando atualização",
      matchesExpected: matched,
    };
  }
  if (!deployment && hasEmbarked) {
    return {
      code: "EMBARCADO",
      label: "EMBARCADO",
      configLabel: "Equipamento atualizou",
      matchesExpected: matched,
    };
  }
  return {
    code: "EMPTY",
    label: "SEM EMBARQUE",
    configLabel: deployment ? "Aguardando atualização" : null,
    matchesExpected: matched,
  };
}

function resolveActionLabel(action) {
  const normalizedAction = String(normalizeDeploymentAction(action)).toUpperCase();
  if (normalizedAction === "DISEMBARK") {
    return "Desembarcado itinerário (remover da configuração do equipamento)";
  }
  if (normalizedAction === "CREATE") return "Criado itinerário";
  if (normalizedAction === "UPDATE") return "Atualizado itinerário";
  if (normalizedAction === "DELETE") return "Excluído itinerário";
  return "Embarcado itinerário";
}

function resolveHistoryMessage(entry) {
  const itineraryName = entry.itineraryName || "itinerário";
  const vehicleLabel = entry.plate || entry.vehicleName || "veículo";
  const actionLabel = resolveActionLabel(entry.action);
  const statusLabel = resolveStatusLabel(entry.statusCode || entry.status, entry.statusLabel);
  if (statusLabel === "ERRO") {
    return `Não foi possível concluir "${actionLabel}" para o itinerário ${itineraryName} no veículo ${vehicleLabel}.`;
  }
  if (statusLabel.startsWith("FALHOU")) {
    return `Falha ao executar "${actionLabel}" para o itinerário ${itineraryName} no veículo ${vehicleLabel}.`;
  }
  if (statusLabel === "ENVIADO") {
    return `Itinerário ${itineraryName} enviado para a central do veículo ${vehicleLabel}.`;
  }
  if (statusLabel === "PENDENTE") {
    return `Central confirmou o itinerário ${itineraryName} para o veículo ${vehicleLabel} e aguarda atualização do equipamento.`;
  }
  if (actionLabel.startsWith("Embarcado")) {
    return `Itinerário ${itineraryName} embarcado no veículo ${vehicleLabel}.`;
  }
  if (actionLabel.startsWith("Desembarcado")) {
    return `Itinerário ${itineraryName} desembarcado do veículo ${vehicleLabel} (removido do equipamento).`;
  }
  if (actionLabel.startsWith("Atualizado")) {
    return `Itinerário ${itineraryName} atualizado e reenviado para o veículo ${vehicleLabel}.`;
  }
  if (actionLabel.startsWith("Criado")) {
    return `Itinerário ${itineraryName} criado.`;
  }
  if (actionLabel.startsWith("Excluído")) {
    return `Itinerário ${itineraryName} excluído.`;
  }
  return `Ação "${actionLabel}" registrada para o itinerário ${itineraryName}.`;
}

function normalizeHistoryEntry(entry) {
  const statusCode = entry.statusCode || entry.status || "SYNCING";
  const statusLabel = resolveStatusLabel(statusCode, entry.statusLabel);
  const actionLabel = resolveActionLabel(entry.action);
  const details = entry.details || entry.result || null;
  const message = entry.message || resolveHistoryMessage({ ...entry, statusCode, statusLabel });
  return {
    ...entry,
    statusCode,
    statusLabel,
    actionLabel,
    message,
    details,
  };
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

function normalizePointList(points = []) {
  return (Array.isArray(points) ? points : [])
    .map((pair) => {
      if (!Array.isArray(pair) || pair.length < 2) return null;
      const lat = Number(pair[0]);
      const lng = Number(pair[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return [lat, lng];
    })
    .filter(Boolean);
}

function buildCirclePoints({ center, radiusMeters }) {
  if (!center || !Number.isFinite(radiusMeters) || radiusMeters <= 0) return [];
  const [lat, lng] = center;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const latRadius = radiusMeters / 111320;
  const lngRadius = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  const points = [];
  for (let angle = 0; angle <= 360; angle += 15) {
    const rad = (angle * Math.PI) / 180;
    points.push([lat + latRadius * Math.sin(rad), lng + lngRadius * Math.cos(rad)]);
  }
  return points;
}

function buildPreviewSvg(points = [], { stroke = "#38bdf8", fill = "rgba(56,189,248,0.2)", closePath = false } = {}) {
  const normalized = normalizePointList(points);
  if (!normalized.length) return null;
  const width = 160;
  const height = 96;
  const padding = 8;
  const lats = normalized.map((pair) => pair[0]);
  const lngs = normalized.map((pair) => pair[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = maxLat - minLat || 0.0001;
  const lngSpan = maxLng - minLng || 0.0001;
  const scaleX = (width - padding * 2) / lngSpan;
  const scaleY = (height - padding * 2) / latSpan;
  const path = normalized
    .map(([lat, lng], index) => {
      const x = padding + (lng - minLng) * scaleX;
      const y = height - padding - (lat - minLat) * scaleY;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const closed = closePath ? `${path} Z` : path;
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#0f172a" />
      <path d="${closed}" fill="${fill}" stroke="${stroke}" stroke-width="2" />
    </svg>
  `.trim();
}

function resolveItemSizeBytes(payload) {
  if (!payload) return null;
  if (payload.kml) return Buffer.byteLength(String(payload.kml));
  if (payload.geometryJson) return Buffer.byteLength(JSON.stringify(payload.geometryJson));
  if (payload.area) return Buffer.byteLength(String(payload.area));
  if (payload.points) return Buffer.byteLength(JSON.stringify(payload.points));
  return null;
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

async function buildVehicleEmbarkDetail({
  vehicle,
  deployment,
  lastEmbark,
  itinerariesById,
  geofencesById,
  routesById,
  groupLookup,
  correlationId,
}) {
  const deviceUid = resolveVehicleDeviceUid(vehicle);
  let xdmGroupIds = null;
  let xdmError = null;
  if (deviceUid) {
    try {
      xdmGroupIds = await fetchDeviceGeozoneGroupIds({ deviceUid, correlationId });
    } catch (error) {
      xdmError = error?.message || "Falha ao consultar a Central";
    }
  }

  const itineraryMapping = xdmGroupIds?.itinerary ? groupLookup.get(String(xdmGroupIds.itinerary)) : null;
  const targetsMapping = xdmGroupIds?.targets ? groupLookup.get(String(xdmGroupIds.targets)) : null;
  const entryMapping = xdmGroupIds?.entry ? groupLookup.get(String(xdmGroupIds.entry)) : null;
  const itinerary = itineraryMapping ? itinerariesById.get(String(itineraryMapping.itineraryId)) || null : null;
  const snapshotItinerary = deployment?.snapshot?.itinerary || null;
  const resolvedItinerary = itinerary || snapshotItinerary || null;
  const xdmStatus = resolveXdmStatus({ deployment, xdmGroupIds, xdmError });
  const snapshotItems = deployment?.snapshot?.items || null;

  const items = snapshotItems?.length
    ? snapshotItems.map((item) => ({
        ...item,
        lastEmbarkAt: lastEmbark?.finishedAt || lastEmbark?.startedAt || null,
        statusLabel: xdmStatus.label,
      }))
    : resolvedItinerary
      ? (resolvedItinerary.items || []).map((item) => {
          const type = item?.type || "";
          const id = item?.id ? String(item.id) : null;
          const geofence = type === "geofence" || type === "target" ? geofencesById.get(id) || null : null;
          const route = type === "route" ? routesById.get(id) || null : null;
          const isTarget = Boolean(geofence?.isTarget) || type === "target";
          const typeLabel =
            type === "route"
              ? "Rota"
              : isTarget
                ? "Alvo"
                : geofence?.config === "exit"
                  ? "Cerca (Saída)"
                  : geofence?.config === "entry"
                    ? "Cerca (Entrada)"
                    : "Cerca";
          const circlePoints =
            geofence?.type === "circle"
              ? buildCirclePoints({
                  center: [geofence.latitude ?? geofence.center?.[0], geofence.longitude ?? geofence.center?.[1]],
                  radiusMeters: geofence.radius,
                })
              : [];
          const points =
            type === "route"
              ? route?.points || []
              : geofence?.type === "circle"
                ? circlePoints
                : geofence?.points || [];
          const previewSvg = buildPreviewSvg(points, {
            stroke: geofence?.color || "#38bdf8",
            closePath: type !== "route",
          });
          return {
            id,
            type,
            name: geofence?.name || route?.name || "Item",
            typeLabel,
            sizeBytes: resolveItemSizeBytes(geofence || route),
            previewSvg,
            geometry: {
              points,
              center:
                geofence?.type === "circle"
                  ? [geofence.latitude ?? geofence.center?.[0], geofence.longitude ?? geofence.center?.[1]]
                  : null,
              radiusMeters: geofence?.type === "circle" ? geofence?.radius || null : null,
              color: geofence?.color || "#38bdf8",
              isRoute: type === "route",
            },
            lastEmbarkAt: lastEmbark?.finishedAt || lastEmbark?.startedAt || null,
            statusLabel: xdmStatus.label,
          };
        })
      : [];

  return {
    vehicleId: String(vehicle.id),
    vehicleName: vehicle.name || null,
    plate: vehicle.plate || null,
    brand: vehicle.brand || null,
    model: vehicle.model || null,
    itineraryId: itinerary?.id || snapshotItinerary?.id || null,
    itineraryName: itinerary?.name || snapshotItinerary?.name || null,
    itineraryDescription: itinerary?.description || snapshotItinerary?.description || null,
    xdmDeviceUid: deviceUid || null,
    xdmGroups: {
      itinerary: {
        id: xdmGroupIds?.itinerary || null,
        itineraryId: itineraryMapping?.itineraryId || null,
        itineraryName: itinerary?.name || null,
      },
      targets: {
        id: xdmGroupIds?.targets || null,
        itineraryId: targetsMapping?.itineraryId || null,
      },
      entry: {
        id: xdmGroupIds?.entry || null,
        itineraryId: entryMapping?.itineraryId || null,
      },
    },
    xdmError,
    xdmStatus: xdmStatus.code,
    xdmStatusLabel: xdmStatus.label,
    configStatusLabel: xdmStatus.configLabel,
    statusCode: deployment?.status || null,
    statusLabel: xdmStatus.label,
    status: xdmStatus.label,
    lastActionLabel: deployment ? resolveActionLabel(deployment.action) : "—",
    lastActionAt: deployment?.finishedAt || deployment?.startedAt || null,
    lastEmbarkAt: lastEmbark?.finishedAt || lastEmbark?.startedAt || null,
    items,
    lastSnapshot: deployment?.snapshot || null,
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
    const userLabel = req.user?.name || req.user?.email || req.user?.username || req.user?.id || "Usuário";
    const sentAt = new Date().toISOString();
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
      addEmbarkEntries([
        {
          clientId,
          itineraryId: synced.itinerary.id,
          itineraryName: synced.itinerary.name || null,
          sentAt,
          receivedAt: new Date().toISOString(),
          sentBy: req.user?.id || null,
          sentByName: userLabel,
          status: "DEPLOYED",
          statusLabel: "EMBARCADO",
          action: "CREATE",
          message: `Itinerário '${synced.itinerary.name || "itinerário"}' criado por ${userLabel}.`,
          details: null,
          snapshot: null,
        },
      ]);
      return res.status(201).json({ data: withSyncStatus(synced.itinerary), error: null });
    } catch (error) {
      if (isNoPermissionError(error)) {
        const updated = updateItinerary(itinerary.id, {
          xdmSyncStatus: "failed",
          xdmLastSyncError: "NO_PERMISSION",
          xdmLastError: "NO_PERMISSION",
          xdmLastSyncedAt: new Date().toISOString(),
        });
        addEmbarkEntries([
          {
            clientId,
            itineraryId: updated.id,
            itineraryName: updated.name || null,
            sentAt,
            receivedAt: new Date().toISOString(),
            sentBy: req.user?.id || null,
            sentByName: userLabel,
            status: "DEPLOYED",
            statusLabel: "EMBARCADO",
            action: "CREATE",
            message: `Itinerário '${updated.name || "itinerário"}' criado por ${userLabel}.`,
            details: null,
            snapshot: null,
          },
        ]);
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
        xdmLastSyncError: error?.message || "Falha ao sincronizar na Central",
        xdmLastError: error?.message || "Falha ao sincronizar na Central",
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
        xdmLastSyncError: error?.message || "Falha ao sincronizar na Central",
        xdmLastSyncedAt: new Date().toISOString(),
      });
      throw error;
    }

    const removedItems = diffRemovedItems(existing.items || [], synced.itinerary.items || []);
    let updateDetails = null;
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

    let updateSnapshot = null;
    try {
      const [geofences, routes] = await Promise.all([
        listGeofences({ clientId: updated.clientId }),
        listRoutes({ clientId: updated.clientId }),
      ]);
      const geofencesById = new Map(geofences.map((geofence) => [String(geofence.id), geofence]));
      const routesById = new Map(routes.map((route) => [String(route.id), route]));
      if (removedItems.length) {
        const labels = removedItems.map((item) => {
          if (item.type === "route") {
            return routesById.get(String(item.id))?.name || `Rota ${item.id}`;
          }
          const geofence = geofencesById.get(String(item.id));
          if (geofence?.isTarget) {
            return geofence?.name || `Alvo ${item.id}`;
          }
          return geofence?.name || `Cerca ${item.id}`;
        });
        updateDetails = `Removeu ${labels.join(", ")}.`;
      }
      updateSnapshot = buildItinerarySnapshot({
        itinerary: synced.itinerary,
        geofencesById,
        routesById,
        action: "UPDATE",
        requestedByName: req.user?.name || req.user?.email || req.user?.username || req.user?.id || "Usuário",
      });
    } catch (error) {
      console.warn("[itineraries] Falha ao gerar snapshot para atualização", error?.message || error);
    }

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
        snapshot: updateSnapshot ? JSON.parse(JSON.stringify(updateSnapshot)) : null,
        action: "UPDATE",
      });
    });

    addEmbarkEntries([
      {
        clientId,
        itineraryId: updated.id,
        itineraryName: updated.name || null,
        sentAt: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        sentBy: req.user?.id || null,
        sentByName: req.user?.name || req.user?.email || req.user?.username || req.user?.id || "Usuário",
        status: "DEPLOYED",
        statusLabel: "PENDENTE",
        action: "UPDATE",
        message: `Itinerário '${updated.name || "itinerário"}' atualizado por ${req.user?.name || req.user?.email || req.user?.username || req.user?.id || "Usuário"}.`,
        details: updateDetails,
        snapshot: updateSnapshot ? JSON.parse(JSON.stringify(updateSnapshot)) : null,
      },
    ]);

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
    const userLabel = req.user?.name || req.user?.email || req.user?.username || req.user?.id || "Usuário";
    const sentAt = new Date().toISOString();
    let deleteSnapshot = null;
    try {
      const [geofences, routes] = await Promise.all([
        listGeofences({ clientId: existing.clientId }),
        listRoutes({ clientId: existing.clientId }),
      ]);
      const geofencesById = new Map(geofences.map((geofence) => [String(geofence.id), geofence]));
      const routesById = new Map(routes.map((route) => [String(route.id), route]));
      deleteSnapshot = buildItinerarySnapshot({
        itinerary: existing,
        geofencesById,
        routesById,
        action: "DELETE",
        requestedByName: userLabel,
      });
    } catch (error) {
      console.warn("[itineraries] Falha ao gerar snapshot para exclusão", error?.message || error);
    }
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

    try {
      await deleteItinerary(req.params.id);
      addEmbarkEntries([
        {
          clientId: existing.clientId,
          itineraryId: existing.id,
          itineraryName: existing.name || null,
          sentAt,
          receivedAt: new Date().toISOString(),
          sentBy: req.user?.id || null,
          sentByName: userLabel,
          status: "DEPLOYED",
          action: "DELETE",
          message: `Itinerário '${existing.name || "itinerário"}' excluído por ${userLabel}.`,
          details: null,
          snapshot: deleteSnapshot,
        },
      ]);
    } catch (error) {
      addEmbarkEntries([
        {
          clientId: existing.clientId,
          itineraryId: existing.id,
          itineraryName: existing.name || null,
          sentAt,
          receivedAt: new Date().toISOString(),
          sentBy: req.user?.id || null,
          sentByName: userLabel,
          status: error?.status ? "ERROR" : "FAILED",
          action: "DELETE",
          message: `Falha ao excluir itinerário '${existing.name || "itinerário"}' por ${userLabel}.`,
          details: error?.message || "Falha ao excluir",
          snapshot: deleteSnapshot ? { ...deleteSnapshot, error: error?.message || "Falha ao excluir" } : null,
        },
      ]);
      throw error;
    }

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

    const deploymentsHistory = toHistoryEntries({
      deploymentsList: deployments,
      vehiclesById: vehicles,
      itinerariesById: itineraries,
    }).map(normalizeHistoryEntry);
    const extraHistory = listEmbarkHistory(clientId ? { clientId } : {}).map(normalizeHistoryEntry);

    const history = [...deploymentsHistory, ...extraHistory].sort(
      (a, b) => new Date(b.sentAt || b.at || 0).getTime() - new Date(a.sentAt || a.at || 0).getTime(),
    );

    return res.json({ data: history, error: null });
  } catch (error) {
    return next(error);
  }
});

router.get("/itineraries/embark/vehicles", async (req, res, next) => {
  try {
    const clientId = resolveTargetClient(req, req.query?.clientId, { required: req.user.role !== "admin" });
    const correlationId = req.headers["x-correlation-id"] || null;
    const vehicles = listVehicles(clientId ? { clientId } : {});
    const deployments = listDeployments(clientId ? { clientId } : {});
    const itineraries = listItineraries(clientId ? { clientId } : {});
    const geofences = await listGeofences(clientId ? { clientId } : {});
    const routes = listRoutes(clientId ? { clientId } : {});
    const groupMappings = listGeozoneGroupMappings(clientId ? { clientId } : {});

    const itinerariesById = new Map(itineraries.map((itinerary) => [String(itinerary.id), itinerary]));
    const geofencesById = new Map(geofences.map((geofence) => [String(geofence.id), geofence]));
    const routesById = new Map(routes.map((route) => [String(route.id), route]));
    const groupLookup = new Map();
    groupMappings.forEach((mapping) => {
      if (!mapping?.xdmGeozoneGroupId) return;
      let itineraryId = mapping.itineraryId || mapping.id || null;
      let roleKey = ITINERARY_GEOZONE_GROUPS.itinerary.key;
      if (mapping.scopeKey) {
        const [scopePrefix, scopeItineraryId, scopeRole] = String(mapping.scopeKey).split(":");
        if (scopePrefix === "itinerary") {
          itineraryId = scopeItineraryId;
          roleKey = scopeRole || roleKey;
        }
      }
      groupLookup.set(String(mapping.xdmGeozoneGroupId), { itineraryId, roleKey });
    });

    const sortedDeployments = [...deployments].sort(
      (a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime(),
    );
    const latestByVehicle = new Map();
    const lastEmbarkByVehicle = new Map();
    for (const deployment of sortedDeployments) {
      const vehicleId = String(deployment.vehicleId);
      if (!latestByVehicle.has(vehicleId)) {
        latestByVehicle.set(vehicleId, deployment);
      }
      if (
        !lastEmbarkByVehicle.has(vehicleId) &&
        normalizeDeploymentAction(deployment.action) === "EMBARK" &&
        deployment.status === "DEPLOYED"
      ) {
        lastEmbarkByVehicle.set(vehicleId, deployment);
      }
    }

    const vehiclesDetail = await Promise.all(
      vehicles.map(async (vehicle) => {
        const deployment = latestByVehicle.get(String(vehicle.id)) || null;
        const lastEmbark = lastEmbarkByVehicle.get(String(vehicle.id)) || null;
        return buildVehicleEmbarkDetail({
          vehicle,
          deployment,
          lastEmbark,
          itinerariesById,
          geofencesById,
          routesById,
          groupLookup,
          correlationId,
        });
      }),
    );

    return res.json({ data: vehiclesDetail, error: null });
  } catch (error) {
    return next(error);
  }
});

router.get("/itineraries/embark/vehicles/:vehicleId/status", async (req, res, next) => {
  try {
    const vehicleId = req.params.vehicleId;
    const vehicle = getVehicleById(vehicleId);
    if (!vehicle) {
      throw createError(404, "Veículo não encontrado");
    }
    ensureSameClient(req.user, vehicle.clientId);
    const correlationId = req.headers["x-correlation-id"] || null;

    const deployments = listDeployments({ clientId: vehicle.clientId }).filter(
      (deployment) => String(deployment.vehicleId) === String(vehicleId),
    );
    const sortedDeployments = [...deployments].sort(
      (a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime(),
    );
    const latest = sortedDeployments[0] || null;
    const lastEmbark = sortedDeployments.find(
      (deployment) => normalizeDeploymentAction(deployment.action) === "EMBARK" && deployment.status === "DEPLOYED",
    );

    const itineraries = listItineraries({ clientId: vehicle.clientId });
    const geofences = await listGeofences({ clientId: vehicle.clientId });
    const routes = listRoutes({ clientId: vehicle.clientId });
    const groupMappings = listGeozoneGroupMappings({ clientId: vehicle.clientId });

    const itinerariesById = new Map(itineraries.map((itinerary) => [String(itinerary.id), itinerary]));
    const geofencesById = new Map(geofences.map((geofence) => [String(geofence.id), geofence]));
    const routesById = new Map(routes.map((route) => [String(route.id), route]));
    const groupLookup = new Map();
    groupMappings.forEach((mapping) => {
      if (!mapping?.xdmGeozoneGroupId) return;
      let itineraryId = mapping.itineraryId || mapping.id || null;
      let roleKey = ITINERARY_GEOZONE_GROUPS.itinerary.key;
      if (mapping.scopeKey) {
        const [scopePrefix, scopeItineraryId, scopeRole] = String(mapping.scopeKey).split(":");
        if (scopePrefix === "itinerary") {
          itineraryId = scopeItineraryId;
          roleKey = scopeRole || roleKey;
        }
      }
      groupLookup.set(String(mapping.xdmGeozoneGroupId), { itineraryId, roleKey });
    });

    const detail = await buildVehicleEmbarkDetail({
      vehicle,
      deployment: latest,
      lastEmbark,
      itinerariesById,
      geofencesById,
      routesById,
      groupLookup,
      correlationId,
    });

    return res.json({ data: detail, error: null });
  } catch (error) {
    return next(error);
  }
});

router.get("/itineraries/embark/vehicles/:vehicleId/history", async (req, res, next) => {
  try {
    const vehicleId = req.params.vehicleId;
    const vehicle = getVehicleById(vehicleId);
    if (!vehicle) {
      throw createError(404, "Veículo não encontrado");
    }
    ensureSameClient(req.user, vehicle.clientId);

    const deployments = listDeployments({ clientId: vehicle.clientId }).filter(
      (deployment) => String(deployment.vehicleId) === String(vehicleId),
    );
    const vehicles = new Map([[String(vehicle.id), vehicle]]);
    const itineraries = listItineraries({ clientId: vehicle.clientId }).reduce((acc, itinerary) => {
      acc.set(String(itinerary.id), itinerary);
      return acc;
    }, new Map());

    const history = toHistoryEntries({ deploymentsList: deployments, vehiclesById: vehicles, itinerariesById: itineraries })
      .map(normalizeHistoryEntry);

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

    const deploymentsHistory = toHistoryEntries({
      deploymentsList: deployments,
      vehiclesById: vehicles,
      itinerariesById: itineraries,
    }).map(normalizeHistoryEntry);
    const extraHistory = listEmbarkHistory({ clientId: itinerary.clientId })
      .filter((entry) => String(entry.itineraryId) === String(itinerary.id))
      .map(normalizeHistoryEntry);
    const history = [...deploymentsHistory, ...extraHistory].sort(
      (a, b) => new Date(b.sentAt || b.at || 0).getTime() - new Date(a.sentAt || a.at || 0).getTime(),
    );
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
    const [geofences, routes] = await Promise.all([
      listGeofences({ clientId }),
      listRoutes({ clientId }),
    ]);
    const geofencesById = new Map(geofences.map((geofence) => [String(geofence.id), geofence]));
    const routesById = new Map(routes.map((route) => [String(route.id), route]));
    const snapshotByItinerary = new Map();

    for (const vehicleId of vehicleIds) {
      const vehicle = vehicles.get(String(vehicleId)) || getVehicleById(vehicleId);
      for (const itineraryId of itineraryIds) {
        const itinerary = itinerariesById.get(String(itineraryId)) || getItineraryById(itineraryId);
        let snapshot = snapshotByItinerary.get(String(itineraryId)) || null;
        if (!snapshot && itinerary) {
          snapshot = buildItinerarySnapshot({
            itinerary,
            geofencesById,
            routesById,
            action: "EMBARK",
            requestedByName: userLabel,
          });
          snapshotByItinerary.set(String(itineraryId), snapshot);
        }
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
          snapshot: snapshot ? JSON.parse(JSON.stringify(snapshot)) : null,
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
