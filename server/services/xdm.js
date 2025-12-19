import createError from "http-errors";

import { config } from "../config.js";

const BASE_URL = (process.env.XDM_BASE_URL || config?.xdm?.baseUrl || "").replace(/\/$/, "");
const DEFAULT_TIMEOUT = Number.isFinite(Number(process.env.XDM_TIMEOUT_MS))
  ? Number(process.env.XDM_TIMEOUT_MS)
  : Number.isFinite(Number(config?.xdm?.timeoutMs))
  ? Number(config?.xdm?.timeoutMs)
  : 10_000;
const DEFAULT_RETRY_ATTEMPTS = Number.isFinite(Number(process.env.XDM_RETRY_ATTEMPTS))
  ? Number(process.env.XDM_RETRY_ATTEMPTS)
  : Number.isFinite(Number(config?.xdm?.retryAttempts))
  ? Number(config?.xdm?.retryAttempts)
  : 2;
const DEFAULT_RETRY_DELAY_MS = Number.isFinite(Number(process.env.XDM_RETRY_DELAY_MS))
  ? Number(process.env.XDM_RETRY_DELAY_MS)
  : Number.isFinite(Number(config?.xdm?.retryDelayMs))
  ? Number(config?.xdm?.retryDelayMs)
  : 300;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeToken(token) {
  if (!token) return null;
  if (token.startsWith("Bearer ") || token.startsWith("Basic ")) return token;
  return `Bearer ${token}`;
}

const AUTH_TOKEN = normalizeToken(
  process.env.XDM_API_TOKEN || process.env.XDM_API_KEY || config?.xdm?.apiToken || config?.xdm?.apiKey,
);

export function isXdmConfigured(customToken = null) {
  return Boolean(BASE_URL && (normalizeToken(customToken) || AUTH_TOKEN));
}

