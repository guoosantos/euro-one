import createError from "http-errors";
import { randomUUID } from "crypto";

import prisma, { isPrismaAvailable } from "../services/prisma.js";
import { hashPassword, sanitizeUser, verifyPassword } from "../utils/password.js";
import {
  getFallbackClient,
  getFallbackUser,
  isDemoModeEnabled,
  isFallbackEnabled,
  resolveFallbackCredentials,
} from "../services/fallback-data.js";
import { loadCollection, saveCollection } from "../services/storage.js";

const VALID_ROLES = new Set(["admin", "tenant_admin", "manager", "user", "technician"]);
const STORAGE_KEY = "users";
const users = new Map();
const byEmail = new Map();
const byUsername = new Map();

function normaliseEmail(email) {
  if (!email) return null;
  return String(email).trim().toLowerCase();
}

function normaliseUsername(username) {
  if (!username) return null;
  return String(username).trim().toLowerCase();
}

function assertRole(role) {
  if (!VALID_ROLES.has(role)) {
    throw createError(400, `Papel inválido: ${role}`);
  }
  return role;
}

function syncStorage() {
  saveCollection(STORAGE_KEY, Array.from(users.values()));
}

function deindexUser(record) {
  if (!record) return;
  if (record.emailNormalized) {
    byEmail.delete(String(record.emailNormalized));
  }
  if (record.usernameNormalized) {
    byUsername.delete(String(record.usernameNormalized));
  }
}

function indexUser(record) {
  if (!record) return;
  if (record.emailNormalized) {
    byEmail.set(String(record.emailNormalized), record);
  }
  if (record.usernameNormalized) {
    byUsername.set(String(record.usernameNormalized), record);
  }
}

function persist(record, { skipSync = false } = {}) {
  if (!record?.id) return null;
  const existing = users.get(String(record.id));
  if (existing) {
    deindexUser(existing);
  }
  users.set(String(record.id), record);
  indexUser(record);
  if (!skipSync) {
    syncStorage();
  }
  return record;
}

const persistedUsers = loadCollection(STORAGE_KEY, []);
persistedUsers.forEach((record) => {
  if (!record?.id) return;
  persist({ ...record }, { skipSync: true });
});

async function ensureUniqueEmail(email, currentId = null) {
  if (!email) return;
  const normalized = normaliseEmail(email);
  if (!normalized) return;
  if (!isPrismaAvailable()) {
    const existing = byEmail.get(normalized);
    if (existing && existing.id !== currentId) {
      throw createError(409, "E-mail já cadastrado");
    }
    return;
  }
  try {
    const existing = await prisma.user.findUnique({ where: { emailNormalized: normalized } });
    if (existing && existing.id !== currentId) {
      throw createError(409, "E-mail já cadastrado");
    }
  } catch (error) {
    console.warn("[users] falha ao validar e-mail no banco, usando storage", error?.message || error);
    const existing = byEmail.get(normalized);
    if (existing && existing.id !== currentId) {
      throw createError(409, "E-mail já cadastrado");
    }
  }
}

async function ensureUniqueUsername(username, currentId = null) {
  if (!username) return;
  const normalized = normaliseUsername(username);
  if (!normalized) return;
  if (!isPrismaAvailable()) {
    const existing = byUsername.get(normalized);
    if (existing && existing.id !== currentId) {
      throw createError(409, "Login já utilizado");
    }
    return;
  }
  try {
    const existing = await prisma.user.findUnique({ where: { usernameNormalized: normalized } });
    if (existing && existing.id !== currentId) {
      throw createError(409, "Login já utilizado");
    }
  } catch (error) {
    console.warn("[users] falha ao validar login no banco, usando storage", error?.message || error);
    const existing = byUsername.get(normalized);
    if (existing && existing.id !== currentId) {
      throw createError(409, "Login já utilizado");
    }
  }
}

