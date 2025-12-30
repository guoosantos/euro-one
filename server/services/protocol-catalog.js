import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.join(__dirname, "..", "data", "protocol-catalog.json");
let cachedCatalog = null;

export function loadProtocolCatalog() {
  if (cachedCatalog) return cachedCatalog;
  const raw = fs.readFileSync(catalogPath, "utf-8");
  cachedCatalog = JSON.parse(raw);
  return cachedCatalog;
}

export function normalizeProtocolKey(protocol) {
  return String(protocol || "").trim().toLowerCase();
}

export function getProtocolList() {
  const catalog = loadProtocolCatalog();
  return Array.isArray(catalog?.protocols) ? catalog.protocols : [];
}

export function getProtocolCommands(protocol) {
  const catalog = loadProtocolCatalog();
  const protocolKey = normalizeProtocolKey(protocol);
  const commands = catalog?.commands?.[protocolKey];
  return Array.isArray(commands) ? commands : null;
}

export function getProtocolEvents(protocol) {
  const catalog = loadProtocolCatalog();
  const protocolKey = normalizeProtocolKey(protocol);
  const events = catalog?.events?.[protocolKey];
  return Array.isArray(events) ? events : null;
}
