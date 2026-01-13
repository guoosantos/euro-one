import XdmClient from "./xdm-client.js";
import { buildGeofenceKml, buildGeometryHash, normalizePolygon } from "./geofence-sync-service.js";
import { getRouteById, listRoutes } from "../../models/route.js";
import {
  getRouteGeozoneMapping,
  upsertRouteGeozoneMapping,
} from "../../models/xdm-route-geozone.js";
import { wrapXdmError } from "./xdm-error.js";
import {
  buildFriendlyNameWithSuffix,
  buildShortIdSuffix,
  resolveClientDisplayName,
  resolveXdmNameConfig,
  sanitizeFriendlyName,
} from "./xdm-name-utils.js";
import { normalizeXdmId } from "./xdm-utils.js";

const DEFAULT_BUFFER_METERS = 150;
const DEFAULT_SIMPLIFY_METERS = 20;
const DEFAULT_POLYGON_SIMPLIFY_METERS = 10;
const DEFAULT_SEGMENT_METERS = 15000;
const DEFAULT_CAP_SEGMENTS = 8;
const MIN_SEGMENT_METERS = 1000;

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

function parsePositiveNumber(value, fallback) {
  if (value == null) return fallback;
  const trimmed = String(value).trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveRouteConfig(overrides = {}) {
  const maxPoints = parsePositiveNumber(process.env.XDM_GEOFENCE_MAX_POINTS, Infinity);
  return {
    bufferMeters: parsePositiveNumber(overrides.bufferMeters, parsePositiveNumber(process.env.XDM_ROUTE_BUFFER_METERS, DEFAULT_BUFFER_METERS)),
    simplifyMeters: parsePositiveNumber(overrides.simplifyMeters, parsePositiveNumber(process.env.XDM_ROUTE_SIMPLIFY_METERS, DEFAULT_SIMPLIFY_METERS)),
    polygonSimplifyMeters: parsePositiveNumber(
      overrides.polygonSimplifyMeters,
      parsePositiveNumber(process.env.XDM_ROUTE_POLYGON_SIMPLIFY_METERS, DEFAULT_POLYGON_SIMPLIFY_METERS),
    ),
    segmentMeters: parsePositiveNumber(overrides.segmentMeters, parsePositiveNumber(process.env.XDM_ROUTE_SEGMENT_METERS, DEFAULT_SEGMENT_METERS)),
    capSegments: Math.max(4, Math.round(parsePositiveNumber(overrides.capSegments, parsePositiveNumber(process.env.XDM_ROUTE_CAP_SEGMENTS, DEFAULT_CAP_SEGMENTS)))),
    maxPoints: Number.isFinite(overrides.maxPoints) ? overrides.maxPoints : maxPoints,
  };
}

function toMeters(point, referenceLat) {
  const [lat, lon] = point;
  const metersPerLon = 111_320 * Math.cos((referenceLat * Math.PI) / 180);
  return [lon * metersPerLon, lat * 111_320];
}

function distanceToSegmentMeters(point, segmentStart, segmentEnd, referenceLat) {
  const [px, py] = toMeters(point, referenceLat);
  const [sx, sy] = toMeters(segmentStart, referenceLat);
  const [ex, ey] = toMeters(segmentEnd, referenceLat);
  const dx = ex - sx;
  const dy = ey - sy;
  if (!dx && !dy) {
    return Math.hypot(px - sx, py - sy);
  }
  const t = ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  const closestX = sx + clamped * dx;
  const closestY = sy + clamped * dy;
  return Math.hypot(px - closestX, py - closestY);
}

function simplifyRdp(points, toleranceMeters) {
  if (!Array.isArray(points) || points.length < 3 || toleranceMeters <= 0) {
    return points;
  }
  const referenceLat = points.reduce((acc, [lat]) => acc + lat, 0) / points.length;

  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let maxDistance = 0;
    let index = 0;
    for (let i = start + 1; i < end; i += 1) {
      const distance = distanceToSegmentMeters(points[i], points[start], points[end], referenceLat);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }
    if (maxDistance > toleranceMeters && index) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }

  return points.filter((_point, idx) => keep[idx]);
}

