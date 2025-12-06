import createError from "http-errors";

import { config } from "../config.js";

const TRACCAR_UNAVAILABLE_MESSAGE = "Não foi possível consultar o Traccar";

// Garante que nunca termina com / e sempre aponta para /api
const BASE_URL = `${(process.env.TRACCAR_BASE_URL || config.traccar.baseUrl || "").replace(/\/$/, "")}/api`;

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

function resolveStatus(error) {
  const status = Number(
    error?.status || error?.statusCode || error?.response?.status || error?.details?.status,
  );
  return Number.isFinite(status) ? status : null;
}

function logTraccarAttempt({ method, url, attempt, maxAttempts, error }) {
  const status = resolveStatus(error);
  console.warn("[traccar] falha na requisição", {
    method,
    url,
    attempt,
    maxAttempts,
    status,
    code: error?.code,
    message: error?.message || error,
  });
}

function buildErrorResult({ message, code, cause }) {
  return { ok: false, error: { message, code, cause } };
}

async function requestTraccar(path, options = {}) {
  const {
    method = "GET",
    params,
    data,
    headers = {},
    responseType = "json",
    timeout = 5_000,
  } = options;

  const url = buildUrl(BASE_URL, path, params);
  const resolvedHeaders = new Headers({ Accept: "application/json", ...headers });
  const init = { method: method.toUpperCase(), headers: resolvedHeaders };

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

  let attempt = 0;
  const maxAttempts = 3; // 1 tentativa inicial + 2 retries
  const transientStatus = [502, 503, 504];
  const transientCodes = ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED"];

  while (attempt < maxAttempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error("Request timeout"));
    }, timeout);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      const rawHeaders =
        typeof response.headers.raw === "function"
          ? response.headers.raw()
          : Object.fromEntries(response.headers.entries());

      let payload;
      try {
        if (responseType === "arraybuffer") {
          payload = await response.arrayBuffer();
        } else {
          payload = await response.clone().json();
        }
      } catch (_parseError) {
        payload = await response.text();
      }

      if (response.ok) {
        return { ok: true, status: response.status, headers: rawHeaders, data: payload };
      }

      const errorMessage =
        response.status === 504
          ? "Tempo de resposta do Traccar excedido."
          : response.status >= 500
          ? "Não foi possível conectar ao servidor Traccar."
          : "Erro inesperado ao consultar o Traccar.";

      const errorResult = buildErrorResult({
        message: errorMessage,
        code: response.status,
        cause: payload?.message || payload?.cause || response.statusText,
      });

      if (transientStatus.includes(response.status) && attempt + 1 < maxAttempts) {
        logTraccarAttempt({ method: init.method, url, attempt: attempt + 1, maxAttempts, error: errorResult });
        const backoff = attempt === 0 ? 500 : 1500;
        await new Promise((resolve) => setTimeout(resolve, backoff));
        attempt += 1;
        continue;
      }

      return errorResult;
    } catch (error) {
      clearTimeout(timer);
      const causeCode = error?.code || (error?.name === "AbortError" ? "ETIMEDOUT" : undefined);
      const isTimeout = causeCode === "ETIMEDOUT" || error?.name === "AbortError";
      const transient = isTimeout || transientCodes.includes(causeCode);

      const errorResult = buildErrorResult({
        message: isTimeout
          ? "Tempo de resposta do Traccar excedido."
          : "Não foi possível conectar ao servidor Traccar.",
        code: causeCode,
        cause: error?.message || error?.toString(),
      });

      logTraccarAttempt({ method: init.method, url, attempt: attempt + 1, maxAttempts, error: errorResult });

      if (transient && attempt + 1 < maxAttempts) {
        const backoff = attempt === 0 ? 500 : 1500;
        await new Promise((resolve) => setTimeout(resolve, backoff));
        attempt += 1;
        continue;
      }

      return errorResult;
    }
  }

  return buildErrorResult({ message: "Erro inesperado ao consultar o Traccar." });
}

