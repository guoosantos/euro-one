import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storagePath = path.join(__dirname, "..", "data", "event-severity.json");
let cachedSeverity = null;

function readFile() {
  if (cachedSeverity) return cachedSeverity;
  try {
    const raw = fs.readFileSync(storagePath, "utf-8");
    cachedSeverity = JSON.parse(raw);
  } catch (_error) {
    cachedSeverity = {};
  }
  return cachedSeverity;
}

function writeFile(payload) {
  cachedSeverity = payload;
  fs.writeFileSync(storagePath, JSON.stringify(payload, null, 2));
}

export function getProtocolSeverity(protocolKey) {
  const data = readFile();
  const entry = data?.[protocolKey];
  return entry && typeof entry === "object" ? entry : {};
}

export function updateProtocolSeverity(protocolKey, updates = []) {
  const data = readFile();
  const current = data?.[protocolKey] && typeof data[protocolKey] === "object" ? data[protocolKey] : {};
  const next = { ...current };
  updates.forEach((update) => {
    if (!update?.eventId) return;
    next[update.eventId] = {
      severity: update.severity || current?.[update.eventId]?.severity || "informativa",
      active: typeof update.active === "boolean" ? update.active : current?.[update.eventId]?.active ?? true,
    };
  });
  const payload = { ...data, [protocolKey]: next };
  writeFile(payload);
  return next;
}
