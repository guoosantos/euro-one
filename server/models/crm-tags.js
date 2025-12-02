import createError from "http-errors";

import prisma from "../services/prisma.js";

function normaliseName(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function listCrmTags({ clientId } = {}) {
  return prisma.crmTag.findMany({
    where: clientId ? { clientId: String(clientId) } : undefined,
    orderBy: { name: "asc" },
  });
}

export async function findCrmTagById(id) {
  if (!id) return null;
  return prisma.crmTag.findUnique({ where: { id: String(id) } });
}

async function findCrmTagByName(name, { clientId } = {}) {
  if (!name) return null;
  const normalised = name.trim().toLowerCase();
  return prisma.crmTag.findFirst({
    where: { clientId: clientId ? String(clientId) : undefined, name: { equals: normalised, mode: "insensitive" } },
  });
}

export async function createCrmTag({ clientId, name, color }) {
  const cleanName = normaliseName(name);
  if (!cleanName) {
    throw createError(400, "Nome da tag é obrigatório");
  }
  if (!clientId) {
    throw createError(400, "clientId é obrigatório");
  }

  const existing = await findCrmTagByName(cleanName, { clientId });
  if (existing) return existing;

  const now = new Date();
  return prisma.crmTag.create({
    data: {
      clientId: String(clientId),
      name: cleanName,
      color: color || null,
      createdAt: now,
      updatedAt: now,
    },
  });
}

export async function deleteCrmTag(id, { clientId } = {}) {
  const existing = await prisma.crmTag.findUnique({ where: { id: String(id) } });
  if (!existing) {
    throw createError(404, "Tag não encontrada");
  }
  if (clientId && String(existing.clientId) !== String(clientId)) {
    throw createError(403, "Tag não pertence ao cliente informado");
  }
  await prisma.crmTag.delete({ where: { id: existing.id } });
  return true;
}

export async function normaliseClientTags(tags, { clientId } = {}) {
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

  for (const tag of queue) {
    if (!tag) continue;
    if (typeof tag === "string") {
      const byId = await findCrmTagById(tag);
      if (byId && String(byId.clientId) === String(clientId)) {
        result.add(byId.id);
        continue;
      }
      const created = await createCrmTag({ clientId, name: tag });
      result.add(created.id);
      continue;
    }
    if (tag?.id) {
      const byId = await findCrmTagById(tag.id);
      if (byId && String(byId.clientId) === String(clientId)) {
        result.add(byId.id);
        continue;
      }
      if (tag.name) {
        const created = await createCrmTag({ clientId, name: tag.name, color: tag.color });
        result.add(created.id);
      }
    }
  }

  return Array.from(result);
}

export async function resolveTagNames(tagIds, { clientId } = {}) {
  if (!tagIds?.length) return [];
  const catalog = await listCrmTags({ clientId });
  const map = new Map(catalog.map((tag) => [tag.id, tag]));
  return (tagIds || []).map((id) => map.get(id) || null).filter(Boolean);
}

export default {
  listCrmTags,
  createCrmTag,
  deleteCrmTag,
  findCrmTagById,
  normaliseClientTags,
  resolveTagNames,
};
