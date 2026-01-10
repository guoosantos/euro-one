import crypto from "node:crypto";

import { buildGeofencesKml, approximateCirclePoints } from "../../utils/kml.js";
import { getClientById } from "../../models/client.js";
import { getGeofenceById } from "../../models/geofence.js";
import { getGeofenceMapping, upsertGeofenceMapping } from "../../models/xdm-geofence.js";
import XdmClient from "./xdm-client.js";

const MAX_POINTS = Number(process.env.XDM_GEOFENCE_MAX_POINTS) || 200;
const MIN_POINTS = 4;

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

  const cleaned = points
    .filter((pair) => Array.isArray(pair) && pair.length >= 2)
    .map(([lat, lon]) => [roundPoint(lat), roundPoint(lon)])
    .slice(0, MAX_POINTS);

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
  const geometryHash = buildGeometryHash(normalizedPoints);

  const mapping = getGeofenceMapping({ geofenceId, clientId: geofence.clientId });
  if (mapping?.xdmGeofenceId && mapping.geometryHash === geometryHash) {
    return mapping.xdmGeofenceId;
  }

  const clientLabel = await resolveClientLabel(geofence.clientId);
  const xdmName = buildXdmName({ clientLabel, name: geofence.name });

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

  const createdIds = await xdmClient.request("POST", "/api/external/v1/geozones/import", form, { correlationId });
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