export function buildTraccarUnavailableError(reason, context = {}) {
  const statusFromReason = Number(reason?.status || reason?.statusCode || reason?.response?.status);
  const status = Number.isFinite(statusFromReason) && statusFromReason >= 400 ? statusFromReason : 503;

  const statusLabel = context?.status || statusFromReason || reason?.code;
  const messageSuffix = statusLabel ? ` (${statusLabel})` : "";
  const error = createError(status, `${TRACCAR_UNAVAILABLE_MESSAGE}${messageSuffix}`);
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

  return requestTraccar(options.url, { ...options, headers });
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

export async function loginTraccar(email, password) {
  const response = await requestTraccar("/session", {
    method: "POST",
    data: new URLSearchParams({ email, password }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!response.ok) {
    return response;
  }

  const rawSetCookie = response.headers?.["set-cookie"];

  const cookies = Array.isArray(rawSetCookie)
    ? rawSetCookie
    : rawSetCookie
    ? [rawSetCookie]
    : [];

  const sessionCookie = cookies.map((item) => String(item).split(";")[0]).find((item) => item.startsWith("JSESSIONID="));

  const sessionId = sessionCookie ? sessionCookie.split("=")[1] : null;

  return {
    ok: true,
    user: response.data,
    session: sessionId,
    token: null, // aqui estamos usando cookie de sessão, não bearer
  };
}

/**
 * Proxy genérico para repassar chamadas ao Traccar e devolver apenas o data.
 */
export async function traccarProxy(method, url, { context, params, data, asAdmin = false } = {}) {
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

  if (response?.ok) {
    return response.data;
  }

  return response;
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
      if (auth?.ok) {
        storeAdminToken(auth);

        if (auth.session) {
          console.log("Sessão administrativa do Traccar criada (JSESSIONID capturado).");
        } else {
          console.warn("Login administrativo efetuado, mas JSESSIONID não encontrado na resposta.");
        }

        const ping = await traccarAdminRequest({
          method: "GET",
          url: "/server",
        });

        if (ping?.ok) {
          console.log("Conectado ao Traccar como administrador usando sessão dedicada.");
          return;
        }
      }
    } catch (error) {
      console.warn(
        "Falha ao autenticar no Traccar via sessão administrativa",
        error?.status || error?.statusCode || "",
        error?.message || error,
      );
    }
  }

  try {
    const check = await traccarAdminRequest({
      method: "GET",
      url: "/server",
    });

    if (check?.ok) {
      console.log("Conectado ao Traccar como administrador usando credenciais configuradas.");
      return;
    }

    console.warn(
      "Falha ao autenticar no Traccar como administrador",
      check?.error?.code || check?.error?.message,
      check?.error?.message,
    );
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

  const response = await traccarAdminRequest({
    method: "GET",
    url: "/server",
  });

  if (response?.ok) {
    return {
      status: "ok",
      authStrategy,
      sessionActive,
      server: response.data,
    };
  }

  return {
    status: "error",
    authStrategy,
    sessionActive,
    message: response?.error?.message || "Falha ao consultar servidor do Traccar",
    code: response?.error?.code || 503,
  };
}

// Funções utilitárias específicas
export async function getDevices(context, options = {}) {
  const response = await traccarRequest({ method: "GET", url: "/devices", params: options?.params }, context);
  return response?.ok ? { ok: true, devices: response.data } : response;
}

export async function getLastPositions(context, deviceIds) {
  const params = {};
  if (Array.isArray(deviceIds) && deviceIds.length > 0) {
    params.deviceId = deviceIds;
  }
  const response = await traccarRequest({ method: "GET", url: "/positions/last", params }, context);
  return response?.ok ? { ok: true, positions: response.data } : response;
}

export async function getEvents(context, params) {
  const response = await traccarRequest({ method: "GET", url: "/events", params }, context);
  return response?.ok ? { ok: true, events: response.data } : response;
}

export async function getServerHealth() {
  return getTraccarHealth();
}

