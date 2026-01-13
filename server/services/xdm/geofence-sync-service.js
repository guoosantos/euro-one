import crypto from "node:crypto";

import { buildGeofencesKml, approximateCirclePoints } from "../../utils/kml.js";
import { getGeofenceById, listGeofences } from "../../models/geofence.js";
import { getGeofenceMapping, upsertGeofenceMapping } from "../../models/xdm-geofence.js";
import XdmClient from "./xdm-client.js";
import { wrapXdmError } from "./xdm-error.js";
import {
  buildFriendlyNameWithSuffix,
  buildShortIdSuffix,
  resolveClientDisplayName,
  resolveXdmNameConfig,
  sanitizeFriendlyName,
  truncateName,
} from "./xdm-name-utils.js";
import { normalizeXdmId } from "./xdm-utils.js";
import { ITINERARY_GEOZONE_GROUPS } from "./xdm-geozone-group-roles.js";

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

export function buildGeofenceKml({ name, description = "", points }) {
  return buildGeofencesKml([
    {
      name,
      description,
      type: "polygon",
      points,
    },
  ]);
}

async function updateGeozoneName({ xdmGeofenceId, name, correlationId }) {
  if (!xdmGeofenceId) return;
  const normalizedId = normalizeXdmId(xdmGeofenceId, { context: "update geozone name" });
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
      step: "updateGeofenceName",
      correlationId,
      payloadSample: { xdmGeofenceId: normalizedId, name },
    });
  }
}

function sanitizeName(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

async function shouldAddGeofenceSuffix({ clientId, geofenceId, name }) {
  if (!clientId || !name) return false;
  const normalizedName = sanitizeFriendlyName(name).toLowerCase();
  if (!normalizedName) return false;
  const geofences = await listGeofences({ clientId });
  const duplicates = geofences.filter((item) => {
    if (!item?.name) return false;
    if (String(item.id) === String(geofenceId)) return false;
    return sanitizeFriendlyName(item.name).toLowerCase() === normalizedName;
  });
  return duplicates.length > 0;
}

function buildXdmName({
  clientId,
  clientDisplayName,
  itineraryId,
  itineraryName,
  geofenceId,
  type,
  name,
  roleKey = null,
  withSuffix = false,
}) {
  const { friendlyNamesEnabled, maxNameLength, geozoneNameMode } = resolveXdmNameConfig();
  const roleLabel = roleKey ? ITINERARY_GEOZONE_GROUPS[roleKey]?.label || null : null;
  const suffixLabel =
    roleKey === ITINERARY_GEOZONE_GROUPS.targets.key
      ? ITINERARY_GEOZONE_GROUPS.targets.label
      : roleKey === ITINERARY_GEOZONE_GROUPS.entry.key
        ? ITINERARY_GEOZONE_GROUPS.entry.label
        : "CERCA";
  if (friendlyNamesEnabled) {
    const resolvedClient = resolveClientDisplayName({ clientDisplayName, clientId });
    const resolvedGeofence = sanitizeFriendlyName(name) || "Geofence";
    const parts = [resolvedClient];
    if (geozoneNameMode === "client_itinerary_geofence" && itineraryName) {
      const resolvedItinerary = sanitizeFriendlyName(itineraryName);
      if (resolvedItinerary) {
        parts.push(resolvedItinerary);
      }
    }
    parts.push(resolvedGeofence);
    const suffix = withSuffix ? buildShortIdSuffix(geofenceId) : "";
    const suffixParts = [suffixLabel || roleLabel, suffix].filter(Boolean).join(" ").trim();
    const friendly = buildFriendlyNameWithSuffix(parts, { maxLen: maxNameLength, suffix: suffixParts });
    if (friendly) return friendly;
  }
  const safeClient = sanitizeName(clientId) || "CLIENT";
  const scopeId = sanitizeName(itineraryId || geofenceId) || "GEOFENCE";
  const safeType = sanitizeName(type) || "GEOFENCE";
  const safeName = sanitizeName(name) || "GEOFENCE";
  const safeRole = suffixLabel || roleLabel ? sanitizeName(suffixLabel || roleLabel) : "";
  return `EUROONE_${safeClient}_${scopeId}_${safeType}_${safeName}${safeRole ? `_${safeRole}` : ""}`;
}

function buildGeofenceDescription({ clientId, geofenceId, itineraryId, geometryHash, roleKey }) {
  const entries = [];
  if (clientId) entries.push(`clientId=${clientId}`);
  if (geofenceId) entries.push(`geofenceId=${geofenceId}`);
  if (itineraryId) entries.push(`itineraryId=${itineraryId}`);
  if (roleKey) entries.push(`role=${roleKey}`);
  if (geometryHash) entries.push(`hash=${geometryHash}`);
  return truncateName(entries.join(", "), 512);
}

function isPayloadTooLargeError(error) {
  const status = Number(error?.status || error?.statusCode);
  if (status === 413) return true;
  const message = String(error?.message || "").toLowerCase();
  return message.includes("payload") && message.includes("large");
}

export async function syncGeofence(
  geofenceId,
  {
    clientId,
    correlationId,
    geofence: geofenceOverride,
    itineraryId = null,
    itineraryName = null,
    clientDisplayName = null,
    roleKey = null,
  } = {},
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
  const withSuffix = await shouldAddGeofenceSuffix({
    clientId: geofence.clientId,
    geofenceId: geofence.id,
    name: geofence.name,
  });
  const xdmName = buildXdmName({
    clientId: geofence.clientId,
    clientDisplayName,
    itineraryId,
    itineraryName,
    geofenceId: geofence.id,
    type: geofence.type,
    name: geofence.name,
    roleKey,
    withSuffix,
  });
  const geometryHash = buildGeometryHash(normalizedPoints);
  const mapping = getGeofenceMapping({ geofenceId, clientId: geofence.clientId });
  if (mapping?.xdmGeofenceId && mapping.geometryHash === geometryHash) {
    const normalizedId = normalizeXdmId(mapping.xdmGeofenceId, { context: "mapping geofence" });
    if (mapping.name !== xdmName) {
      await updateGeozoneName({ xdmGeofenceId: normalizedId, name: xdmName, correlationId });
      upsertGeofenceMapping({
        geofenceId: geofence.id,
        clientId: geofence.clientId,
        geometryHash,
        xdmGeofenceId: normalizedId,
        name: xdmName,
      });
    }
    return normalizedId;
  }

  const xdmClient = new XdmClient();
  const kml = buildGeofenceKml({
    name: xdmName,
    description: buildGeofenceDescription({
      clientId: geofence.clientId,
      geofenceId: geofence.id,
      itineraryId,
      roleKey,
      geometryHash,
    }),
    points: normalizedPoints,
  });
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
    throw wrapXdmError(error, {
      step: "createGeofence",
      correlationId,
      payloadSample: {
        geofenceId,
        clientId: geofence.clientId,
        itineraryId,
        name: xdmName,
      },
    });
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
  buildGeofenceKml,
  normalizePolygon,
  buildGeometryHash,
  syncGeofence,
};
