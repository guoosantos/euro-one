const TOKEN_STORAGE_KEY = "euro-one.session.token";
const USER_STORAGE_KEY = "euro-one.session.user";
const RAW_BASE_URL = (import.meta?.env?.VITE_API_BASE_URL || "").trim();
const FALLBACK_BASE_URL =
  typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : "http://localhost:3001";
const BASE_URL = (RAW_BASE_URL || FALLBACK_BASE_URL).replace(/\/$/, "");

export function getApiBaseUrl() {
  return BASE_URL;
}

const unauthorizedHandlers = new Set();

export function registerUnauthorizedHandler(handler) {
  if (typeof handler !== "function") return () => {};
  unauthorizedHandlers.add(handler);
  return () => unauthorizedHandlers.delete(handler);
}

function notifyUnauthorized(error) {
  unauthorizedHandlers.forEach((handler) => {
    try {
      handler(error);
    } catch (notifyError) {
      console.warn("Falha ao notificar 401", notifyError);
    }
  });
}

function getStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch (error) {
    console.warn("Storage indisponível", error);
  }
  return null;
}

export function getStoredSession() {
  const storage = getStorage();
  if (!storage) return { token: null, user: null };
  try {
    const rawToken = storage.getItem(TOKEN_STORAGE_KEY);
    const rawUser = storage.getItem(USER_STORAGE_KEY);
    return {
      token: rawToken || null,
      user: rawUser ? JSON.parse(rawUser) : null,
    };
  } catch (error) {
    console.warn("Falha ao carregar sessão persistida", error);
    return { token: null, user: null };
  }
}

export function setStoredSession(session) {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (session?.token) {
      storage.setItem(TOKEN_STORAGE_KEY, session.token);
    }
    if (session?.user) {
      storage.setItem(USER_STORAGE_KEY, JSON.stringify(session.user));
    }
  } catch (error) {
    console.warn("Falha ao persistir sessão", error);
  }
}

export function clearStoredSession() {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(TOKEN_STORAGE_KEY);
    storage.removeItem(USER_STORAGE_KEY);
  } catch (error) {
    console.warn("Falha ao limpar sessão", error);
  }
}

function normaliseToken(value) {
  if (!value) return null;
  if (/^Bearer /i.test(value)) {
    return value;
  }
  return `Bearer ${value}`;
}

export function resolveAuthorizationHeader() {
  const stored = getStoredSession();
  if (stored?.token) {
    return normaliseToken(stored.token);
  }
  return null;
}

function friendlyErrorMessage(status, payload, statusText) {
  if (payload?.message) return payload.message;
  if (status === 401) return "Sessão expirada. Faça login novamente.";
  if (status === 403) return "Você não tem permissão para realizar esta ação.";
  if (status >= 500) return "Erro interno. Tente novamente em instantes.";
  return statusText || "Erro na requisição";
}

function buildUrl(path, params, { apiPrefix = true } = {}) {
  const targetPath = typeof path === "string" ? path : String(path || "");
  const isAbsolute = /^https?:\/\//i.test(targetPath);

  const url = isAbsolute
    ? new URL(targetPath)
    : (() => {
        const base = new URL(BASE_URL || FALLBACK_BASE_URL);
        const basePath = base.pathname.replace(/\/$/, "");
        const normalisedPath = targetPath.replace(/^\/+/, "");
        const shouldPrefix = apiPrefix && !/^(api\/?)/.test(normalisedPath) && !/\/api\/?$/.test(basePath);
        const segments = [basePath, shouldPrefix ? "api" : "", normalisedPath]
          .filter(Boolean)
          .join("/");
        base.pathname = segments.replace(/\/{2,}/g, "/");
        return base;
      })();

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

async function request({
  method = "GET",
  url,
  params,
  data,
  headers = {},
  timeout = 20_000,
  apiPrefix = true,
  signal,
  responseType = "json",
}) {
  const controller = new AbortController();
  const abortReason = new Error("Request timeout");
  const timer = setTimeout(() => controller.abort(abortReason), timeout);

  const forwardAbort = () => {
    try {
      controller.abort(signal?.reason);
    } catch (_abortError) {
      controller.abort();
    }
  };

  if (signal) {
    if (signal.aborted) {
      forwardAbort();
    } else {
      signal.addEventListener("abort", forwardAbort);
    }
  }

  const finalUrl = buildUrl(url, params, { apiPrefix });
  const resolvedHeaders = new Headers(headers);
  const authorization = resolveAuthorizationHeader();
  if (authorization && !resolvedHeaders.has("Authorization")) {
    resolvedHeaders.set("Authorization", authorization);
  }

  const init = {
    method: method.toUpperCase(),
    headers: resolvedHeaders,
    credentials: "include",
    signal: controller.signal,
  };

  if (data !== undefined && data !== null) {
    if (data instanceof FormData || data instanceof Blob || data instanceof ArrayBuffer) {
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
      if (responseType === "blob") {
        payload = await response.clone().blob();
      } else if (responseType === "text") {
        payload = await response.clone().text();
      } else {
        payload = await response.clone().json();
      }
    } catch (parseError) {
      payload = await response.text();
    }

    const normalised = {
      status: response.status,
      statusText: response.statusText,
      data: payload,
    };

    if (response.status === 401) {
      clearStoredSession();
      notifyUnauthorized(normalised);
      if (typeof window !== "undefined") {
        window.alert?.("Sessão expirada. Faça login novamente.");
        window.location.assign("/login");
      }
    }

    if (!response.ok) {
      const error = new Error(friendlyErrorMessage(response.status, payload, response.statusText));
      error.status = response.status;
      error.response = normalised;
      throw error;
    }

    return normalised;
  } catch (error) {
    clearTimeout(timer);
    throw error;
  } finally {
    if (signal) {
      signal.removeEventListener("abort", forwardAbort);
    }
  }
}

const api = {
  request,
  get: (url, options = {}) => request({ ...options, method: "GET", url }),
  delete: (url, options = {}) => request({ ...options, method: "DELETE", url }),
  post: (url, data, options = {}) => request({ ...options, method: "POST", url, data }),
  put: (url, data, options = {}) => request({ ...options, method: "PUT", url, data }),
  patch: (url, data, options = {}) => request({ ...options, method: "PATCH", url, data }),
};

export default api;
