import createError from "http-errors";

import { loadEnv } from "../utils/env.js";

await loadEnv();

function buildMissingEnvError(variable) {
  const error = createError(500, `Variável de ambiente obrigatória ausente: ${variable}`);
  error.code = "MISSING_ENV";
  error.details = { missing: [variable] };
  return error;
}

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
if (!databaseUrl) {
  throw buildMissingEnvError("DATABASE_URL");
}

let prisma = null;
function initPrisma() {
  if (!PrismaClient) {
    throw buildUnavailableError("@prisma/client não foi instalado ou gerado");
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

export function getPrisma() {
  return initPrisma();
}

const prismaProxy = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = initPrisma();
      return client[prop];
    },
  },
);

export default prismaProxy;
