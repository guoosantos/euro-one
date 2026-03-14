import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../../services/storage.js";

const STORAGE_KEY = "ai-learning-entries";
const entries = new Map();

function clone(value) {
  if (!value) return null;
  return JSON.parse(JSON.stringify(value));
}

function syncStorage() {
  saveCollection(STORAGE_KEY, Array.from(entries.values()));
}

function sanitizeString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeRoutePath(value) {
  const normalized = sanitizeString(value);
  if (!normalized) return null;
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function matchesRoute(entryRoutePath, routePath) {
  if (!entryRoutePath) return true;
  if (!routePath) return false;
  if (routePath === entryRoutePath) return true;
  return routePath.startsWith(`${entryRoutePath}/`);
}

const persisted = loadCollection(STORAGE_KEY, []);
persisted.forEach((entry) => {
  if (!entry?.id) return;
  entries.set(String(entry.id), entry);
});

export function listLearningEntries({
  routePath = null,
  entityType = null,
  activeOnly = true,
  limit = 50,
} = {}) {
  return Array.from(entries.values())
    .filter((entry) => {
      if (activeOnly && entry.active === false) return false;
      if (!matchesRoute(entry.routePath, routePath)) return false;
      if (entry.entityType && entityType && String(entry.entityType) !== String(entityType)) return false;
      if (entry.entityType && !entityType) return false;
      return true;
    })
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, Math.max(1, Number(limit) || 50))
    .map(clone);
}

export function createLearningEntry(payload = {}) {
  const content = sanitizeString(payload.content);
  if (!content) {
    const error = new Error("Conteúdo da instrução é obrigatório.");
    error.status = 400;
    error.code = "LEARNING_CONTENT_REQUIRED";
    throw error;
  }

  const record = {
    id: randomUUID(),
    title: sanitizeString(payload.title),
    content,
    category: sanitizeString(payload.category) || "instruction",
    routePath: normalizeRoutePath(payload.routePath),
    entityType: sanitizeString(payload.entityType),
    active: payload.active !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: payload.createdBy
      ? {
          id: sanitizeString(payload.createdBy.id),
          name: sanitizeString(payload.createdBy.name),
        }
      : null,
  };

  entries.set(record.id, record);
  syncStorage();
  return clone(record);
}

export function buildLearningContext({ routePath = null, entityType = null, limit = 8 } = {}) {
  const items = listLearningEntries({ routePath, entityType, limit });
  return {
    entries: items,
    summary: items
      .map((entry) => {
        const title = entry.title ? `${entry.title}: ` : "";
        return `${title}${entry.content}`;
      })
      .join("\n"),
  };
}

