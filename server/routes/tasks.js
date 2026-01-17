import express from "express";
import createError from "http-errors";

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
    next(error);
  }
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseDateParam(value, label) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createError(400, `Parâmetro ${label} inválido`);
  }
  return date;
}

function assertValidClientId(clientId) {
  if (!clientId) return;
  if (!UUID_REGEX.test(String(clientId))) {
    throw createError(400, "clientId inválido");
  }
}

router.get("/tasks", (req, res, next) => routeDeps.resolveClientIdMiddleware(req, res, next), async (req, res, next) => {
  try {
    const clientId = routeDeps.resolveClientId(req, req.query?.clientId, { required: false });
    assertValidClientId(clientId);
    const { from: fromRaw, to: toRaw, ...restQuery } = req.query || {};
    const from = parseDateParam(fromRaw, "from");
    const to = parseDateParam(toRaw, "to");
    if (from && to && from > to) {
      throw createError(400, "Intervalo de datas inválido");
    }
    const tasks = await routeDeps.listTasks({ ...restQuery, clientId, from, to });
    res.json({ tasks });
  } catch (error) {
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
    next(error);
  }
});

export default router;
