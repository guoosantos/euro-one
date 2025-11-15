import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

let loaded = false;

function applyEnv(content) {
  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .forEach((line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) return;
      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();
      if (!key) return;
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    });
}

export async function loadEnv() {
  if (loaded) return;
  try {
    const dotenv = await import("dotenv");
    if (dotenv?.config) {
      dotenv.config();
      loaded = true;
      return;
    }
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("dotenv não disponível, usando carregamento manual", error?.message || error);
    }
  }

  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    loaded = true;
    return;
  }
  const raw = readFileSync(envPath, "utf-8");
  applyEnv(raw);
  loaded = true;
}
