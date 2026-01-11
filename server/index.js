import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { WebSocketServer, WebSocket } from "ws";

import { loadEnv, validateEnv } from "./utils/env.js";
import { assertDemoFallbackSafety } from "./services/fallback-data.js";
import { getGeozoneGroupOverrideConfig } from "./services/xdm/xdm-utils.js";
import { extractToken } from "./middleware/auth.js";

const logErrorStack = (label, error) => {
  console.error(label, {
    message: error?.message || error,
    stack: error?.stack || error,
  });
};

process.on("uncaughtException", (error) => {
  logErrorStack("[startup] uncaughtException", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logErrorStack("[startup] unhandledRejection", reason);
  process.exit(1);
});

process.on("beforeExit", (code) => {
  console.warn("[startup] beforeExit", { code });
});

process.on("exit", (code) => {
  console.warn("[startup] exit", { code });
});

const importWithLog = (path, { required = false } = {}) => {
  console.info(`[startup] importing ${path}`);
  return import(path)
    .then((module) => {
      console.info(`[startup] imported ${path} ok`);
      return module;
    })
    .catch((error) => {
      logErrorStack(`[startup] failed importing ${path}`, error);
      if (required) {
        throw error;
      }
      return null;
    });
};

const runWithTimeout = (operation, timeoutMs, label) => {
  const controller = new AbortController();
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`));
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const operationPromise = Promise.resolve().then(() => operation(controller.signal));
  operationPromise.catch(() => {});

  return Promise.race([operationPromise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
};

async function bootstrapServer() {
  console.info("[startup] API inicializando…");

  try {
    await loadEnv();
  } catch (error) {
    console.warn("[startup] Falha ao carregar variáveis de ambiente; seguindo com defaults.", {
      message: error?.message || error,
      stack: process.env.NODE_ENV !== "production" ? error?.stack : undefined,
    });
  }

  console.info("[startup] XDM env loaded", {
    authUrl: process.env.XDM_AUTH_URL || null,
    baseUrl: process.env.XDM_BASE_URL || null,
    clientId: process.env.XDM_CLIENT_ID || null,
    dealerId: process.env.XDM_DEALER_ID || null,
    configName: process.env.XDM_CONFIG_NAME || process.env.XDM_CONFIG_ID || null,
    secretLen: process.env.XDM_CLIENT_SECRET ? String(process.env.XDM_CLIENT_SECRET).length : 0,
  });
  const overrideConfig = getGeozoneGroupOverrideConfig();
  const overrideLogPayload = {
    overrideId: overrideConfig.overrideId,
    overrideIdValid: overrideConfig.isValid,
    overrideSource: overrideConfig.source,
    overrideRaw: overrideConfig.rawValue,
  };
  if (overrideConfig.isValid) {
    console.info("[startup] XDM override config", overrideLogPayload);
  } else {
    console.warn("[startup] XDM override config inválido", overrideLogPayload);
  }

  const { missing } = validateEnv(["JWT_SECRET", "TRACCAR_BASE_URL"], { optional: true });
  if (missing.length) {
    console.warn(
      "[startup] Variáveis de ambiente ausentes; verifique o .env antes de subir em produção.",
      { missing },
    );
  }

  try {
    assertDemoFallbackSafety();
  } catch (error) {
    console.warn("[startup] Verificação de fallback em modo demo falhou.", {
      message: error?.message || error,
      stack: process.env.NODE_ENV !== "production" ? error?.stack : undefined,
    });
  }

  if (
    !process.env.TRACCAR_ADMIN_TOKEN &&
    (!process.env.TRACCAR_ADMIN_USER || !process.env.TRACCAR_ADMIN_PASSWORD)
  ) {
    console.warn(
      "[startup] Nenhum token ou usuário/senha administrativa do Traccar informado; rotas protegidas podem falhar.",
    );
  }

  const host = process.env.HOST || "0.0.0.0";
  const rawPort = process.env.PORT ?? "3001";
  console.info(
    `[startup] env PORT=${rawPort} HOST=${host} NODE_ENV=${process.env.NODE_ENV || "development"}`,
  );
  const port = Number(rawPort);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`PORT inválida: ${rawPort}`);
  }

  let ready = false;
  let stopGeocodeWorker = () => {};
  let stopGeocodeMonitor = () => {};
  const app = express();
  app.get("/health", (_req, res) => res.status(200).json({ ok: true }));
  app.get("/ready", (_req, res) => {
    res.status(ready ? 200 : 503).json({ ok: ready, ready });
  });

  const server = http.createServer(app);
  server.on("error", (error) => {
    const code = error?.code;
    const reason =
      code === "EADDRINUSE"
        ? "Porta já está em uso; ajuste a PORT ou libere o socket"
        : code === "EACCES"
          ? "Permissão negada ao tentar bindar a porta"
          : "Erro ao iniciar servidor HTTP";
    console.error(`[startup] ${reason}`, {
      message: error?.message || error,
      code,
      host,
      port,
      stack: process.env.NODE_ENV !== "production" ? error?.stack : undefined,
    });
    process.exit(1);
  });

  console.info(`[startup] before listen host=${host} port=${port} (type=${typeof port})`);
  await new Promise((resolve) => {
    server.listen({ port, host }, resolve);
  });
  console.info(`[startup] listening on http://${host}:${port}`);
  console.log(`API Rodando na porta ${port}`);

  const bootstrapPhase2 = async () => {
    const bootstrapTimeout = Number(process.env.BOOTSTRAP_INIT_TIMEOUT_MS) || 8000;

    const storageModule = await importWithLog("./services/storage.js", { required: true });
    if (storageModule?.initStorage) {
      await runWithTimeout(() => storageModule.initStorage(), bootstrapTimeout, "initStorage");
    }

    const prismaModule = await importWithLog("./services/prisma.js");
    if (prismaModule?.initPrismaEnv) {
      await runWithTimeout(() => prismaModule.initPrismaEnv(), bootstrapTimeout, "initPrismaEnv");
    }

    const vehiclesModule = await importWithLog("./models/vehicle.js");
    if (vehiclesModule?.initVehicles) {
      try {
        await runWithTimeout(() => vehiclesModule.initVehicles(), bootstrapTimeout, "initVehicles");
      } catch (error) {
        console.warn("[startup] Falha ao hidratar veículos", error?.message || error);
      }
    }

    const addressModule = await importWithLog("./utils/address.js");
    if (addressModule?.initGeocodeCache) {
      try {
        await runWithTimeout(() => addressModule.initGeocodeCache(), bootstrapTimeout, "initGeocodeCache");
      } catch (error) {
        console.warn("[startup] Falha ao hidratar cache de endereços", error?.message || error);
      }
    }

    const geocodeWorkerModule = await importWithLog("./workers/geocode.worker.js");
    if (geocodeWorkerModule?.startGeocodeWorker) {
      try {
        stopGeocodeWorker = geocodeWorkerModule.startGeocodeWorker();
      } catch (error) {
        console.warn("[startup] Falha ao iniciar geocode worker", error?.message || error);
      }
    }

    const geocodeMonitorModule = await importWithLog("./services/geocode-monitor.js");
    if (geocodeMonitorModule?.startGeocodeMonitor) {
      try {
        stopGeocodeMonitor = geocodeMonitorModule.startGeocodeMonitor();
      } catch (error) {
        console.warn("[startup] Falha ao iniciar geocode monitor", error?.message || error);
      }
    }

    let stopXdmPoller = () => {};
    const xdmPollerModule = await importWithLog("./jobs/xdm-deployments-poller.js");
    if (xdmPollerModule?.startXdmDeploymentsPoller) {
      try {
        stopXdmPoller = xdmPollerModule.startXdmDeploymentsPoller();
      } catch (error) {
        console.warn("[startup] Falha ao iniciar poller XDM", error?.message || error);
      }
    }

    const appModule = await importWithLog("./app.js", { required: true });
    const realApp = appModule?.default;
    if (!realApp) {
      throw new Error("app.js não exportou um app válido");
    }
    app.use(realApp);

    const configModule = await importWithLog("./config.js", { required: true });
    const { config } = configModule || {};

    const traccarModule = await importWithLog("./services/traccar.js");
    const traccarSyncModule = await importWithLog("./services/traccar-sync.js");
    const traccarDbModule = await importWithLog("./services/traccar-db.js");
    const deviceModule = await importWithLog("./models/device.js");

    if (config?.osrm && !config.osrm.baseUrl) {
      console.warn("[startup] OSRM_BASE_URL não configurado: map matching ficará em modo passthrough.");
    }

    if (traccarModule?.describeTraccarMode && traccarDbModule?.isTraccarDbConfigured) {
      const traccarMode = traccarModule.describeTraccarMode({
        traccarDbConfigured: traccarDbModule.isTraccarDbConfigured(),
      });
      console.info("[startup] Traccar mode", {
        apiBaseUrl: traccarMode.apiBaseUrl,
        traccarConfigured: traccarMode.traccarConfigured,
        traccarDbConfigured: traccarMode.traccarDbConfigured,
        adminAuth: traccarMode.adminAuth,
      });
    }

    const liveSockets = new Map();
    const wss = new WebSocketServer({ noServer: true, path: "/ws/live" });
    const TELEMETRY_INTERVAL_MS = Number(process.env.WS_LIVE_INTERVAL_MS) || 5000;
    let stopSync = () => {};
    let telemetryInterval;

    const canStartTelemetry =
      config?.jwt?.secret &&
      deviceModule?.listDevices &&
      traccarDbModule?.fetchLatestPositionsWithFallback;

    const authenticateWebSocket = (req) => {
      const token = extractToken(req);
      if (!token) {
        return null;
      }

      try {
        return jwt.verify(token, config.jwt.secret);
      } catch (error) {
        console.warn("[ws-live] Token inválido na conexão WebSocket", {
          message: error?.message || error,
          path: req.url,
        });
        return null;
      }
    };

    const removeSocketFromClient = (clientId, socket) => {
      const sockets = liveSockets.get(clientId);
      if (!sockets) return;

      sockets.delete(socket);
      if (!sockets.size) {
        liveSockets.delete(clientId);
      }
    };

    const normalisePositionMessage = (positions = []) => {
      return positions.map((item) => ({
        deviceId: item.deviceId,
        latitude: item.latitude,
        longitude: item.longitude,
        speed: item.speed,
        course: item.course,
        timestamp: item.fixTime || item.serverTime || item.deviceTime || null,
        address: item.address || "",
      }));
    };

    const pushTelemetryToClient = async (clientId, sockets) => {
      if (!sockets || !sockets.size) return;
      try {
        const devices = deviceModule.listDevices({ clientId });
        const deviceIds = devices
          .map((device) => (device?.traccarId != null ? String(device.traccarId) : null))
          .filter(Boolean);
        if (!deviceIds.length) return;

        // Este WebSocket usa o banco do Traccar via módulo traccarDb como fonte de dados em tempo quase real (arquitetura C).
        const positions = await traccarDbModule.fetchLatestPositionsWithFallback(deviceIds, null);
        const payload = JSON.stringify({
          type: "positions",
          data: normalisePositionMessage(positions),
        });

        sockets.forEach((socket) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(payload);
          }
        });
      } catch (error) {
        console.error(`[ws-live] Erro ao buscar telemetria para o client ${clientId}:`, error);
        const errorPayload = JSON.stringify({
          type: "error",
          data: { message: "Falha ao atualizar dados de telemetria." },
        });

        sockets.forEach((socket) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(errorPayload);
          }
        });
      }
    };

    const dispatchTelemetry = async () => {
      for (const [clientId, sockets] of liveSockets.entries()) {
        if (!sockets.size) {
          liveSockets.delete(clientId);
          continue;
        }

        // Não chamamos a API HTTP do Traccar diretamente neste fluxo.
        await pushTelemetryToClient(clientId, sockets);
      }
    };

    if (canStartTelemetry) {
      wss.on("connection", async (socket, req, user) => {
        const clientId = user?.clientId;
        if (!clientId) {
          socket.close(4401, "Cliente não identificado");
          return;
        }

        const sockets = liveSockets.get(clientId) || new Set();
        sockets.add(socket);
        liveSockets.set(clientId, sockets);

        socket.on("close", () => removeSocketFromClient(clientId, socket));
        socket.on("error", () => removeSocketFromClient(clientId, socket));

        await pushTelemetryToClient(clientId, sockets);
      });

      server.on("upgrade", (req, socket, head) => {
        const { pathname } = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
        if (pathname !== "/ws/live") {
          socket.destroy();
          return;
        }

        const user = authenticateWebSocket(req);
        if (!user) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req, user);
        });
      });

      telemetryInterval = setInterval(() => {
        void dispatchTelemetry();
      }, TELEMETRY_INTERVAL_MS);
    } else {
      console.warn("[startup] WebSocket /ws/live desativado: dependências não disponíveis.");
    }

    const startExternalBootstrap = async () => {
      const traccarInitTimeout = Number(process.env.TRACCAR_INIT_TIMEOUT_MS) || 5000;

      if (!traccarModule?.initializeTraccarAdminSession) {
        console.warn("[startup] Traccar admin session indisponível; pulando bootstrap.");
        return;
      }

      try {
        await runWithTimeout(
          (signal) => traccarModule.initializeTraccarAdminSession({ signal }),
          traccarInitTimeout,
          "initializeTraccarAdminSession",
        ).then((traccarInit) => {
          if (traccarInit?.ok && traccarSyncModule?.startTraccarSyncJob) {
            stopSync = traccarSyncModule.startTraccarSyncJob();
          } else {
            console.warn(
              "[startup] Sincronização automática do Traccar não iniciada no startup.",
              traccarInit?.reason || "",
            );
            stopSync = () => {};
          }
        });
      } catch (error) {
        stopSync = () => {};
        console.warn(
          "[startup] Falha ao inicializar Traccar:",
          error?.message || error,
          process.env.NODE_ENV !== "production" ? error : "",
        );
        console.warn("[startup] Erro na inicialização do Traccar, mas ouvindo a porta.");
      }
    };

    startExternalBootstrap().catch((error) => {
      console.warn("[startup] Erro inesperado durante bootstrap externo.", {
        message: error?.message || error,
        stack: process.env.NODE_ENV !== "production" ? error?.stack : undefined,
      });
    });

    const shutdown = () => {
      if (stopSync) {
        stopSync();
      }
      if (telemetryInterval) {
        clearInterval(telemetryInterval);
      }
      wss.close();
      stopGeocodeWorker();
      stopGeocodeMonitor();
      stopXdmPoller();
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    ready = true;
    console.info("[startup] ready=true (fase 2 concluída)");
  };

  bootstrapPhase2().catch((error) => {
    logErrorStack("[startup] Falha ao concluir fase 2", error);
    process.exit(1);
  });
}

bootstrapServer().catch((error) => {
  logErrorStack("[startup] Falha ao iniciar a API", error);
  process.exit(1);
});
