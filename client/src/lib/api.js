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
const RESOLVED_BASE = RAW_BASE_URL || windowBaseUrl || FALLBACK_BASE_URL;

if (!RAW_BASE_URL && typeof window !== "undefined") {
  const fallback = windowBaseUrl || FALLBACK_BASE_URL;
  const label = windowBaseUrl ? "base do host atual" : "fallback controlado";
  if (isDevEnvironment) {
    console.warn(`[api] VITE_API_BASE_URL ausente. Usando ${fallback} (${label}).`);
  } else {
    console.error(`[api] VITE_API_BASE_URL ausente em produção. Usando ${fallback} (${label}).`);
  }
}

const BASE_URL = RESOLVED_BASE.replace(/\/$/, "");

export function getApiBaseUrl() {
  return BASE_URL;
}

const unauthorizedHandlers = new Set();
let unauthorizedHandled = false;
let refreshPromise = null;
let refreshBlocked = false;

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

function resetAuthGuards() {
  unauthorizedHandled = false;
  refreshBlocked = false;
}

function handleUnauthorized(response) {
  if (unauthorizedHandled) return;
  unauthorizedHandled = true;
  clearStoredSession();
  notifyUnauthorized(response);
  if (typeof window !== "undefined") {
    const pathname = window.location?.pathname || "";
    if (!pathname.startsWith("/login")) {
      window.location.assign("/login");
    }
  }
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
    resetAuthGuards();
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
    storage.removeItem(MIRROR_OWNER_STORAGE_KEY);
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
  const serverMessage =
    payload?.message ||
    payload?.error?.message ||
    (typeof payload?.error === "string" ? payload.error : null) ||
    payload?.errorMessage ||
    null;
  if (serverMessage) return serverMessage;
  if (status === 401) return "Sessão expirada. Faça login novamente.";
  if (status === 403) return "Você não tem permissão para realizar esta ação.";
  if (status >= 500) return "Erro interno. Tente novamente em instantes.";
  return statusText || "Erro na requisição";
}

const MIRROR_READ_ALLOWLIST = [
  "/bootstrap",
  "/context",
  "/permissions/context",
  "/protocols",
  "/vehicles",
  "/positions",
  "/alerts",
  "/reports",
  "/events",
  "/devices",
  "/drivers",
  "/geofences",
  "/geofence-groups",
  "/groups",
  "/users",
  "/notifications",
  "/tracker",
  "/traccar",
  "/tasks",
  "/itineraries",
  "/euro/routes",
  "/routes",
  "/home",
  "/core/vehicles",
  "/core/devices",
  "/core/chips",
  "/core/telemetry",
  "/core/vehicle-attributes",
  "/core/stock",
  "/core/service-orders",
  "/core/technicians",
];
const MIRROR_WRITE_ALLOWLIST = [];
const MIRROR_READ_BLOCKLIST = ["/commands"];

const DEDUPE_GET_PATHS = new Set([
  "/bootstrap",
  "/context",
  "/session",
  "/permissions/context",
  "/mirrors/context",
  "/core/devices",
  "/core/vehicles",
  "/core/telemetry",
  "/core/tasks",
  "/devices",
  "/telemetry",
  "/alerts",
  "/alerts/conjugated",
  "/positions/last",
]);
const DEDUPE_TTL_MS = 4000;
const SWR_FRESH_MS = 8_000;
const SWR_MAX_AGE_MS = 45_000;
const SWR_GET_PATHS = new Set([
  ...DEDUPE_GET_PATHS,
  "/vehicles",
  "/devices",
  "/positions",
  "/geofences",
  "/geofence-groups",
  "/routes",
  "/itineraries",
  "/events",
  "/alerts",
]);
const getDedupeCache = (() => {
  const cache = new Map();
  return {
    get(key) {
      return cache.get(key) || null;
    },
    set(key, value) {
      cache.set(key, value);
    },
    delete(key) {
      cache.delete(key);
    },
    clear() {
      cache.clear();
    },
  };
})();
const inflightGetCache = new Map();
const swrCache = new Map();
let globalAbortController = new AbortController();

export function abortInflightRequests(reason = "manual") {
  try {
    globalAbortController.abort(new Error(reason));
  } catch (_error) {
    try {
      globalAbortController.abort();
    } catch (_err) {
      // ignore
    }
  }
  globalAbortController = new AbortController();
}

