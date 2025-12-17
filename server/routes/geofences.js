import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { getClientById } from "../models/client.js";
import { getPrisma } from "../services/prisma.js";

const router = express.Router();

router.use(authenticate);

const ALLOWED_TYPES = new Set(["polygon", "circle"]);

function ensurePrisma() {
  try {
    return getPrisma();
  } catch (error) {
    throw createError(503, "Banco de dados indisponível para geofences.");
  }
}

function normalizePoint(raw) {
  if (!raw) return null;
  if (Array.isArray(raw) && raw.length >= 2) {
    const [lat, lng] = raw;
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      return [Number(lat), Number(lng)];
    }
  }
  if (typeof raw === "object") {
    const lat = raw.lat ?? raw.latitude;
    const lng = raw.lng ?? raw.lon ?? raw.longitude;
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      return [Number(lat), Number(lng)];
    }
  }
  return null;
}

function normalizePoints(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => normalizePoint(item))
    .filter(Boolean);
}

function normalizeCenter(value) {
  const resolved = normalizePoint(value);
  if (!resolved) return null;
  const [lat, lng] = resolved;
  return { lat, lng };
}

function normalizeGeometry(payload, existing = null) {
  const type = String(payload?.type ?? payload?.shapeType ?? existing?.type ?? "polygon").toLowerCase();
  if (!ALLOWED_TYPES.has(type)) {
    throw createError(400, "Tipo de geofence inválido. Use polygon ou circle.");
  }

  const basePoints = payload?.points ?? existing?.points ?? [];
  const points = type === "polygon" ? normalizePoints(basePoints) : [];
  const centerPayload = payload?.center ?? payload?.centroid ?? existing?.center ?? null;
  const center = normalizeCenter(centerPayload);
  const radiusValue = payload?.radius ?? existing?.radius ?? payload?.area ?? null;
  const radius = radiusValue === null || radiusValue === undefined ? null : Number(radiusValue);

  if (type === "polygon" && points.length < 3) {
    throw createError(400, "Polígonos precisam de pelo menos 3 pontos.");
  }
  if (type === "circle") {
    if (!center) {
      throw createError(400, "Centro é obrigatório para círculos.");
    }
    if (!Number.isFinite(radius) || radius <= 0) {
      throw createError(400, "Raio inválido para círculo.");
    }
  }

  return { type, points, center, radius: type === "circle" ? radius : null };
}

function serializeGeofence(record) {
  if (!record) return null;
  const centerObj = record.center && typeof record.center === "object"
    ? { lat: Number(record.center.lat ?? record.center.latitude ?? 0), lng: Number(record.center.lng ?? record.center.lon ?? record.center.longitude ?? 0) }
    : null;

  return {
    id: record.id,
    clientId: record.clientId,
    name: record.name,
    description: record.description,
    type: record.type,
    color: record.color,
    points: normalizePoints(record.points),
    center: centerObj,
    radius: record.radius ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function resolveClientId(req, payload) {
  if (req.user.role === "admin") {
    return payload?.clientId || req.query?.clientId || req.user.clientId || null;
  }
  return req.user.clientId || null;
}

function assertClientAccess(user, targetClientId) {
  if (user.role === "admin") return;
  if (!user.clientId || String(user.clientId) !== String(targetClientId)) {
    throw createError(403, "Operação não permitida para este cliente.");
  }
}

router.get("/geofences", async (req, res, next) => {
  try {
    const prisma = ensurePrisma();
    const clientId = resolveClientId(req, req.query);
    if (!clientId) {
      return res.json({ geofences: [] });
    }

    const geofences = await prisma.geofence.findMany({
      where: { clientId: String(clientId) },
      orderBy: { updatedAt: "desc" },
    });

    return res.json({ geofences: geofences.map(serializeGeofence) });
  } catch (error) {
    return next(error);
  }
});

router.post("/geofences", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const prisma = ensurePrisma();
    const clientId = resolveClientId(req, req.body);
    if (!clientId) {
      throw createError(400, "clientId é obrigatório");
    }

    const client = getClientById(clientId);
    if (!client) {
      throw createError(404, "Cliente não encontrado");
    }

    const geometry = normalizeGeometry(req.body || {});
    const now = new Date();

    const created = await prisma.geofence.create({
      data: {
        clientId: String(clientId),
        name: (req.body?.name || "Cerca virtual").trim(),
        description: req.body?.description?.trim?.() || null,
        type: geometry.type,
        color: req.body?.color || null,
        points: geometry.points,
        center: geometry.center,
        radius: geometry.radius,
        createdAt: now,
        updatedAt: now,
      },
    });

    return res.status(201).json({ geofence: serializeGeofence(created) });
  } catch (error) {
    return next(error);
  }
});

router.put("/geofences/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const prisma = ensurePrisma();
    const { id } = req.params;
    const existing = await prisma.geofence.findUnique({ where: { id } });
    if (!existing) {
      throw createError(404, "Geofence não encontrada");
    }

    assertClientAccess(req.user, existing.clientId);
    const geometry = normalizeGeometry(req.body || {}, existing);

    let nextClientId = existing.clientId;
    if (req.user.role === "admin" && req.body?.clientId) {
      const client = getClientById(req.body.clientId);
      if (!client) {
        throw createError(404, "Cliente não encontrado");
      }
      nextClientId = req.body.clientId;
    }

    const updated = await prisma.geofence.update({
      where: { id },
      data: {
        clientId: String(nextClientId),
        name: req.body?.name ? String(req.body.name).trim() : existing.name,
        description: req.body?.description?.trim?.() ?? existing.description,
        type: geometry.type,
        color: req.body?.color ?? existing.color,
        points: geometry.points,
        center: geometry.center,
        radius: geometry.radius,
      },
    });

    return res.json({ geofence: serializeGeofence(updated) });
  } catch (error) {
    return next(error);
  }
});

router.delete("/geofences/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const prisma = ensurePrisma();
    const { id } = req.params;
    const existing = await prisma.geofence.findUnique({ where: { id } });
    if (!existing) {
      return res.status(204).send();
    }

    assertClientAccess(req.user, existing.clientId);
    await prisma.geofence.delete({ where: { id } });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
