import http from "http";
import jwt from "jsonwebtoken";
import { WebSocketServer, WebSocket } from "ws";

import { loadEnv } from "./utils/env.js";

async function bootstrap() {
  await loadEnv();

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

  const PORT = Number(process.env.PORT) || 3001;
  const server = http.createServer(app);
  const liveSockets = new Map();
  const wss = new WebSocketServer({ noServer: true, path: "/ws/live" });
  const TELEMETRY_INTERVAL_MS = Number(process.env.WS_LIVE_INTERVAL_MS) || 5000;
  let stopSync;
  let telemetryInterval;

  const traccarMode = describeTraccarMode({ traccarDbConfigured: isTraccarDbConfigured() });
  console.info("[startup] Traccar mode", {
    apiBaseUrl: traccarMode.apiBaseUrl,
    traccarConfigured: traccarMode.traccarConfigured,
    traccarDbConfigured: traccarMode.traccarDbConfigured,
    adminAuth: traccarMode.adminAuth,
  });

  const extractTokenFromRequest = (req) => {
    const authHeader = req.headers?.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7);
    }

    const cookieHeader = req.headers?.cookie || "";
    const cookies = Object.fromEntries(
      cookieHeader
        .split(";")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((pair) => {
          const [key, ...rest] = pair.split("=");
          return [key, rest.join("=")];
        }),
    );

    return cookies.token || null;
  };

  const authenticateWebSocket = (req) => {
    const token = extractTokenFromRequest(req);
    if (!token) {
      throw new Error("Token ausente");
    }

    return jwt.verify(token, config.jwt.secret);
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
      const positions = await fetchLatestPositionsWithFallback(deviceIds, clientId);
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

    let user;
    try {
      user = authenticateWebSocket(req);
    } catch (error) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, user);
    });
  });

  try {
    const traccarInit = await initializeTraccarAdminSession();
    if (traccarInit?.ok) {
      stopSync = startTraccarSyncJob();
    } else {
      console.warn("Sincronização automática do Traccar não iniciada no startup.", traccarInit?.reason || "");
      stopSync = () => {};
    }
  } catch (error) {
    stopSync = () => {};
    console.warn("Não foi possível inicializar a sessão administrativa do Traccar", error?.message || error);
  }

  telemetryInterval = setInterval(() => {
    void dispatchTelemetry();
  }, TELEMETRY_INTERVAL_MS);

  server.listen(PORT, () => {
    console.log(`API Rodando na porta ${PORT}`);
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

bootstrap();

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});
