const TOKEN_STORAGE_KEY = "euro-one.session.token";
const USER_STORAGE_KEY = "euro-one.session.user";
const RAW_BASE_URL = import.meta?.env?.VITE_API_BASE_URL || "";
const BASE_URL = RAW_BASE_URL ? RAW_BASE_URL.replace(/\/$/, "") : "";

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

function resolveAuthorizationHeader() {
  const stored = getStoredSession();
  if (stored?.token) {
    return normaliseToken(stored.token);
  }
  return null;
}

function buildUrl(path, params) {
  const url = new URL(path, `${BASE_URL || ""}/api`);
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

async function request({ method = "GET", url, params, data, headers = {}, timeout = 20_000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Request timeout")), timeout);

  const finalUrl = buildUrl(url, params);
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
      payload = await response.clone().json();
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
    }

    if (!response.ok) {
      const error = new Error(payload?.message || response.statusText || "Erro na requisição");
      error.response = normalised;
      throw error;
    }

    return normalised;
  } catch (error) {
    clearTimeout(timer);
    throw error;
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
