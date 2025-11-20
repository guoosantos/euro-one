import express from "express";

import { resolveClientId, resolveClientIdMiddleware } from "../middleware/client.js";
import { authenticate } from "../middleware/auth.js";
import { createTask, listTasks, getTaskById, updateTask } from "../models/task.js";
import { traccarRequest } from "../services/traccar.js";

const router = express.Router();

router.use(authenticate);

async function createGeofenceForTask(task) {
  if (!task?.latitude || !task?.longitude) return null;
  const radius = Number(task.geofenceRadius) || 150;
  const payload = {
    name: `Task-${task.id}`,
    description: task.address || "Task geofence",
    area: `CIRCLE (${task.longitude} ${task.latitude}, ${radius})`,
    attributes: { taskId: task.id },
  };
  const response = await traccarRequest({ method: "post", url: "/geofences", data: payload }, null, { asAdmin: true });
  const geofence = response?.data;
  if (task.vehicleId && geofence?.id) {
    await traccarRequest(
      { method: "post", url: "/permissions", data: { deviceId: Number(task.vehicleId), geofenceId: geofence.id } },
      null,
      { asAdmin: true },
    );
  }
  return geofence;
}

router.post("/tasks", resolveClientIdMiddleware, async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    const task = createTask({ ...req.body, clientId });
    let geofence = null;
    try {
      geofence = await createGeofenceForTask(task);
      if (geofence?.id) {
        const updated = updateTask(task.id, { geoFenceId: geofence.id });
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

router.get("/tasks", resolveClientIdMiddleware, (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query?.clientId);
    const tasks = listTasks({ ...req.query, clientId });
    res.json({ tasks });
  } catch (error) {
    next(error);
  }
});

router.put("/tasks/:id", resolveClientIdMiddleware, async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId);
    const task = getTaskById(req.params.id);
    if (clientId && task && String(task.clientId) !== String(clientId)) {
      return res.status(403).json({ message: "Task não pertence a este cliente" });
    }
    const updates = { ...req.body, clientId: task?.clientId || clientId };
    const updated = updateTask(req.params.id, updates);
    if (!task?.geoFenceId && (updates.latitude || updates.longitude)) {
      try {
        const geofence = await createGeofenceForTask({ ...task, ...updates });
        if (geofence?.id) {
          const withGeo = updateTask(req.params.id, { geoFenceId: geofence.id });
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