export async function listUsers({ clientId } = {}) {
  if (isPrismaAvailable()) {
    try {
      const users = await prisma.user.findMany({
        where:
          typeof clientId === "undefined"
            ? undefined
            : clientId === null
              ? { clientId: null }
              : { clientId: String(clientId) },
        orderBy: { createdAt: "desc" },
      });
      return users.map((user) => sanitizeUser(user));
    } catch (error) {
      console.warn("[users] falha ao listar no banco, usando storage", error?.message || error);
    }
  }

  const list = Array.from(users.values());
  let filtered = list;
  if (typeof clientId !== "undefined") {
    if (clientId === null) {
      filtered = list.filter((user) => user.clientId === null);
    } else {
      filtered = list.filter((user) => String(user.clientId) === String(clientId));
    }
  }
  if (filtered.length) {
    return filtered.map((user) => sanitizeUser(user));
  }
  if (isFallbackEnabled()) {
    const fallback = getFallbackUser();
    return !clientId || String(clientId) === String(fallback.clientId) ? [fallback] : [];
  }
  return [];
}

export async function getUserById(id, { includeSensitive = false } = {}) {
  if (isPrismaAvailable()) {
    try {
      const record = await prisma.user.findUnique({ where: { id: String(id) } });
      if (!record) return null;
      return includeSensitive ? record : sanitizeUser(record);
    } catch (error) {
      console.warn("[users] falha ao buscar no banco, usando storage", error?.message || error);
    }
  }
  const record = users.get(String(id));
  if (record) {
    return includeSensitive ? { ...record } : sanitizeUser(record);
  }
  if (isFallbackEnabled()) {
    const fallback = getFallbackUser();
    if (String(id) !== String(fallback.id)) return null;
    return includeSensitive ? { ...fallback } : sanitizeUser(fallback);
  }
  return null;
}

export async function findByEmail(email, { includeSensitive = false } = {}) {
  const normalized = normaliseEmail(email);
  if (!normalized) return null;
  if (isPrismaAvailable()) {
    try {
      const record = await prisma.user.findUnique({ where: { emailNormalized: normalized } });
      if (!record) return null;
      return includeSensitive ? record : sanitizeUser(record);
    } catch (error) {
      console.warn("[users] falha ao buscar e-mail no banco, usando storage", error?.message || error);
    }
  }
  const record = byEmail.get(normalized);
  if (record) {
    return includeSensitive ? { ...record } : sanitizeUser(record);
  }
  if (isFallbackEnabled()) {
    const fallback = getFallbackUser();
    if (normalized === normaliseEmail(fallback.email)) {
      return includeSensitive ? { ...fallback } : sanitizeUser(fallback);
    }
  }
  return null;
}

export async function findByUsername(username, { includeSensitive = false } = {}) {
  const normalized = normaliseUsername(username);
  if (!normalized) return null;
  if (isPrismaAvailable()) {
    try {
      const record = await prisma.user.findUnique({ where: { usernameNormalized: normalized } });
      if (!record) return null;
      return includeSensitive ? record : sanitizeUser(record);
    } catch (error) {
      console.warn("[users] falha ao buscar login no banco, usando storage", error?.message || error);
    }
  }
  const record = byUsername.get(normalized);
  if (record) {
    return includeSensitive ? { ...record } : sanitizeUser(record);
  }
  if (isFallbackEnabled()) {
    const fallback = getFallbackUser();
    if (normalized === normaliseUsername(fallback.username)) {
      return includeSensitive ? { ...fallback } : sanitizeUser(fallback);
    }
  }
  return null;
}

export async function findByLogin(login, { includeSensitive = false } = {}) {
  return (
    (await findByEmail(login, { includeSensitive })) ||
    (await findByUsername(login, { includeSensitive }))
  );
}

