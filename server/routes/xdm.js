import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { listGeofences } from "../models/geofence.js";
import { listRoutes } from "../models/route.js";
import { getItineraryById } from "../models/itinerary.js";
import { buildItineraryKml } from "../utils/kml.js";
import {
  applyConfigToDevices,
  applySettingsOverride,
  associateGeozones,
  createGeozoneGroup,
  createRollout,
  ensureXdmConfigured,
  fetchSettingsOverrideCategories,
  fetchSettingsOverrideElements,
  filterGeozoneGroups,
  getGeozoneGroup,
  importGeozones,
  importGeozonesToGroup,
  listConfigsForDevices,
  pingXdm,
  updateGeozoneGroup,
  testXdmToken,
} from "../services/xdm.js";

const router = express.Router();

router.use(authenticate);

function resolveTargetClient(req, provided, { required = false } = {}) {
  if (req.user.role === "admin") {
    return provided || req.query?.clientId || req.user.clientId || null;
  }
  const clientId = req.user.clientId || null;
  if (required && !clientId) {
    throw createError(400, "clientId é obrigatório");
  }
  return clientId;
}

function ensureSameClient(user, clientId) {
  if (user.role === "admin") return;
  if (!user.clientId || String(user.clientId) !== String(clientId)) {
    throw createError(403, "Operação não permitida para este cliente");
  }
}

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.content)) return payload.content;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  return [];
}

function resolveGroupId(group) {
  return (
    group?.id ||
    group?.geozoneGroupId ||
    group?.geozoneGroupID ||
    group?.geozone_group_id ||
    group?.geozone_groupId ||
    null
  );
}

function slugify(text = "") {
  const normalized = text
    .normalize("NFD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized || "itinerario";
}

async function buildItineraryKmlPayload(itinerary, clientId) {
  const geofenceIds = (itinerary.items || [])
    .filter((item) => item.type === "geofence")
    .map((item) => String(item.id));
  const routeIds = (itinerary.items || [])
    .filter((item) => item.type === "route")
    .map((item) => String(item.id));

  if (!geofenceIds.length && !routeIds.length) {
    throw createError(400, "Itinerário não possui itens para exportação");
  }

  let geofences = [];
  if (geofenceIds.length) {
    try {
      geofences = (await listGeofences({ clientId })).filter((geo) => geofenceIds.includes(String(geo.id)));
    } catch (error) {
      console.warn("[xdm] Falha ao carregar cercas para itinerário", error?.message || error);
    }
  }

  const routes = routeIds.length ? listRoutes({ clientId }).filter((route) => routeIds.includes(String(route.id))) : [];

  if (!geofences.length && !routes.length) {
    throw createError(404, "Itens do itinerário não encontrados para o cliente informado");
  }

  const kml = buildItineraryKml({
    name: itinerary.name,
    geofences,
    routes,
  });

  return { kml, geofenceIds, routeIds };
}

function ensureKmlContent(kml) {
  if (!kml || typeof kml !== "string") {
    throw createError(400, "Conteúdo KML é obrigatório");
  }
  return kml;
}

router.get("/xdm/ping", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    ensureXdmConfigured();
    const pingResult = await pingXdm();
    return res.json({ data: { ok: true, response: pingResult }, error: null });
  } catch (error) {
    return next(error);
  }
});

router.post("/xdm/token/test", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const providedToken = req.body?.token || req.query?.token || req.headers?.["x-xdm-token"] || null;
    const testResult = await testXdmToken({ token: providedToken });
    return res.json({
      data: { ok: true, response: testResult, usedToken: providedToken ? "provided" : "default" },
      error: null,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/xdm/geozone-groups", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    ensureXdmConfigured();
    const groups = await filterGeozoneGroups(req.query || {});
    return res.json({ data: groups, error: null });
  } catch (error) {
    return next(error);
  }
});

router.post("/xdm/geozone-groups", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    ensureXdmConfigured();
    const created = await createGeozoneGroup(req.body || {});
    return res.status(201).json({ data: created, error: null });
  } catch (error) {
    return next(error);
  }
});

router.put("/xdm/geozone-groups/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    ensureXdmConfigured();
    const updated = await updateGeozoneGroup(req.params.id, req.body || {});
    return res.json({ data: updated, error: null });
  } catch (error) {
    return next(error);
  }
});

router.get("/xdm/geozone-groups/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    ensureXdmConfigured();
    const details = await getGeozoneGroup(req.params.id);
    return res.json({ data: details, error: null });
  } catch (error) {
    return next(error);
  }
});

