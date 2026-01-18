import express from "express";
import createError from "http-errors";
import { randomUUID } from "crypto";

import { resolveClientId, resolveClientIdMiddleware } from "../middleware/client.js";
import { authenticate } from "../middleware/auth.js";
import { createTask, listTasks, getTaskById, updateTask } from "../models/task.js";
import { traccarRequest } from "../services/traccar.js";

const router = express.Router();

const defaultDeps = {
  authenticate,
  resolveClientId,
  resolveClientIdMiddleware,
  createTask,
  listTasks,
  getTaskById,
  updateTask,
  traccarRequest,
};

let routeDeps = { ...defaultDeps };

export function __setTasksRouteMocks(overrides = {}) {
  routeDeps = { ...routeDeps, ...overrides };
}

export function __resetTasksRouteMocks() {
  routeDeps = { ...defaultDeps };
}

router.use((req, res, next) => routeDeps.authenticate(req, res, next));

async function createGeofenceForTask(task) {
  if (!task?.latitude || !task?.longitude) return null;
  const radius = Number(task.geofenceRadius) || 150;
  const payload = {
    name: `Task-${task.id}`,
    description: task.address || "Task geofence",
    area: `CIRCLE (${task.longitude} ${task.latitude}, ${radius})`,
    attributes: { taskId: task.id },
  };
  const response = await routeDeps.traccarRequest(
    { method: "post", url: "/geofences", data: payload },
    null,
    { asAdmin: true },
  );
  const geofence = response?.data;
  if (task.vehicleId && geofence?.id) {
    await routeDeps.traccarRequest(
      { method: "post", url: "/permissions", data: { deviceId: Number(task.vehicleId), geofenceId: geofence.id } },
      null,
      { asAdmin: true },
    );
  }
  return geofence;
}

router.post("/tasks", (req, res, next) => routeDeps.resolveClientIdMiddleware(req, res, next), async (req, res, next) => {
  try {
    const clientId = routeDeps.resolveClientId(req, req.body?.clientId, { required: true });
    const task = await routeDeps.createTask({ ...req.body, clientId });
    let geofence = null;
    try {
      geofence = await createGeofenceForTask(task);
      if (geofence?.id) {
        const updated = await routeDeps.updateTask(task.id, { geoFenceId: geofence.id });
        return res.status(201).json({ task: updated, geofence });
      }
    } catch (geoError) {
      console.error("[tasks] Failed to create geofence", geoError);
    }
    res.status(201).json({ task, geofence });
  } catch (error) {
    const correlationId = res.get?.("X-Correlation-Id") || req.get?.("x-correlation-id");
    console.error("[tasks] create failed", {
      correlationId,
      code: error?.code,
      message: error?.message,
      meta: error?.meta,
      stack: error?.stack,
    });
    if (error?.code === "P2022") {
      return next(createError(500, "Banco desatualizado. Execute prisma migrate deploy."));
    }
    next(error);
  }
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseDateParam(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) {
    throw createError(400, `Parâmetro ${label} inválido`, { details: { param: label, reason: "array_not_allowed" } });
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createError(400, `Parâmetro ${label} inválido`, { details: { param: label, value: String(value) } });
  }
  return date;
}

function assertValidClientId(clientId) {
  if (!clientId) return;
  if (!UUID_REGEX.test(String(clientId))) {
    throw createError(400, "clientId inválido", { details: { param: "clientId", value: String(clientId) } });
  }
}

function normalizeStringParam(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) {
    throw createError(400, `Parâmetro ${label} inválido`, { details: { param: label, reason: "array_not_allowed" } });
  }
  if (typeof value === "object") {
    throw createError(400, `Parâmetro ${label} inválido`, { details: { param: label, reason: "object_not_allowed" } });
  }
  return String(value);
}

function normalizeStatusParam(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    throw createError(400, "Parâmetro status inválido", { details: { param: "status", reason: "object_not_allowed" } });
  }
  const values = Array.isArray(value) ? value : [value];
  const list = values
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

function resolveCorrelationId(req, res) {
  const header = req.get?.("x-correlation-id") || req.get?.("x-request-id");
  const correlationId = header && String(header).trim() ? String(header).trim() : randomUUID();
  res.set("X-Correlation-Id", correlationId);
  return correlationId;
}

router.get("/tasks", (req, res, next) => routeDeps.resolveClientIdMiddleware(req, res, next), async (req, res, next) => {
  try {
    const correlationId = resolveCorrelationId(req, res);
    const clientId = routeDeps.resolveClientId(req, req.query?.clientId, { required: false });
    assertValidClientId(clientId);
    const { from: fromRaw, to: toRaw, status: statusRaw, vehicleId: vehicleIdRaw, driverId: driverIdRaw, type: typeRaw, ...restQuery } = req.query || {};
    const from = parseDateParam(fromRaw, "from");
    const to = parseDateParam(toRaw, "to");
    const status = normalizeStatusParam(statusRaw);
    const vehicleId = normalizeStringParam(vehicleIdRaw, "vehicleId");
    const driverId = normalizeStringParam(driverIdRaw, "driverId");
    const type = normalizeStringParam(typeRaw, "type");
    if (from && to && from > to) {
      throw createError(400, "Intervalo de datas inválido", { details: { param: "from,to", value: { from, to } } });
    }
    const sanitizedQuery = {
      ...restQuery,
      clientId,
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
      status,
      vehicleId,
      driverId,
      type,
    };
    console.info("[tasks] list", { correlationId, params: sanitizedQuery });
    const tasks = await routeDeps.listTasks({ ...restQuery, clientId, from, to, status, vehicleId, driverId, type });
    res.json({ tasks: Array.isArray(tasks) ? tasks : [] });
  } catch (error) {
    const correlationId = res.get?.("X-Correlation-Id") || req.get?.("x-correlation-id");
    console.error("[tasks] list failed", {
      correlationId,
      message: error?.message,
      status: error?.status || error?.statusCode,
    });
    next(error);
  }
});

router.put("/tasks/:id", (req, res, next) => routeDeps.resolveClientIdMiddleware(req, res, next), async (req, res, next) => {
  try {
    const clientId = routeDeps.resolveClientId(req, req.body?.clientId || req.query?.clientId);
    const task = await routeDeps.getTaskById(req.params.id);
    if (clientId && task && String(task.clientId) !== String(clientId)) {
      return res.status(403).json({ message: "Task não pertence a este cliente" });
    }
    const updates = { ...req.body, clientId: task?.clientId || clientId };
    const updated = await routeDeps.updateTask(req.params.id, updates);
    if (!task?.geoFenceId && (updates.latitude || updates.longitude)) {
      try {
        const geofence = await createGeofenceForTask({ ...task, ...updates });
        if (geofence?.id) {
          const withGeo = await routeDeps.updateTask(req.params.id, { geoFenceId: geofence.id });
          return res.json({ task: withGeo, geofence });
        }
      } catch (geoError) {
        console.error("[tasks] Failed to create geofence on update", geoError);
      }
    }
    res.json({ task: updated });
  } catch (error) {
    const correlationId = res.get?.("X-Correlation-Id") || req.get?.("x-correlation-id");
    console.error("[tasks] update failed", {
      correlationId,
      code: error?.code,
      message: error?.message,
      meta: error?.meta,
      stack: error?.stack,
    });
    if (error?.code === "P2022") {
      return next(createError(500, "Banco desatualizado. Execute prisma migrate deploy."));
    }
    next(error);
  }
});

export default router;