function simplifyPolygon(points, toleranceMeters) {
  if (!Array.isArray(points) || points.length < 4 || toleranceMeters <= 0) return points;
  const ring = points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1]
    ? points.slice(0, -1)
    : points;
  const simplified = simplifyRdp(ring, toleranceMeters);
  return [...simplified, simplified[0]];
}

function distanceMeters(a, b) {
  const latMid = (a[0] + b[0]) / 2;
  const metersPerLon = 111_320 * Math.cos((latMid * Math.PI) / 180);
  const dx = (b[1] - a[1]) * metersPerLon;
  const dy = (b[0] - a[0]) * 111_320;
  return Math.hypot(dx, dy);
}

function resolveSegmentNormal([latA, lonA], [latB, lonB]) {
  const midLat = (latA + latB) / 2;
  const metersPerLon = 111_320 * Math.cos((midLat * Math.PI) / 180);
  const metersPerLat = 111_320;
  const dx = (lonB - lonA) * metersPerLon;
  const dy = (latB - latA) * metersPerLat;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length === 0) {
    return { x: 0, y: 0 };
  }
  return { x: -dy / length, y: dx / length };
}

function normalizeVector(vector) {
  if (!vector) return { x: 0, y: 0 };
  const length = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(length) || length === 0) {
    return { x: 0, y: 0 };
  }
  return { x: vector.x / length, y: vector.y / length };
}

function buildOffsetPoints(points, bufferMeters) {
  const segmentNormals = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    segmentNormals.push(resolveSegmentNormal(points[i], points[i + 1]));
  }

  return points.map(([lat, lon], index) => {
    let normal = null;
    if (index === 0) {
      normal = segmentNormals[0];
    } else if (index === points.length - 1) {
      normal = segmentNormals[segmentNormals.length - 1];
    } else {
      const prev = segmentNormals[index - 1];
      const next = segmentNormals[index];
      normal = normalizeVector({
        x: (prev?.x || 0) + (next?.x || 0),
        y: (prev?.y || 0) + (next?.y || 0),
      });
      if (!normal.x && !normal.y) {
        normal = prev || next;
      }
    }

    const metersPerLon = 111_320 * Math.cos((lat * Math.PI) / 180);
    const latOffset = (normal?.y || 0) * bufferMeters / 111_320;
    const lonOffset = (normal?.x || 0) * bufferMeters / (metersPerLon || 111_320);
    return {
      left: [lat + latOffset, lon + lonOffset],
      right: [lat - latOffset, lon - lonOffset],
    };
  });
}

function buildCapPoints(center, start, end, segments) {
  if (segments <= 1) return [start, end];
  const referenceLat = center[0];
  const metersPerLon = 111_320 * Math.cos((referenceLat * Math.PI) / 180);
  const toLocal = ([lat, lon]) => [lon * metersPerLon, lat * 111_320];
  const toGeo = ([x, y]) => [y / 111_320, x / metersPerLon];

  const [cx, cy] = toLocal(center);
  const [sx, sy] = toLocal(start);
  const [ex, ey] = toLocal(end);
  const startAngle = Math.atan2(sy - cy, sx - cx);
  let endAngle = Math.atan2(ey - cy, ex - cx);
  let delta = endAngle - startAngle;
  if (delta <= 0) {
    delta += Math.PI * 2;
  }
  const step = delta / segments;
  const radius = Math.hypot(sx - cx, sy - cy);
  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = startAngle + step * i;
    points.push(toGeo([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]));
  }
  return points;
}

function buildRouteCorridor(points, { bufferMeters, capSegments }) {
  const offsets = buildOffsetPoints(points, bufferMeters);
  const leftSide = offsets.map((entry) => entry.left);
  const rightSide = offsets.map((entry) => entry.right);
  const startCap = buildCapPoints(points[0], rightSide[0], leftSide[0], capSegments);
  const endCap = buildCapPoints(points[points.length - 1], leftSide[leftSide.length - 1], rightSide[rightSide.length - 1], capSegments);
  const polygon = [...leftSide, ...endCap.slice(1, -1), ...rightSide.reverse(), ...startCap.slice(1, -1)];
  return polygon.filter((point, index) => {
    if (!index) return true;
    const [prevLat, prevLon] = polygon[index - 1];
    return point[0] !== prevLat || point[1] !== prevLon;
  });
}