function buildUrl(path, params) {
  if (!BASE_URL) {
    throw createError(503, "Integração XDM não configurada.");
  }

  const finalBase = BASE_URL.replace(/\/$/, "");
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

function buildHeaders(custom = {}, authToken = null) {
  const headers = new Headers({ Accept: "application/json", ...custom });
  const finalToken = normalizeToken(authToken) || AUTH_TOKEN;
  if (finalToken && !headers.has("Authorization")) {
    headers.set("Authorization", finalToken);
  }
  return headers;
}

async function parseResponse(response, responseType = "json") {
  if (responseType === "arraybuffer") return response.arrayBuffer();

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (responseType === "text" || !isJson) {
    try {
      return await response.text();
    } catch (error) {
      console.warn("[xdm] Falha ao ler resposta como texto", error?.message || error);
      return null;
    }
  }

  try {
    return await response.clone().json();
  } catch (error) {
    console.warn("[xdm] Falha ao parsear JSON da resposta", error?.message || error);
    return null;
  }
}

function resolveErrorMessage(status) {
  if (status === 401 || status === 403) return "Credenciais inválidas ou acesso negado no XDM.";
  if (status >= 500) return "Serviço XDM indisponível no momento.";
  return "Falha ao chamar API do XDM.";
}

function resolveStatus(error) {
  return error?.status || error?.statusCode || error?.details?.status || error?.details?.statusCode || null;
}

function shouldRetry(error) {
  const status = resolveStatus(error);
  if (status === 429) return true;
  if (status && status >= 500) return true;
  if (error?.name === "AbortError") return true;
  if (error?.message?.toLowerCase().includes("tempo limite")) return true;
  if (error?.code && ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED"].includes(error.code)) return true;
  return false;
}

function logXdm(event, { method, path, status, durationMs, attempt, retries, message, label, retrying }) {
  const prefix = `[xdm] ${label ? `${label} ` : ""}${method} ${path}`;
  const suffix = status ? `${status}` : "";
  const base = `${prefix}${suffix ? ` -> ${suffix}` : ""} (${durationMs}ms)`;
  if (event === "success") {
    console.info(`${base}${attempt > 1 ? ` [tentativa ${attempt}]` : ""}`);
    return;
  }
  const retryNote = retrying ? `; nova tentativa ${attempt + 1} de ${retries}` : "";
  console.warn(`${base} - ${message || "erro"}${retryNote}`);
}

export async function xdmRequest(path, options = {}) {
  const {
    method = "GET",
    params,
    data,
    headers = {},
    responseType = "json",
    timeout = DEFAULT_TIMEOUT,
    authToken = null,
    retries = DEFAULT_RETRY_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    label,
  } = options;

  const url = buildUrl(path, params);
  const resolvedHeaders = buildHeaders(headers, authToken);
  const normalizedMethod = method.toUpperCase();
  const init = { method: normalizedMethod, headers: resolvedHeaders };

  if (data !== undefined && data !== null) {
    if (data instanceof FormData || data instanceof URLSearchParams || typeof data === "string") {
      init.body = data;
    } else if (data instanceof Buffer || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      init.body = data;
    } else {
      init.body = JSON.stringify(data);
      if (!resolvedHeaders.has("Content-Type")) {
        resolvedHeaders.set("Content-Type", "application/json");
      }
    }
  }

  const attempts = Math.max(1, Number.isFinite(retries) ? Number(retries) : DEFAULT_RETRY_ATTEMPTS);
  const baseDelay = Number.isFinite(retryDelayMs) ? Number(retryDelayMs) : DEFAULT_RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const startedAt = Date.now();

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      const payload = await parseResponse(response, responseType);
      if (!response.ok) {
        const status = response.status || 500;
        const error = createError(status, payload?.message || resolveErrorMessage(status));
        error.code = payload?.code;
        error.details = payload || null;
        throw error;
      }

      logXdm("success", {
        method: normalizedMethod,
        path,
        status: response.status,
        durationMs: Date.now() - startedAt,
        attempt,
        retries: attempts,
        label,
      });

      return payload;
    } catch (error) {
      clearTimeout(timer);
      const retrying = attempt < attempts && shouldRetry(error);

      logXdm("error", {
        method: normalizedMethod,
        path,
        status: resolveStatus(error),
        durationMs: Date.now() - startedAt,
        attempt,
        retries: attempts,
        message: error?.message,
        label,
        retrying,
      });

      if (retrying) {
        await delay(baseDelay * Math.max(1, 2 ** (attempt - 1)));
        continue;
      }

      if (error?.name === "AbortError") {
        throw createError(504, "Tempo limite ao chamar API do XDM.");
      }
      throw error;
    }
  }

  throw createError(500, "Falha inesperada ao chamar API do XDM.");
}

export function ensureXdmConfigured(customToken = null) {
  if (!isXdmConfigured(customToken)) {
    throw createError(503, "Integração XDM não configurada.");
  }
}

export function pingXdm(options = {}) {
  const { authToken = null } = options;
  ensureXdmConfigured(authToken);
  return xdmRequest("/api/external/v1/geozonegroups/filter", {
    method: "GET",
    params: { page: 0, size: 1 },
    timeout: Math.min(DEFAULT_TIMEOUT, 5_000),
    authToken,
    retries: 1,
    label: "ping",
  });
}

export function testXdmToken({ token } = {}) {
  const normalizedToken = normalizeToken(token);
  ensureXdmConfigured(normalizedToken);
  return xdmRequest("/api/external/v1/geozonegroups/filter", {
    method: "GET",
    params: { page: 0, size: 1 },
    timeout: Math.min(DEFAULT_TIMEOUT, 7_000),
    authToken: normalizedToken,
    retries: 1,
    label: "token-test",
  });
}

export function filterGeozoneGroups(params = {}) {
  return xdmRequest("/api/external/v1/geozonegroups/filter", { method: "GET", params });
}

export function createGeozoneGroup(payload) {
  return xdmRequest("/api/external/v1/geozonegroups", { method: "POST", data: payload });
}

