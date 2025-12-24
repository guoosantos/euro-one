import createError from "http-errors";

const fallbackEnabled =
  String(process.env.ENABLE_DEMO_FALLBACK || process.env.ALLOW_DEMO_FALLBACK || "").toLowerCase() === "true";

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
