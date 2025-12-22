import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

let loaded = false;

const moduleDir = dirname(fileURLToPath(import.meta.url));
const envSearchPaths = [
  resolve(moduleDir, "..", ".env"),
  resolve(moduleDir, "..", "..", ".env"),
  resolve(moduleDir, ".env"),
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "..", ".env"),
];

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

function resolveEnvPath() {
  return envSearchPaths.find((candidate) => existsSync(candidate));
}

export function validateEnv(requiredKeys = [], { optional = false } = {}) {
  const missing = requiredKeys
    .map((key) => String(key).trim())
    .filter(Boolean)
    .filter((key) => !(key in process.env) || String(process.env[key]).trim() === "");

  if (missing.length && !optional) {
    const message = `Variáveis obrigatórias ausentes: ${missing.join(", ")}`;
    const error = new Error(message);
    error.code = "MISSING_ENV";
    error.missing = missing;
    return { ok: false, missing, error };
  }

  return { ok: true, missing: optional ? missing : [] };
}

export async function loadEnv() {
  if (loaded) return;
  const envPath = resolveEnvPath();
  try {
    const dotenv = await import("dotenv");
    if (dotenv?.config) {
      if (envPath) {
        dotenv.config({ path: envPath });
      } else {
        dotenv.config();
      }
      loaded = true;
      return;
    }
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("dotenv não disponível, usando carregamento manual", error?.message || error);
    }
  }

  if (!envPath) {
    loaded = true;
    return;
  }
  const raw = readFileSync(envPath, "utf-8");
  applyEnv(raw);
  loaded = true;
}
