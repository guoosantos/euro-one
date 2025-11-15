import app from "./app.js";
import { initializeTraccarAdminSession } from "./services/traccar.js";
import { loadEnv } from "./utils/env.js";

async function bootstrap() {
  await loadEnv();
  const port = process.env.PORT || 3001;
  try {
    await initializeTraccarAdminSession();
  } catch (error) {
    console.error("Não foi possível inicializar a sessão administrativa do Traccar", error);
  }

  app.listen(port, () => {
    console.log(`API Rodando na porta ${port}`);
  });
}

bootstrap();

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});
