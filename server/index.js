import http from "http";

import { loadEnv } from "./utils/env.js";

async function bootstrap() {
  await loadEnv();

  const [
    { default: app },
    { initializeTraccarAdminSession },
    { default: startTraccarSocketService },
    { startTraccarSyncJob },
  ] = await Promise.all([
    import("./app.js"),
    import("./services/traccar.js"),
    import("./services/traccar-socket.js"),
    import("./services/traccar-sync.js"),
  ]);

  const PORT = Number(process.env.PORT) || 3001;
  const server = http.createServer(app);
  let stopSync;
  try {
    await initializeTraccarAdminSession();
  } catch (error) {
    console.warn("Não foi possível inicializar a sessão administrativa do Traccar", error?.message || error);
  }

  startTraccarSocketService(server);
  stopSync = startTraccarSyncJob();

  server.listen(PORT, () => {
    console.log(`API Rodando na porta ${PORT}`);
  });

  const shutdown = () => {
    if (stopSync) {
      stopSync();
    }
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
