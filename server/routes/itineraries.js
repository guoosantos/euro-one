import crypto from "node:crypto";
import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { resolveClientId } from "../middleware/client.js";
import { authorizePermission } from "../middleware/permissions.js";
import { buildItineraryKml } from "../utils/kml.js";
import { listGeofences } from "../models/geofence.js";
import { getRouteById, listRoutes, updateRoute } from "../models/route.js";
import { getVehicleById } from "../models/vehicle.js";
import { getDeviceById } from "../models/device.js";
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
import { resolveDeviceConfirmationStatus } from "../services/xdm/deployment-confirmation.js";
import XdmClient from "../services/xdm/xdm-client.js";
import { listVehicleEmbarkHistory, normalizeHistoryEntry, resolveActionLabel } from "../services/embark-history.js";
import { getAccessibleVehicles } from "../services/accessible-vehicles.js";

const router = express.Router();

router.use(authenticate);

function resolveTargetClient(req, provided, { required = false } = {}) {
  if (req.user.role === "admin") {
    const resolved = provided || req.query?.clientId || null;
    if (required && !resolved) {
      return req.user.clientId || null;
    }
    return resolved;
  }
  const mirrorClientId =
    req.tenant?.accessType === "mirror"
      ? (req.clientId || req.mirrorContext?.ownerClientId || null)
      : null;
  const clientId = mirrorClientId || req.user.clientId || null;
  if (required && !clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  return clientId;
}

function resolveMirrorAllClientIds(req) {
  const ownerClientId = req.mirrorContext?.ownerClientId ?? null;
  if (!ownerClientId || String(ownerClientId) !== "all") return null;
  const ownerIds = Array.isArray(req.mirrorContext?.ownerClientIds)
    ? req.mirrorContext.ownerClientIds.map((id) => String(id)).filter(Boolean)
    : [];
  return ownerIds.length ? ownerIds : [];
}

function mergeUniqueByKey(list = [], getKey) {
  const map = new Map();
  list.forEach((item) => {
    const key = getKey(item);
    if (!key || map.has(key)) return;
    map.set(key, item);
  });
  return Array.from(map.values());
}

function listItinerariesWithGlobals({ clientId, includeGlobal = true } = {}) {
  if (!clientId) {
    return listItineraries();
  }
  if (!includeGlobal) {
    return listItineraries({ clientId });
  }
  const globals = listItineraries({ scope: "global" });
  const perClient = listItineraries({ clientId });
  return mergeUniqueByKey([...globals, ...perClient], (item) => String(item?.id || ""));
}

async function collectByClientIds(clientIds = [], loader, label = "dados") {
  if (!clientIds.length) return [];
  const results = await Promise.allSettled(
    clientIds.map(async (clientId) => {
      const value = await Promise.resolve(loader(clientId));
      return { clientId, value };
    }),
  );
  const merged = [];
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      const list = result.value?.value;
      if (Array.isArray(list)) merged.push(...list);
      return;
    }
    console.warn(`[itineraries] Falha ao carregar ${label} por cliente`, {
      message: result.reason?.message || result.reason,
    });
  });
  return merged;
}

function shouldAllowXdmFailure(error) {
  const status = Number(error?.status || error?.statusCode || error?.response?.status);
  if (Number.isFinite(status) && status === 405) return true;
  const code = String(error?.code || error?.details?.code || "").toUpperCase();
  return code === "XDM_REQUEST_FAILED" && status === 405;
}

