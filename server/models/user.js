import createError from "http-errors";
import { randomUUID } from "crypto";

import prisma, { isPrismaAvailable } from "../services/prisma.js";
import { hashPassword, sanitizeUser, verifyPassword } from "../utils/password.js";
import {
  getFallbackClient,
  getFallbackUser,
  isFallbackEnabled,
  resolveFallbackCredentials,
} from "../services/fallback-data.js";

const VALID_ROLES = new Set(["admin", "manager", "user"]);

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

async function ensureUniqueEmail(email, currentId = null) {
  if (!email) return;
  const normalized = normaliseEmail(email);
  if (!normalized) return;
  const existing = await prisma.user.findUnique({ where: { emailNormalized: normalized } });
  if (existing && existing.id !== currentId) {
    throw createError(409, "E-mail já cadastrado");
  }
}

async function ensureUniqueUsername(username, currentId = null) {
  if (!username) return;
  const normalized = normaliseUsername(username);
  if (!normalized) return;
  const existing = await prisma.user.findUnique({ where: { usernameNormalized: normalized } });
  if (existing && existing.id !== currentId) {
    throw createError(409, "Login já utilizado");
  }
}

export async function listUsers({ clientId } = {}) {
  if (!isPrismaAvailable()) {
    if (!isFallbackEnabled()) {
      throw createError(503, "Banco de dados indisponível e modo demo desabilitado");
    }
    const fallback = getFallbackUser();
    return !clientId || String(clientId) === String(fallback.clientId) ? [fallback] : [];
  }

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
}

export async function getUserById(id, { includeSensitive = false } = {}) {
  if (!isPrismaAvailable()) {
    if (!isFallbackEnabled()) {
      throw createError(503, "Banco de dados indisponível e modo demo desabilitado");
    }
    const fallback = getFallbackUser();
    if (String(id) !== String(fallback.id)) return null;
    return includeSensitive ? { ...fallback } : sanitizeUser(fallback);
  }
  const record = await prisma.user.findUnique({ where: { id: String(id) } });
  if (!record) return null;
  return includeSensitive ? record : sanitizeUser(record);
}

export async function findByEmail(email, { includeSensitive = false } = {}) {
  const normalized = normaliseEmail(email);
  if (!normalized) return null;
  if (!isPrismaAvailable()) {
    if (!isFallbackEnabled()) {
      throw createError(503, "Banco de dados indisponível e modo demo desabilitado");
    }
    const fallback = getFallbackUser();
    if (normalized === normaliseEmail(fallback.email)) {
      return includeSensitive ? { ...fallback } : sanitizeUser(fallback);
    }
    return null;
  }
  const record = await prisma.user.findUnique({ where: { emailNormalized: normalized } });
  if (!record) return null;
  return includeSensitive ? record : sanitizeUser(record);
}

export async function findByUsername(username, { includeSensitive = false } = {}) {
  const normalized = normaliseUsername(username);
  if (!normalized) return null;
  if (!isPrismaAvailable()) {
    if (!isFallbackEnabled()) {
      throw createError(503, "Banco de dados indisponível e modo demo desabilitado");
    }
    const fallback = getFallbackUser();
    if (normalized === normaliseUsername(fallback.username)) {
      return includeSensitive ? { ...fallback } : sanitizeUser(fallback);
    }
    return null;
  }
  const record = await prisma.user.findUnique({ where: { usernameNormalized: normalized } });
  if (!record) return null;
  return includeSensitive ? record : sanitizeUser(record);
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
  if (validatedRole !== "admin" && !clientId) {
    throw createError(400, "Usuários não administradores devem estar vinculados a um cliente");
  }

  const id = randomUUID();
  const passwordHash = await hashPassword(password);
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
      clientId: validatedRole === "admin" ? null : clientId,
      attributes,
    },
  });
  return sanitizeUser(record);
}

export async function updateUser(id, updates = {}) {
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
}

export async function verifyUserCredentials(login, password) {
  const fallbackMatch = resolveFallbackCredentials(login, password);
  if (fallbackMatch) {
    return fallbackMatch;
  }

  const user = await findByLogin(login, { includeSensitive: true });
  if (!user) {
    throw createError(401, "Credenciais inválidas");
  }

  if (!isPrismaAvailable()) {
    throw createError(401, "Credenciais inválidas");
  }

  const isValidPassword = await verifyPassword(password, user.passwordHash);
  if (!isValidPassword) {
    throw createError(401, "Credenciais inválidas");
  }
  return user;
}

export async function deleteUser(id) {
  const record = await prisma.user.delete({ where: { id: String(id) } }).catch(() => null);
  if (!record) {
    throw createError(404, "Usuário não encontrado");
  }
  return sanitizeUser(record);
}

export async function deleteUsersByClientId(clientId) {
  if (!clientId) return 0;
  const result = await prisma.user.deleteMany({ where: { clientId: String(clientId) } });
  return result.count;
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
