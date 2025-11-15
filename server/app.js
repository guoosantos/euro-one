import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import createError from "http-errors";

import { config } from "./config.js";
import authRoutes from "./routes/auth.js";
import clientRoutes from "./routes/clients.js";
import userRoutes from "./routes/users.js";
import proxyRoutes from "./routes/proxy.js";

const app = express();

const allowedOrigins = config.cors.origins.length ? config.cors.origins : ["http://localhost:5173"];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, origin || allowedOrigins[0]);
      }
      if (process.env.NODE_ENV !== "production") {
        console.warn(`Bloqueando origem não autorizada: ${origin}`);
      }
      return callback(createError(403, "Origem não autorizada"));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", authRoutes);
app.use("/api", clientRoutes);
app.use("/api", userRoutes);
app.use("/api", proxyRoutes);

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
