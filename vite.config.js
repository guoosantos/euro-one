import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendTarget = process.env.VITE_API_BASE_URL || "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": backendTarget,
      "/core": backendTarget,
    },
  },
  build: { outDir: "dist" },
});
