import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import prisma from "./prisma.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const DATA_FILE = path.join(DATA_DIR, "storage.json");
const SHOULD_PERSIST = process.env.NODE_ENV !== "test";

const hasDatabase = false;

let snapshot = null;
let flushTimer = null;

function cloneValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "object") {
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch (_error) {
        // fallback para JSON clone
      }
    }
    return JSON.parse(JSON.stringify(value));
  }
  return value;
}

async function loadSnapshotFromDatabase() {
  if (!prisma?.storageCollection) return null;
  try {
    const collections = await prisma.storageCollection.findMany();
    const store = {};
    collections.forEach((item) => {
      store[item.key] = cloneValue(item.data ?? []);
    });
    return store;
  } catch (error) {
    console.warn("[storage] Falha ao carregar snapshot do banco", error?.message || error);
    return null;
  }
}

function loadSnapshotFromFile() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch (_error) {
    return {};
  }
}

async function persistToDatabase() {
  if (!prisma || !snapshot) return;
  const entries = Object.entries(snapshot);
  if (!entries.length) return;
  try {
    await prisma.$transaction(
      entries.map(([key, value]) =>
        prisma.storageCollection.upsert({
          where: { key },
          update: { data: value },
          create: { key, data: value },
        }),
      ),
    );
  } catch (error) {
    console.warn("[storage] Falha ao persistir no banco", error?.message || error);
  }
}

function persistToFile() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(snapshot ?? {}, null, 2), "utf8");
  } catch (error) {
    console.warn("[storage] Falha ao persistir arquivo", error?.message || error);
  }
}

async function initSnapshot() {
  if (snapshot) return snapshot;
  if (!SHOULD_PERSIST) {
    snapshot = {};
    return snapshot;
  }

  if (hasDatabase) {
    snapshot = (await loadSnapshotFromDatabase()) ?? {};
  } else {
    snapshot = loadSnapshotFromFile();
  }
  return snapshot;
}

export async function initStorage() {
  try {
    await initSnapshot();
  } catch (error) {
    console.warn("[storage] Falha ao inicializar snapshot", error?.message || error);
    snapshot = snapshot ?? {};
  }
  return snapshot;
}

function scheduleFlush() {
  if (!SHOULD_PERSIST) return;
  if (flushTimer) return;

  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (hasDatabase) {
      void persistToDatabase();
      return;
    }
    persistToFile();
  }, 100);

  if (typeof flushTimer.unref === "function") {
    flushTimer.unref();
  }
}

export function loadCollection(name, fallback = []) {
  if (!snapshot) {
    throw new Error("Storage não inicializado");
  }
  if (!Object.prototype.hasOwnProperty.call(snapshot, name)) {
    snapshot[name] = cloneValue(fallback);
    scheduleFlush();
  }
  return cloneValue(snapshot[name]);
}

export function saveCollection(name, value) {
  if (!snapshot) {
    throw new Error("Storage não inicializado");
  }
  snapshot[name] = cloneValue(value);
  scheduleFlush();
  return snapshot[name];
}

export function exportStorage() {
  return cloneValue(snapshot ?? {});
}

export function getStoragePath() {
  return hasDatabase ? "database" : DATA_FILE;
}
