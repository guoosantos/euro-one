import http from "http";
import jwt from "jsonwebtoken";
import { WebSocketServer, WebSocket } from "ws";

import { loadEnv, validateEnv } from "./utils/env.js";
import { assertDemoFallbackSafety } from "./services/fallback-data.js";
import { extractToken } from "./middleware/auth.js";

async function bootstrap() {
  console.info("[startup] API inicializando…");

  try {
    await loadEnv();
  } catch (error) {
    console.warn("[startup] Falha ao carregar variáveis de ambiente; seguindo com defaults.", {
      message: error?.message || error,
      stack: process.env.NODE_ENV !== "production" ? error?.stack : undefined,
    });
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

  const [
    { default: app },
    { describeTraccarMode, initializeTraccarAdminSession },
    { startTraccarSyncJob },
    { fetchLatestPositionsWithFallback, isTraccarDbConfigured },
    { listDevices },
    { config },
  ] = await Promise.all([
    import("./app.js"),
    import("./services/traccar.js"),
    import("./services/traccar-sync.js"),
    import("./services/traccar-db.js"),
    import("./models/device.js"),
    import("./config.js"),
  ]);

  const host = process.env.HOST || "0.0.0.0";
  const rawPort = process.env.PORT ?? "3001";
  console.info(
    `[startup] env PORT=${rawPort} (type=${typeof rawPort}) HOST=${host} NODE_ENV=${process.env.NODE_ENV || "development"}`,
  );
  const port = Number(rawPort);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`PORT inválida: ${rawPort}`);
  }
  console.info("[startup] Porta resolvida", { port, type: typeof port });
  const server = http.createServer(app);
  const liveSockets = new Map();
  const wss = new WebSocketServer({ noServer: true, path: "/ws/live" });
  const TELEMETRY_INTERVAL_MS = Number(process.env.WS_LIVE_INTERVAL_MS) || 5000;
  let stopSync = () => {};
  let telemetryInterval;

  if (!config.osrm?.baseUrl) {
    console.warn("[startup] OSRM_BASE_URL não configurado: map matching ficará em modo passthrough.");
  }

  const traccarMode = describeTraccarMode({ traccarDbConfigured: isTraccarDbConfigured() });
  console.info("[startup] Traccar mode", {
    apiBaseUrl: traccarMode.apiBaseUrl,
    traccarConfigured: traccarMode.traccarConfigured,
    traccarDbConfigured: traccarMode.traccarDbConfigured,
    adminAuth: traccarMode.adminAuth,
  });

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
      const devices = listDevices({ clientId });
      const deviceIds = devices
        .map((device) => (device?.traccarId != null ? String(device.traccarId) : null))
        .filter(Boolean);
      if (!deviceIds.length) return;

      // Este WebSocket usa o banco do Traccar via módulo traccarDb como fonte de dados em tempo quase real (arquitetura C).
      const positions = await fetchLatestPositionsWithFallback(deviceIds, null);
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

  telemetryInterval = setInterval(() => {
    void dispatchTelemetry();
  }, TELEMETRY_INTERVAL_MS);

  server.on("error", (error) => {
    console.error("[startup] Erro ao iniciar servidor HTTP", {
      message: error?.message || error,
      code: error?.code,
      stack: process.env.NODE_ENV !== "production" ? error?.stack : undefined,
    });
    process.exit(1);
  });

  console.info("[startup] Iniciando server.listen", { host, port });
  server.listen({ port, host }, () => {
    console.info(`[startup] listening on http://${host}:${port}`);
    console.log(`API Rodando na porta ${port}`);
  });

  const startExternalBootstrap = async () => {
    const traccarInitTimeout = Number(process.env.TRACCAR_INIT_TIMEOUT_MS) || 5000;

    try {
      await runWithTimeout(
        (signal) => initializeTraccarAdminSession({ signal }),
        traccarInitTimeout,
        "initializeTraccarAdminSession",
      ).then((traccarInit) => {
        if (traccarInit?.ok) {
          stopSync = startTraccarSyncJob();
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

  // Executa inicializações externas sem bloquear o servidor HTTP.
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
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

bootstrap().catch((error) => {
  console.error("[startup] Falha ao iniciar a API", {
    message: error?.message || error,
    stack: process.env.NODE_ENV !== "production" ? error?.stack : undefined,
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});
