import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { authorizePermission } from "../middleware/permissions.js";

import { createGeofence, deleteGeofence, getGeofenceById, listGeofences, updateGeofence } from "../models/geofence.js";
import { listGeofenceGroups } from "../models/geofence-group.js";
import { buildGeofencesKml, parseGeofencePlacemarks } from "../utils/kml.js";


const router = express.Router();

router.use(authenticate);


function handlePrismaFailure(error, req, res, next) {
  const message = error?.message || "Erro ao acessar geofences";
  const isMissingTable = error?.code === "P2021" || /does not exist/i.test(message || "");
  const initializationCodes = new Set(["P1000", "P1001", "P1002", "P1003", "P1008", "P1009", "P1010", "P1011", "P1012", "P1013"]);
  const isInitializationError =
    initializationCodes.has(error?.code) ||
    error?.name === "PrismaClientInitializationError" ||
    error?.name === "PrismaClientRustPanicError";

  if (isMissingTable) {
    console.error("Geofences indisponíveis (migration pendente)", error);
    if (req.method === "GET") {
      return res.status(200).json({ geofences: [] });
    }
    return res
      .status(503)
      .json({ message: "Banco não preparado para geofences (migrations pendentes)" });
  }
  if (isInitializationError) {
    console.error("Prisma não inicializado para geofences", error);
    return res
      .status(503)
      .json({
        message: "Banco de dados indisponível para geofences. Verifique as credenciais, rode prisma generate e migrações.",
        code: error?.code || "PRISMA_INIT_ERROR",
      });
  }
  const status = error?.status || error?.statusCode;
  if (status) {
    return res.status(status).json({ message, code: error?.code || "GEOFENCE_ERROR" });
  }

  console.error("[geofences] erro inesperado", error);
  return res.status(503).json({ message: "Não foi possível processar a geofence.", code: "GEOFENCE_ERROR" });
}

function resolveClientId(req, provided) {
  const userRole = req.user?.role;
  const userClientId = req.user?.clientId ?? null;
  if (userRole === "admin") {
    return provided || req.query?.clientId || userClientId || null;
  }
  return userClientId;
}

function ensureSameTenant(user, clientId) {
  if (user.role === "admin") return;
  if (!user.clientId || String(user.clientId) !== String(clientId)) {
    throw createError(403, "Operação não permitida para este cliente");
  }
}

function canMirrorRead(req, clientId) {
  const mirrorContext = req?.mirrorContext;
  if (!mirrorContext || mirrorContext.mode !== "target") return false;
  if (String(mirrorContext.ownerClientId || "") === "all") {
    const allowed = Array.isArray(mirrorContext.ownerClientIds)
      ? mirrorContext.ownerClientIds.map((value) => String(value))
      : [];
    return allowed.includes(String(clientId));
  }
  return String(mirrorContext.ownerClientId || "") === String(clientId);
}

function ensureSameTenantOrMirror(req, clientId) {
  if (req.user?.role === "admin") return;
  if (req.user?.clientId && String(req.user.clientId) === String(clientId)) return;
  if (canMirrorRead(req, clientId)) return;
  throw createError(403, "Operação não permitida para este cliente");
}

router.get(
  "/geofences/export/kml",
  authorizePermission({ menuKey: "fleet", pageKey: "geofences" }),
  async (req, res, next) => {
  try {
    const targetClientId = resolveClientId(req, req.query?.clientId);
    if (!targetClientId) {
      throw createError(422, "clientId é obrigatório para exportar");
    }
    const geofences = await listGeofences({ clientId: targetClientId });
    const kml = buildGeofencesKml(geofences);
    res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
    return res.send(kml);
  } catch (error) {
    return next(error);
  }
  },
);

router.post(
  "/geofences/import/kml",
  authorizePermission({ menuKey: "fleet", pageKey: "geofences", requireFull: true }),
  async (req, res, next) => {
  try {
    const { kml, clientId: providedClientId, groupId = null, color = null } = req.body || {};
    const targetClientId = resolveClientId(req, providedClientId);
    if (!targetClientId) {
      throw createError(422, "clientId é obrigatório");
    }
    if (!kml) {
      throw createError(422, "Arquivo KML é obrigatório");
    }
    if (groupId) {
      const groups = await listGeofenceGroups({ clientId: targetClientId });
      const exists = groups.some((group) => String(group.id) === String(groupId));
      if (!exists) {
        throw createError(400, "Grupo de geofence inválido para este cliente");
      }
    }

    const placemarks = parseGeofencePlacemarks(kml);
    if (!placemarks.length) {
      throw createError(400, "Nenhuma geometria válida encontrada no KML");
    }

    const created = [];
    for (const placemark of placemarks) {
      const geofence = await createGeofence({
        clientId: targetClientId,
        groupId,
        name: placemark.name,
        type: "polygon",
        points: placemark.points,
        color,
      });
      created.push(geofence);
    }

    return res.status(201).json({ geofences: created, imported: created.length });
  } catch (error) {
    return next(error);
  }
  },
);

