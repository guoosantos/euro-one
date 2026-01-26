import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { errorHandler } from "../middleware/error-handler.js";
import { loadEnv } from "../utils/env.js";

async function withProductionEnvFile(contents, fn) {
  const envPath = "/home/ubuntu/euro-one/server/.env";
  let previous = null;
  try {
    previous = await fs.readFile(envPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.mkdir(path.dirname(envPath), { recursive: true });
  await fs.writeFile(envPath, contents, "utf8");

  try {
    await fn();
  } finally {
    if (previous == null) {
      await fs.rm(envPath, { force: true });
    } else {
      await fs.writeFile(envPath, previous, "utf8");
    }
  }
}

async function withTempEnv(vars, fn) {
  const previous = {};
  Object.keys(vars).forEach((key) => {
    previous[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  });
  try {
    await fn();
  } finally {
    Object.keys(vars).forEach((key) => {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    });
  }
}

function setupApp(contextRoutes) {
  const app = express();
  app.use(express.json());
  app.use("/api", contextRoutes);
  app.use(errorHandler);
  return app;
}

async function callEndpoint(app, { path: requestPath, token }) {
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}${requestPath}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json();
  server.close();
  return { status: response.status, payload };
}

describe("GET /api/context env info", () => {
  it("reporta envPathCarregado em produção quando o .env padrão existe", async () => {
    await withTempEnv({ NODE_ENV: "production", ENABLE_DEMO_FALLBACK: "true" }, async () => {
      await withProductionEnvFile("MIRROR_MODE_ENABLED=false\n", async () => {
        const { signSession } = await import("../middleware/auth.js");
        const { default: contextRoutes } = await import("../routes/context.js");
        await loadEnv();
        const app = setupApp(contextRoutes);
        const token = signSession({ id: "admin-user", role: "admin", clientId: "admin-client" });
        const response = await callEndpoint(app, { path: "/api/context", token });

        assert.equal(response.status, 200);
        assert.equal(response.payload?.envPathCarregado, "/home/ubuntu/euro-one/server/.env");
      });
    });
  });
});
