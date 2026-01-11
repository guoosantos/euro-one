import crypto from "node:crypto";

import { buildGeofencesKml, approximateCirclePoints } from "../../utils/kml.js";
import { getGeofenceById } from "../../models/geofence.js";
import { getGeofenceMapping, upsertGeofenceMapping } from "../../models/xdm-geofence.js";
import XdmClient from "./xdm-client.js";

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

export function normalizePolygon(geometry = {}, { geofenceId = null, clientId = null } = {}) {
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

  if (Number.isFinite(MAX_POINTS) && cleaned.length > MAX_POINTS) {
    console.warn("[xdm] geofence clipped", {
      geofenceId,
      clientId,
      maxPoints: MAX_POINTS,
      originalPoints: cleaned.length,
    });
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

function sanitizeName(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function buildXdmName({ clientId, itineraryId, geofenceId, type, name }) {
  const safeClient = sanitizeName(clientId) || "CLIENT";
  const scopeId = sanitizeName(itineraryId || geofenceId) || "GEOFENCE";
  const safeType = sanitizeName(type) || "GEOFENCE";
  const safeName = sanitizeName(name) || "GEOFENCE";
  return `EUROONE_${safeClient}_${scopeId}_${safeType}_${safeName}`;
}

function isPayloadTooLargeError(error) {
  const status = Number(error?.status || error?.statusCode);
  if (status === 413) return true;
  const message = String(error?.message || "").toLowerCase();
  return message.includes("payload") && message.includes("large");
}

export async function syncGeofence(
  geofenceId,
  { clientId, correlationId, geofence: geofenceOverride, itineraryId = null } = {},
) {
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

  const normalizedPoints = normalizePolygon(geometry, { geofenceId, clientId: geofence.clientId });
  const xdmName = buildXdmName({
    clientId: geofence.clientId,
    itineraryId,
    geofenceId: geofence.id,
    type: geofence.type,
    name: geofence.name,
  });
  const geometryHash = buildGeometryHash(normalizedPoints);
  const mapping = getGeofenceMapping({ geofenceId, clientId: geofence.clientId });
  if (mapping?.xdmGeofenceId && mapping.geometryHash === geometryHash) {
    return mapping.xdmGeofenceId;
  }

  const xdmClient = new XdmClient();
  const kml = buildGeofenceKml({ name: xdmName, points: normalizedPoints });
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

  let createdIds;
  try {
    createdIds = await xdmClient.request("POST", "/api/external/v1/geozones/import", form, { correlationId });
  } catch (error) {
    if (isPayloadTooLargeError(error) && !Number.isFinite(MAX_POINTS)) {
      const sizeError = new Error(
        "XDM rejeitou geofence por tamanho. Ajuste pontos ou habilite XDM_GEOFENCE_MAX_POINTS",
      );
      sizeError.status = 413;
      sizeError.expose = true;
      throw sizeError;
    }
    throw error;
  }
  const xdmGeofenceId = Array.isArray(createdIds) ? createdIds[0] : null;

  if (!xdmGeofenceId) {
    throw new Error("XDM não retornou id da GEOFENCE criada");
  }

  upsertGeofenceMapping({
    geofenceId,
    clientId: geofence.clientId,
    name: xdmName,
    geometry: normalizedPoints,
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
