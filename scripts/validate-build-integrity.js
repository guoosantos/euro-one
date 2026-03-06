import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const distDir = path.join(repoRoot, "client", "dist");
const versionPath = path.join(distDir, "version.json");
const assetsDir = path.join(distDir, "assets");
const OUT_OF_COMMIT_ERROR = "ERRO: bundle contém código fora do commit declarado";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readHeadSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch (error) {
    fail(`[build-integrity] não foi possível resolver HEAD: ${error?.message || error}`);
  }
}

function readVersionPayload() {
  if (!fs.existsSync(versionPath)) {
    fail(`[build-integrity] version.json ausente em ${versionPath}`);
  }

  try {
    const payload = JSON.parse(fs.readFileSync(versionPath, "utf8"));
    if (!payload || typeof payload !== "object") {
      fail("[build-integrity] version.json inválido");
    }
    return payload;
  } catch (error) {
    fail(`[build-integrity] falha ao ler version.json: ${error?.message || error}`);
  }
}

function readMainBundleContents() {
  if (!fs.existsSync(assetsDir)) {
    fail(`[build-integrity] assets ausente em ${assetsDir}`);
  }

  const bundleFiles = fs
    .readdirSync(assetsDir)
    .filter((name) => /^index-.*\.js$/.test(name))
    .sort();

  if (!bundleFiles.length) {
    fail("[build-integrity] bundle principal index-*.js não encontrado");
  }

  return bundleFiles.map((fileName) => fs.readFileSync(path.join(assetsDir, fileName), "utf8")).join("\n");
}

function headContainsTrustCenterFiles() {
  try {
    const output = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return /trust-center|TrustCenter|migration.*trust|api\/trust-center/i.test(output);
  } catch (error) {
    fail(`[build-integrity] falha ao ler árvore do HEAD: ${error?.message || error}`);
  }
}

const headSha = readHeadSha();
const versionPayload = readVersionPayload();
const declaredSha = String(versionPayload.gitSha || "").trim();

if (!declaredSha) {
  fail("[build-integrity] version.json sem gitSha");
}

if (declaredSha !== headSha) {
  fail(`[build-integrity] ERRO: gitSha do version.json (${declaredSha}) difere do HEAD (${headSha})`);
}

const bundleContents = readMainBundleContents();
const hasTrustCenterInBundle = bundleContents.includes("trust-center");

if (hasTrustCenterInBundle && !headContainsTrustCenterFiles()) {
  fail(OUT_OF_COMMIT_ERROR);
}

console.info(`[build-integrity] version.json e bundle validados para HEAD ${headSha}`);
