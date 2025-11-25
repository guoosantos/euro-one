import createError from "http-errors";
import { randomUUID } from "crypto";

import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "crmTags";
const crmTags = new Map();

function syncStorage() {
  saveCollection(STORAGE_KEY, Array.from(crmTags.values()));
}

function normaliseName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function loadInitialState() {
  const persisted = loadCollection(STORAGE_KEY, []);
  persisted.forEach((tag) => {
    if (tag?.id) {
      crmTags.set(String(tag.id), { ...tag });
    }
  });
}

loadInitialState();

export function listCrmTags({ clientId } = {}) {
  return Array.from(crmTags.values()).filter((tag) =>
    clientId ? String(tag.clientId) === String(clientId) : true,
  );
}

export function findCrmTagById(id) {
  return crmTags.get(String(id)) || null;
}

function findCrmTagByName(name, { clientId } = {}) {
  if (!name) return null;
  const normalised = name.trim().toLowerCase();
  return (
    listCrmTags({ clientId }).find((tag) => tag.name?.trim().toLowerCase() === normalised) || null
  );
}

export function createCrmTag({ clientId, name, color }) {
  const cleanName = normaliseName(name);
  if (!cleanName) {
    throw createError(400, "Nome da tag é obrigatório");
  }
  if (!clientId) {
    throw createError(400, "clientId é obrigatório");
  }

  const existing = findCrmTagByName(cleanName, { clientId });
  if (existing) return existing;

  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    clientId: String(clientId),
    name: cleanName,
    color: color || null,
    createdAt: now,
    updatedAt: now,
  };
  crmTags.set(record.id, record);
  syncStorage();
  return record;
}

export function deleteCrmTag(id, { clientId } = {}) {
  const existing = crmTags.get(String(id));
  if (!existing) {
    throw createError(404, "Tag não encontrada");
  }
  if (clientId && String(existing.clientId) !== String(clientId)) {
    throw createError(403, "Tag não pertence ao cliente informado");
  }
  crmTags.delete(existing.id);
  syncStorage();
  return true;
}

export function normaliseClientTags(tags, { clientId } = {}) {
  if (!clientId) return [];
  const result = new Set();
  const queue = Array.isArray(tags)
    ? tags
    : typeof tags === "string"
      ? tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [];

  queue.forEach((tag) => {
    if (!tag) return;
    if (typeof tag === "string") {
      const byId = findCrmTagById(tag);
      if (byId && String(byId.clientId) === String(clientId)) {
        result.add(byId.id);
        return;
      }
      const created = createCrmTag({ clientId, name: tag });
      result.add(created.id);
      return;
    }
    if (tag?.id) {
      const byId = findCrmTagById(tag.id);
      if (byId && String(byId.clientId) === String(clientId)) {
        result.add(byId.id);
        return;
      }
      if (tag.name) {
        const created = createCrmTag({ clientId, name: tag.name, color: tag.color });
        result.add(created.id);
      }
    }
  });

  return Array.from(result);
}

export function resolveTagNames(tagIds, { clientId } = {}) {
  const catalog = listCrmTags({ clientId });
  return (tagIds || []).map((id) => catalog.find((tag) => tag.id === id) || null).filter(Boolean);
}

export default {
  listCrmTags,
  createCrmTag,
  deleteCrmTag,
  findCrmTagById,
  normaliseClientTags,
  resolveTagNames,
};
