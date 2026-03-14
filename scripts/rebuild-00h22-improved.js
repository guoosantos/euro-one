import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const clientRoot = path.join(repoRoot, "client");
const distDir = path.join(clientRoot, "dist");
const archivePath =
  "/home/ubuntu/backups/euro-one-front/00h22-improved-evolution-20260311T231900Z-all-assets-cache-bust.tgz";
const expectedVersion = {
  gitSha: "f4f823a5991a7f430012067684571492b00f8c60",
  builtAt: "2026-03-05T03:22:03.000Z",
};
const expectedAssets = [
  "index-DfaKhUMY-20260311T231837Z.js",
  "index-Bi22LzuC-20260311T231837Z.css",
  "Home-DwfGBXf8-20260311T231837Z.js",
  "Monitoramento-20260301-024614-20260311T231837Z.js",
  "Security-C6YgUb5Q-20260311T231837Z.js",
  "es-jammer-menu-v2-20260311T231837Z.js",
];

function ensureExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${label} ausente: ${targetPath}`);
  }
}

function resetDist() {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
}

function extractArchive() {
  execFileSync("tar", ["-xzf", archivePath, "--strip-components=1", "-C", distDir], {
    stdio: "inherit",
  });
}

function validateVersion() {
  const versionPath = path.join(distDir, "version.json");
  ensureExists(versionPath, "version.json");
  const version = JSON.parse(fs.readFileSync(versionPath, "utf8"));
  if (version.gitSha !== expectedVersion.gitSha || version.builtAt !== expectedVersion.builtAt) {
    throw new Error(
      `version.json divergente: ${JSON.stringify(version)} != ${JSON.stringify(expectedVersion)}`,
    );
  }
}

function validateAssets() {
  const assetsDir = path.join(distDir, "assets");
  ensureExists(assetsDir, "assets");
  const assets = new Set(fs.readdirSync(assetsDir));
  for (const assetName of expectedAssets) {
    if (!assets.has(assetName)) {
      throw new Error(`asset obrigatório ausente: ${assetName}`);
    }
  }
}

function validateIndex() {
  const indexPath = path.join(distDir, "index.html");
  ensureExists(indexPath, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  for (const assetName of expectedAssets.slice(0, 2)) {
    if (!html.includes(`/assets/${assetName}`)) {
      throw new Error(`index.html não referencia asset esperado: ${assetName}`);
    }
  }
  if (!html.includes('/assets/es-jammer-menu-v2-20260311T231837Z.js')) {
    throw new Error("index.html não referencia o script legado esperado");
  }
}

function main() {
  ensureExists(archivePath, "archive canônico 00h22 melhorado");
  resetDist();
  extractArchive();
  validateVersion();
  validateAssets();
  validateIndex();
  process.stdout.write(`OK: dist reproduzido a partir de ${archivePath}\n`);
}

main();
