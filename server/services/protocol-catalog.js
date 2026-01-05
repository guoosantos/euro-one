import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import iotmEventCatalog from "../../shared/iotmEventCatalog.pt-BR.json" assert { type: "json" };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.join(__dirname, "..", "data", "protocol-catalog.json");
const allowlistPath = path.join(__dirname, "..", "data", "protocol-command-allowlist.json");
let cachedCatalog = null;
let cachedAllowlist = null;

export function loadProtocolCatalog() {
  if (cachedCatalog) return cachedCatalog;
  const raw = fs.readFileSync(catalogPath, "utf-8");
  cachedCatalog = JSON.parse(raw);
  return cachedCatalog;
}

export function loadProtocolCommandAllowlist() {
  if (cachedAllowlist) return cachedAllowlist;
  try {
    const raw = fs.readFileSync(allowlistPath, "utf-8");
    cachedAllowlist = JSON.parse(raw);
  } catch (_error) {
    cachedAllowlist = {};
  }
  return cachedAllowlist;
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

export function getProtocolCommandAllowlist(protocol) {
  const allowlist = loadProtocolCommandAllowlist();
  const protocolKey = normalizeProtocolKey(protocol);
  const commands = allowlist?.[protocolKey];
  return Array.isArray(commands) ? commands : null;
}

export function getProtocolEvents(protocol) {
  const catalog = loadProtocolCatalog();
  const protocolKey = normalizeProtocolKey(protocol);
  const baseEvents = Array.isArray(catalog?.events?.[protocolKey]) ? catalog.events[protocolKey] : [];
  if (protocolKey === "iotm") {
    const seen = new Set(baseEvents.map((event) => String(event?.id)));
    const iotmEvents = (iotmEventCatalog || [])
      .filter((item) => item?.id !== undefined && item?.id !== null)
      .map((item) => ({
        id: String(item.id),
        name: item.labelPt || `Evento ${item.id}`,
        description: item.description || "",
      }))
      .filter((item) => !seen.has(item.id));
    const merged = [...baseEvents, ...iotmEvents];
    return merged.length ? merged : null;
  }
  return baseEvents.length ? baseEvents : null;
}
