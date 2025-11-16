import createError from "http-errors";
import { randomUUID } from "crypto";

import { hashPassword, sanitizeUser, verifyPassword } from "../utils/password.js";
import { loadCollection, saveCollection } from "../services/storage.js";

const VALID_ROLES = new Set(["admin", "manager", "user"]);

const STORAGE_KEY = "users";
const users = new Map();
const emailIndex = new Map();
const usernameIndex = new Map();

function syncStorage() {
  saveCollection(STORAGE_KEY, Array.from(users.values()));
}

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

function persistUser(record, { skipSync = false } = {}) {
  users.set(record.id, record);
  if (record.emailNormalized) {
    emailIndex.set(record.emailNormalized, record.id);
  }
  if (record.usernameNormalized) {
    usernameIndex.set(record.usernameNormalized, record.id);
  }
  if (!skipSync) {
    syncStorage();
  }
  return record;
}

function unpersistUser(record, { skipSync = false } = {}) {
  users.delete(record.id);
  if (record.emailNormalized) {
    emailIndex.delete(record.emailNormalized);
  }
  if (record.usernameNormalized) {
    usernameIndex.delete(record.usernameNormalized);
  }
  if (!skipSync) {
    syncStorage();
  }
}

const persistedUsers = loadCollection(STORAGE_KEY, []);
persistedUsers.forEach((record) => {
  if (!record?.id) {
    return;
  }
  persistUser({ ...record }, { skipSync: true });
});

async function seedDefaultAdmin() {
  const existing = findByEmail("admin@euro.one") || findByUsername("admin");
  if (existing) {
    return;
  }
  const id = randomUUID();
  const passwordHash = await hashPassword("admin");
  const record = {
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  persistUser(record);
}

await seedDefaultAdmin();

export function listUsers({ clientId } = {}) {
  const collection = Array.from(users.values());
  const filtered =
    typeof clientId === "undefined"
      ? collection
      : collection.filter((user) => {
          if (clientId === null) {
            return user.clientId === null;
          }
          return String(user.clientId) === String(clientId);
        });
  return filtered.map((user) => sanitizeUser(user));
}

export function getUserById(id, { includeSensitive = false } = {}) {
  const record = users.get(String(id));
  if (!record) return null;
  return includeSensitive ? record : sanitizeUser(record);
}

export function findByEmail(email, { includeSensitive = false } = {}) {
  const normalized = normaliseEmail(email);
  if (!normalized) return null;
  const id = emailIndex.get(normalized);
  if (!id) return null;
  return getUserById(id, { includeSensitive });
}

export function findByUsername(username, { includeSensitive = false } = {}) {
  const normalized = normaliseUsername(username);
  if (!normalized) return null;
  const id = usernameIndex.get(normalized);
  if (!id) return null;
  return getUserById(id, { includeSensitive });
}

export function findByLogin(login, { includeSensitive = false } = {}) {
  return (
    findByEmail(login, { includeSensitive }) ||
    findByUsername(login, { includeSensitive })
  );
}

function ensureUniqueEmail(email, currentId = null) {
  if (!email) return;
  const normalized = normaliseEmail(email);
  const existingId = emailIndex.get(normalized);
  if (existingId && existingId !== currentId) {
    throw createError(409, "E-mail já cadastrado");
  }
}

function ensureUniqueUsername(username, currentId = null) {
  if (!username) return;
  const normalized = normaliseUsername(username);
  const existingId = usernameIndex.get(normalized);
  if (existingId && existingId !== currentId) {
    throw createError(409, "Login já utilizado");
  }
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
  ensureUniqueEmail(email);
  ensureUniqueUsername(username);
  const normalizedEmail = normaliseEmail(email);
  const normalizedUsername = username ? normaliseUsername(username) : null;
  const validatedRole = assertRole(role);
  if (validatedRole !== "admin" && !clientId) {
    throw createError(400, "Usuários não administradores devem estar vinculados a um cliente");
  }

  const id = randomUUID();
  const passwordHash = await hashPassword(password);
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
    clientId: validatedRole === "admin" ? null : clientId,
    attributes,
    createdAt: now,
    updatedAt: now,
  };
  persistUser(record);
  return sanitizeUser(record);
}

export async function updateUser(id, updates = {}) {
  const record = users.get(String(id));
  if (!record) {
    throw createError(404, "Usuário não encontrado");
  }

  if (updates.email) {
    ensureUniqueEmail(updates.email, record.id);
    const normalized = normaliseEmail(updates.email);
    if (record.emailNormalized && record.emailNormalized !== normalized) {
      emailIndex.delete(record.emailNormalized);
    }
    record.email = updates.email;
    record.emailNormalized = normalized;
    emailIndex.set(normalized, record.id);
  }

  if (updates.username !== undefined) {
    ensureUniqueUsername(updates.username, record.id);
    const normalized = updates.username ? normaliseUsername(updates.username) : null;
    if (record.usernameNormalized && record.usernameNormalized !== normalized) {
      usernameIndex.delete(record.usernameNormalized);
    }
    record.username = updates.username || null;
    record.usernameNormalized = normalized;
    if (normalized) {
      usernameIndex.set(normalized, record.id);
    }
  }

  if (updates.name) {
    record.name = updates.name;
  }

  if (updates.role) {
    record.role = assertRole(updates.role);
    if (record.role === "admin") {
      record.clientId = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, "clientId")) {
    record.clientId = updates.clientId ?? null;
  }

  if (updates.attributes) {
    record.attributes = { ...record.attributes, ...updates.attributes };
  }

  if (updates.password) {
    record.passwordHash = await hashPassword(updates.password);
  }

  record.updatedAt = new Date().toISOString();
  persistUser(record);
  return sanitizeUser(record);
}

export function deleteUser(id) {
  const record = users.get(String(id));
  if (!record) {
    throw createError(404, "Usuário não encontrado");
  }
  if (record.role === "admin" && record.clientId === null) {
    throw createError(400, "Não é permitido remover o administrador padrão");
  }
  unpersistUser(record);
  return true;
}

export function deleteUsersByClientId(clientId) {
  const targetId = String(clientId);
  const toRemove = Array.from(users.values()).filter((user) => String(user.clientId) === targetId);
  toRemove.forEach((user) => {
    unpersistUser(user);
  });
  return toRemove.length;
}

export async function verifyUserCredentials(login, password) {
  if (!login || !password) {
    throw createError(400, "Login e senha são obrigatórios");
  }
  const record = findByLogin(login, { includeSensitive: true });
  if (!record) {
    throw createError(401, "Usuário ou senha inválidos");
  }
  const valid = await verifyPassword(password, record.passwordHash);
  if (!valid) {
    throw createError(401, "Usuário ou senha inválidos");
  }
  return sanitizeUser(record);
}

export { sanitizeUser } from "../utils/password.js";