export async function seedDefaultAdmin() {
  const existing =
    (await findByEmail("admin@euro.one", { includeSensitive: true })) ||
    (await findByUsername("admin", { includeSensitive: true }));
  if (existing) {
    return;
  }
  const id = randomUUID();
  const passwordHash = await hashPassword("admin");
  if (!isPrismaAvailable()) {
    const now = new Date().toISOString();
    persist({
      id,
      name: "Administrador",
      email: "admin@euro.one",
      emailNormalized: normaliseEmail("admin@euro.one"),
      username: "admin",
      usernameNormalized: normaliseUsername("admin"),
      passwordHash,
      role: "admin",
      clientId: null,
      attributes: {},
      createdAt: now,
      updatedAt: now,
    });
    return;
  }
  await prisma.user.create({
    data: {
      id,
      name: "Administrador",
      email: "admin@euro.one",
      emailNormalized: normaliseEmail("admin@euro.one"),
      username: "admin",
      usernameNormalized: normaliseUsername("admin"),
      passwordHash,
      role: "admin",
      clientId: null,
      attributes: {},
    },
  });
}

export async function createUser({
  name,
  email,
  username,
  password,
  role = "user",
  clientId = null,
  attributes = {},
}) {
  if (!name || !email) {
    throw createError(400, "Nome e e-mail são obrigatórios");
  }
  if (!password) {
    throw createError(400, "Senha é obrigatória");
  }
  await ensureUniqueEmail(email);
  await ensureUniqueUsername(username);
  const normalizedEmail = normaliseEmail(email);
  const normalizedUsername = username ? normaliseUsername(username) : null;
  const validatedRole = assertRole(role);
  if (validatedRole !== "admin" && validatedRole !== "technician" && !clientId) {
    throw createError(400, "Usuários não administradores devem estar vinculados a um cliente");
  }

  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  if (isPrismaAvailable()) {
    try {
      const record = await prisma.user.create({
        data: {
          id,
          name,
          email,
          emailNormalized: normalizedEmail,
          username: username || null,
          usernameNormalized: normalizedUsername,
          passwordHash,
          role: validatedRole,
          clientId: validatedRole === "admin" ? (clientId ?? null) : clientId ?? null,
          attributes,
        },
      });
      return sanitizeUser(record);
    } catch (error) {
      console.warn("[users] falha ao criar no banco, usando storage", error?.message || error);
    }
  }
  const now = new Date().toISOString();
  const record = {
    id,
    name,
    email,
    emailNormalized: normalizedEmail,
    username: username || null,
    usernameNormalized: normalizedUsername,
    passwordHash,
    role: validatedRole,
    clientId: validatedRole === "admin" ? (clientId ?? null) : clientId ?? null,
    attributes,
    createdAt: now,
    updatedAt: now,
  };
  persist(record);
  return sanitizeUser(record);
}

export async function updateUser(id, updates = {}) {
  if (isPrismaAvailable()) {
    try {
      const record = await prisma.user.findUnique({ where: { id: String(id) } });
      if (!record) {
        throw createError(404, "Usuário não encontrado");
      }

      if (updates.email && updates.email !== record.email) {
        await ensureUniqueEmail(updates.email, record.id);
      }
      if (updates.username && updates.username !== record.username) {
        await ensureUniqueUsername(updates.username, record.id);
      }

      const payload = {};
      if (Object.prototype.hasOwnProperty.call(updates, "name")) {
        payload.name = updates.name;
      }
      if (Object.prototype.hasOwnProperty.call(updates, "email")) {
        payload.email = updates.email;
      }
      if (Object.prototype.hasOwnProperty.call(updates, "username")) {
        payload.username = updates.username || null;
      }
      if (Object.prototype.hasOwnProperty.call(updates, "role")) {
        payload.role = assertRole(updates.role);
      }
      if (Object.prototype.hasOwnProperty.call(updates, "clientId")) {
        payload.clientId = updates.clientId ?? record.clientId;
      }
      if (Object.prototype.hasOwnProperty.call(updates, "password")) {
        payload.passwordHash = updates.password
          ? await hashPassword(updates.password)
          : record.passwordHash;
      }
      if (Object.prototype.hasOwnProperty.call(updates, "attributes")) {
        payload.attributes = updates.attributes ?? {};
      }
      const nextRecord = await prisma.user.update({
        where: { id: record.id },
        data: {
          ...payload,
          emailNormalized: normaliseEmail(payload.email || record.email),
          usernameNormalized: normaliseUsername(payload.username || record.username),
          updatedAt: new Date(),
        },
      });
      return sanitizeUser(nextRecord);
    } catch (error) {
      console.warn("[users] falha ao atualizar no banco, usando storage", error?.message || error);
    }
  }

  const record = users.get(String(id));
  if (!record) {
    throw createError(404, "Usuário não encontrado");
  }

  if (updates.email && updates.email !== record.email) {
    await ensureUniqueEmail(updates.email, record.id);
  }
  if (updates.username && updates.username !== record.username) {
    await ensureUniqueUsername(updates.username, record.id);
  }

  const payload = { ...record };
  if (Object.prototype.hasOwnProperty.call(updates, "name")) {
    payload.name = updates.name;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "email")) {
    payload.email = updates.email;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "username")) {
    payload.username = updates.username || null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "role")) {
    payload.role = assertRole(updates.role);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "clientId")) {
    payload.clientId = updates.clientId ?? record.clientId;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "password")) {
    payload.passwordHash = updates.password
      ? await hashPassword(updates.password)
      : record.passwordHash;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "attributes")) {
    payload.attributes = updates.attributes ?? {};
  }

  payload.emailNormalized = normaliseEmail(payload.email || record.email);
  payload.usernameNormalized = normaliseUsername(payload.username || record.username);
  payload.updatedAt = new Date().toISOString();

  persist(payload);
  return sanitizeUser(payload);
}

