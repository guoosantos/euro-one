import createError from "http-errors";

import { loadEnv, validateEnv } from "../utils/env.js";

await loadEnv();

function buildUnavailableError(reason) {
  const error = createError(503, "Banco de dados indisponível ou mal configurado");
  error.code = "DATABASE_UNAVAILABLE";
  error.details = { cause: reason?.message || reason };
  return error;
}

let PrismaClient;
try {
  ({ PrismaClient } = await import("@prisma/client"));
} catch (error) {
  console.warn("[prisma] pacote @prisma/client indisponível, verifique a instalação e o prisma generate");
}

const databaseUrl = process.env.DATABASE_URL;
const prismaEnabled = Boolean(PrismaClient) && Boolean(databaseUrl);

if (!prismaEnabled) {
  const validation = validateEnv(["DATABASE_URL"], { optional: true });
  if (validation.missing.length) {
    console.warn(
      "[prisma] DATABASE_URL ausente; recursos dependentes do banco ficarão indisponíveis.",
    );
  }
}

let prisma = null;
function initPrisma() {
  if (!prismaEnabled) {
    return null;
  }

  if (prisma) return prisma;

  try {
    prisma = new PrismaClient();
    return prisma;
  } catch (error) {
    console.error("[prisma] falha ao inicializar PrismaClient", error?.message || error);
    prisma = null;
    throw buildUnavailableError(error);
  }
}

export function isPrismaAvailable() {
  return prismaEnabled;
}

export function getPrisma() {
  return initPrisma();
}

const prismaProxy = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = initPrisma();
      if (!client) {
        return () => {
          throw buildUnavailableError("Prisma desativado (DATABASE_URL ausente ou pacote não instalado)");
        };
      }
      return client[prop];
    },
  },
);

export default prismaProxy;
