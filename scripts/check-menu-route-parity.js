#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function normalizePath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw === "/") return raw;
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.replace(/\/+$/, "");
}

function extractPaths(text, pattern) {
  const matches = [];
  let current = pattern.exec(text);
  while (current) {
    const next = normalizePath(current[1]);
    if (next) matches.push(next);
    current = pattern.exec(text);
  }
  return matches;
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = resolve(rootDir, "client/src/lib/permissions/registry.js");
const routesPath = resolve(rootDir, "client/src/routes.jsx");

const registryText = readFileSync(registryPath, "utf8");
const routesText = readFileSync(routesPath, "utf8");

const menuPaths = new Set(extractPaths(registryText, /to:\s*["']([^"']+)["']/g));
const routePaths = new Set(extractPaths(routesText, /path:\s*["']([^"']+)["']/g));

const missingRoutes = [...menuPaths].filter((path) => !routePaths.has(path)).sort();

if (missingRoutes.length > 0) {
  console.error("ERROR: menu links without matching route:");
  for (const path of missingRoutes) {
    console.error(` - ${path}`);
  }
  process.exit(2);
}

console.log(`OK: menu-route parity (${menuPaths.size} menu links, ${routePaths.size} routes).`);