export async function verifyUserCredentials(login, password, { allowFallback = false } = {}) {
  const prismaAvailable = isPrismaAvailable();
  const fallbackMatch = allowFallback ? resolveFallbackCredentials(login, password) : null;
  if (fallbackMatch && (!prismaAvailable || isDemoModeEnabled())) {
    return fallbackMatch;
  }

  const user = await findByLogin(login, { includeSensitive: true });
  if (!user) {
    throw createError(401, "Credenciais inválidas");
  }

  const isValidPassword = await verifyPassword(password, user.passwordHash);
  if (!isValidPassword) {
    throw createError(401, "Credenciais inválidas");
  }
  return user;
}

export async function deleteUser(id, { prismaClient = prisma } = {}) {
  if (isPrismaAvailable()) {
    try {
      await prismaClient.userPreference.deleteMany({ where: { userId: String(id) } });
      const record = await prismaClient.user.delete({ where: { id: String(id) } });
      if (!record) {
        throw createError(404, "Usuário não encontrado");
      }
      return sanitizeUser(record);
    } catch (error) {
      if (error?.code === "P2025") {
        throw createError(404, "Usuário não encontrado");
      }
      console.warn("[users] falha ao remover no banco, usando storage", error?.message || error);
    }
  }
  const record = users.get(String(id));
  if (!record) {
    throw createError(404, "Usuário não encontrado");
  }
  users.delete(String(id));
  deindexUser(record);
  syncStorage();
  return sanitizeUser(record);
}

export async function deleteUsersByClientId(clientId) {
  if (!clientId) return 0;
  if (isPrismaAvailable()) {
    try {
      const result = await prisma.user.deleteMany({ where: { clientId: String(clientId) } });
      return result.count;
    } catch (error) {
      console.warn("[users] falha ao remover por cliente no banco, usando storage", error?.message || error);
    }
  }
  const ids = Array.from(users.values())
    .filter((user) => String(user.clientId) === String(clientId))
    .map((user) => user.id);
  ids.forEach((id) => {
    const record = users.get(String(id));
    if (record) {
      deindexUser(record);
    }
    users.delete(String(id));
  });
  if (ids.length) {
    syncStorage();
  }
  return ids.length;
}

export { sanitizeUser };

export default {
  listUsers,
  getUserById,
  findByEmail,
  findByUsername,
  findByLogin,
  createUser,
  updateUser,
  verifyUserCredentials,
  deleteUser,
  deleteUsersByClientId,
  seedDefaultAdmin,
};