export function clearApiCaches() {
  getDedupeCache.clear();
  inflightGetCache.clear();
  swrCache.clear();
}

export function resolveMirrorOwnerClientId(session) {
  if (session?.user?.role === "admin") return null;
  const mirrorMode = session?.user?.mirrorContextMode ?? null;
  if (mirrorMode && mirrorMode !== "target") return null;
  const storedOwnerId = (() => {
    try {
      return (
        window?.sessionStorage?.getItem(MIRROR_OWNER_STORAGE_KEY) ||
        window?.localStorage?.getItem(MIRROR_OWNER_STORAGE_KEY) ||
        null
      );
    } catch (_error) {
      return null;
    }
  })();
  if (storedOwnerId) return String(storedOwnerId);
  const ownerClientId = session?.user?.activeMirrorOwnerClientId ?? null;
  if (!ownerClientId) return null;
  // O modo salvo pode estar desatualizado; o backend decide se há mirror ativo.
  const normalised = String(ownerClientId).trim().replace(/;+$/, "");
  if (!normalised) return null;
  return normalised;
}

function resolvePathname(targetPath) {
  if (!targetPath) return "";
  const raw = String(targetPath);
  if (/^https?:\/\//i.test(raw)) {
    return new URL(raw).pathname;
  }
  return `/${raw.replace(/^\/+/, "")}`;
}

function isAuthRefreshPath(targetPath) {
  const pathname = resolvePathname(targetPath);
  return pathname.endsWith("/auth/refresh") || pathname.endsWith("/refresh");
}

function shouldAttemptAuthRefresh(status, payload, statusText) {
  if (status === 401) return true;
  if (status !== 403) return false;
  const message = String(payload?.error || payload?.message || payload?.errorMessage || statusText || "");
  return message.toLowerCase().includes("permissão insuficiente");
}

function shouldAttachMirrorClientId(targetPath, method = "GET") {
  const pathname = resolvePathname(targetPath);
  const normalised = pathname.replace(/^\/api\//, "/");
  if (MIRROR_READ_BLOCKLIST.some((prefix) => normalised.startsWith(prefix))) {
    return false;
  }
  const methodUpper = String(method || "GET").toUpperCase();
  if (methodUpper === "GET" || methodUpper === "HEAD") {
    return MIRROR_READ_ALLOWLIST.some((prefix) => normalised.startsWith(prefix));
  }
  if (!MIRROR_WRITE_ALLOWLIST.length) return false;
  return MIRROR_WRITE_ALLOWLIST.some((prefix) => normalised.startsWith(prefix));
}

function resolveMirrorQueryParams({ mirrorOwnerClientId, params, url, userClientId, method }) {
  if (!mirrorOwnerClientId) return params;
  const nextParams = params && typeof params === "object" ? { ...params } : {};
  const methodUpper = String(method || "GET").toUpperCase();
  const isReadMethod = methodUpper === "GET" || methodUpper === "HEAD";
  const shouldAttach = shouldAttachMirrorClientId(url, methodUpper);
  const shouldStripTarget =
    (isReadMethod &&
      (shouldAttach ||
        (userClientId &&
          [nextParams.clientId, nextParams.tenantId, nextParams.ownerClientId].some(
            (value) => value !== undefined && value !== null && String(value) === String(userClientId),
          )))) ||
    (!isReadMethod && (shouldAttach || mirrorOwnerClientId));
  if (shouldStripTarget) {
    if (Object.prototype.hasOwnProperty.call(nextParams, "clientId")) {
      delete nextParams.clientId;
    }
    if (Object.prototype.hasOwnProperty.call(nextParams, "tenantId")) {
      delete nextParams.tenantId;
    }
    if (Object.prototype.hasOwnProperty.call(nextParams, "ownerClientId")) {
      delete nextParams.ownerClientId;
    }
  }
  const isMirrorAll = String(mirrorOwnerClientId) === "all";
  if (shouldAttach && !isMirrorAll) {
    nextParams.clientId = mirrorOwnerClientId;
  }
  return Object.keys(nextParams).length ? nextParams : undefined;
}

function stripWriteContextPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  if (payload instanceof FormData || payload instanceof Blob || payload instanceof ArrayBuffer) {
    return payload;
  }
  if (Array.isArray(payload)) return payload;
  const next = { ...payload };
  let changed = false;
  ["clientId", "tenantId", "ownerClientId"].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      delete next[key];
      changed = true;
    }
  });
  return changed ? next : payload;
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

