const TOKEN_STORAGE_KEY = "euro-one.session.token";
const USER_STORAGE_KEY = "euro-one.session.user";
const MIRROR_OWNER_STORAGE_KEY = "euro-one.mirror.owner-client-id";

const RAW_BASE_URL = (import.meta?.env?.VITE_API_BASE_URL || "").trim().replace(/\/$/, "");
const FALLBACK_BASE_URL = "http://localhost:3001/api";

const windowLocation = typeof window !== "undefined" ? window.location : null;
const windowHostname = windowLocation?.hostname || "";
const windowProtocol = windowLocation?.protocol || "http:";

const windowPort = windowLocation?.port || "";
const windowPortSegment = windowPort ? `:${windowPort}` : "";

const windowBaseUrl = windowHostname
  ? (["localhost", "127.0.0.1"].includes(windowHostname)
      ? FALLBACK_BASE_URL
      : `${windowProtocol}//${windowHostname}${windowPortSegment}/api`)
  : null;

const isDevEnvironment = Boolean(import.meta.env?.DEV);
const RESOLVED_BASE = RAW_BASE_URL || (isDevEnvironment ? windowBaseUrl || FALLBACK_BASE_URL : FALLBACK_BASE_URL);

if (!RAW_BASE_URL && typeof window !== "undefined" && !isDevEnvironment) {
  const fallback = FALLBACK_BASE_URL;
  console.error(`[api] VITE_API_BASE_URL ausente em produção. Usando ${fallback} como fallback controlado.`);
}

const BASE_URL = RESOLVED_BASE.replace(/\/$/, "");

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
  const serverMessage = payload?.error || payload?.message || payload?.errorMessage || null;
  if (serverMessage) return serverMessage;
  if (status === 401) return "Sessão expirada. Faça login novamente.";
  if (status === 403) return "Você não tem permissão para realizar esta ação.";
  if (status >= 500) return "Erro interno. Tente novamente em instantes.";
  return statusText || "Erro na requisição";
}

const MIRROR_QUERY_ALLOWLIST = [
  "/vehicles",
  "/positions",
  "/alerts",
  "/reports",
  "/events",
  "/commands",
  "/devices",
  "/drivers",
  "/geofences",
  "/geofence-groups",
  "/groups",
  "/notifications",
  "/tracker",
  "/traccar",
  "/tasks",
  "/itineraries",
  "/routes",
  "/core/vehicles",
  "/core/devices",
  "/core/chips",
  "/core/telemetry",
  "/core/vehicle-attributes",
  "/core/stock",
];

function resolveMirrorOwnerClientId(session) {
  const ownerClientId =
    session?.user?.activeMirrorOwnerClientId ??
    (() => {
      try {
        return window?.sessionStorage?.getItem(MIRROR_OWNER_STORAGE_KEY)
          || window?.localStorage?.getItem(MIRROR_OWNER_STORAGE_KEY)
          || null;
      } catch (_error) {
        return null;
      }
    })();
  if (!ownerClientId) return null;
  if (session?.user?.role === "admin") return null;
  return String(ownerClientId);
}

function resolvePathname(targetPath) {
  if (!targetPath) return "";
  const raw = String(targetPath);
  if (/^https?:\/\//i.test(raw)) {
    return new URL(raw).pathname;
  }
  return `/${raw.replace(/^\/+/, "")}`;
}

function shouldAttachMirrorClientId(targetPath) {
  const pathname = resolvePathname(targetPath);
  const normalised = pathname.replace(/^\/api\//, "/");
  return MIRROR_QUERY_ALLOWLIST.some((prefix) => normalised.startsWith(prefix));
}

function hasExplicitClientParam(params) {
  return Boolean(params?.clientId || params?.tenantId || params?.ownerClientId);
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

  const storedSession = getStoredSession();
  const mirrorOwnerClientId = resolveMirrorOwnerClientId(storedSession);
  const shouldAttachMirrorQuery =
    mirrorOwnerClientId && shouldAttachMirrorClientId(url) && !hasExplicitClientParam(params);
  const nextParams = shouldAttachMirrorQuery ? { ...(params || {}), clientId: mirrorOwnerClientId } : params;

  const finalUrl = buildUrl(url, nextParams, { apiPrefix });
  const resolvedHeaders = new Headers(headers);
  const authorization = resolveAuthorizationHeader();
  if (authorization && !resolvedHeaders.has("Authorization")) {
    resolvedHeaders.set("Authorization", authorization);
  }
  if (mirrorOwnerClientId && !resolvedHeaders.has("X-Owner-Client-Id")) {
    resolvedHeaders.set("X-Owner-Client-Id", mirrorOwnerClientId);
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
    const isAborted = error?.name === "AbortError" || error?.message === abortReason?.message;
    const isNetworkError =
      !isAborted &&
      (error?.name === "TypeError" ||
        error?.code === "ECONNREFUSED" ||
        error?.message?.includes?.("Failed to fetch") ||
        error?.message?.includes?.("NetworkError") ||
        error?.cause === abortReason);
    if (isNetworkError) {
      const friendly = new Error(
        `API indisponível em ${BASE_URL}. Verifique o backend ou a variável VITE_API_BASE_URL.`,
      );
      friendly.status = 503;
      friendly.code = "API_UNREACHABLE";
      throw friendly;
    }
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
