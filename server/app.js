// server/app.js
import express from "express";
import cookieParser from "cookie-parser";
import createError from "http-errors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
import permissionRoutes from "./routes/permissions.js";
import traccarDbRoutes from "./routes/traccar-db.js";
import geocodeRoutes from "./routes/geocode.js";
import geofenceGroupRoutes from "./routes/geofence-groups.js";
import geofenceRoutes from "./routes/geofences.js";
import routeRoutes from "./routes/route.js";
import proxyRoutes from "./routes/proxy.js";
import itineraryRoutes from "./routes/itineraries.js";
import euroRoutes from "./routes/euro-routes.js";
import trackerMappingRoutes from "./routes/tracker-mappings.js";
import mapMatchingRoutes from "./routes/map-matching.js";
import protocolRoutes from "./routes/protocols.js";
import alertRoutes from "./routes/alerts.js";
import serviceOrderRoutes from "./routes/service-orders.js";
import xdmRoutes from "./routes/xdm.js";
import xdmAdminRoutes from "./routes/xdm-admin.js";
import mirrorRoutes from "./routes/mirrors.js";
import { errorHandler } from "./middleware/error-handler.js";
import { formatVersionText, getVersionInfo } from "./utils/version.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.resolve(__dirname, "../client/dist");
const clientIndexPath = path.join(clientDistPath, "index.html");

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

app.get("/api/version", (_req, res) => {
  res.json(getVersionInfo());
});

app.get("/version.txt", (_req, res) => {
  res.type("text/plain").send(formatVersionText(getVersionInfo()));
});

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
app.use("/api", mirrorRoutes);
app.use("/api", moduleRoutes);
app.use("/api", analyticsRoutes);
app.use("/api", exportRoutes);
app.use("/api", preferencesRoutes);
app.use("/api", mediaRoutes);
app.use("/api", permissionRoutes);
app.use("/api", traccarDbRoutes);
app.use("/api", trackerMappingRoutes);
app.use("/api", geocodeRoutes);
app.use("/api", proxyRoutes);
app.use("/api", alertRoutes);
app.use("/api", itineraryRoutes);
app.use("/api", euroRoutes);
app.use("/api", mapMatchingRoutes);
app.use("/api", protocolRoutes);
app.use("/api", xdmRoutes);
app.use("/api/core", serviceOrderRoutes);
app.use("/api/admin", xdmAdminRoutes);

if (fs.existsSync(clientDistPath)) {
  app.use(
    express.static(clientDistPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html") || filePath.endsWith("version.json")) {
          res.setHeader("Cache-Control", "no-store");
        }
      },
    }),
  );
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/health") || req.path.startsWith("/ws")) {
      return next();
    }
    return res.sendFile(clientIndexPath);
  });
} else {
  console.warn(`[startup] Build do front não encontrado em ${clientDistPath}. O backend servirá apenas a API.`);
}


app.use((req, _res, next) => {
  next(createError(404, `Rota não encontrada: ${req.method} ${req.originalUrl}`));
});

app.use(errorHandler);

export default app;