async function runAuthRefresh({ apiPrefix }) {
  if (refreshBlocked) {
    const blockedError = new Error("Refresh bloqueado");
    blockedError.status = 401;
    throw blockedError;
  }
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const refreshResponse = await request({
          method: "POST",
          url: "/auth/refresh",
          data: {},
          apiPrefix,
          authRetryCount: 1,
          skipAuthRefresh: true,
          skipMirrorClient: true,
          skipSWRCache: true,
        });
        const refreshedToken = refreshResponse?.data?.token;
        const refreshedUser = refreshResponse?.data?.user;
        if (refreshedToken) {
          setStoredSession({ token: refreshedToken, user: refreshedUser || getStoredSession()?.user || null });
        }
        return refreshResponse;
      } catch (error) {
        const status = Number(error?.status || error?.response?.status);
        if (status === 401) {
          refreshBlocked = true;
        }
        throw error;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
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
  authRetryCount = 0,
  skipAuthRefresh = false,
  skipMirrorClient = false,
  dedupeBypass = false,
  skipSWRCache = false,
}) {
  const controller = new AbortController();
  const abortReason = new Error("Request timeout");
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort(abortReason);
  }, timeout);

  const forwardAbort = (reason) => {
    try {
      controller.abort(reason);
    } catch (_abortError) {
      controller.abort();
    }
  };

  const abortListeners = [];
  const attachAbortSignal = (targetSignal) => {
    if (!targetSignal) return;
    const handler = () => forwardAbort(targetSignal?.reason);
    if (targetSignal.aborted) {
      handler();
      return;
    }
    targetSignal.addEventListener("abort", handler);
    abortListeners.push({ signal: targetSignal, handler });
  };

  attachAbortSignal(signal);
  attachAbortSignal(globalAbortController.signal);

  const methodUpper = method.toUpperCase();
  const isReadMethod = methodUpper === "GET" || methodUpper === "HEAD";
  const storedSession = getStoredSession();
  const userClientId = storedSession?.user?.clientId ?? null;
  const mirrorOwnerClientId = skipMirrorClient ? null : resolveMirrorOwnerClientId(storedSession);
  // Em modo mirror, anexamos o clientId do OWNER apenas para rotas allowlisted de leitura.
  const shouldAttachMirror =
    !skipMirrorClient && mirrorOwnerClientId && shouldAttachMirrorClientId(url, methodUpper);
  const shouldStripWriteContext = Boolean(!isReadMethod && mirrorOwnerClientId && !skipMirrorClient);
  const nextParams = resolveMirrorQueryParams({ mirrorOwnerClientId, params, url, userClientId, method: methodUpper });
  const requestData = shouldStripWriteContext ? stripWriteContextPayload(data) : data;

  const finalUrl = buildUrl(url, nextParams, { apiPrefix });
  const pathname = resolvePathname(finalUrl);
  const normalisedPath = pathname.replace(/^\/api\//, "/");
  const cacheKey = `${normalisedPath}|${finalUrl}`;

  if (isReadMethod && !skipSWRCache && SWR_GET_PATHS.has(normalisedPath)) {
    const cached = swrCache.get(cacheKey);
    if (cached) {
      const age = Date.now() - cached.ts;
      if (age < SWR_MAX_AGE_MS) {
        if (age > SWR_FRESH_MS && !cached.revalidating) {
          cached.revalidating = true;
          swrCache.set(cacheKey, cached);
          request({
            method,
            url,
            params,
            data: requestData,
            headers,
            timeout,
            apiPrefix,
            signal,
            responseType,
            authRetryCount,
            skipAuthRefresh,
            skipMirrorClient,
            dedupeBypass: true,
            skipSWRCache: true,
          })
            .then((response) => {
              swrCache.set(cacheKey, { ts: Date.now(), response, revalidating: false });
            })
            .catch(() => {
              const entry = swrCache.get(cacheKey);
              if (entry) {
                swrCache.set(cacheKey, { ...entry, revalidating: false });
              }
            });
        }
        return cached.response;
      }
    }
  }

  if (methodUpper === "GET" && !dedupeBypass && DEDUPE_GET_PATHS.has(normalisedPath)) {
    const cached = getDedupeCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.ts < DEDUPE_TTL_MS) {
      return cached.promise;
    }
    const promise = request({
      method,
      url,
      params,
      data: requestData,
      headers,
      timeout,
      apiPrefix,
      signal,
      responseType,
      authRetryCount,
      skipAuthRefresh,
      skipMirrorClient,
      dedupeBypass: true,
      skipSWRCache: true,
    });
    getDedupeCache.set(cacheKey, { ts: now, promise });
    try {
      const response = await promise;
      getDedupeCache.set(cacheKey, { ts: Date.now(), promise: Promise.resolve(response) });
      return response;
    } catch (error) {
      getDedupeCache.delete(cacheKey);
      throw error;
    }
  }

  if (isReadMethod && !dedupeBypass) {
    const inflight = inflightGetCache.get(cacheKey);
    if (inflight) return inflight;
  }
  const resolvedHeaders = new Headers(headers);
  const authorization = resolveAuthorizationHeader();
  if (authorization && !resolvedHeaders.has("Authorization")) {
    resolvedHeaders.set("Authorization", authorization);
  }
  if (shouldAttachMirror && !resolvedHeaders.has("X-Owner-Client-Id")) {
    resolvedHeaders.set("X-Owner-Client-Id", mirrorOwnerClientId);
  }
  if (!resolvedHeaders.has("X-Mirror-Mode")) {
    resolvedHeaders.set("X-Mirror-Mode", shouldAttachMirror ? "target" : "self");
  }

  const init = {
    method: method.toUpperCase(),
    headers: resolvedHeaders,
    credentials: "include",
    signal: controller.signal,
    ...(methodUpper === "GET" ? { cache: "no-store" } : {}),
  };

  if (requestData !== undefined && requestData !== null) {
    if (requestData instanceof FormData || requestData instanceof Blob || requestData instanceof ArrayBuffer) {
      init.body = requestData;
    } else {
      init.body = JSON.stringify(requestData);
      if (!resolvedHeaders.has("Content-Type")) {
        resolvedHeaders.set("Content-Type", "application/json");
      }
    }
  }

  const runFetch = async () => {
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

    if (!response.ok) {
      console.warn("[api] request failed", {
        method: methodUpper,
        url: finalUrl,
        status: response.status,
        statusText: response.statusText,
        body: payload,
      });
      const error = new Error(friendlyErrorMessage(response.status, payload, response.statusText));
      error.status = response.status;
      error.response = normalised;
      error.method = methodUpper;
      error.url = finalUrl;
      error.body = payload;
      const canRefresh =
        !skipAuthRefresh &&
        authRetryCount < 1 &&
        !isAuthRefreshPath(url) &&
        !refreshBlocked &&
        shouldAttemptAuthRefresh(response.status, payload, response.statusText);
      if (canRefresh) {
        try {
          await runAuthRefresh({ apiPrefix });
          return await request({
            method,
            url,
            params,
            data,
            headers,
            timeout,
            apiPrefix,
            signal,
            responseType,
            authRetryCount: authRetryCount + 1,
            skipAuthRefresh: true,
            skipMirrorClient,
            skipSWRCache: true,
          });
        } catch (_refreshError) {
          // Se o refresh falhar, seguimos com o fluxo padrão de erro.
        }
      }

      if (response.status === 401) {
        handleUnauthorized(normalised);
      }
      throw error;
    }

    if (isReadMethod && SWR_GET_PATHS.has(normalisedPath)) {
      swrCache.set(cacheKey, { ts: Date.now(), response: normalised, revalidating: false });
    }
    return normalised;
  };

  const runPromise = runFetch();
  if (isReadMethod && !dedupeBypass) {
    inflightGetCache.set(cacheKey, runPromise);
  }

  try {
    return await runPromise;
  } catch (error) {
    clearTimeout(timer);
    const isAborted =
      controller.signal.aborted ||
      error?.name === "AbortError" ||
      error?.code === "ERR_ABORTED" ||
      error?.message === abortReason?.message;
    if (isAborted && (didTimeout || error?.message === abortReason?.message)) {
      error.code = error.code || "REQUEST_TIMEOUT";
      error.status = error.status || 504;
      error.isTimeout = true;
    }
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
      friendly.baseUrl = BASE_URL;
      friendly.endpoint = url;
      throw friendly;
    }
    throw error;
  } finally {
    if (isReadMethod && !dedupeBypass) {
      inflightGetCache.delete(cacheKey);
    }
    abortListeners.forEach(({ signal: target, handler }) => {
      try {
        target.removeEventListener("abort", handler);
      } catch (_err) {
        // ignore
      }
    });
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
