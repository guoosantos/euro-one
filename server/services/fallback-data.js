import createError from "http-errors";

const fallbackEnabled =
  String(process.env.ENABLE_DEMO_FALLBACK || process.env.ALLOW_DEMO_FALLBACK || "").toLowerCase() === "true";

const demoLoginOnly =
  String(process.env.DEMO_LOGIN_ONLY || process.env.DEMO_MODE || "").toLowerCase() === "true";

const allowDemoFallbackInProduction =
  String(process.env.ALLOW_DEMO_FALLBACK_IN_PRODUCTION || "").toLowerCase() === "true";

const failOnDemoFallbackInProduction =
  String(process.env.FAIL_ON_DEMO_FALLBACK_IN_PRODUCTION || "").toLowerCase() === "true";

const productionLike = ["production", "prod"].includes(String(process.env.NODE_ENV || "").toLowerCase());

const fallbackClient = {
  id: process.env.FALLBACK_CLIENT_ID || "demo-client",
  name: process.env.FALLBACK_CLIENT_NAME || "Cliente Demo",
  deviceLimit: 0,
  userLimit: 0,
  attributes: {},
};

const fallbackUser = {
  id: process.env.FALLBACK_ADMIN_ID || "demo-admin",
  name: process.env.FALLBACK_ADMIN_NAME || "Administrador Demo",
  email: process.env.FALLBACK_ADMIN_EMAIL || "admin@euro.one",
  username: process.env.FALLBACK_ADMIN_USERNAME || "admin",
  role: "admin",
  clientId: fallbackClient.id,
  password: process.env.FALLBACK_ADMIN_PASSWORD || "admin",
};

export function isFallbackEnabled() {
  return fallbackEnabled;
}

export function isDemoModeEnabled() {
  return fallbackEnabled && demoLoginOnly;
}

export function shouldUseDemoFallback({ prismaAvailable }) {
  const prismaUp = Boolean(prismaAvailable);
  return fallbackEnabled && (!prismaUp || demoLoginOnly);
}

export function assertDemoFallbackSafety() {
  if (!fallbackEnabled) return;

  const warning = "[safety] ENABLE_DEMO_FALLBACK ativo; não utilize em produção com banco disponível.";
  if (productionLike && !allowDemoFallbackInProduction) {
    const message = `${warning} Defina ALLOW_DEMO_FALLBACK_IN_PRODUCTION=true para sobrescrever.`;
    console.warn(message, {
      nodeEnv: process.env.NODE_ENV || null,
      allowDemoFallbackInProduction,
      failOnDemoFallbackInProduction,
    });
    if (failOnDemoFallbackInProduction) {
      const error = new Error(message);
      error.code = "DEMO_FALLBACK_FORBIDDEN_IN_PRODUCTION";
      throw error;
    }
    return;
  }

  console.warn(warning, {
    nodeEnv: process.env.NODE_ENV || null,
    allowDemoFallbackInProduction,
    failOnDemoFallbackInProduction,
    demoLoginOnly,
  });
}

function ensureFallbackEnabled() {
  if (fallbackEnabled) return true;
  throw createError(
    503,
    "Modo demo desabilitado. Configure ENABLE_DEMO_FALLBACK=true para habilitar os dados de exemplo.",
  );
}

export function getFallbackClient() {
  ensureFallbackEnabled();
  return { ...fallbackClient };
}

export function getFallbackUser() {
  ensureFallbackEnabled();
  const { password, ...user } = fallbackUser;
  return { ...user };
}

export function resolveFallbackCredentials(login, password) {
  if (!fallbackEnabled) return null;
  if (!login || !password) return null;
  const normalizedLogin = String(login).trim().toLowerCase();
  const candidate = { ...fallbackUser };
  if (
    normalizedLogin !== String(candidate.email).toLowerCase() &&
    normalizedLogin !== String(candidate.username).toLowerCase()
  ) {
    return null;
  }

  if (String(password) !== String(candidate.password)) {
    return null;
  }

  const { password: _pwd, ...safeUser } = candidate;
  return safeUser;
}
