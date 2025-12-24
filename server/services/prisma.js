import createError from "http-errors";

import { loadEnv, validateEnv } from "../utils/env.js";

await loadEnv();

function buildUnavailableError(reason) {
  const error = createError(503, "Banco de dados indisponível ou mal configurado");
  error.code = "DATABASE_UNAVAILABLE";
  error.details = { cause: reason?.message || reason };
  return error;
}

function disabledResult(operation) {
  const op = String(operation);
  if (op === "findMany" || op === "groupBy") return [];
  if (op === "count") return 0;
  if (op.endsWith("Many")) return { count: 0 };
  return null;
}

const disabledWarnings = new Set();
function logDisabled(operation) {
  const key = String(operation);
  if (disabledWarnings.has(key)) return;
  disabledWarnings.add(key);
  console.warn("[prisma] acesso em modo desativado; retornando mock seguro", { operation: key });
}

function createDisabledModel(modelName) {
  const handler = {
    get(_modelTarget, operation) {
      if (operation === Symbol.toStringTag) return "PrismaDisabledModel";
      return async () => {
        logDisabled(`${modelName}.${String(operation)}`);
        return disabledResult(operation);
      };
    },
  };
  return new Proxy({}, handler);
}

const disabledModels = new Map();
function getDisabledModel(modelName) {
  if (!disabledModels.has(modelName)) {
    disabledModels.set(modelName, createDisabledModel(modelName));
  }
  return disabledModels.get(modelName);
}

const disabledPrismaClient = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === "$transaction") {
        return async (operations = []) => {
          logDisabled("$transaction");
          if (Array.isArray(operations)) {
            return operations.map((operation) => (typeof operation === "function" ? operation() : null));
          }
          return null;
        };
      }
      if (prop === "$connect" || prop === "$disconnect" || prop === "$on") {
        return async () => {
          logDisabled(prop);
          return null;
        };
      }
      return getDisabledModel(String(prop));
    },
  },
);

let PrismaClient;
try {
  ({ PrismaClient } = await import("@prisma/client"));
} catch (_error) {
  console.warn("[prisma] pacote @prisma/client indisponível, verifique a instalação e o prisma generate");
}

const databaseUrl = process.env.DATABASE_URL;
const hasPrismaConfig = Boolean(PrismaClient) && Boolean(databaseUrl);

if (!hasPrismaConfig) {
  const validation = validateEnv(["DATABASE_URL"], { optional: true });
  if (validation.missing.length) {
    console.warn(
      "[prisma] DATABASE_URL ausente; recursos dependentes do banco ficarão indisponíveis.",
    );
  }
}

const prismaState = {
  client: null,
  enabled: hasPrismaConfig,
  reason: null,
};

function initPrisma() {
  if (!prismaState.enabled) {
    return null;
  }

  if (prismaState.client) return prismaState.client;

  try {
    prismaState.client = new PrismaClient();
    prismaState.reason = null;
    return prismaState.client;
  } catch (error) {
    prismaState.client = null;
    prismaState.enabled = false;
    prismaState.reason = error;
    console.warn("[prisma] falha ao inicializar PrismaClient, executando em modo desativado", error?.message || error);
    return null;
  }
}

export function isPrismaAvailable() {
  return Boolean(initPrisma());
}

export function getPrisma() {
  return initPrisma();
}

const prismaProxy = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = initPrisma();
      const target = client || disabledPrismaClient;
      const value = target[prop];
      return value;
    },
  },
);

export default prismaProxy;
