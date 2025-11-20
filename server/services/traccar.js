import createError from "http-errors";

import { config } from "../config.js";

const TRACCAR_UNAVAILABLE_MESSAGE = "Não foi possível consultar o Traccar";

// Garante que nunca termina com / e sempre aponta para /api
const BASE_URL = `${config.traccar.baseUrl.replace(/\/$/, "")}/api`;

/**
 * Constrói a URL final SEM perder o "/api"
 * Evita o comportamento do new URL(path, base) que zera o path quando path começa com "/"
 */
function buildUrl(base, path, params) {
  const finalBase = base.replace(/\/$/, "");
  const finalPath = path.replace(/^\//, "");
  const url = new URL(`${finalBase}/${finalPath}`);

  if (params && typeof params === "object") {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (Array.isArray(value)) {
        value.forEach((item) => url.searchParams.append(key, item));
        return;
      }
      url.searchParams.set(key, value);
    });
  }

  return url.toString();
}

async function httpRequest({
  baseURL = "",
  method = "GET",
  url,
  params,
  data,
  headers = {},
  timeout = 20_000,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Request timeout")), timeout);

  const finalUrl = buildUrl(baseURL, url, params);
  const resolvedHeaders = new Headers({ Accept: "application/json", ...headers });
  const init = {
    method: method.toUpperCase(),
    headers: resolvedHeaders,
    signal: controller.signal,
  };

  if (data !== undefined && data !== null) {
    if (data instanceof URLSearchParams || typeof data === "string") {
      init.body = data;
      if (!resolvedHeaders.has("Content-Type")) {
        resolvedHeaders.set("Content-Type", "application/x-www-form-urlencoded");
      }
    } else if (data instanceof Buffer || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      init.body = data;
    } else {
      init.body = JSON.stringify(data);
      if (!resolvedHeaders.has("Content-Type")) {
        resolvedHeaders.set("Content-Type", "application/json");
      }
    }
  }

  try {
    const response = await fetch(finalUrl, init);
    clearTimeout(timer);

    let payload;
    try {
      payload = await response.clone().json();
    } catch (_parseError) {
      payload = await response.text();
    }

    const rawHeaders =
      typeof response.headers.raw === "function"
        ? response.headers.raw()
        : Object.fromEntries(response.headers.entries());

    const normalisedResponse = {
      status: response.status,
      statusText: response.statusText,
      headers: rawHeaders,
      data: payload,
    };

    if (!response.ok) {
      const message =
        payload?.message || payload?.cause || response.statusText || "Falha ao comunicar com o Traccar";
      const error = createError(response.status || 500, message);
      error.response = normalisedResponse;
      throw buildTraccarUnavailableError(error, { url: finalUrl, method: init.method, response: payload });
    }

    return normalisedResponse;
  } catch (error) {
    clearTimeout(timer);
    if (error?.isTraccarError || error?.code === "TRACCAR_UNAVAILABLE") {
      throw error;
    }

    throw buildTraccarUnavailableError(error, { url: finalUrl, method: init.method });
  }
}

export function buildTraccarUnavailableError(reason, context = {}) {
  const statusFromReason = Number(reason?.status || reason?.statusCode || reason?.response?.status);
  const status = Number.isFinite(statusFromReason) && statusFromReason >= 400 ? statusFromReason : 502;

  const error = createError(status, TRACCAR_UNAVAILABLE_MESSAGE);
  error.code = "TRACCAR_UNAVAILABLE";
  error.isTraccarError = true;
  error.details = {
    ...(context || {}),
    status,
    cause: reason?.message || reason?.code || reason,
    response: reason?.response?.data,
  };
  return error;
}

let adminSessionCookie = null;

/**
 * Normaliza um token de admin do Traccar.
 * Aceita:
 *  - "session:<id>"
 *  - "JSESSIONID=<id>"
 *  - "Basic xxx" / "Bearer xxx"
 *  - "<token>" cru (vira "Bearer <token>")
 */
function normaliseAdminToken(token) {
  if (!token) return null;
  if (typeof token !== "string") return null;

  if (token.startsWith("session:")) {
    return token;
  }

  if (token.startsWith("JSESSIONID=")) {
    return `session:${token.split("=")[1]}`;
  }

  if (/^(Basic|Bearer)\s+/i.test(token)) {
    return token;
  }

  return `Bearer ${token}`;
}

/**
 * Monta um token Basic em base64 a partir de user:password.
 */
function encodeBasic(user, password) {
  if (!user || !password) return null;
  return Buffer.from(`${user}:${password}`).toString("base64");
}

function storeAdminSession(session) {
  adminSessionCookie = session || null;
  if (session) {
    config.traccar.adminToken = `session:${session}`;
  }
}

/**
 * Headers padrão para chamadas como administrador.
 * Preferência:
 *  1. Usa config.traccar.adminToken (session / Bearer / Basic)
 *  2. Se não tiver token, usa Basic com adminUser/adminPassword
 */
function resolveAdminHeaders() {
  if (adminSessionCookie) {
    return { Cookie: `JSESSIONID=${adminSessionCookie}` };
  }

  const token = normaliseAdminToken(config.traccar.adminToken);
  if (token) {
    if (token.startsWith("session:")) {
      const sessionId = token.split(":")[1];
      storeAdminSession(sessionId);
      return { Cookie: `JSESSIONID=${sessionId}` };
    }
    return { Authorization: token };
  }

  if (config.traccar.adminUser && config.traccar.adminPassword) {
    const basicToken = encodeBasic(config.traccar.adminUser, config.traccar.adminPassword);
    return { Authorization: `Basic ${basicToken}` };
  }

  throw createError(500, "Credenciais administrativas do Traccar não configuradas");
}

/**
 * Guarda o token de admin em memória (para sessão ou bearer).
 */
function storeAdminToken({ session, token }) {
  if (session) {
    storeAdminSession(session);
    config.traccar.adminToken = `session:${session}`;
    return;
  }
  if (token) {
    config.traccar.adminToken = normaliseAdminToken(token);
  }
}

/**
 * Monta headers de autenticação para um usuário comum (não admin),
 * usando dados do context (por exemplo, quando um usuário loga
 * com credenciais próprias do Traccar).
 */
export function resolveUserHeaders(context) {
  if (!context) return null;

  const { traccar } = context;

  if (traccar?.type === "basic" && traccar?.token) {
    return { Authorization: `Basic ${traccar.token}` };
  }

  if (traccar?.type === "session" && traccar?.session) {
    return { Cookie: `JSESSIONID=${traccar.session}` };
  }

  if (traccar?.token) {
    return { Authorization: traccar.token };
  }

  return null;
}

export function getAdminSessionCookie() {
  return adminSessionCookie;
}

/**
 * Função base para qualquer request ao Traccar.
 * - Se asAdmin = true → usa credenciais de admin.
 * - Se asAdmin = false → tenta usar contexto do usuário, senão cai no admin.
 */
export async function traccarRequest(options, context, { asAdmin = false } = {}) {
  let authHeaders;

  if (asAdmin) {
    authHeaders = resolveAdminHeaders();
  } else {
    authHeaders = resolveUserHeaders(context) || resolveAdminHeaders();
  }

  const headers = {
    ...authHeaders,
    ...(options?.headers || {}),
  };

  return httpRequest({
    baseURL: BASE_URL,
    ...options,
    headers,
  });
}

/**
 * Atalho para request como admin.
 */
export async function traccarAdminRequest(options) {
  return traccarRequest(options, null, { asAdmin: true });
}

/**
 * Expor headers de admin (usado em alguns lugares específicos).
 */
export function getTraccarAdminHeaders() {
  return resolveAdminHeaders();
}

export function describeAdminAuth() {
  if (getAdminSessionCookie()) {
    return "session";
  }

  const token = normaliseAdminToken(config.traccar.adminToken);
  if (token) {
    if (token.startsWith("Bearer")) return "bearer";
    if (token.startsWith("Basic")) return "basic";
    return "token";
  }

  if (config.traccar.adminUser && config.traccar.adminPassword) {
    return "basic";
  }

  return "unknown";
}

/**
 * Login explícito no Traccar via /api/session.
 * Útil se você quiser autenticar um usuário com sessão própria,
 * além do admin. NÃO é necessário para o admin funcionar,
 * porque usamos Basic Auth diretamente.
 */
export async function loginTraccar(email, password) {
  const response = await httpRequest({
    method: "POST",
    baseURL: BASE_URL,
    url: "/session",
    data: new URLSearchParams({ email, password }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  // Normaliza o header Set-Cookie (pode vir string ou array)
  const rawSetCookie = response.headers?.["set-cookie"];

  const cookies = Array.isArray(rawSetCookie)
    ? rawSetCookie
    : rawSetCookie
    ? [rawSetCookie]
    : [];

  const sessionCookie = cookies
    .map((item) => String(item).split(";")[0])
    .find((item) => item.startsWith("JSESSIONID="));

  const sessionId = sessionCookie ? sessionCookie.split("=")[1] : null;

  return {
    user: response.data,
    session: sessionId,
    token: null, // aqui estamos usando cookie de sessão, não bearer
  };
}

/**
 * Proxy genérico para repassar chamadas ao Traccar e devolver apenas o data.
 */
export async function traccarProxy(
  method,
  url,
  { context, params, data, asAdmin = false } = {},
) {
  const response = await traccarRequest(
    {
      method,
      url,
      params,
      data,
    },
    asAdmin ? null : context,
    { asAdmin },
  );

  return response.data;
}

/**
 * Inicializa uma sessão/admin "testando" a conexão.
 * Tenta criar sessão via /api/session (cookie) e, em último caso,
 * valida conexão usando as credenciais configuradas.
 */
export async function initializeTraccarAdminSession() {
  const { adminUser, adminPassword, adminToken } = config.traccar;

  if (!adminToken && (!adminUser || !adminPassword)) {
    console.warn("Credenciais administrativas do Traccar não configuradas");
    return;
  }

  if (adminUser && adminPassword) {
    try {
      storeAdminSession(null);
      const auth = await loginTraccar(adminUser, adminPassword);
      storeAdminToken(auth);

      if (auth.session) {
        console.log("Sessão administrativa do Traccar criada (JSESSIONID capturado).");
      } else {
        console.warn("Login administrativo efetuado, mas JSESSIONID não encontrado na resposta.");
      }

      await traccarAdminRequest({
        method: "GET",
        url: "/server",
      });

      console.log("Conectado ao Traccar como administrador usando sessão dedicada.");
      return;
    } catch (error) {
      console.warn(
        "Falha ao autenticar no Traccar via sessão administrativa",
        error?.status || error?.statusCode || "",
        error?.message || error,
      );
    }
  }

  try {
    await traccarAdminRequest({
      method: "GET",
      url: "/server",
    });

    console.log("Conectado ao Traccar como administrador usando credenciais configuradas.");
  } catch (error) {
    console.warn(
      "Falha ao autenticar no Traccar como administrador",
      error?.status || error?.statusCode || "",
      error?.message || error,
    );
  }
}

export async function getTraccarHealth() {
  const authStrategy = describeAdminAuth();
  const sessionActive = Boolean(getAdminSessionCookie());

  try {
    const response = await traccarAdminRequest({
      method: "GET",
      url: "/server",
    });

    return {
      status: "ok",
      authStrategy,
      sessionActive,
      server: response.data,
    };
  } catch (error) {
    return {
      status: "error",
      authStrategy,
      sessionActive,
      message: error?.message || "Falha ao consultar servidor do Traccar",
      code: error?.status || error?.statusCode || 503,
    };
  }
}
