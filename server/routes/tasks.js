import express from "express";

import { resolveClientId, resolveClientIdMiddleware } from "../middleware/client.js";
import { requireAuth } from "../middleware/auth.js";
import { createTask, listTasks, getTaskById, updateTask } from "../models/task.js";

const router = express.Router();

router.use(requireAuth);

router.post("/tasks", resolveClientIdMiddleware, (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId, { required: true });
    const task = createTask({ ...req.body, clientId });
    res.status(201).json({ task });
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

router.put("/tasks/:id", resolveClientIdMiddleware, (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId);
    const task = getTaskById(req.params.id);
    if (clientId && task && String(task.clientId) !== String(clientId)) {
      return res.status(403).json({ message: "Task não pertence a este cliente" });
    }
    const updated = updateTask(req.params.id, { ...req.body, clientId: task?.clientId || clientId });
    res.json({ task: updated });
  } catch (error) {
    next(error);
  }
});

export default router;
