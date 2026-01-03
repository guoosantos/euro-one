import { execSync } from "node:child_process";
import { chromium } from "playwright";

function ensureChromiumInstalled() {
  try {
    const executable = chromium.executablePath();
    if (executable) {
      console.log(`[playwright] Chromium disponível em ${executable}`);
      return;
    }
  } catch (error) {
    console.warn("[playwright] Chromium não encontrado, iniciando instalação…", error?.message || error);
  }

  try {
    console.log("[playwright] Instalando navegador Chromium para geração de PDF…");
    execSync("npx playwright install chromium --with-deps --force", { stdio: "inherit" });
    console.log("[playwright] Instalação do Chromium concluída.");
  } catch (error) {
    console.error("[playwright] Falha ao instalar Chromium do Playwright.", error?.message || error);
    throw error;
  }
}

ensureChromiumInstalled();
