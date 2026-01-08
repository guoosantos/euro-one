import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import iotmEventCatalog from "../../shared/iotmEventCatalog.pt-BR.json" with { type: "json" };
import diagnosticCatalog from "../../shared/deviceDiagnosticEvents.pt-BR.json" with { type: "json" };

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

function buildDiagnosticEntries() {
  const events = Array.isArray(diagnosticCatalog?.events) ? diagnosticCatalog.events : [];
  const templates = Array.isArray(diagnosticCatalog?.templates) ? diagnosticCatalog.templates : [];
  const entries = [...events, ...templates]
    .map((entry) => {
      const id = String(entry?.key || "").trim();
      if (!id) return null;
      return {
        id,
        name: entry?.title || entry?.description || `Diagnóstico ${id}`,
        description: entry?.description || entry?.template || "",
        defaultSeverity: entry?.severity || null,
        kind: "diagnostic",
        source: "deviceDiagnosticEvents",
      };
    })
    .filter(Boolean);
  return entries;
}

function parseDiagnosticKey(id) {
  if (!id) return null;
  const match = String(id).match(/fun_id\\s*=\\s*(\\d+)\\s*,\\s*war_id\\s*=\\s*([^,\\s]+)/i);
  if (!match) return null;
  return {
    funId: Number(match[1]),
    warId: match[2],
  };
}

function compareCatalogEntries(a, b) {
  const idA = String(a?.id || "");
  const idB = String(b?.id || "");
  const isNumericA = /^\\d+$/.test(idA);
  const isNumericB = /^\\d+$/.test(idB);
  if (isNumericA && isNumericB) return Number(idA) - Number(idB);
  if (isNumericA) return -1;
  if (isNumericB) return 1;

  const diagA = parseDiagnosticKey(idA);
  const diagB = parseDiagnosticKey(idB);
  if (diagA && diagB) {
    if (diagA.funId !== diagB.funId) return diagA.funId - diagB.funId;
    const warA = Number(diagA.warId);
    const warB = Number(diagB.warId);
    if (Number.isFinite(warA) && Number.isFinite(warB)) return warA - warB;
    if (diagA.warId === diagB.warId) return 0;
    return String(diagA.warId).localeCompare(String(diagB.warId));
  }
  if (diagA) return 1;
  if (diagB) return -1;
  return idA.localeCompare(idB);
}

export function buildFullProtocolEventCatalog(protocol) {
  const catalog = loadProtocolCatalog();
  const protocolKey = normalizeProtocolKey(protocol);
  const baseEvents = Array.isArray(catalog?.events?.[protocolKey]) ? catalog.events[protocolKey] : [];
  const entries = [];
  const seen = new Set();

  const append = (list, defaults = {}) => {
    (list || []).forEach((event) => {
      const id = String(event?.id || "").trim();
      if (!id || seen.has(id)) return;
      entries.push({
        id,
        name: event?.name || event?.labelPt || event?.label || defaults.name || `Evento ${id}`,
        description: event?.description || event?.descriptionPt || "",
        defaultSeverity: event?.defaultSeverity || event?.severity || defaults.defaultSeverity || null,
        kind: event?.kind || defaults.kind || "event",
        source: event?.source || defaults.source || "protocol",
      });
      seen.add(id);
    });
  };

  append(baseEvents);

  if (protocolKey === "iotm") {
    const iotmEvents = (iotmEventCatalog || [])
      .filter((item) => item?.id !== undefined && item?.id !== null)
      .map((item) => ({
        id: String(item.id),
        name: item.labelPt || `Evento ${item.id}`,
        description: item.description || "",
        defaultSeverity: item.severity || null,
        kind: "event",
        source: "iotmEventCatalog",
      }));
    append(iotmEvents, { source: "iotmEventCatalog" });
    append(buildDiagnosticEntries(), { kind: "diagnostic", source: "deviceDiagnosticEvents" });
  }

  entries.sort(compareCatalogEntries);
  return entries.length ? entries : null;
}

export function getProtocolEvents(protocol) {
  return buildFullProtocolEventCatalog(protocol);
}
