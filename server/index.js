import app from "./app.js";
import { initializeTraccarAdminSession } from "./services/traccar.js";
import { loadEnv } from "./utils/env.js";

async function bootstrap() {
  await loadEnv();
  const PORT = Number(process.env.PORT) || 3001;
  try {
    await initializeTraccarAdminSession();
  } catch (error) {
    console.warn("Não foi possível inicializar a sessão administrativa do Traccar", error?.message || error);
  }

  app.listen(PORT, () => {
    console.log(`API Rodando na porta ${PORT}`);
  });
}

bootstrap();

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});