function ensureSameClient(req, clientId) {
  const user = req.user;
  if (user.role === "admin") return;
  if (!clientId) {
    const mirrorAll = req.mirrorContext?.ownerClientId && String(req.mirrorContext.ownerClientId) === "all";
    if (mirrorAll) return;
  }
  if (user.clientId && String(user.clientId) === String(clientId)) return;
  const mirrorOwnerId = req.mirrorContext?.ownerClientId ?? null;
  const hasMirrorAccess =
    req.tenant?.accessType === "mirror" &&
    mirrorOwnerId &&
    String(mirrorOwnerId) === String(clientId);
  if (hasMirrorAccess) return;
  const mirrorAllAccess =
    req.tenant?.accessType === "mirror" &&
    mirrorOwnerId &&
    String(mirrorOwnerId) === "all" &&
    Array.isArray(req.mirrorContext?.ownerClientIds) &&
    req.mirrorContext.ownerClientIds.some((id) => String(id) === String(clientId));
  if (mirrorAllAccess) return;
  throw createError(403, `Usuário não tem permissão para clientId ${clientId}`);
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

async function resolveAccessibleVehicleList(req, clientId) {
  const access = await getAccessibleVehicles({
    user: req.user,
    clientId,
    includeMirrorsForNonReceivers: false,
    mirrorContext: req.mirrorContext,
  });
  return access.vehicles;
}

function findMissingItineraryItem({ itinerary, geofencesById, routesById } = {}) {
  if (!itinerary) return null;
  const items = Array.isArray(itinerary.items) ? itinerary.items : [];
  for (const item of items) {
    if (!item?.id || !item?.type) continue;
    const type = String(item.type);
    const id = String(item.id);
    if (type === "route") {
      if (!routesById?.has(id)) {
        return { type: "route", id, message: `Rota não encontrada para o itinerário (${id})` };
      }
      continue;
    }
    if (type === "geofence" || type === "target") {
      if (!geofencesById?.has(id)) {
        return { type: "geofence", id, message: `Geofence não encontrada para o itinerário (${id})` };
      }
    }
  }
  return null;
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
  const confirmedAt = deployment?.deviceConfirmedAt || deployment?.confirmedAt || null;
  const isConfirmed = Boolean(confirmedAt);

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
  if (["CONFIRMED", "DEPLOYED", "CLEARED"].includes(deploymentStatus)) {
    if (isConfirmed) {
      return {
        code: "CONFIRMED",
        label: "CONCLUÍDO",
        configLabel: "Central confirmou",
        matchesExpected: true,
      };
    }
    return {
      code: "PENDENTE",
      label: "PENDENTE",
      configLabel: "Aguardando confirmação do equipamento",
      matchesExpected: matched,
    };
  }
  if (matched) {
    if (isConfirmed) {
      return {
        code: "CONFIRMED",
        label: "CONCLUÍDO",
        configLabel: "Equipamento confirmou",
        matchesExpected: true,
      };
    }
    return {
      code: "PENDENTE",
      label: "PENDENTE",
      configLabel: "Aguardando confirmação do equipamento",
      matchesExpected: matched,
    };
  }
  if (["SYNCING", "DEPLOYING", "STARTED", "RUNNING"].includes(deploymentStatus)) {
    return {
      code: "PENDENTE",
      label: "PENDENTE",
      configLabel: "Aguardando atualização",
      matchesExpected: matched,
    };
  }
  if (!deployment && hasEmbarked) {
    if (isConfirmed) {
      return {
        code: "EMBARCADO",
        label: "EMBARCADO",
        configLabel: "Equipamento atualizou",
        matchesExpected: matched,
      };
    }
    return {
      code: "PENDENTE",
      label: "PENDENTE",
      configLabel: "Aguardando confirmação do equipamento",
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

async function resolveXdmDeviceConfirmation({ deviceUid, correlationId, startedAt } = {}) {
  if (!deviceUid) return null;
  const xdmClient = new XdmClient();
  const normalizedUid = String(deviceUid).trim();
  let details = null;
  try {
    details = await xdmClient.request(
      "GET",
      `/api/external/v3/devicesSdk/${normalizedUid}/details`,
      null,
      { correlationId },
    );
  } catch (error) {
    try {
      details = await xdmClient.request(
        "GET",
        `/api/external/v1/devicesSdk/${normalizedUid}/details`,
        null,
        { correlationId },
      );
    } catch (fallbackError) {
      console.warn("[itineraries] Falha ao consultar confirmação no XDM", {
        deviceUid: normalizedUid,
        message: fallbackError?.message || fallbackError,
      });
      return null;
    }
  }
  return resolveDeviceConfirmationStatus({ details, startedAt });
}

async function resolveDeviceConfirmationTime({ vehicle, deployment, correlationId } = {}) {
  if (!vehicle) return null;
  const deviceUid = resolveVehicleDeviceUid(vehicle);
  if (!deviceUid) return null;
  return resolveXdmDeviceConfirmation({
    deviceUid,
    correlationId,
    startedAt: deployment?.startedAt || null,
  });
}

async function maybeConfirmDeployment({ deployment, vehicle, xdmStatus } = {}) {
  const canConfirm =
    xdmStatus?.matchesExpected ||
    xdmStatus?.code === "CONFIRMED" ||
    String(xdmStatus?.label || "").toUpperCase().includes("CONCLU");
  if (!deployment || !canConfirm) return null;
  const status = String(deployment.status || "").toUpperCase();
  if (["FAILED", "TIMEOUT", "ERROR", "INVALID", "REJECTED"].includes(status)) return deployment;
  if (deployment.confirmedAt) return deployment;
  const providerConfirmation = await resolveDeviceConfirmationTime({
    vehicle,
    deployment,
    correlationId: deployment.id || null,
  });
  if (!providerConfirmation) return deployment;
  if (providerConfirmation.status === "failed") {
    return updateDeployment(deployment.id, {
      status: "FAILED",
      finishedAt: new Date().toISOString(),
      errorMessage: "Falha na atualização do equipamento",
      errorDetails: providerConfirmation.state || null,
    });
  }
  if (providerConfirmation.status !== "confirmed" || !providerConfirmation.confirmedAt) {
    return deployment;
  }
  const confirmedAt = providerConfirmation.confirmedAt;
  return updateDeployment(deployment.id, {
    status: "CONFIRMED",
    confirmedAt,
    deviceConfirmedAt: confirmedAt,
    finishedAt: confirmedAt,
  });
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

const DEFAULT_OVERLAY_BUFFER_METERS = 200;

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

function normalizeGeoJsonLineString(points = []) {
  const normalized = normalizePointList(points);
  if (!normalized.length) return null;
  return {
    type: "LineString",
    coordinates: normalized.map(([lat, lng]) => [lng, lat]),
  };
}

function normalizeGeoJsonPolygon(points = []) {
  const normalized = normalizePointList(points);
  if (normalized.length < 3) return null;
  const coordinates = normalized.map(([lat, lng]) => [lng, lat]);
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    coordinates.push([...first]);
  }
  return {
    type: "Polygon",
    coordinates: [coordinates],
  };
}

function resolveOverlayBufferMeters({ routeIds = [], routesById = new Map() } = {}) {
  for (const routeId of routeIds) {
    const route = routesById.get(String(routeId));
    const metadata = route?.metadata && typeof route.metadata === "object" ? route.metadata : {};
    const candidate = Number(metadata.xdmBufferMeters ?? metadata.bufferMeters ?? metadata.routeBufferMeters);
    if (Number.isFinite(candidate) && candidate > 0) return candidate;
  }
  return parsePositiveNumber(process.env.XDM_ROUTE_BUFFER_METERS, DEFAULT_OVERLAY_BUFFER_METERS);
}

function buildOverlayGeometry(items = [], routesById = new Map()) {
  const list = Array.isArray(items) ? items : [];
  const routeItems = list.filter((item) => item?.type === "route" || item?.geometry?.isRoute);
  const geofenceItems = list.filter((item) => !(item?.type === "route" || item?.geometry?.isRoute));
  const routeGeometries = routeItems
    .map((item) => normalizeGeoJsonLineString(item?.geometry?.points || []))
    .filter(Boolean);
  const route =
    routeGeometries.length === 1
      ? routeGeometries[0]
      : routeGeometries.length > 1
        ? { type: "MultiLineString", coordinates: routeGeometries.map((geom) => geom.coordinates) }
        : null;

  const geofences = geofenceItems
    .map((item) => {
      const geometry = normalizeGeoJsonPolygon(item?.geometry?.points || []);
      if (!geometry) return null;
      return {
        type: "Feature",
        geometry,
        properties: {
          id: item?.id ?? null,
          name: item?.name ?? null,
          role: item?.type ?? null,
        },
      };
    })
    .filter(Boolean);

  const checkpoints = geofenceItems
    .filter((item) => String(item?.type || "").toLowerCase() === "target")
    .map((item) => {
      const center = item?.geometry?.center;
      const normalizedPoints = normalizePointList(item?.geometry?.points || []);
      const fallback = normalizedPoints[0];
      const lat = Number(center?.[0] ?? fallback?.[0]);
      const lng = Number(center?.[1] ?? fallback?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        name: item?.name || "Alvo",
        lat,
        lng,
      };
    })
    .filter(Boolean);

  const routeIds = routeItems
    .map((item) => (item?.id != null ? String(item.id) : null))
    .filter(Boolean);
  const bufferMeters = resolveOverlayBufferMeters({ routeIds, routesById });

  return { route, geofences, checkpoints, bufferMeters };
}

function buildOverlayItemsFromItinerary({ itinerary, geofencesById, routesById } = {}) {
  const items = Array.isArray(itinerary?.items) ? itinerary.items : [];
  return items
    .map((item) => {
      const type = item?.type || "";
      const id = item?.id != null ? String(item.id) : null;
      if (!id) return null;
      if (type === "route") {
        const route = routesById.get(id) || null;
        if (!route) return null;
        return {
          ...item,
          id,
          type: "route",
          geometry: {
            points: route?.points || [],
            isRoute: true,
          },
        };
      }
      const geofence = type === "geofence" || type === "target" ? geofencesById.get(id) || null : null;
      if (!geofence) return null;
      const center = [
        geofence.latitude ?? geofence.center?.[0],
        geofence.longitude ?? geofence.center?.[1],
      ];
      const circlePoints =
        geofence?.type === "circle"
          ? buildCirclePoints({
              center,
              radiusMeters: geofence.radius,
            })
          : [];
      const points = geofence?.type === "circle" ? circlePoints : geofence?.points || [];
      return {
        ...item,
        id,
        type: geofence?.isTarget || type === "target" ? "target" : "geofence",
        geometry: {
          points,
          center: geofence?.type === "circle" ? center : null,
          radiusMeters: geofence?.type === "circle" ? geofence?.radius || null : null,
          isRoute: false,
        },
      };
    })
    .filter(Boolean);
}

function resolveOverlayStatus({ detail, deployment } = {}) {
  const statusCode = String(detail?.xdmStatus || detail?.statusCode || "").toUpperCase();
  const action = String(deployment?.action || "EMBARK").toUpperCase();
  const hasItinerary = Boolean(detail?.itineraryId || detail?.itineraryName);
  const errorCodes = new Set(["ERROR", "INVALID", "REJECTED", "FAILED", "TIMEOUT"]);

  if (!hasItinerary && !deployment) {
    return { status: "NONE", statusMessage: "Sem itinerário embarcado para este veículo." };
  }

  if (action === "DISEMBARK") {
    if (statusCode === "CONFIRMED" || statusCode === "EMPTY") {
      return { status: "FINISHED", statusMessage: "Itinerário finalizado." };
    }
    return { status: "PENDING_CONFIRMATION", statusMessage: "Aguardando confirmação do equipamento para remover o itinerário." };
  }

  if (!hasItinerary || statusCode === "EMPTY") {
    return { status: "NONE", statusMessage: "Sem itinerário embarcado para este veículo." };
  }

  if (errorCodes.has(statusCode)) {
    return { status: "ERROR", statusMessage: "Falha ao confirmar o itinerário." };
  }

  if (statusCode === "CONFIRMED") {
    return { status: "CONFIRMED", statusMessage: "Itinerário confirmado pelo equipamento." };
  }

  return { status: "PENDING_CONFIRMATION", statusMessage: "Aguardando confirmação do equipamento para exibir no mapa." };
}

const OVERLAY_STATUS_MAP = {
  NONE: "NONE",
  PENDING_CONFIRMATION: "PENDING",
  ERROR: "FAILED",
  CONFIRMED: "CONFIRMED",
  FINISHED: "FINISHED",
};

const OVERLAY_FAILED_STATUSES = new Set(["ERROR", "INVALID", "REJECTED", "FAILED", "TIMEOUT"]);
const OVERLAY_PENDING_STATUSES = new Set([
  "SYNCING",
  "DEPLOYING",
  "QUEUED",
  "STARTED",
  "RUNNING",
  "DEPLOYED",
  "CLEARED",
]);

function mapDeploymentStatusToOverlay(deployment) {
  if (!deployment) return "NONE";
  const action = String(deployment.action || "EMBARK").toUpperCase();
  const status = String(deployment.status || "").toUpperCase();
  if (status === "CANCELED" || status === "CANCELLED") return "CANCELED";
  if (action === "DISEMBARK") {
    if (status === "CONFIRMED" || status === "FINISHED") return "FINISHED";
    if (OVERLAY_FAILED_STATUSES.has(status)) return "FAILED";
    return "PENDING";
  }
  if (status === "CONFIRMED") return "CONFIRMED";
  if (OVERLAY_FAILED_STATUSES.has(status)) return "FAILED";
  if (OVERLAY_PENDING_STATUSES.has(status)) return "PENDING";
  return status ? "PENDING" : "NONE";
}

function mapOverlayStatusCode(status, deployment, { fallbackToDeployment = false } = {}) {
  const mapped = OVERLAY_STATUS_MAP[status] || "NONE";
  if (mapped === "NONE" && fallbackToDeployment && deployment) {
    return mapDeploymentStatusToOverlay(deployment);
  }
  return mapped;
}

function resolveOverlayStatusV2({ detail, deployment, fallbackToDeployment = false } = {}) {
  const { status, statusMessage } = resolveOverlayStatus({ detail, deployment });
  return {
    status: mapOverlayStatusCode(status, deployment, { fallbackToDeployment }),
    statusMessage,
  };
}

export function __mapOverlayStatusCode(status, deployment, fallbackToDeployment = false) {
  return mapOverlayStatusCode(status, deployment, { fallbackToDeployment });
}

function resolveItemSizeBytes(payload) {
  if (!payload) return null;
  if (payload.kml) return Buffer.byteLength(String(payload.kml));
  if (payload.geometryJson) return Buffer.byteLength(JSON.stringify(payload.geometryJson));
  if (payload.area) return Buffer.byteLength(String(payload.area));
  if (payload.points) return Buffer.byteLength(JSON.stringify(payload.points));
  return null;
}

function buildGroupLookup(groupMappings = []) {
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
  return groupLookup;
}

async function resolveOverlayContext({ vehicle } = {}) {
  const deployments = listDeployments({ clientId: vehicle.clientId }).filter(
    (deployment) => String(deployment.vehicleId) === String(vehicle.id),
  );
  const sortedDeployments = [...deployments].sort(
    (a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime(),
  );
  const lastEmbark = sortedDeployments.find(
    (deployment) => normalizeDeploymentAction(deployment.action) === "EMBARK" && deployment.status === "DEPLOYED",
  );
  const itineraries = listItinerariesWithGlobals({ clientId: vehicle.clientId });
  const geofences = await listGeofences({ clientId: vehicle.clientId });
  const routes = listRoutes({ clientId: vehicle.clientId });
  const groupMappings = listGeozoneGroupMappings({ clientId: vehicle.clientId });

  const itinerariesById = new Map(itineraries.map((itinerary) => [String(itinerary.id), itinerary]));
  const geofencesById = new Map(geofences.map((geofence) => [String(geofence.id), geofence]));
  const routesById = new Map(routes.map((route) => [String(route.id), route]));
  const groupLookup = buildGroupLookup(groupMappings);

  return {
    deployments,
    sortedDeployments,
    lastEmbark,
    itinerariesById,
    geofencesById,
    routesById,
    groupLookup,
  };
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
  vehiclesById,
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

  const vehicles = vehiclesById || new Map();

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
  const confirmedDeployment = await maybeConfirmDeployment({ deployment, vehicle, xdmStatus });
  const activeDeployment = confirmedDeployment || deployment;
  const snapshotItems = activeDeployment?.snapshot?.items || null;

  const items = snapshotItems?.length
    ? snapshotItems.map((item) => ({
        ...item,
        lastEmbarkAt: lastEmbark?.confirmedAt || lastEmbark?.finishedAt || lastEmbark?.startedAt || null,
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
            lastEmbarkAt: lastEmbark?.confirmedAt || lastEmbark?.finishedAt || lastEmbark?.startedAt || null,
            statusLabel: xdmStatus.label,
          };
        })
      : [];
  const routeIds = items
    .map((item) => {
      if (!item) return null;
      const isRoute = item?.type === "route" || item?.geometry?.isRoute;
      if (!isRoute) return null;
      return item?.id != null ? String(item.id) : null;
    })
    .filter(Boolean);
  const bufferMeters = resolveOverlayBufferMeters({ routeIds, routesById });

  return {
    vehicleId: String(vehicle.id),
    vehicleName: vehicle.name || null,
    plate: vehicle.plate || null,
    brand: vehicle.brand || null,
    model: vehicle.model || null,
    itineraryId: itinerary?.id || snapshotItinerary?.id || null,
    itineraryName: itinerary?.name || snapshotItinerary?.name || null,
    itineraryDescription: itinerary?.description || snapshotItinerary?.description || null,
    bufferMeters,
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
    statusCode: activeDeployment?.status || null,
    statusLabel: xdmStatus.label,
    status: xdmStatus.label,
    lastActionLabel: activeDeployment ? resolveActionLabel(activeDeployment.action) : "—",
    lastActionAt: activeDeployment?.confirmedAt || activeDeployment?.finishedAt || activeDeployment?.startedAt || null,
    lastEmbarkAt: lastEmbark?.confirmedAt || lastEmbark?.finishedAt || lastEmbark?.startedAt || null,
    items,
    lastSnapshot: activeDeployment?.snapshot || null,
  };
}

router.get(
  "/itineraries",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries" }),
  async (req, res, next) => {
  try {
    const scope = String(req.query?.scope || "").toLowerCase();
    if (scope === "global") {
      if (req.user.role !== "admin") {
        throw createError(403, "Sem acesso a itinerários globais");
      }
      const itineraries = listItineraries({ scope: "global" }).map(withSyncStatus);
      return res.json({ data: itineraries, error: null });
    }
    const mirrorAllClientIds = resolveMirrorAllClientIds(req);
    const requestedClientId = req.query?.clientId ?? null;
    const wantsAll = !requestedClientId || String(requestedClientId).toLowerCase() === "all";
    if (mirrorAllClientIds && wantsAll) {
      const perClient = mirrorAllClientIds.flatMap((clientId) => listItineraries({ clientId }));
      const globals = listItineraries({ scope: "global" });
      const merged = mergeUniqueByKey([...globals, ...perClient], (item) => String(item?.id || ""));
      return res.json({ data: merged.map(withSyncStatus), error: null });
    }
    if (mirrorAllClientIds && requestedClientId && String(requestedClientId).toLowerCase() !== "all") {
      const normalized = String(requestedClientId);
      if (!mirrorAllClientIds.some((id) => String(id) === normalized)) {
        throw createError(403, `Usuário não tem permissão para clientId ${normalized}`);
      }
      const itineraries = listItinerariesWithGlobals({ clientId: normalized }).map(withSyncStatus);
      return res.json({ data: itineraries, error: null });
    }
    const targetClientId = resolveTargetClient(req, req.query?.clientId, { required: req.user.role !== "admin" });
    const itineraries = (targetClientId
      ? listItinerariesWithGlobals({ clientId: targetClientId })
      : listItineraries()
    ).map(withSyncStatus);
    return res.json({ data: itineraries, error: null });
  } catch (error) {
    return next(error);
  }
  },
);

router.get(
  "/itineraries/:id",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries" }),
  async (req, res, next) => {
  try {
    const itinerary = getItineraryById(req.params.id);
    if (!itinerary) {
      throw createError(404, "Itinerário não encontrado");
    }
    ensureSameClient(req, itinerary.clientId);
    return res.json({ data: withSyncStatus(itinerary), error: null });
  } catch (error) {
    return next(error);
  }
  },
);

router.post(
  "/itineraries",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries", requireFull: true }),
  async (req, res, next) => {
  try {
    const scope = String(req.body?.scope || "").toLowerCase();
    const requestedClientId = req.body?.clientId ?? null;
    const ownerHeader = req.get?.("X-Owner-Client-Id") || req.headers?.["x-owner-client-id"] || null;
    const wantsAllClient = String(requestedClientId || ownerHeader || "").toLowerCase() === "all";
    const mirrorAllClientIds = resolveMirrorAllClientIds(req);
    const allowGlobal =
      req.user.role === "admin" ||
      (Array.isArray(mirrorAllClientIds) && mirrorAllClientIds.length > 0 && (wantsAllClient || scope === "global"));
    const isGlobal = scope === "global" || wantsAllClient;
    if (isGlobal && !allowGlobal) {
      throw createError(403, "Sem acesso para criar itinerários globais");
    }
    const clientId = isGlobal ? null : resolveTargetClient(req, requestedClientId, { required: true });
    const userLabel = req.user?.name || req.user?.email || req.user?.username || req.user?.id || "Usuário";
    const sentAt = new Date().toISOString();
    const items = buildItineraryItems({
      items: req.body?.items,
      routeIds: req.body?.routeIds,
      hasItems: Object.prototype.hasOwnProperty.call(req.body || {}, "items"),
    });
    const itinerary = createItinerary({ ...req.body, items, clientId, scope: isGlobal ? "global" : undefined });
    if (isGlobal) {
      return res.status(201).json({ data: withSyncStatus(itinerary), error: null });
    }
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
          receivedAt: null,
          deviceConfirmedAt: null,
          sentBy: req.user?.id || null,
          sentByName: userLabel,
          status: "DEPLOYED",
          statusLabel: "CONCLUÍDO",
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
            receivedAt: null,
            deviceConfirmedAt: null,
            sentBy: req.user?.id || null,
            sentByName: userLabel,
            status: "DEPLOYED",
            statusLabel: "CONCLUÍDO",
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
      if (shouldAllowXdmFailure(error)) {
        const updated = getItineraryById(itinerary.id);
        return res.status(201).json({
          data: withSyncStatus(updated || itinerary),
          error: null,
          xdm: { ok: false, reason: "METHOD_NOT_ALLOWED" },
        });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
  },
);

router.put(
  "/itineraries/:id",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries", requireFull: true }),
  async (req, res, next) => {
  try {
    const existing = getItineraryById(req.params.id);
    if (!existing) {
      throw createError(404, "Itinerário não encontrado");
    }
    const isGlobal = existing.scope === "global" || !existing.clientId;
    if (isGlobal) {
      if (req.user.role !== "admin") {
        throw createError(403, "Sem acesso para atualizar itinerários globais");
      }
      const items = buildItineraryItems({
        items: req.body?.items,
        routeIds: req.body?.routeIds,
        existingItems: existing.items || [],
        hasItems: Object.prototype.hasOwnProperty.call(req.body || {}, "items"),
      });
      const updated = updateItinerary(req.params.id, { ...req.body, items, scope: "global", clientId: null });
      return res.json({ data: withSyncStatus(updated), error: null });
    }
    const clientId = resolveTargetClient(req, req.body?.clientId || existing.clientId, { required: true });
    ensureSameClient(req, clientId);
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
      if (shouldAllowXdmFailure(error)) {
        const refreshed = getItineraryById(updated.id);
        return res.status(200).json({
          data: withSyncStatus(refreshed || updated),
          error: null,
          xdm: { ok: false, reason: "METHOD_NOT_ALLOWED" },
        });
      }
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
    const vehicles = (await resolveAccessibleVehicleList(req, clientId)).reduce((acc, vehicle) => {
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
        receivedAt: null,
        deviceConfirmedAt: null,
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
  },
);

router.delete(
  "/itineraries/:id",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries", requireFull: true }),
  async (req, res, next) => {
  try {
    const existing = getItineraryById(req.params.id);
    if (!existing) {
      throw createError(404, "Itinerário não encontrado");
    }
    const isGlobal = existing.scope === "global" || !existing.clientId;
    if (isGlobal && req.user.role !== "admin") {
      throw createError(403, "Sem acesso para excluir itinerários globais");
    }
    ensureSameClient(req, existing.clientId);
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
    const vehiclesById = (await resolveAccessibleVehicleList(req, existing.clientId)).reduce((acc, vehicle) => {
      acc.set(String(vehicle.id), vehicle);
      return acc;
    }, new Map());
    const blockingDeployments = await resolveBlockingEmbarkDeployments({
      itinerary: existing,
      latestDeployments,
      correlationId,
      vehiclesById,
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
          receivedAt: null,
          deviceConfirmedAt: null,
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
          receivedAt: null,
          deviceConfirmedAt: null,
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
  },
);

router.get(
  "/itineraries/:id/export/kml",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries" }),
  async (req, res, next) => {
  try {
    const itinerary = getItineraryById(req.params.id);
    if (!itinerary) {
      throw createError(404, "Itinerário não encontrado");
    }
    ensureSameClient(req, itinerary.clientId);
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
  },
);

router.get(
  "/itineraries/embark/history",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries" }),
  async (req, res, next) => {
  try {
    const mirrorAllClientIds = resolveMirrorAllClientIds(req);
    const requestedClientId = req.query?.clientId ?? null;
    const wantsAll = !requestedClientId || String(requestedClientId).toLowerCase() === "all";
    if (mirrorAllClientIds && wantsAll) {
      if (!mirrorAllClientIds.length) {
        return res.json({ data: [], error: null });
      }
      const deployments = mirrorAllClientIds.flatMap((clientId) => listDeployments({ clientId }));
      const vehicles = (await resolveAccessibleVehicleList(req, null)).reduce((acc, vehicle) => {
        acc.set(String(vehicle.id), vehicle);
        return acc;
      }, new Map());
      const perClientItineraries = mirrorAllClientIds.flatMap((clientId) => listItineraries({ clientId }));
      const globals = listItineraries({ scope: "global" });
      const mergedItineraries = mergeUniqueByKey(
        [...globals, ...perClientItineraries],
        (item) => String(item?.id || ""),
      );
      const itineraries = mergedItineraries.reduce((acc, itinerary) => {
        acc.set(String(itinerary.id), itinerary);
        return acc;
      }, new Map());

      const deploymentsHistory = toHistoryEntries({
        deploymentsList: deployments,
        vehiclesById: vehicles,
        itinerariesById: itineraries,
      }).map(normalizeHistoryEntry);
      const extraHistory = mirrorAllClientIds
        .flatMap((clientId) => listEmbarkHistory({ clientId }))
        .map(normalizeHistoryEntry);

      const history = [...deploymentsHistory, ...extraHistory].sort(
        (a, b) => new Date(b.sentAt || b.at || 0).getTime() - new Date(a.sentAt || a.at || 0).getTime(),
      );

      return res.json({ data: history, error: null });
    }
    if (mirrorAllClientIds && requestedClientId && String(requestedClientId).toLowerCase() !== "all") {
      const normalized = String(requestedClientId);
      if (!mirrorAllClientIds.some((id) => String(id) === normalized)) {
        throw createError(403, `Usuário não tem permissão para clientId ${normalized}`);
      }
      const deployments = listDeployments({ clientId: normalized });
      const vehicles = (await resolveAccessibleVehicleList(req, normalized)).reduce((acc, vehicle) => {
        acc.set(String(vehicle.id), vehicle);
        return acc;
      }, new Map());
      const itineraries = listItinerariesWithGlobals({ clientId: normalized }).reduce((acc, itinerary) => {
        acc.set(String(itinerary.id), itinerary);
        return acc;
      }, new Map());
      const deploymentsHistory = toHistoryEntries({
        deploymentsList: deployments,
        vehiclesById: vehicles,
        itinerariesById: itineraries,
      }).map(normalizeHistoryEntry);
      const extraHistory = listEmbarkHistory({ clientId: normalized }).map(normalizeHistoryEntry);
      const history = [...deploymentsHistory, ...extraHistory].sort(
        (a, b) => new Date(b.sentAt || b.at || 0).getTime() - new Date(a.sentAt || a.at || 0).getTime(),
      );
      return res.json({ data: history, error: null });
    }
    const clientId = resolveTargetClient(req, req.query?.clientId, { required: req.user.role !== "admin" });
    const deployments = listDeployments(clientId ? { clientId } : {});
    const vehicles = (await resolveAccessibleVehicleList(req, clientId)).reduce((acc, vehicle) => {
      acc.set(String(vehicle.id), vehicle);
      return acc;
    }, new Map());
    const itineraries = (clientId
      ? listItinerariesWithGlobals({ clientId })
      : listItineraries()
    ).reduce((acc, itinerary) => {
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
  },
);

router.get(
  "/itineraries/embark/vehicles",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries" }),
  async (req, res, next) => {
  try {
    const requestedClientId = req.query?.clientId ?? null;
    if (!requestedClientId) {
      throw createError(400, "clientId é obrigatório");
    }
    const normalizedRequested = String(requestedClientId);
    const mirrorAllClientIds = resolveMirrorAllClientIds(req);
    const wantsAll = String(requestedClientId).toLowerCase() === "all";
    if (wantsAll && !mirrorAllClientIds) {
      throw createError(400, "clientId inválido para este contexto");
    }
    if (!wantsAll) {
      ensureSameClient(req, normalizedRequested);
    }
    if (mirrorAllClientIds && wantsAll) {
      if (!mirrorAllClientIds.length) {
        return res.json({ data: [], error: null });
      }
      const correlationId = req.headers["x-correlation-id"] || null;
      const vehicles = await resolveAccessibleVehicleList(req, null);
      const deployments = mirrorAllClientIds.flatMap((clientId) => listDeployments({ clientId }));
      const perClientItineraries = mirrorAllClientIds.flatMap((clientId) => listItineraries({ clientId }));
      const globals = listItineraries({ scope: "global" });
      const itineraries = mergeUniqueByKey(
        [...globals, ...perClientItineraries],
        (item) => String(item?.id || ""),
      );
      const geofences = await collectByClientIds(mirrorAllClientIds, (clientId) => listGeofences({ clientId }), "cercas");
      const routes = mirrorAllClientIds.flatMap((clientId) => listRoutes({ clientId }));
      const groupMappings = mirrorAllClientIds.flatMap((clientId) => listGeozoneGroupMappings({ clientId }));

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
        const vehicleKey = `${deployment.clientId}:${deployment.vehicleId}`;
        if (!latestByVehicle.has(vehicleKey)) {
          latestByVehicle.set(vehicleKey, deployment);
        }
        if (
          !lastEmbarkByVehicle.has(vehicleKey) &&
          normalizeDeploymentAction(deployment.action) === "EMBARK" &&
          deployment.status === "DEPLOYED"
        ) {
          lastEmbarkByVehicle.set(vehicleKey, deployment);
        }
      }

      const vehiclesDetail = await Promise.all(
        vehicles.map(async (vehicle) => {
          const vehicleKey = `${vehicle.clientId ?? "unknown"}:${vehicle.id}`;
          const deployment = latestByVehicle.get(vehicleKey) || null;
          const lastEmbark = lastEmbarkByVehicle.get(vehicleKey) || null;
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

      const deduped = mergeUniqueByKey(
        vehiclesDetail,
        (detail) => `${detail?.clientId ?? "unknown"}:${detail?.vehicleId ?? ""}`,
      );

      return res.json({ data: deduped, error: null });
    }
    if (mirrorAllClientIds && requestedClientId && String(requestedClientId).toLowerCase() !== "all") {
      const normalized = String(requestedClientId);
      if (!mirrorAllClientIds.some((id) => String(id) === normalized)) {
        throw createError(403, `Usuário não tem permissão para clientId ${normalized}`);
      }
      const correlationId = req.headers["x-correlation-id"] || null;
      const vehicles = await resolveAccessibleVehicleList(req, normalized);
      const deployments = listDeployments({ clientId: normalized });
      const itineraries = listItinerariesWithGlobals({ clientId: normalized });
      const geofences = await listGeofences({ clientId: normalized });
      const routes = listRoutes({ clientId: normalized });
      const groupMappings = listGeozoneGroupMappings({ clientId: normalized });

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
    }
    const clientId = resolveTargetClient(req, req.query?.clientId, { required: req.user.role !== "admin" });
    const correlationId = req.headers["x-correlation-id"] || null;
    const vehicles = await resolveAccessibleVehicleList(req, clientId);
    const deployments = listDeployments(clientId ? { clientId } : {});
    const itineraries = clientId ? listItinerariesWithGlobals({ clientId }) : listItineraries();
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
  },
);

router.get(
  "/itineraries/embark/vehicles/:vehicleId/status",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries" }),
  async (req, res, next) => {
  try {
    const vehicleId = req.params.vehicleId;
    const vehicle = getVehicleById(vehicleId);
    if (!vehicle) {
      throw createError(404, "Veículo não encontrado");
    }
    ensureSameClient(req, vehicle.clientId);
    const correlationId = req.headers["x-correlation-id"] || null;

    const {
      sortedDeployments,
      lastEmbark,
      itinerariesById,
      geofencesById,
      routesById,
      groupLookup,
    } = await resolveOverlayContext({ vehicle });
    const latest = sortedDeployments[0] || null;

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
  },
);

router.get(
  "/vehicles/:vehicleId/itinerary-overlay",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries" }),
  async (req, res, next) => {
  try {
    const vehicleId = req.params.vehicleId;
    const vehicle = getVehicleById(vehicleId);
    if (!vehicle) {
      throw createError(404, "Veículo não encontrado");
    }
    ensureSameClient(req, vehicle.clientId);
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

    const itineraries = listItinerariesWithGlobals({ clientId: vehicle.clientId });
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

    const { status, statusMessage } = resolveOverlayStatus({ detail, deployment: latest });
    const snapshotItinerary = detail?.lastSnapshot?.itinerary || null;
    const storedItinerary = detail?.itineraryId ? itinerariesById.get(String(detail.itineraryId)) : null;
    const resolvedItinerary = storedItinerary || snapshotItinerary || null;
    const confirmedAt =
      latest?.confirmedAt || latest?.deviceConfirmedAt || latest?.finishedAt || null;
    const items = Array.isArray(detail?.items) ? detail.items : [];
    const geometry =
      status === "CONFIRMED" ? buildOverlayGeometry(items, routesById) : null;

    const itineraryPayload = resolvedItinerary
      ? {
          id: resolvedItinerary?.id ? String(resolvedItinerary.id) : detail?.itineraryId || null,
          name: resolvedItinerary?.name || detail?.itineraryName || "Itinerário",
          updatedAt: resolvedItinerary?.updatedAt || latest?.startedAt || null,
          confirmedAt,
          bufferMeters: geometry?.bufferMeters ?? DEFAULT_OVERLAY_BUFFER_METERS,
          route: status === "CONFIRMED" ? geometry?.route || null : null,
          geofences: status === "CONFIRMED" ? geometry?.geofences || [] : [],
          checkpoints: status === "CONFIRMED" ? geometry?.checkpoints || [] : [],
        }
      : null;

    return res.json({
      data: {
        status,
        statusMessage,
        itinerary: status === "NONE" ? null : itineraryPayload,
      },
      error: null,
    });
  } catch (error) {
    return next(error);
  }
  },
);

router.get(
  "/vehicles/:vehicleId/itineraries",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries" }),
  async (req, res, next) => {
  try {
    const vehicleId = req.params.vehicleId;
    const vehicle = getVehicleById(vehicleId);
    if (!vehicle) {
      throw createError(404, "Veículo não encontrado");
    }
    ensureSameClient(req, vehicle.clientId);
    const itineraries = listItinerariesWithGlobals({ clientId: vehicle.clientId });
    return res.json({ data: itineraries, error: null });
  } catch (error) {
    return next(error);
  }
  },
);

router.get(
  "/vehicles/:vehicleId/itinerary-overlay/confirmed",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries" }),
  async (req, res, next) => {
  try {
    const vehicleId = req.params.vehicleId;
    const vehicle = getVehicleById(vehicleId);
    if (!vehicle) {
      throw createError(404, "Veículo não encontrado");
    }
    ensureSameClient(req, vehicle.clientId);
    const correlationId = req.headers["x-correlation-id"] || null;

    const {
      sortedDeployments,
      lastEmbark,
      itinerariesById,
      geofencesById,
      routesById,
      groupLookup,
    } = await resolveOverlayContext({ vehicle });
    const latest = sortedDeployments[0] || null;

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

    const { status, statusMessage } = resolveOverlayStatusV2({ detail, deployment: latest });
    const snapshotItinerary = detail?.lastSnapshot?.itinerary || null;
    const storedItinerary = detail?.itineraryId ? itinerariesById.get(String(detail.itineraryId)) : null;
    const resolvedItinerary = storedItinerary || snapshotItinerary || null;
    const confirmedAt =
      latest?.confirmedAt || latest?.deviceConfirmedAt || latest?.finishedAt || null;
    const items = Array.isArray(detail?.items) ? detail.items : [];
    const geometry = status === "CONFIRMED" ? buildOverlayGeometry(items, routesById) : null;

    const itineraryPayload =
      status === "CONFIRMED" && (resolvedItinerary || detail?.itineraryId || detail?.itineraryName)
        ? {
            id: resolvedItinerary?.id ? String(resolvedItinerary.id) : detail?.itineraryId || null,
            name: resolvedItinerary?.name || detail?.itineraryName || "Itinerário",
            updatedAt: resolvedItinerary?.updatedAt || latest?.startedAt || null,
            confirmedAt,
            bufferMeters: geometry?.bufferMeters ?? DEFAULT_OVERLAY_BUFFER_METERS,
            route: geometry?.route || null,
            geofences: geometry?.geofences || [],
            checkpoints: geometry?.checkpoints || [],
          }
        : null;

    return res.json({
      data: {
        status,
        statusMessage,
        itinerary: status === "CONFIRMED" ? itineraryPayload : null,
      },
      error: null,
    });
  } catch (error) {
    return next(error);
  }
  },
);

router.get(
  "/vehicles/:vehicleId/itinerary-overlay/last-attempt",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries" }),
  async (req, res, next) => {
  try {
    const vehicleId = req.params.vehicleId;
    const vehicle = getVehicleById(vehicleId);
    if (!vehicle) {
      throw createError(404, "Veículo não encontrado");
    }
    ensureSameClient(req, vehicle.clientId);
    const correlationId = req.headers["x-correlation-id"] || null;

    const {
      sortedDeployments,
      lastEmbark,
      itinerariesById,
      geofencesById,
      routesById,
      groupLookup,
    } = await resolveOverlayContext({ vehicle });

    const latestEmbark = sortedDeployments.find(
      (deployment) => normalizeDeploymentAction(deployment.action) === "EMBARK",
    );

    if (!latestEmbark) {
      return res.json({
        data: { status: "NONE", attemptAt: null, itinerary: null },
        error: null,
      });
    }

    const detail = await buildVehicleEmbarkDetail({
      vehicle,
      deployment: latestEmbark,
      lastEmbark,
      itinerariesById,
      geofencesById,
      routesById,
      groupLookup,
      correlationId,
    });

    const items = Array.isArray(detail?.items) ? detail.items : [];
    const geometry = buildOverlayGeometry(items, routesById);
    const hasGeometry = Boolean(geometry?.route) || (geometry?.geofences?.length ?? 0) > 0 || (geometry?.checkpoints?.length ?? 0) > 0;

    if (!hasGeometry) {
      return res.json({
        data: { status: "NONE", attemptAt: null, itinerary: null },
        error: null,
      });
    }

    const { status, statusMessage } = resolveOverlayStatusV2({
      detail,
      deployment: latestEmbark,
      fallbackToDeployment: true,
    });
    const snapshotItinerary = detail?.lastSnapshot?.itinerary || null;
    const storedItinerary = detail?.itineraryId ? itinerariesById.get(String(detail.itineraryId)) : null;
    const resolvedItinerary = storedItinerary || snapshotItinerary || null;
    const attemptAt =
      latestEmbark?.startedAt || latestEmbark?.confirmedAt || latestEmbark?.finishedAt || null;

    const itineraryPayload =
      resolvedItinerary || detail?.itineraryId || detail?.itineraryName
        ? {
            id: resolvedItinerary?.id ? String(resolvedItinerary.id) : detail?.itineraryId || null,
            name: resolvedItinerary?.name || detail?.itineraryName || "Itinerário",
            updatedAt: resolvedItinerary?.updatedAt || latestEmbark?.startedAt || null,
            attemptAt,
            bufferMeters: geometry?.bufferMeters ?? DEFAULT_OVERLAY_BUFFER_METERS,
            route: geometry?.route || null,
            geofences: geometry?.geofences || [],
            checkpoints: geometry?.checkpoints || [],
          }
        : null;

    return res.json({
      data: {
        status,
        statusMessage,
        attemptAt,
        itinerary: itineraryPayload,
      },
      error: null,
    });
  } catch (error) {
    return next(error);
  }
  },
);

router.get(
  "/itineraries/:id/overlay",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries" }),
  async (req, res, next) => {
  try {
    const itinerary = getItineraryById(req.params.id);
    if (!itinerary) {
      throw createError(404, "Itinerário não encontrado");
    }
    ensureSameClient(req, itinerary.clientId);
    const clientId = itinerary.clientId || null;
    const geofences = await listGeofences(clientId ? { clientId } : {});
    const routes = listRoutes(clientId ? { clientId } : {});
    const geofencesById = new Map(geofences.map((geofence) => [String(geofence.id), geofence]));
    const routesById = new Map(routes.map((route) => [String(route.id), route]));
    const items = buildOverlayItemsFromItinerary({ itinerary, geofencesById, routesById });
    const geometry = buildOverlayGeometry(items, routesById);

    return res.json({
      data: {
        itineraryId: String(itinerary.id),
        route: geometry?.route || null,
        geofences: geometry?.geofences || [],
        checkpoints: geometry?.checkpoints || [],
        bufferMeters: geometry?.bufferMeters ?? DEFAULT_OVERLAY_BUFFER_METERS,
      },
      error: null,
    });
  } catch (error) {
    return next(error);
  }
  },
);

router.get(
  "/itineraries/embark/vehicles/:vehicleId/history",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries" }),
  async (req, res, next) => {
  try {
    const vehicleId = req.params.vehicleId;
    const vehicle = getVehicleById(vehicleId);
    if (!vehicle) {
      throw createError(404, "Veículo não encontrado");
    }
    ensureSameClient(req, vehicle.clientId);

    const history = listVehicleEmbarkHistory({ vehicle: vehicle, from: req.query?.from, to: req.query?.to });
    history.sort((a, b) => {
      const aTime = new Date(a.sentAt || a.deviceConfirmedAt || a.receivedAt || 0).getTime();
      const bTime = new Date(b.sentAt || b.deviceConfirmedAt || b.receivedAt || 0).getTime();
      return bTime - aTime;
    });

    return res.json({ data: history, error: null });
  } catch (error) {
    return next(error);
  }
  },
);

router.get(
  "/itineraries/:id/embark/history",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries" }),
  async (req, res, next) => {
  try {
    const itinerary = getItineraryById(req.params.id);
    if (!itinerary) {
      throw createError(404, "Itinerário não encontrado");
    }
    ensureSameClient(req, itinerary.clientId);

    const deployments = listDeployments({ clientId: itinerary.clientId }).filter(
      (deployment) => String(deployment.itineraryId) === String(itinerary.id),
    );
    const vehicles = (await resolveAccessibleVehicleList(req, itinerary.clientId)).reduce((acc, vehicle) => {
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
  },
);

router.post(
  "/itineraries/:itineraryId/embark",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries", requireFull: true }),
  async (req, res, next) => {
  try {
    const itineraryId = req.params.itineraryId;
    const itinerary = getItineraryById(itineraryId);
    if (!itinerary) {
      throw createError(404, "Itinerário não encontrado");
    }
    const clientId = resolveTargetClient(req, req.body?.clientId || itinerary.clientId, { required: true });
    ensureSameClient(req, clientId);

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
  },
);

router.post(
  "/itineraries/:itineraryId/disembark",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries", requireFull: true }),
  async (req, res, next) => {
  try {
    const operationId = req.headers["x-correlation-id"] || crypto.randomUUID();
    const itineraryId = req.params.itineraryId;
    const itinerary = getItineraryById(itineraryId);
    if (!itinerary) {
      throw createError(404, "Itinerário não encontrado");
    }
    const clientId = resolveTargetClient(req, req.body?.clientId || itinerary.clientId, { required: true });
    ensureSameClient(req, clientId);

    const vehicleIds = Array.isArray(req.body?.vehicleIds)
      ? Array.from(new Set(req.body.vehicleIds.map(String)))
      : [];
    const dryRun = Boolean(req.body?.dryRun);

    console.info("[itineraries] solicitando desembarque", {
      operationId,
      itineraryId: String(itineraryId),
      clientId: String(clientId),
      vehicleCount: vehicleIds.length,
      requestedBy: req.user?.id || null,
      ipAddress: resolveRequestIp(req),
    });

    const response = await disembarkItinerary({
      clientId,
      itineraryId,
      vehicleIds,
      dryRun,
      correlationId: operationId,
      requestedByUserId: req.user?.id || null,
      requestedByName: req.user?.name || req.user?.email || req.user?.username || req.user?.id || "Usuário",
      ipAddress: resolveRequestIp(req),
    });

    console.info("[itineraries] desembarcado com sucesso", {
      operationId,
      itineraryId: String(itineraryId),
      vehicles: response?.vehicles?.length || 0,
    });

    return res.status(201).json({ data: { ...response, operationId }, error: null });
  } catch (error) {
    return next(error);
  }
  },
);

router.post(
  "/itineraries/disembark",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries", requireFull: true }),
  async (req, res, next) => {
  try {
    const operationId = req.headers["x-correlation-id"] || crypto.randomUUID();
    const clientId = resolveTargetClient(req, req.body?.clientId, { required: true });
    const mirrorAllClientIds = resolveMirrorAllClientIds(req);
    const isMirrorAll = Array.isArray(mirrorAllClientIds);
    const vehicleIds = Array.isArray(req.body?.vehicleIds)
      ? Array.from(new Set(req.body.vehicleIds.map(String)))
      : [];
    const itineraryIds = Array.isArray(req.body?.itineraryIds)
      ? Array.from(new Set(req.body.itineraryIds.map(String)))
      : [];
    if (!itineraryIds.length) {
      throw createError(400, "Informe itinerários para desembarcar");
    }

    const dryRun = Boolean(req.body?.dryRun);
    const cleanupOptions = req.body?.options?.cleanup || {};
    const cleanupGroups = Boolean(cleanupOptions?.deleteGeozoneGroup);
    const cleanupGeozones = Boolean(cleanupOptions?.deleteGeozones);

    const ipAddress = resolveRequestIp(req);
    const userLabel = req.user?.name || req.user?.email || req.user?.username || req.user?.id || "Usuário";
    const correlationId = operationId;

    console.info("[itineraries] solicitando desembarque em lote", {
      operationId,
      clientId: String(clientId),
      itineraryCount: itineraryIds.length,
      vehicleCount: vehicleIds.length,
      requestedBy: req.user?.id || null,
      ipAddress,
    });

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
      if (itinerary.clientId && String(itinerary.clientId) !== String(clientId)) {
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
        console.warn("[itineraries] falha no desembarque em lote", {
          operationId,
          itineraryId: String(itinerary.id),
          message: error?.message || error,
        });
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
          console.warn("[itineraries] falha ao desembarcar veículo", {
            operationId,
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

    return res.status(201).json({ data: { summary, results, cleanup, operationId }, error: null });
  } catch (error) {
    return next(error);
  }
  },
);

router.post(
  "/itineraries/embark",
  authorizePermission({ menuKey: "fleet", pageKey: "itineraries", requireFull: true }),
  async (req, res, next) => {
  try {
    const clientId = resolveTargetClient(req, req.body?.clientId, { required: true });
    const mirrorAllClientIds = resolveMirrorAllClientIds(req);
    const isMirrorAll = Array.isArray(mirrorAllClientIds);
    const vehicleIds = Array.isArray(req.body?.vehicleIds) ? req.body.vehicleIds.map(String) : [];
    const itineraryIds = Array.isArray(req.body?.itineraryIds) ? req.body.itineraryIds.map(String) : [];
    if (!vehicleIds.length || !itineraryIds.length) {
      throw createError(400, "Informe veículos e itinerários para embarcar");
    }

    const bufferMetersRaw = req.body?.xdmBufferMeters ?? req.body?.bufferMeters ?? null;
    const bufferMeters = bufferMetersRaw == null ? null : Number(bufferMetersRaw);
    const ipAddress = resolveRequestIp(req);
    const userLabel = req.user?.name || req.user?.email || req.user?.username || req.user?.id || "Usuário";

    const vehicles = (await resolveAccessibleVehicleList(req, clientId)).reduce((acc, vehicle) => {
      acc.set(String(vehicle.id), vehicle);
      return acc;
    }, new Map());
    const geofenceCache = new Map();
    const routeCache = new Map();
    const snapshotByContext = new Map();
    const missingItemsByContext = new Map();
    const resolveMapsForClient = async (targetClientId) => {
      const key = targetClientId ? String(targetClientId) : "";
      if (!key) {
        return { geofencesById: new Map(), routesById: new Map() };
      }
      if (!geofenceCache.has(key)) {
        const geofences = await listGeofences({ clientId: key });
        geofenceCache.set(key, new Map(geofences.map((geofence) => [String(geofence.id), geofence])));
      }
      if (!routeCache.has(key)) {
        const routes = listRoutes({ clientId: key });
        routeCache.set(key, new Map(routes.map((route) => [String(route.id), route])));
      }
      return { geofencesById: geofenceCache.get(key), routesById: routeCache.get(key) };
    };
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

    if (!isMirrorAll) {
      await resolveMapsForClient(clientId);
    }

    const entries = [];
    const failureEntries = [];
    let success = 0;
    let failed = 0;

    for (const vehicleId of vehicleIds) {
      const vehicle = vehicles.get(String(vehicleId)) || getVehicleById(vehicleId);
      for (const itineraryId of itineraryIds) {
        const itinerary = itinerariesById.get(String(itineraryId)) || getItineraryById(itineraryId);
        const entryClientId =
          isMirrorAll && vehicle?.clientId ? String(vehicle.clientId) : String(clientId);
        const snapshotKey = `${itineraryId}:${entryClientId || ""}`;
        let snapshot = snapshotByContext.get(snapshotKey) || null;
        let missingItem = missingItemsByContext.get(snapshotKey) || null;
        if (!snapshot && !missingItem && itinerary) {
          const { geofencesById, routesById } = await resolveMapsForClient(entryClientId);
          missingItem = findMissingItineraryItem({ itinerary, geofencesById, routesById });
          if (missingItem) {
            missingItemsByContext.set(snapshotKey, missingItem);
          } else {
            snapshot = buildItinerarySnapshot({
              itinerary,
              geofencesById,
              routesById,
              action: "EMBARK",
              requestedByName: userLabel,
            });
            snapshotByContext.set(snapshotKey, snapshot);
          }
        }
        const entryBase = {
          clientId: entryClientId,
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
          const result = "Itinerário não encontrado";
          entries.push({ ...entryBase, status: "Falhou", result });
          failureEntries.push({
            ...entryBase,
            status: "ERROR",
            statusLabel: "FALHOU (ENVIO)",
            action: "EMBARK",
            result,
            details: result,
          });
          continue;
        }
        if (missingItem) {
          failed += 1;
          const result = missingItem.message;
          entries.push({ ...entryBase, status: "Falhou", result });
          failureEntries.push({
            ...entryBase,
            status: "ERROR",
            statusLabel: "FALHOU (ENVIO)",
            action: "EMBARK",
            result,
            details: result,
          });
          continue;
        }
        if (itinerary.clientId && String(itinerary.clientId) !== String(entryClientId)) {
          failed += 1;
          const result = "Itinerário não pertence ao cliente";
          entries.push({ ...entryBase, status: "Falhou", result });
          failureEntries.push({
            ...entryBase,
            status: "ERROR",
            statusLabel: "FALHOU (ENVIO)",
            action: "EMBARK",
            result,
            details: result,
          });
          continue;
        }
        const vehicleMatchesClient =
          vehicle &&
          (isMirrorAll
            ? mirrorAllClientIds?.some((id) => String(id) === String(vehicle.clientId))
            : String(vehicle.clientId) === String(clientId));
        if (!vehicle || !vehicleMatchesClient) {
          failed += 1;
          const result = "Veículo não encontrado para o cliente";
          entries.push({ ...entryBase, status: "Falhou", result });
          failureEntries.push({
            ...entryBase,
            status: "ERROR",
            statusLabel: "FALHOU (ENVIO)",
            action: "EMBARK",
            result,
            details: result,
          });
          continue;
        }

        const { deployment, status } = queueDeployment({
          clientId: entryClientId,
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
    if (failureEntries.length) {
      addEmbarkEntries(failureEntries);
    }
    return res.status(201).json({ data: { entries, summary: { success, failed } }, error: null });
  } catch (error) {
    return next(error);
  }
  },
);

router.get("/deployments/:id", async (req, res, next) => {
  try {
    const deployment = getDeploymentById(req.params.id);
    if (!deployment) {
      throw createError(404, "Deploy não encontrado");
    }
    ensureSameClient(req, deployment.clientId);
    return res.json({ data: deployment, error: null });
  } catch (error) {
    return next(error);
  }
});

export default router;
