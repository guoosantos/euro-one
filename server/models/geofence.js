import createError from "http-errors";

import prisma from "../services/prisma.js";

function validationError(message) {
  const error = createError(422, message);
  error.code = "GEOFENCE_VALIDATION";
  return error;
}

function ensurePrisma() {
  if (!prisma) {
    throw createError(503, "Banco de dados indisponível");
  }
  if (!prisma.geofence) {
    throw createError(503, "Prisma Client sem o modelo Geofence. Rode prisma generate e redeploy.");
  }
}

function clampCoordinate(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(Math.max(num, min), max);
}

async function assertClientExists(clientId) {
  const client = await prisma.client.findUnique({ where: { id: String(clientId) } });
  if (!client) {
    throw createError(404, "Cliente associado não encontrado");
  }
}

async function assertGroup(groupId, clientId) {
  if (!groupId) return null;
  const group = await prisma.geofenceGroup.findUnique({ where: { id: String(groupId) } });
  if (!group) {
    throw createError(404, "Grupo de geofence não encontrado");
  }
  if (clientId && String(group.clientId) !== String(clientId)) {
    throw createError(400, "Grupo pertence a outro cliente");
  }
  return group;
}

function parsePointsFromArea(area) {
  if (!area) return [];
  return String(area)
    .split(",")
    .map((segment) => segment.trim().split(/\s+/).slice(0, 2).map((value) => Number(value)))
    .filter((pair) => pair.length === 2 && pair.every((value) => Number.isFinite(value)));
}

function normalizePointList(rawPoints) {
  if (!Array.isArray(rawPoints)) return [];
  return rawPoints
    .map((pair) => {
      if (!Array.isArray(pair) || pair.length < 2) return null;
      const latitude = clampCoordinate(pair[0], -90, 90);
      const longitude = clampCoordinate(pair[1], -180, 180);
      if (latitude === null || longitude === null) return null;
      return [latitude, longitude];
    })
    .filter(Boolean);
}

function normalizePoints({ points, area }) {
  if (Array.isArray(points) && points.length) {
    return normalizePointList(points).slice(0, 200);
  }
  return normalizePointList(parsePointsFromArea(area)).slice(0, 200);
}

function buildArea(points = []) {
  if (!Array.isArray(points) || !points.length) return "";
  return points.map(([lat, lon]) => `${lat} ${lon}`).join(",");
}