router.get(
  "/geofences",
  authorizePermission({ menuKey: "fleet", pageKey: "geofences" }),
  async (req, res, next) => {
  try {
    const userRole = req.user?.role || "user";
    const { groupId, isTarget, lite } = req.query || {};
    const mirrorOwnerIds = Array.isArray(req.mirrorContext?.ownerClientIds)
      ? req.mirrorContext.ownerClientIds.map((value) => String(value)).filter(Boolean)
      : [];
    const isMirrorAll = String(req.mirrorContext?.ownerClientId || "") === "all";
    const targetClientId = !isMirrorAll ? resolveClientId(req, req.query?.clientId) : null;
    if (!targetClientId && mirrorOwnerIds.length === 0 && userRole !== "admin") {
      return res.json({ geofences: [] });
    }
    const hasTargetFilter = isTarget !== undefined && isTarget !== null && String(isTarget).length > 0;
    const normalized = hasTargetFilter ? String(isTarget).toLowerCase() : null;
    const targetFlag = hasTargetFilter ? ["true", "1", "yes", "y", "sim"].includes(normalized) : null;
    const geofences = await listGeofences({
      ...(mirrorOwnerIds.length > 0 ? { clientIds: mirrorOwnerIds } : {}),
      ...(targetClientId ? { clientId: targetClientId } : {}),
      ...(groupId ? { groupId } : {}),
      ...(targetFlag === null ? {} : { isTarget: targetFlag }),
      ...(lite !== undefined && lite !== null && String(lite).length > 0
        ? { lite: ["true", "1", "yes", "y", "sim"].includes(String(lite).toLowerCase()) }
        : {}),
    });
    return res.json({ geofences });
  } catch (error) {
    return handlePrismaFailure(error, req, res, next);
  }
  },
);

router.get(
  "/geofences/:id",
  authorizePermission({ menuKey: "fleet", pageKey: "geofences" }),
  async (req, res, next) => {
  try {
    const geofence = await getGeofenceById(req.params.id);
    if (!geofence) {
      throw createError(404, "Geofence não encontrada");
    }
    ensureSameTenantOrMirror(req, geofence.clientId);
    return res.json({ geofence });

  } catch (error) {
    return handlePrismaFailure(error, req, res, next);
  }
  },
);

router.post(
  "/geofences",
  authorizePermission({ menuKey: "fleet", pageKey: "geofences", requireFull: true }),
  async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId);
    if (!clientId) {
      throw createError(422, "clientId é obrigatório");
    }

    if (req.user.role !== "admin" && (!req.user.clientId || String(req.user.clientId) !== String(clientId))) {
      throw createError(403, "Operação não permitida para este cliente");
    }

    const geofence = await createGeofence({ ...req.body, clientId, createdByUserId: req.user?.id || null });

    return res.status(201).json({ geofence });
  } catch (error) {
    return handlePrismaFailure(error, req, res, next);
  }
  },
);

router.put(
  "/geofences/:id",
  authorizePermission({ menuKey: "fleet", pageKey: "geofences", requireFull: true }),
  async (req, res, next) => {
  try {

    const existing = await getGeofenceById(req.params.id);
    if (!existing) {
      throw createError(404, "Geofence não encontrada");
    }
    ensureSameTenant(req.user, existing.clientId);
    if (req.user.role !== "admin" && req.body?.clientId && String(req.body.clientId) !== String(existing.clientId)) {
      throw createError(403, "Não é permitido mover geofences para outro cliente");
    }
    const geofence = await updateGeofence(req.params.id, {
      ...req.body,
      clientId: req.user.role === "admin" ? req.body?.clientId || existing.clientId : existing.clientId,
      createdByUserId: req.user?.id || existing.createdByUserId || null,
    });
    return res.json({ geofence });

  } catch (error) {
    return handlePrismaFailure(error, req, res, next);
  }
  },
);

router.delete(
  "/geofences/:id",
  authorizePermission({ menuKey: "fleet", pageKey: "geofences", requireFull: true }),
  async (req, res, next) => {
  try {

    const existing = await getGeofenceById(req.params.id);
    if (!existing) {
      throw createError(404, "Geofence não encontrada");
    }
    ensureSameTenant(req.user, existing.clientId);
    await deleteGeofence(req.params.id);

    return res.status(204).send();
  } catch (error) {
    return handlePrismaFailure(error, req, res, next);
  }
  },
);

export default router;
