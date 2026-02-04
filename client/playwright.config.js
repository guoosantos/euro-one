import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "https://rastreamento.eurosolucoes.tech";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  retries: 0,
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  reporter: [["list"]],
});