function mapGeofence(record) {
  if (!record) return null;
  const points = normalizePointList(record.points || []);
  const center =
    Number.isFinite(record.centerLat) && Number.isFinite(record.centerLng)
      ? [record.centerLat, record.centerLng]
      : null;
  return {
    id: record.id,
    clientId: record.clientId,
    groupId: record.groupId || null,
    name: record.name,
    description: record.description,
    type: record.type,
    color: record.color,
    radius: record.radius,
    latitude: record.centerLat,
    longitude: record.centerLng,
    center,
    area: buildArea(points),
    points,
    geometryJson: record.geometryJson || null,
    kml: record.kml || null,
    createdByUserId: record.createdByUserId || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function normalizeType(type) {
  const value = String(type || "").toLowerCase();
  if (value === "circle" || value === "polygon") return value;
  throw validationError("Tipo de geofence inválido");
}

function resolveCircleGeometry(payload, fallback = {}) {
  const radius = Number(payload.radius ?? fallback.radius ?? 0);
  const centerPayload = payload.center || {};
  const fallbackCenter = fallback.center || {};
  const latitude = clampCoordinate(
    payload.centerLat ??
      payload.latitude ??
      payload.center?.[0] ??
      centerPayload.lat ??
      centerPayload.latitude ??
      fallback.centerLat ??
      fallback.latitude ??
      fallback.center?.[0] ??
      fallbackCenter.lat ??
      fallbackCenter.latitude,
    -90,
    90,
  );
  const longitude = clampCoordinate(
    payload.centerLng ??
      payload.longitude ??
      payload.center?.[1] ??
      centerPayload.lng ??
      centerPayload.lon ??
      centerPayload.longitude ??
      fallback.centerLng ??
      fallback.longitude ??
      fallback.center?.[1] ??
      fallbackCenter.lng ??
      fallbackCenter.lon ??
      fallbackCenter.longitude,
    -180,
    180,
  );

  if (latitude === null || longitude === null) {
    throw validationError("latitude/longitude são obrigatórios para círculo");
  }
  if (!Number.isFinite(radius) || radius <= 0) {
    throw validationError("radius é obrigatório para círculo");
  }

  return { radius, centerLat: latitude, centerLng: longitude };
}

export async function listGeofences({ clientId, groupId } = {}) {
  ensurePrisma();
  const where = {
    ...(clientId ? { clientId: String(clientId) } : {}),
    ...(groupId ? { groupId: String(groupId) } : {}),
  };
  const geofences = await prisma.geofence.findMany({ where, orderBy: { createdAt: "desc" } });
  return geofences.map(mapGeofence);
}

export async function getGeofenceById(id) {
  ensurePrisma();
  const geofence = await prisma.geofence.findUnique({ where: { id: String(id) } });
  return mapGeofence(geofence);
}

export async function createGeofence({
  clientId,
  groupId = null,
  name,
  description = null,
  type,
  color = null,
  radius = null,
  center = null,
  latitude = null,
  longitude = null,
  centerLat = null,
  centerLng = null,
  points = null,
  area = null,
  geometryJson = null,
  kml = null,
  createdByUserId = null,
}) {
  ensurePrisma();
  if (!clientId) {
    throw validationError("clientId é obrigatório");
  }
  if (!name) {
    throw validationError("Nome é obrigatório");
  }

  const normalizedType = normalizeType(type);
  await assertClientExists(clientId);
  await assertGroup(groupId, clientId);

  const payload = {
    clientId: String(clientId),
    groupId: groupId ? String(groupId) : null,
    name: String(name),
    description: description || null,
    type: normalizedType,
    color: color || null,
    points: [],
    centerLat: null,
    centerLng: null,
    radius: null,
    geometryJson: geometryJson || null,
    kml: kml || null,
    createdByUserId: createdByUserId || null,
  };

  if (normalizedType === "polygon") {
    const resolvedPoints = normalizePoints({ points, area });
    if (resolvedPoints.length < 3) {
      throw validationError("Polígono deve ter ao menos 3 pontos");
    }
    payload.points = resolvedPoints;
    payload.geometryJson = payload.geometryJson || { type: "polygon", points: resolvedPoints };
  } else {
    const geometry = resolveCircleGeometry(
      { center, radius, latitude, longitude, centerLat, centerLng },
      { radius: null, centerLat: null, centerLng: null },
    );
    payload.centerLat = geometry.centerLat;
    payload.centerLng = geometry.centerLng;
    payload.radius = geometry.radius;
    payload.geometryJson =
      payload.geometryJson || {
        type: "circle",
        center: [geometry.centerLat, geometry.centerLng],
        radius: geometry.radius,
      };
  }

  const geofence = await prisma.geofence.create({ data: payload });
  return mapGeofence(geofence);
}

export async function updateGeofence(id, updates = {}) {
  ensurePrisma();
  const existing = await prisma.geofence.findUnique({ where: { id: String(id) } });
  if (!existing) {
    throw createError(404, "Geofence não encontrada");
  }

  const nextType = updates.type ? normalizeType(updates.type) : existing.type;
  const targetClientId = updates.clientId ? String(updates.clientId) : existing.clientId;

  await assertClientExists(targetClientId);
  await assertGroup(updates.groupId ?? existing.groupId, targetClientId);

  const data = {
    clientId: targetClientId,
    groupId:
      Object.prototype.hasOwnProperty.call(updates, "groupId") && updates.groupId !== undefined
        ? updates.groupId
          ? String(updates.groupId)
          : null
        : existing.groupId,
    name: updates.name ? String(updates.name) : existing.name,
    description: Object.prototype.hasOwnProperty.call(updates, "description") ? updates.description || null : existing.description,
    color: Object.prototype.hasOwnProperty.call(updates, "color") ? updates.color || null : existing.color,
    type: nextType,
    kml: Object.prototype.hasOwnProperty.call(updates, "kml") ? updates.kml || null : existing.kml,
    geometryJson: Object.prototype.hasOwnProperty.call(updates, "geometryJson")
      ? updates.geometryJson || null
      : existing.geometryJson,
    createdByUserId: updates.createdByUserId || existing.createdByUserId || null,
  };

  if (nextType === "polygon") {
    const resolvedPoints = normalizePoints({ points: updates.points, area: updates.area });
    const pointsToPersist = resolvedPoints.length ? resolvedPoints : normalizePointList(existing.points || []);
    if (pointsToPersist.length < 3) {
      throw validationError("Polígono deve ter ao menos 3 pontos");
    }
    data.points = pointsToPersist;
    data.centerLat = null;
    data.centerLng = null;
    data.radius = null;
    if (!data.geometryJson) {
      data.geometryJson = { type: "polygon", points: pointsToPersist };
    }
  } else {
    const geometry = resolveCircleGeometry(
      { ...updates, centerLat: updates.centerLat ?? updates.latitude, centerLng: updates.centerLng ?? updates.longitude },
      { radius: existing.radius, centerLat: existing.centerLat, centerLng: existing.centerLng },
    );
    data.centerLat = geometry.centerLat;
    data.centerLng = geometry.centerLng;
    data.radius = geometry.radius;
    data.points = [];
    if (!data.geometryJson) {
      data.geometryJson = { type: "circle", center: [geometry.centerLat, geometry.centerLng], radius: geometry.radius };
    }
  }

  const geofence = await prisma.geofence.update({
    where: { id: String(id) },
    data,
  });
  return mapGeofence(geofence);
}

export async function deleteGeofence(id) {
  ensurePrisma();
  const deleted = await prisma.geofence.delete({ where: { id: String(id) } }).catch(() => null);
  if (!deleted) {
    throw createError(404, "Geofence não encontrada");
  }
  return mapGeofence(deleted);
}

export default {
  listGeofences,
  getGeofenceById,
  createGeofence,
  updateGeofence,
  deleteGeofence,
};
