import express from "express";
import cookieParser from "cookie-parser";
import createError from "http-errors";

import { config } from "./config.js";
import authRoutes from "./routes/auth.js";
import clientRoutes from "./routes/clients.js";
import userRoutes from "./routes/users.js";
import proxyRoutes from "./routes/proxy.js";
import coreRoutes from "./routes/core.js";

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

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", authRoutes);
app.use("/api", proxyRoutes);
app.use("/api/core", coreRoutes);
app.use("/api", clientRoutes);
app.use("/api", userRoutes);

app.use((req, _res, next) => {
  next(createError(404, `Rota não encontrada: ${req.method} ${req.originalUrl}`));
});

app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const payload = {
    message: err.expose ? err.message : "Erro interno no servidor",
  };
  if (process.env.NODE_ENV !== "production") {
    payload.details = err.message;
  }
  res.status(status).json(payload);
});

export default app;