function normalizeRoutePoints(points = []) {
  return points
    .map(([lat, lon]) => [Number(lat), Number(lon)])
    .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
}

function splitRouteByDistance(points, segmentMeters) {
  if (points.length < 2) return [points];
  const segments = [];
  let current = [points[0]];
  let length = 0;

  for (let i = 1; i < points.length; i += 1) {
    const next = points[i];
    const prev = current[current.length - 1];
    const delta = distanceMeters(prev, next);
    if (length + delta > segmentMeters && current.length >= 2) {
      segments.push(current);
      current = [prev, next];
      length = delta;
      continue;
    }
    current.push(next);
    length += delta;
  }

  if (current.length >= 2) {
    segments.push(current);
  }
  return segments;
}

function buildRoutePolygons(points, config) {
  const {
    bufferMeters,
    simplifyMeters,
    polygonSimplifyMeters,
    segmentMeters,
    capSegments,
    maxPoints,
  } = config;
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error("Rota inválida: pontos insuficientes");
  }
  const normalizedPoints = normalizeRoutePoints(points);
  if (normalizedPoints.length < 2) {
    throw new Error("Rota inválida: coordenadas inválidas");
  }

  const simplifiedRoute = simplifyRdp(normalizedPoints, simplifyMeters);
  const basePolygon = buildRouteCorridor(simplifiedRoute, { bufferMeters, capSegments });
  const simplifiedPolygon = simplifyPolygon(basePolygon, polygonSimplifyMeters);

  if (!Number.isFinite(maxPoints) || simplifiedPolygon.length <= maxPoints) {
    return [simplifiedPolygon];
  }

  let segmentSize = Math.max(segmentMeters, MIN_SEGMENT_METERS);
  while (segmentSize >= MIN_SEGMENT_METERS) {
    const segments = splitRouteByDistance(simplifiedRoute, segmentSize);
    const segmentPolygons = segments.map((segment) => {
      const corridor = buildRouteCorridor(segment, { bufferMeters, capSegments });
      return simplifyPolygon(corridor, polygonSimplifyMeters);
    });
    const exceeds = segmentPolygons.some((polygon) => polygon.length > maxPoints);
    if (!exceeds) {
      return segmentPolygons;
    }
    segmentSize = Math.floor(segmentSize / 2);
  }

  throw new Error("Corredor de rota excede o limite de pontos do XDM. Ajuste a simplificação ou segmente a rota.");
}

function shouldAddRouteSuffix({ clientId, routeId, routeName }) {
  if (!clientId || !routeName) return false;
  const normalizedName = sanitizeFriendlyName(routeName).toLowerCase();
  if (!normalizedName) return false;
  const duplicates = listRoutes({ clientId }).filter((item) => {
    if (!item?.name) return false;
    if (String(item.id) === String(routeId)) return false;
    return sanitizeFriendlyName(item.name).toLowerCase() === normalizedName;
  });
  return duplicates.length > 0;
}

