import crypto from "node:crypto";

import { buildGeofencesKml, approximateCirclePoints } from "../../utils/kml.js";
import { getClientById } from "../../models/client.js";
import { getGeofenceById } from "../../models/geofence.js";
import { getGeofenceMapping, upsertGeofenceMapping } from "../../models/xdm-geofence.js";
import XdmClient from "./xdm-client.js";

const DEFAULT_KML_MAX_BYTES = 500 * 1024;
const MIN_SIMPLIFICATION_POINTS = 20;
const MAX_SIMPLIFICATION_ATTEMPTS = 8;
const MIN_POINTS = 4;

function resolveMaxPoints(value) {
  if (value == null) return Infinity;
  const trimmed = String(value).trim();
  if (!trimmed) return Infinity;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return Infinity;
  return parsed;
}

const MAX_POINTS = resolveMaxPoints(process.env.XDM_GEOFENCE_MAX_POINTS);

function roundPoint(value) {
  return Number(Number(value).toFixed(6));
}

function closePolygon(points) {
  if (!points.length) return points;
  const [firstLat, firstLon] = points[0];
  const [lastLat, lastLon] = points[points.length - 1];
  if (firstLat === lastLat && firstLon === lastLon) return points;
  return [...points, [firstLat, firstLon]];
}

export function normalizePolygon(geometry = {}) {
  let points = [];
  if (geometry?.type === "circle") {
    const center = geometry.center || [geometry.latitude, geometry.longitude];
    points = approximateCirclePoints([Number(center[0]), Number(center[1])], Number(geometry.radius || 0));
  } else if (Array.isArray(geometry?.points)) {
    points = geometry.points.map((pair) => [Number(pair[0]), Number(pair[1])]);
  }

  let cleaned = points
    .filter((pair) => Array.isArray(pair) && pair.length >= 2)
    .map(([lat, lon]) => [roundPoint(lat), roundPoint(lon)]);

  if (Number.isFinite(MAX_POINTS)) {
    cleaned = cleaned.slice(0, MAX_POINTS);
  }

  const closed = closePolygon(cleaned);
  if (closed.length < MIN_POINTS) {
    throw new Error("Geofence inválida: pontos insuficientes para polígono");
  }
  return closed;
}

export function buildGeometryHash(points = []) {
  const payload = points.map(([lat, lon]) => `${lat},${lon}`).join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function buildGeofenceKml({ name, points }) {
  return buildGeofencesKml([
    {
      name,
      type: "polygon",
      points,
    },
  ]);
}

async function resolveClientLabel(clientId) {
  if (!clientId) return null;
  const client = await getClientById(clientId);
  const name = client?.name ? String(client.name).trim() : "";
  return name || null;
}

function buildXdmName({ clientLabel, name }) {
  const trimmed = String(name || "").trim();
  if (!clientLabel) return trimmed;
  return `${clientLabel} - ${trimmed || "Geofence"}`;
}

function isClosedPolygon(points = []) {
  if (points.length < 2) return false;
  const [firstLat, firstLon] = points[0];
  const [lastLat, lastLon] = points[points.length - 1];
  return firstLat === lastLat && firstLon === lastLon;
}

function buildOpenPoints(points = []) {
  if (!isClosedPolygon(points)) return points.slice();
  return points.slice(0, -1);
}

function distanceBetweenPoints(point, start) {
  const latDiff = point[0] - start[0];
  const lonDiff = point[1] - start[1];
  return Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
}

function perpendicularDistance(point, start, end) {
  const [startLat, startLon] = start;
  const [endLat, endLon] = end;
  const [pointLat, pointLon] = point;
  const dx = endLon - startLon;
  const dy = endLat - startLat;
  if (dx === 0 && dy === 0) {
    return distanceBetweenPoints(point, start);
  }
  const numerator = Math.abs(dy * pointLon - dx * pointLat + endLon * startLat - endLat * startLon);
  const denominator = Math.sqrt(dx * dx + dy * dy);
  return numerator / denominator;
}

function simplifyDouglasPeucker(points = [], epsilon) {
  if (points.length <= 2) return points.slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];

  while (stack.length) {
    const [startIndex, endIndex] = stack.pop();
    let maxDistance = 0;
    let index = -1;

    for (let i = startIndex + 1; i < endIndex; i += 1) {
      const distance = perpendicularDistance(points[i], points[startIndex], points[endIndex]);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }

    if (index !== -1 && maxDistance > epsilon) {
      keep[index] = true;
      stack.push([startIndex, index], [index, endIndex]);
    }
  }

  return points.filter((_, index) => keep[index]);
}

function estimateBaseTolerance(points = []) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  points.forEach(([lat, lon]) => {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  });

  const span = Math.max(maxLat - minLat, maxLon - minLon);
  return span > 0 ? span / 1000 : 0.00005;
}

function samplePoints(points = [], targetCount) {
  if (points.length <= targetCount) return points.slice();
  const sampled = [];
  const lastIndex = points.length - 1;
  for (let i = 0; i < targetCount; i += 1) {
    const index = Math.round((i * lastIndex) / (targetCount - 1));
    sampled.push(points[index]);
  }
  return sampled;
}

