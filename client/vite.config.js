import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendTarget = (process.env.VITE_API_BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    fs: {
      allow: [repoRoot],
    },
    proxy: {
      "/api": backendTarget,
      "/core": backendTarget,
    },
  },
  build: { outDir: "dist" },
});
