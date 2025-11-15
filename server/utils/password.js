import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

let bcryptPromise;

function loadBcrypt() {
  if (!bcryptPromise) {
    bcryptPromise = import("bcrypt").catch((error) => {
      if (process.env.NODE_ENV !== "production") {
        console.warn("Biblioteca bcrypt não disponível, utilizando scrypt como fallback.", error?.message || error);
      }
      return null;
    });
  }
  return bcryptPromise;
}

function hashWithScrypt(password) {
  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

function compareWithScrypt(password, storedHash) {
  if (!storedHash || typeof storedHash !== "string") return false;
  const [prefix, saltHex, keyHex] = storedHash.split(":");
  if (prefix !== "scrypt" || !saltHex || !keyHex) {
    return false;
  }
  const salt = Buffer.from(saltHex, "hex");
  const derivedKey = Buffer.from(keyHex, "hex");
  const candidate = scryptSync(password, salt, derivedKey.length);
  if (candidate.length !== derivedKey.length) {
    return false;
  }
  return timingSafeEqual(candidate, derivedKey);
}

export async function hashPassword(password, saltRounds = 10) {
  if (typeof password !== "string" || !password) {
    throw new Error("Senha inválida para hash");
  }
  const bcrypt = await loadBcrypt();
  if (bcrypt?.hash) {
    return bcrypt.hash(password, saltRounds);
  }
  return hashWithScrypt(password);
}

export async function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  const bcrypt = await loadBcrypt();
  if (bcrypt?.compare) {
    return bcrypt.compare(password, storedHash);
  }
  return compareWithScrypt(password, storedHash);
}

export function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}
