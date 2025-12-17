import createError from "http-errors";
import { randomUUID } from "crypto";

import prisma from "../services/prisma.js";

function ensurePrisma() {
  if (!prisma) {
    throw createError(503, "Banco de dados indisponível");
  }
}

async function assertClientExists(clientId) {
  const client = await prisma.client.findUnique({ where: { id: String(clientId) } });
  if (!client) {
    throw createError(404, "Cliente associado não encontrado");
  }
}

function normalizeRoutePoints(points) {
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => {
      if (!Array.isArray(point) || point.length < 2) return null;
      const [lat, lon] = point;
      const latitude = Number(lat);
      const longitude = Number(lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return [latitude, longitude];
    })
    .filter(Boolean);
}

function mapRoute(record) {
  if (!record) return null;
  const points = Array.isArray(record.points)
    ? record.points
        .map((point) => [Number(point.latitude), Number(point.longitude)])
        .filter((pair) => pair.every((value) => Number.isFinite(value)))
    : [];
  return {
    id: record.id,
    clientId: record.clientId,
    name: record.name,
    description: record.description,
    color: record.color,
    points,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function listRoutes({ clientId } = {}) {
  ensurePrisma();
  const where = clientId ? { clientId: String(clientId) } : {};
  const routes = await prisma.route.findMany({
    where,
    include: { points: { orderBy: { order: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  return routes.map(mapRoute);
}

export async function getRouteById(id) {
  ensurePrisma();
  const route = await prisma.route.findUnique({
    where: { id: String(id) },
    include: { points: { orderBy: { order: "asc" } } },
  });
  return mapRoute(route);
}

export async function createRoute({ clientId, name, description = null, color = null, points = [] }) {
  ensurePrisma();
  if (!clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  if (!name) {
    throw createError(400, "Nome é obrigatório");
  }

  await assertClientExists(clientId);
  const normalizedPoints = normalizeRoutePoints(points);
  if (normalizedPoints.length < 2) {
    throw createError(400, "Rota deve conter ao menos 2 pontos");
  }

  const routeId = randomUUID();
  await prisma.$transaction([
    prisma.route.create({
      data: {
        id: routeId,
        clientId: String(clientId),
        name: String(name),
        description: description || null,
        color: color || null,
      },
    }),
    prisma.routePoint.createMany({
      data: normalizedPoints.map(([lat, lon], index) => ({
        id: randomUUID(),
        routeId,
        latitude: lat,
        longitude: lon,
        order: index,
      })),
    }),
  ]);

  return getRouteById(routeId);
}

export async function updateRoute(id, updates = {}) {
  ensurePrisma();
  const existing = await prisma.route.findUnique({
    where: { id: String(id) },
    include: { points: { orderBy: { order: "asc" } } },
  });
  if (!existing) {
    throw createError(404, "Rota não encontrada");
  }

  const targetClientId = updates.clientId ? String(updates.clientId) : existing.clientId;
  await assertClientExists(targetClientId);

  const data = {
    clientId: targetClientId,
    name: updates.name ? String(updates.name) : existing.name,
    description: Object.prototype.hasOwnProperty.call(updates, "description") ? updates.description || null : existing.description,
    color: Object.prototype.hasOwnProperty.call(updates, "color") ? updates.color || null : existing.color,
  };

  const operations = [
    prisma.route.update({
      where: { id: String(id) },
      data,
    }),
  ];

  if (Array.isArray(updates.points)) {
    const normalizedPoints = normalizeRoutePoints(updates.points);
    if (normalizedPoints.length < 2) {
      throw createError(400, "Rota deve conter ao menos 2 pontos");
    }
    operations.push(prisma.routePoint.deleteMany({ where: { routeId: String(id) } }));
    operations.push(
      prisma.routePoint.createMany({
        data: normalizedPoints.map(([lat, lon], index) => ({
          id: randomUUID(),
          routeId: String(id),
          latitude: lat,
          longitude: lon,
          order: index,
        })),
      }),
    );
  }

  await prisma.$transaction(operations);

  return getRouteById(id);
}

export async function deleteRoute(id) {
  ensurePrisma();
  const deleted = await prisma.route.delete({ where: { id: String(id) } }).catch(() => null);
  if (!deleted) {
    throw createError(404, "Rota não encontrada");
  }
  return mapRoute(deleted);
}

export default {
  listRoutes,
  getRouteById,
  createRoute,
  updateRoute,
  deleteRoute,
};
