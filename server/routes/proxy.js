import express from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { traccarProxy, traccarRequest } from "../services/traccar.js";

const router = express.Router();

router.use(authenticate);

router.get("/devices", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", "/devices", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/positions", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", "/positions", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/positions/last", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", "/positions/last", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/events", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", "/events", { params: req.query, asAdmin: true });
    res.json(data);
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
