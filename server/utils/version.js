import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const clientVersionPath = path.join(repoRoot, "client", "dist", "version.json");

function resolveGitSha() {
  if (process.env.GIT_SHA) return String(process.env.GIT_SHA).trim();
  try {
    return execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch (error) {
    console.warn("[version] falha ao resolver git sha", error?.message || error);
    return "unknown";
  }
}

function readClientVersion() {
  if (!fs.existsSync(clientVersionPath)) return null;
  try {
    const raw = fs.readFileSync(clientVersionPath, "utf8");
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== "object") return null;
    return {
      gitSha: payload.gitSha || "unknown",
      builtAt: payload.builtAt || null,
    };
  } catch (error) {
    console.warn("[version] falha ao ler version.json do client", error?.message || error);
    return null;
  }
}

export function getVersionInfo() {
  return {
    server: {
      gitSha: resolveGitSha(),
      builtAt: process.env.BUILD_AT || null,
    },
    client: readClientVersion(),
  };
}

export function formatVersionText(versionInfo) {
  const serverSha = versionInfo?.server?.gitSha || "unknown";
  const clientSha = versionInfo?.client?.gitSha || "unknown";
  const clientBuiltAt = versionInfo?.client?.builtAt || "unknown";
  return [
    `server=${serverSha}`,
    `client=${clientSha}`,
    `clientBuiltAt=${clientBuiltAt}`,
  ].join("\n");
}
