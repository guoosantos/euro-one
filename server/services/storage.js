import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const DATA_FILE = path.join(DATA_DIR, "storage.json");

let snapshot = null;
let flushTimer = null;

function cloneValue(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "object") {
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch (_error) {
        // fall back to JSON clone
      }
    }
    return JSON.parse(JSON.stringify(value));
  }
  return value;
}

function ensureSnapshot() {
  if (snapshot) {
    return snapshot;
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    snapshot = raw ? JSON.parse(raw) : {};
  } catch (_error) {
    snapshot = {};
  }
  return snapshot;
}

function scheduleFlush() {
  if (flushTimer) {
    return;
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(snapshot ?? {}, null, 2), "utf8");
    } catch (error) {
      console.warn("[storage] Falha ao persistir dados", error?.message || error);
    }
  }, 100);
  if (typeof flushTimer.unref === "function") {
    flushTimer.unref();
  }
}

export function loadCollection(name, fallback = []) {
  const store = ensureSnapshot();
  if (!Object.prototype.hasOwnProperty.call(store, name)) {
    store[name] = cloneValue(fallback);
    scheduleFlush();
  }
  return cloneValue(store[name]);
}

export function saveCollection(name, value) {
  const store = ensureSnapshot();
  store[name] = cloneValue(value);
  scheduleFlush();
  return store[name];
}

export function exportStorage() {
  return cloneValue(ensureSnapshot());
}

export function getStoragePath() {
  return DATA_FILE;
}
