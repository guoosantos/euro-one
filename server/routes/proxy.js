import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { listDevices } from "../models/device.js";
import { traccarProxy, traccarRequest } from "../services/traccar.js";

const router = express.Router();

router.use(authenticate);

function resolveAllowedDeviceIds(req) {
  if (req.user?.role === "admin") {
    return null;
  }
  if (!req.user?.clientId) {
    throw createError(403, "Usuário não vinculado a um cliente");
  }
  const devices = listDevices({ clientId: req.user.clientId });
  const traccarIds = devices
    .map((device) => (device?.traccarId ? String(device.traccarId) : null))
    .filter(Boolean);
  if (!traccarIds.length) {
    throw createError(403, "Cliente não possui dispositivos sincronizados");
  }
  return traccarIds;
}

function extractDeviceIds(source = {}) {
  const values = [];
  const pushValue = (entry) => {
    if (entry === undefined || entry === null) return;
    if (Array.isArray(entry)) {
      entry.forEach(pushValue);
      return;
    }
    const stringValue = String(entry).trim();
    if (!stringValue) return;
    if (stringValue.includes(",")) {
      stringValue.split(",").forEach((part) => pushValue(part));
      return;
    }
    values.push(stringValue);
  };
  pushValue(source.deviceId);
  pushValue(source.deviceID);
  pushValue(source.device_id);
  pushValue(source.deviceIds);
  pushValue(source.device_ids);
  pushValue(source.devices);
  pushValue(source.id);
  return values;
}

function enforceDeviceFilterInQuery(req) {
  const allowed = resolveAllowedDeviceIds(req);
  if (!allowed) {
    return;
  }
  const requested = extractDeviceIds(req.query || {});
  if (!requested.length) {
    req.query.deviceIds = allowed.join(",");
    req.query.deviceId = allowed;
    return;
  }
  const invalid = requested.some((value) => !allowed.includes(String(value)));
  if (invalid) {
    throw createError(403, "Dispositivo não autorizado para este cliente");
  }
}

function enforceDeviceFilterInBody(req) {
  const allowed = resolveAllowedDeviceIds(req);
  if (!allowed) {
    return;
  }
  const requested = extractDeviceIds(req.body || {});
  if (!requested.length) {
    throw createError(400, "deviceId é obrigatório");
  }
  const invalid = requested.some((value) => !allowed.includes(String(value)));
  if (invalid) {
    throw createError(403, "Dispositivo não autorizado para este cliente");
  }
}

async function proxyTraccarReport(req, res, next, path) {
  try {
    enforceDeviceFilterInQuery(req);
    const format = String(req.query?.format || "").toLowerCase();
    const params = { ...req.query };
    if (format === "csv") {
      const response = await traccarRequest(
        {
          method: "get",
          url: path,
          params,
          headers: { Accept: "text/csv" },
          responseType: "arraybuffer",
        },
        null,
        { asAdmin: true },
      );
      res.setHeader("Content-Type", "text/csv");
      res.send(Buffer.from(response.data));
      return;
    }
    const data = await traccarProxy("get", path, { params, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
}

function sanitizeUserQuery(query = {}) {
  const nextParams = { ...query };
  delete nextParams.target;
  delete nextParams.scope;
  delete nextParams.provider;
  return nextParams;
}

function isTraccarUserRequest(req) {
  const marker = req.query?.target || req.query?.scope || req.query?.provider;
  return marker === "traccar";
}

router.get("/devices", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", "/devices", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/devices", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("post", "/devices", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/devices/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("put", `/devices/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/devices/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    await traccarProxy("delete", `/devices/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/positions", async (req, res, next) => {
  try {
    enforceDeviceFilterInQuery(req);
    const data = await traccarProxy("get", "/positions", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/positions/last", async (req, res, next) => {
  try {
    enforceDeviceFilterInQuery(req);
    const data = await traccarProxy("get", "/positions/last", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/events", async (req, res, next) => {
  try {
    enforceDeviceFilterInQuery(req);
    const data = await traccarProxy("get", "/events", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/groups", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", "/groups", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/groups", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("post", "/groups", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/groups/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("put", `/groups/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/groups/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    await traccarProxy("delete", `/groups/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/drivers", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", "/drivers", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/drivers", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("post", "/drivers", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/drivers/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("put", `/drivers/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/drivers/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    await traccarProxy("delete", `/drivers/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/commands", async (req, res, next) => {
  try {
    enforceDeviceFilterInQuery(req);
    const data = await traccarProxy("get", "/commands", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/commands", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    enforceDeviceFilterInBody(req);
    const data = await traccarProxy("post", "/commands", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/commands/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("put", `/commands/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/commands/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    await traccarProxy("delete", `/commands/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/reports/route", (req, res, next) => proxyTraccarReport(req, res, next, "/reports/route"));

router.get("/reports/summary", (req, res, next) => proxyTraccarReport(req, res, next, "/reports/summary"));

router.get("/reports/stops", (req, res, next) => proxyTraccarReport(req, res, next, "/reports/stops"));

router.get("/notifications", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", "/notifications", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/notifications", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("post", "/notifications", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/notifications/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("put", `/notifications/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/notifications/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    await traccarProxy("delete", `/notifications/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/users", async (req, res, next) => {
  if (!isTraccarUserRequest(req)) {
    return next();
  }
  try {
    const params = sanitizeUserQuery(req.query);
    const data = await traccarProxy("get", "/users", { params, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/users", requireRole("manager", "admin"), async (req, res, next) => {
  if (!isTraccarUserRequest(req)) {
    return next();
  }
  try {
    const data = await traccarProxy("post", "/users", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/users/:id", requireRole("manager", "admin"), async (req, res, next) => {
  if (!isTraccarUserRequest(req)) {
    return next();
  }
  try {
    const data = await traccarProxy("put", `/users/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/users/:id", requireRole("manager", "admin"), async (req, res, next) => {
  if (!isTraccarUserRequest(req)) {
    return next();
  }
  try {
    await traccarProxy("delete", `/users/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/geofences", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", "/geofences", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/geofences", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("post", "/geofences", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/geofences/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("put", `/geofences/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/geofences/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    await traccarProxy("delete", `/geofences/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post("/permissions", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("post", "/permissions", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/reports/trips", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    enforceDeviceFilterInBody(req);
    const format = req.body?.format;
    const response = await traccarRequest(
      {
        method: "post",
        url: "/reports/trips",
        data: req.body,
        responseType: format === "csv" || format === "xls" ? "arraybuffer" : "json",
      },
      null,
      { asAdmin: true },
    );
    if (format === "csv" || format === "xls") {
      res.setHeader("Content-Type", format === "xls" ? "application/vnd.ms-excel" : "text/csv");
      res.send(Buffer.from(response.data));
    } else {
      res.json(response.data);
    }
  } catch (error) {
    next(error);
  }
});

export default router;