function buildXdmName({ clientId, clientDisplayName, routeId, routeName, withSuffix = false }) {
  const { friendlyNamesEnabled, maxNameLength } = resolveXdmNameConfig();
  if (friendlyNamesEnabled) {
    const resolvedClient = resolveClientDisplayName({ clientDisplayName, clientId });
    const resolvedRoute = sanitizeFriendlyName(routeName) || "Rota";
    const suffix = withSuffix ? buildShortIdSuffix(routeId) : "";
    const friendly = buildFriendlyNameWithSuffix([resolvedClient, resolvedRoute], { maxLen: maxNameLength, suffix });
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
  {
    clientId,
    correlationId,
    route: routeOverride,
    bufferMeters,
    simplifyMeters,
    polygonSimplifyMeters,
    segmentMeters,
    capSegments,
    maxPoints,
    clientDisplayName = null,
  } = {},
) {
  const route = routeOverride || (await getRouteById(routeId));
  if (!route) {
    throw new Error("Rota não encontrada");
  }
  if (clientId && String(route.clientId) !== String(clientId)) {
    throw new Error("Rota não pertence ao cliente");
  }

  const metadata = route?.metadata || {};
  const config = resolveRouteConfig({
    bufferMeters: bufferMeters ?? metadata.xdmBufferMeters ?? metadata.bufferMeters,
    simplifyMeters: simplifyMeters ?? metadata.xdmSimplifyMeters ?? metadata.simplifyMeters,
    polygonSimplifyMeters:
      polygonSimplifyMeters ?? metadata.xdmPolygonSimplifyMeters ?? metadata.polygonSimplifyMeters,
    segmentMeters: segmentMeters ?? metadata.xdmSegmentMeters ?? metadata.segmentMeters,
    capSegments: capSegments ?? metadata.xdmCapSegments ?? metadata.capSegments,
    maxPoints,
  });
  const polygons = buildRoutePolygons(route.points || [], config);
  const normalizedPolygons = polygons.map((polygonPoints, index) =>
    normalizePolygon({ points: polygonPoints }, { geofenceId: `${route.id}-${index}`, clientId: route.clientId }),
  );
  const geometryHash = buildGeometryHash(normalizedPolygons.flat());
  const withSuffix = shouldAddRouteSuffix({
    clientId: route.clientId,
    routeId: route.id,
    routeName: route.name,
  });

  const mapping = getRouteGeozoneMapping({ routeId, clientId: route.clientId });
  const baseName = buildXdmName({
    clientId: route.clientId,
    clientDisplayName,
    routeId: route.id,
    routeName: route.name,
    withSuffix,
  });
  const desiredNames = normalizedPolygons.map((_polygon, index) =>
    normalizedPolygons.length === 1 ? baseName : `${baseName} - Trecho ${index + 1}`,
  );
  const mappingIds = Array.isArray(mapping?.xdmGeozoneIds) && mapping.xdmGeozoneIds.length
    ? mapping.xdmGeozoneIds
    : mapping?.xdmGeozoneId
      ? [mapping.xdmGeozoneId]
      : [];

  if (mappingIds.length && mapping.geometryHash === geometryHash && mappingIds.length === desiredNames.length) {
    const normalizedIds = mappingIds.map((id) => normalizeXdmId(id, { context: "mapping route geozone" }));
    const renamed = await Promise.all(
      normalizedIds.map((id, index) => {
        const name = desiredNames[index] || baseName;
        if (mapping.name === name && mappingIds.length === 1) return null;
        return updateGeozoneName({ xdmGeozoneId: id, name, correlationId });
      }),
    );
    if (renamed.some(Boolean)) {
      upsertRouteGeozoneMapping({
        routeId: route.id,
        clientId: route.clientId,
        geometryHash,
        xdmGeozoneIds: normalizedIds,
        xdmGeozoneId: normalizedIds[0],
        name: baseName,
      });
    }
    return { xdmGeozoneId: normalizedIds[0] || null, xdmGeozoneIds: normalizedIds, geometryHash };
  }

  const xdmClient = new XdmClient();
  if (mappingIds.length) {
    await Promise.all(
      mappingIds.map(async (id) => {
        try {
          await xdmClient.request("DELETE", `/api/external/v1/geozones/${id}`, null, { correlationId });
        } catch (error) {
          console.warn("[xdm] falha ao remover geozone da rota", {
            correlationId,
            routeId,
            xdmGeozoneId: id,
            message: error?.message || error,
          });
        }
      }),
    );
  }

  const createdGeozoneIds = [];
  for (let index = 0; index < normalizedPolygons.length; index += 1) {
    const polygonPoints = normalizedPolygons[index];
    const xdmName = desiredNames[index];
    const kml = buildGeofenceKml({ name: xdmName, points: polygonPoints });
    const form = new FormData();
    form.append("files", new Blob([kml], { type: "application/vnd.google-earth.kml+xml" }), `${xdmName}.kml`);

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
    createdGeozoneIds.push(xdmGeozoneId);
  }

  upsertRouteGeozoneMapping({
    routeId: route.id,
    clientId: route.clientId,
    geometryHash,
    xdmGeozoneIds: createdGeozoneIds,
    xdmGeozoneId: createdGeozoneIds[0],
    name: baseName,
  });

  return { xdmGeozoneId: createdGeozoneIds[0], xdmGeozoneIds: createdGeozoneIds, geometryHash };
}

export default {
  syncRouteGeozone,
};
