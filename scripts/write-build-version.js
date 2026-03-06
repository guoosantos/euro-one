import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputPath = path.join(repoRoot, "client", "dist", "version.json");

function resolveGitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch (error) {
    console.warn("[build] não foi possível resolver git sha", error?.message || error);
    return "unknown";
  }
}

const payload = {
  gitSha: resolveGitSha(),
  builtAt: new Date().toISOString(),
};

const hotfix = String(process.env.BUILD_HOTFIX || process.env.HOTFIX || "").trim();
if (hotfix) {
  payload.hotfix = hotfix;
}

try {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  console.info(`[build] version.json atualizado em ${outputPath}`);
} catch (error) {
  console.error("[build] falha ao escrever version.json", error?.message || error);
  process.exitCode = 1;
}
