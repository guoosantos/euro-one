// server/app.js
import express from "express";
import cookieParser from "cookie-parser";
import createError from "http-errors";

import { config } from "./config.js";
import authRoutes from "./routes/auth.js";
import clientRoutes from "./routes/clients.js";
import userRoutes from "./routes/users.js";
import coreRoutes from "./routes/core.js";
import modelRoutes from "./routes/models.js";
import groupRoutes from "./routes/groups.js";
import healthRoutes from "./routes/health.js";
import moduleRoutes from "./routes/modules.js";
import taskRoutes from "./routes/tasks.js";
import analyticsRoutes from "./routes/analytics.js";
import exportRoutes from "./routes/export.js";
import preferencesRoutes from "./routes/preferences.js";
import mediaRoutes from "./routes/media.js";
import crmRoutes from "./routes/crm.js";
import traccarDbRoutes from "./routes/traccar-db.js";
import geocodeRoutes from "./routes/geocode.js";


import geofenceGroupRoutes from "./routes/geofence-groups.js";


import { errorHandler } from "./middleware/error-handler.js";

const app = express();

const viteHosts = ["localhost", "127.0.0.1"];
const vitePorts = Array.from({ length: 18 }, (_item, index) => 5173 + index);
const viteOrigins = viteHosts.flatMap((host) =>
  vitePorts.map((port) => `http://${host}:${port}`),
);

const configuredOrigins = config.cors.origins.length ? config.cors.origins : [];
const allowedOriginsSet = new Set([...viteOrigins, ...configuredOrigins]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isAllowedOrigin = !origin || allowedOriginsSet.has(origin);

  if (origin && isAllowedOrigin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Vary", "Origin");
  }

  const requestHeaders = req.headers["access-control-request-headers"]; // Pré-flight usa este header
  res.header("Access-Control-Allow-Headers", requestHeaders || "Authorization, Content-Type, X-Requested-With");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");

  if (!isAllowedOrigin && origin) {
    if (req.method === "OPTIONS") {
      return res.status(403).json({ message: "Origem não autorizada" });
    }
    return next(createError(403, "Origem não autorizada"));
  }

  if (req.method === "OPTIONS") {
    return res.status(204).send();
  }

  next();
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/health", healthRoutes);
app.use("/api/health", healthRoutes);

app.use("/api", authRoutes);
app.use("/api", modelRoutes);
app.use("/api/core", coreRoutes);
app.use("/api/core", taskRoutes);
app.use("/api/crm", crmRoutes);
app.use("/api", geofenceGroupRoutes);
app.use("/api", geofenceRoutes);
app.use("/api", routeRoutes);
app.use("/api", clientRoutes);
app.use("/api", groupRoutes);
app.use("/api", userRoutes);
app.use("/api", moduleRoutes);
app.use("/api", analyticsRoutes);
app.use("/api", exportRoutes);
app.use("/api", preferencesRoutes);
app.use("/api", mediaRoutes);
app.use("/api", traccarDbRoutes);
app.use("/api", geocodeRoutes);
app.use("/api", proxyRoutes);

app.use("/api", geofenceGroupRoutes);


app.use((req, _res, next) => {
  next(createError(404, `Rota não encontrada: ${req.method} ${req.originalUrl}`));
});

app.use(errorHandler);

export default app;
