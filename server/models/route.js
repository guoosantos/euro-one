import createError from "http-errors";
import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../services/storage.js";
import prisma from "../services/prisma.js";

const STORAGE_KEY = "routes";
const routes = new Map();

function isPrismaReady() {
  return Boolean(prisma) && Boolean(process.env.DATABASE_URL);
}

function clone(record) {
  if (!record) return null;
  return JSON.parse(JSON.stringify(record));
}

function syncStorage() {
  saveCollection(STORAGE_KEY, Array.from(routes.values()));
}

function normalisePoint(point) {
  if (!point) return null;
  const lat = Number(point.lat ?? point.latitude ?? point[0]);
  const lon = Number(point.lng ?? point.lon ?? point.longitude ?? point[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return [lat, lon];
}

function normalisePoints(points) {
  if (!Array.isArray(points)) return [];
  return points.map(normalisePoint).filter(Boolean);
}

function persist(record, { skipSync = false } = {}) {
  routes.set(record.id, record);
  if (!skipSync) {
    syncStorage();
  }
  return clone(record);
}

const persistedRoutes = loadCollection(STORAGE_KEY, []);
persistedRoutes.forEach((item) => {
  if (!item?.id) return;
  const stored = persist(
    {
      ...item,
      points: normalisePoints(item.points || []),
      clientId: String(item.clientId),
      mode: item.mode || "car",
      metadata: item.metadata || {},
    },
    { skipSync: true },
  );
  void syncRouteToPrisma(stored);
});

function ensureName(name) {
  const normalized = String(name || "").trim();
  if (!normalized) {
    throw createError(400, "Nome da rota é obrigatório");
  }
  return normalized;
}

async function syncRouteToPrisma(record) {
  if (!isPrismaReady() || !record?.id) return;
  const points = normalisePoints(record.points || []);
  const data = {
    id: record.id,
    clientId: String(record.clientId),
    name: ensureName(record.name || "Rota"),
    mode: record.mode || "car",
    metadata: record.metadata || {},
    createdAt: record.createdAt ? new Date(record.createdAt) : new Date(),
    updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date(),
  };

  try {
    await prisma.$transaction([
      prisma.route.upsert({
        where: { id: record.id },
        create: data,
        update: {
          ...data,
          createdAt: undefined,
        },
      }),
      prisma.routePoint.deleteMany({ where: { routeId: record.id } }),
      points.length
        ? prisma.routePoint.createMany({
            data: points.map(([latitude, longitude], index) => ({
              routeId: record.id,
              order: index,
              latitude,
              longitude,
              createdAt: record.createdAt ? new Date(record.createdAt) : new Date(),
              updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date(),
            })),
          })
        : null,
    ].filter(Boolean));
  } catch (error) {
    console.warn("[routes] falha ao sincronizar com o banco", error?.message || error);
  }
}

async function hydrateFromPrisma() {
  if (!isPrismaReady()) return;
  try {
    const dbRoutes = await prisma.route.findMany({
      include: { points: true },
    });
    dbRoutes.forEach((route) => {
      if (!route?.id) return;
      const normalised = {
        id: String(route.id),
        clientId: String(route.clientId),
        name: route.name,
        mode: route.mode || "car",
        metadata: route.metadata || {},
        points: (route.points || [])
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((point) => [point.latitude, point.longitude]),
        createdAt: route.createdAt ? new Date(route.createdAt).toISOString() : new Date().toISOString(),
        updatedAt: route.updatedAt ? new Date(route.updatedAt).toISOString() : new Date().toISOString(),
      };
      persist(normalised, { skipSync: true });
    });
    syncStorage();
  } catch (error) {
    console.warn("[routes] falha ao hidratar rotas do banco", error?.message || error);
  }
}

void hydrateFromPrisma();

export function listRoutes({ clientId } = {}) {
  const list = Array.from(routes.values());
  if (!clientId) {
    return list.map(clone);
  }
  return list.filter((route) => String(route.clientId) === String(clientId)).map(clone);
}

export function getRouteById(id) {
  return clone(routes.get(String(id)));
}

export async function deleteRoute(id) {
  const existing = routes.get(String(id));
  if (!existing) return null;
  routes.delete(String(id));
  syncStorage();
  if (isPrismaReady()) {
    try {
      await prisma.route.delete({ where: { id: String(id) } });
    } catch (error) {
      if (error?.code !== "P2025") {
        console.warn("[routes] falha ao excluir do banco", error?.message || error);
      }
    }
  }
  return clone(existing);
}

export async function createRoute({ clientId, name, mode = "car", points = [], metadata = {} }) {
  if (!clientId) {
    throw createError(400, "clientId é obrigatório");
  }

  const record = {
    id: randomUUID(),
    clientId: String(clientId),
    name: ensureName(name || "Rota"),
    mode: mode || "car",
    metadata: metadata || {},
    points: normalisePoints(points),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const stored = persist(record);
  void syncRouteToPrisma(stored);
  return stored;
}

export async function updateRoute(id, updates = {}) {
  const existing = routes.get(String(id));
  if (!existing) {
    throw createError(404, "Rota não encontrada");
  }

  const updated = {
    ...existing,
    ...updates,
    name: updates.name ? ensureName(updates.name) : existing.name,
    mode: updates.mode || existing.mode || "car",
    metadata: updates.metadata || existing.metadata || {},
    points: updates.points ? normalisePoints(updates.points) : existing.points,
    updatedAt: new Date().toISOString(),
  };

  const stored = persist(updated);
  void syncRouteToPrisma(stored);
  return stored;
}