export function updateGeozoneGroup(id, payload) {
  if (!id) {
    throw createError(400, "geozoneGroupId é obrigatório");
  }
  return xdmRequest(`/api/external/v1/geozonegroups/${id}`, { method: "PUT", data: payload });
}

export function getGeozoneGroup(id) {
  if (!id) {
    throw createError(400, "geozoneGroupId é obrigatório");
  }
  return xdmRequest(`/api/external/v1/geozonegroups/${id}`, { method: "GET" });
}

export function importGeozonesToGroup(geozoneGroupId, kmlText, { filename = "geozones.kml" } = {}) {
  if (!geozoneGroupId) {
    throw createError(400, "geozoneGroupId é obrigatório");
  }
  if (!kmlText) {
    throw createError(400, "Conteúdo KML é obrigatório");
  }

  const formData = new FormData();
  const blob = new Blob([kmlText], { type: "application/vnd.google-earth.kml+xml" });
  formData.append("file", blob, filename);

  return xdmRequest(`/api/external/v1/geozonegroups/${geozoneGroupId}/importGeozones`, {
    method: "POST",
    data: formData,
  });
}

export function importGeozones(kmlText, { filename = "geozones.kml" } = {}) {
  if (!kmlText) {
    throw createError(400, "Conteúdo KML é obrigatório");
  }
  const formData = new FormData();
  const blob = new Blob([kmlText], { type: "application/vnd.google-earth.kml+xml" });
  formData.append("file", blob, filename);
  return xdmRequest("/api/external/v1/geozones/import", { method: "POST", data: formData });
}

export function associateGeozones(geozoneGroupId, geozoneIds = []) {
  if (!geozoneGroupId) {
    throw createError(400, "geozoneGroupId é obrigatório");
  }
  const normalizedIds = geozoneIds.map((id) => String(id)).filter(Boolean);
  return xdmRequest(`/api/external/v1/geozonegroups/${geozoneGroupId}/geozones`, {
    method: "POST",
    data: { geozoneIds: normalizedIds },
  });
}

export function fetchSettingsOverrideCategories(deviceIdentifier) {
  if (!deviceIdentifier) {
    throw createError(400, "deviceIdentifier é obrigatório");
  }
  return xdmRequest(`/api/external/v1/settingsOverrides/${deviceIdentifier}/categories`, { method: "GET" });
}

export function fetchSettingsOverrideElements(deviceIdentifier, categoryId) {
  if (!deviceIdentifier || !categoryId) {
    throw createError(400, "deviceIdentifier e categoryId são obrigatórios");
  }
  return xdmRequest(`/api/external/v1/settingsOverrides/${deviceIdentifier}/categories/${categoryId}/elements`, {
    method: "GET",
  });
}

export function applySettingsOverride(deviceIdentifier, payload) {
  if (!deviceIdentifier) {
    throw createError(400, "deviceIdentifier é obrigatório");
  }
  return xdmRequest(`/api/external/v1/settingsOverrides/${deviceIdentifier}`, { method: "PUT", data: payload });
}

export function listConfigsForDevices(payload) {
  return xdmRequest("/api/external/v3/configs/forDevices", { method: "POST", data: payload });
}

export function applyConfigToDevices(payload) {
  return xdmRequest("/api/external/v3/devicesSdk/multiple", { method: "PUT", data: payload });
}

export function createRollout(payload) {
  return xdmRequest("/api/external/v1/rollouts/create", { method: "POST", data: payload });
}

export default {
  isXdmConfigured,
  ensureXdmConfigured,
  xdmRequest,
  pingXdm,
  testXdmToken,
  filterGeozoneGroups,
  createGeozoneGroup,
  updateGeozoneGroup,
  getGeozoneGroup,
  importGeozonesToGroup,
  importGeozones,
  associateGeozones,
  fetchSettingsOverrideCategories,
  fetchSettingsOverrideElements,
  applySettingsOverride,
  listConfigsForDevices,
  applyConfigToDevices,
  createRollout,
};
