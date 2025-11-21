import { execSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = resolve(rootDir, "client");
const distDir = resolve(clientDir, "dist");
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const snap = `backups/deploy-${ts}`;

mkdirSync(snap, { recursive: true });
if (existsSync(distDir)) execSync(`cp -a ${distDir} ${snap}/dist`, { stdio: "inherit" });
console.log(`📦 snapshot: ${snap}`);
execSync("npm run build --workspace client", { stdio: "inherit", cwd: rootDir });
execSync(`sudo rsync -a --delete ${distDir}/ /var/www/euro/web/`, { stdio: "inherit" });
execSync("sudo systemctl reload nginx", { stdio: "inherit" });
console.log("✅ publicado");