router.post("/xdm/geozones/import", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    ensureXdmConfigured();
    const kml = ensureKmlContent(req.body?.kml || req.body?.file || req.body?.content);
    const filename = req.body?.filename || req.body?.name || "geozones.kml";
    const imported = await importGeozones(kml, { filename });
    return res.status(201).json({ data: imported, error: null });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/xdm/geozone-groups/:id/geozones",
  requireRole("manager", "admin"),
  async (req, res, next) => {
    try {
      ensureXdmConfigured();
      const geozoneIds = Array.isArray(req.body?.geozoneIds) ? req.body.geozoneIds : [];
      if (!geozoneIds.length) {
        throw createError(400, "geozoneIds é obrigatório e não pode ser vazio");
      }

      const association = await associateGeozones(req.params.id, geozoneIds);
      return res.json({ data: association, error: null });
    } catch (error) {
      return next(error);
    }
  },
);

router.post("/xdm/itineraries/:id/push", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    ensureXdmConfigured();
    const itinerary = getItineraryById(req.params.id);
    if (!itinerary) {
      throw createError(404, "Itinerário não encontrado");
    }

    const targetClientId = resolveTargetClient(req, req.body?.clientId || itinerary.clientId, { required: true });
    ensureSameClient(req.user, itinerary.clientId || targetClientId);

    const { kml } = await buildItineraryKmlPayload(itinerary, targetClientId);
    const explicitGroupId = req.body?.geozoneGroupId || req.body?.geozoneGroupID || null;
    const syncMetadata = req.body?.syncMetadata !== false;

    let targetGroupId = explicitGroupId ? String(explicitGroupId) : null;
    let group = null;

    if (targetGroupId) {
      group = await getGeozoneGroup(targetGroupId);
    } else {
      try {
        const filtered = await filterGeozoneGroups({ name: itinerary.name, search: itinerary.name });
        const list = normalizeList(filtered);
        group = list.find((item) => (item.name || "").toLowerCase() === itinerary.name.toLowerCase()) || null;
        targetGroupId = resolveGroupId(group) || targetGroupId;
      } catch (error) {
        console.warn("[xdm] Falha ao consultar grupos existentes", error?.message || error);
      }
    }

    if (!targetGroupId) {
      group = await createGeozoneGroup({
        name: itinerary.name,
        description: itinerary.description || "",
      });
      targetGroupId = resolveGroupId(group);
    } else if (syncMetadata) {
      try {
        group = await updateGeozoneGroup(targetGroupId, {
          name: itinerary.name,
          description: itinerary.description || "",
        });
      } catch (error) {
        console.warn("[xdm] Falha ao atualizar metadados do grupo", error?.message || error);
      }
    }

    if (!targetGroupId) {
      throw createError(500, "Não foi possível resolver o geozoneGroupId no XDM");
    }

    const filename = `${slugify(itinerary.name || "itinerario")}.kml`;
    const importResult = await importGeozonesToGroup(targetGroupId, kml, { filename });

    return res.json({
      data: {
        geozoneGroupId: targetGroupId,
        group,
        importResult,
      },
      error: null,
    });
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/xdm/settings-overrides/:deviceId/categories",
  requireRole("manager", "admin"),
  async (req, res, next) => {
    try {
      ensureXdmConfigured();
      const categories = await fetchSettingsOverrideCategories(req.params.deviceId);
      return res.json({ data: categories, error: null });
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/xdm/settings-overrides/:deviceId/categories/:categoryId/elements",
  requireRole("manager", "admin"),
  async (req, res, next) => {
    try {
      ensureXdmConfigured();
      const elements = await fetchSettingsOverrideElements(req.params.deviceId, req.params.categoryId);
      return res.json({ data: elements, error: null });
    } catch (error) {
      return next(error);
    }
  },
);

router.put("/xdm/settings-overrides/:deviceId", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    ensureXdmConfigured();
    const updated = await applySettingsOverride(req.params.deviceId, req.body || {});
    return res.json({ data: updated, error: null });
  } catch (error) {
    return next(error);
  }
});

router.post("/xdm/configs/for-devices", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    ensureXdmConfigured();
    const configs = await listConfigsForDevices(req.body || {});
    return res.json({ data: configs, error: null });
  } catch (error) {
    return next(error);
  }
});

router.put("/xdm/devices/config", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    ensureXdmConfigured();
    const result = await applyConfigToDevices(req.body || {});
    return res.json({ data: result, error: null });
  } catch (error) {
    return next(error);
  }
});

router.post("/xdm/rollouts", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    ensureXdmConfigured();
    const rollout = await createRollout(req.body || {});
    return res.status(201).json({ data: rollout, error: null });
  } catch (error) {
    return next(error);
  }
});

export default router;