function byteLength(text) {
  return Buffer.byteLength(text, "utf8");
}

function reduceGeofenceSize({ name, points, limitBytes }) {
  const originalKml = buildGeofenceKml({ name, points });
  const originalBytes = byteLength(originalKml);
  if (originalBytes <= limitBytes) {
    return {
      points,
      kml: originalKml,
      bytes: originalBytes,
      simplified: false,
      originalBytes,
    };
  }

  const openPoints = buildOpenPoints(points);
  const minClosedPoints = Math.max(MIN_SIMPLIFICATION_POINTS, MIN_POINTS);
  const minOpenPoints = Math.max(minClosedPoints - 1, 3);
  let best = {
    points,
    kml: originalKml,
    bytes: originalBytes,
  };
  const baseTolerance = estimateBaseTolerance(openPoints);
  let epsilon = baseTolerance;

  for (let attempt = 0; attempt < MAX_SIMPLIFICATION_ATTEMPTS; attempt += 1) {
    if (openPoints.length <= minOpenPoints) break;
    let simplifiedOpen = simplifyDouglasPeucker(openPoints, epsilon);
    if (simplifiedOpen.length < minOpenPoints) {
      simplifiedOpen = samplePoints(openPoints, minOpenPoints);
    }
    const simplifiedClosed = closePolygon(simplifiedOpen);
    const simplifiedKml = buildGeofenceKml({ name, points: simplifiedClosed });
    const simplifiedBytes = byteLength(simplifiedKml);

    if (simplifiedBytes < best.bytes) {
      best = {
        points: simplifiedClosed,
        kml: simplifiedKml,
        bytes: simplifiedBytes,
      };
    }

    if (simplifiedBytes <= limitBytes || simplifiedOpen.length <= minOpenPoints) {
      break;
    }

    epsilon *= 2;
  }

  return {
    points: best.points,
    kml: best.kml,
    bytes: best.bytes,
    simplified: best.bytes < originalBytes,
    originalBytes,
  };
}

export async function syncGeofence(geofenceId, { clientId, correlationId, geofence: geofenceOverride } = {}) {
  const geofence = geofenceOverride || (await getGeofenceById(geofenceId));
  if (!geofence) {
    throw new Error("Geofence não encontrada");
  }
  if (clientId && String(geofence.clientId) !== String(clientId)) {
    throw new Error("Geofence não pertence ao cliente");
  }

  const geometry = {
    type: geofence.type,
    points: geofence.points,
    radius: geofence.radius,
    latitude: geofence.latitude,
    longitude: geofence.longitude,
    center: geofence.center,
  };

  const normalizedPoints = normalizePolygon(geometry);
  const clientLabel = await resolveClientLabel(geofence.clientId);
  const xdmName = buildXdmName({ clientLabel, name: geofence.name });
  const reduced = reduceGeofenceSize({
    name: xdmName,
    points: normalizedPoints,
    limitBytes: DEFAULT_KML_MAX_BYTES,
  });

  if (reduced.simplified) {
    console.warn("[xdm] geofence simplificada por tamanho", {
      correlationId,
      geofenceId,
      clientId: geofence.clientId,
      pointsOriginal: normalizedPoints.length,
      pointsFinal: reduced.points.length,
      bytesOriginal: reduced.originalBytes,
      bytesFinal: reduced.bytes,
    });
  }

  const geometryHash = buildGeometryHash(reduced.points);
  const mapping = getGeofenceMapping({ geofenceId, clientId: geofence.clientId });
  if (mapping?.xdmGeofenceId && mapping.geometryHash === geometryHash) {
    return mapping.xdmGeofenceId;
  }

  const xdmClient = new XdmClient();
  const kml = reduced.kml;
  const form = new FormData();
  form.append("files", new Blob([kml], { type: "application/vnd.google-earth.kml+xml" }), `${xdmName}.kml`);

  if (mapping?.xdmGeofenceId && mapping.geometryHash !== geometryHash) {
    try {
      await xdmClient.request("DELETE", `/api/external/v1/geozones/${mapping.xdmGeofenceId}`, null, {
        correlationId,
      });
    } catch (error) {
      console.warn("[xdm] falha ao remover GEOFENCE anterior", {
        correlationId,
        geofenceId,
        xdmGeofenceId: mapping.xdmGeofenceId,
        message: error?.message || error,
      });
    }
  }

  const createdIds = await xdmClient.request("POST", "/api/external/v1/geozones/import", form, { correlationId });
  const xdmGeofenceId = Array.isArray(createdIds) ? createdIds[0] : null;

  if (!xdmGeofenceId) {
    throw new Error("XDM não retornou id da GEOFENCE criada");
  }

  upsertGeofenceMapping({
    geofenceId,
    clientId: geofence.clientId,
    name: xdmName,
    geometry: reduced.points,
    kmlOriginal: kml,
    geometryHash,
    xdmGeofenceId,
  });

  return xdmGeofenceId;
}

export default {
  normalizePolygon,
  buildGeometryHash,
  syncGeofence,
};
