import http from "http";

import app from "./app.js";
import { config } from "./config.js";

const server = http.createServer(app);

server.listen(config.port, () => {
  console.log(`Euro One API rodando em http://localhost:${config.port}`);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});
