import XdmClient from "./xdm-client.js";
import { buildGeofenceKml, buildGeometryHash, normalizePolygon } from "./geofence-sync-service.js";
import { getRouteById } from "../../models/route.js";
import {
  getRouteGeozoneMapping,
  upsertRouteGeozoneMapping,
} from "../../models/xdm-route-geozone.js";
import { wrapXdmError } from "./xdm-error.js";
import {
  buildFriendlyName,
  resolveClientDisplayName,
  resolveXdmNameConfig,
  sanitizeFriendlyName,
} from "./xdm-name-utils.js";
import { normalizeXdmId } from "./xdm-utils.js";

const DEFAULT_BUFFER_METERS = 50;

function sanitizeName(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function metersToLatDegrees(meters) {
  return meters / 111_320;
}

function metersToLonDegrees(meters, latitude) {
  const latRad = (Number(latitude) * Math.PI) / 180;
  const denominator = 111_320 * Math.cos(latRad);
  if (!Number.isFinite(denominator) || denominator === 0) return meters / 111_320;
  return meters / denominator;
}

function buildRoutePolygon(points = [], bufferMeters = DEFAULT_BUFFER_METERS) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error("Rota inválida: pontos insuficientes");
  }
  const latitudes = points.map(([lat]) => Number(lat)).filter((value) => Number.isFinite(value));
  const longitudes = points.map(([, lon]) => Number(lon)).filter((value) => Number.isFinite(value));
  if (!latitudes.length || !longitudes.length) {
    throw new Error("Rota inválida: coordenadas inválidas");
  }

  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);
  const centerLat = (minLat + maxLat) / 2;
  const latPadding = metersToLatDegrees(bufferMeters);
  const lonPadding = metersToLonDegrees(bufferMeters, centerLat);

  return [
    [minLat - latPadding, minLon - lonPadding],
    [minLat - latPadding, maxLon + lonPadding],
    [maxLat + latPadding, maxLon + lonPadding],
    [maxLat + latPadding, minLon - lonPadding],
  ];
}

function buildXdmName({ clientId, clientDisplayName, routeId, routeName }) {
  const { friendlyNamesEnabled, maxNameLength } = resolveXdmNameConfig();
  if (friendlyNamesEnabled) {
    const resolvedClient = resolveClientDisplayName({ clientDisplayName, clientId });
    const resolvedRoute = sanitizeFriendlyName(routeName) || "Rota";
    const friendly = buildFriendlyName([resolvedClient, resolvedRoute], { maxLen: maxNameLength });
    if (friendly) return friendly;
  }
  const safeClient = sanitizeName(clientId) || "CLIENT";
  const safeRouteId = sanitizeName(routeId) || "ROUTE";
  const safeName = sanitizeName(routeName) || "ROUTE";
  return `EUROONE_${safeClient}_${safeRouteId}_ROUTE_${safeName}`;
}

async function updateGeozoneName({ xdmGeozoneId, name, correlationId }) {
  if (!xdmGeozoneId) return;
  const normalizedId = normalizeXdmId(xdmGeozoneId, { context: "update route geozone name" });
  const xdmClient = new XdmClient();
  try {
    await xdmClient.request(
      "PUT",
      `/api/external/v1/geozones/${normalizedId}`,
      { id: Number(normalizedId), name },
      { correlationId },
    );
  } catch (error) {
    throw wrapXdmError(error, {
      step: "updateRouteGeozoneName",
      correlationId,
      payloadSample: { xdmGeozoneId: normalizedId, name },
    });
  }
}

export async function syncRouteGeozone(
  routeId,
  { clientId, correlationId, route: routeOverride, bufferMeters = DEFAULT_BUFFER_METERS, clientDisplayName = null } = {},
) {
  const route = routeOverride || (await getRouteById(routeId));
  if (!route) {
    throw new Error("Rota não encontrada");
  }
  if (clientId && String(route.clientId) !== String(clientId)) {
    throw new Error("Rota não pertence ao cliente");
  }

  const polygonPoints = buildRoutePolygon(route.points || [], bufferMeters);
  const normalizedPoints = normalizePolygon({ points: polygonPoints }, { geofenceId: route.id, clientId: route.clientId });
  const geometryHash = buildGeometryHash(normalizedPoints);

  const mapping = getRouteGeozoneMapping({ routeId, clientId: route.clientId });
  const xdmName = buildXdmName({
    clientId: route.clientId,
    clientDisplayName,
    routeId: route.id,
    routeName: route.name,
  });
  if (mapping?.xdmGeozoneId && mapping.geometryHash === geometryHash) {
    const normalizedId = normalizeXdmId(mapping.xdmGeozoneId, { context: "mapping route geozone" });
    if (mapping.name !== xdmName) {
      await updateGeozoneName({ xdmGeozoneId: normalizedId, name: xdmName, correlationId });
      upsertRouteGeozoneMapping({
        routeId: route.id,
        clientId: route.clientId,
        geometryHash,
        xdmGeozoneId: normalizedId,
        name: xdmName,
      });
    }
    return { xdmGeozoneId: normalizedId, geometryHash };
  }
  const kml = buildGeofenceKml({ name: xdmName, points: normalizedPoints });
  const form = new FormData();
  form.append("files", new Blob([kml], { type: "application/vnd.google-earth.kml+xml" }), `${xdmName}.kml`);

  const xdmClient = new XdmClient();
  if (mapping?.xdmGeozoneId && mapping.geometryHash !== geometryHash) {
    try {
      await xdmClient.request("DELETE", `/api/external/v1/geozones/${mapping.xdmGeozoneId}`, null, { correlationId });
    } catch (error) {
      console.warn("[xdm] falha ao remover geozone da rota", {
        correlationId,
        routeId,
        xdmGeozoneId: mapping.xdmGeozoneId,
        message: error?.message || error,
      });
    }
  }

  let createdIds;
  try {
    createdIds = await xdmClient.request("POST", "/api/external/v1/geozones/import", form, { correlationId });
  } catch (error) {
    throw wrapXdmError(error, {
      step: "createRouteGeozone",
      correlationId,
      payloadSample: {
        routeId: route.id,
        clientId: route.clientId,
        name: xdmName,
      },
    });
  }
  const xdmGeozoneId = Array.isArray(createdIds) ? createdIds[0] : null;

  if (!xdmGeozoneId) {
    throw new Error("XDM não retornou id da geozone da rota");
  }

  upsertRouteGeozoneMapping({
    routeId: route.id,
    clientId: route.clientId,
    geometryHash,
    xdmGeozoneId,
    name: xdmName,
  });

  return { xdmGeozoneId, geometryHash };
}

export default {
  syncRouteGeozone,
};
