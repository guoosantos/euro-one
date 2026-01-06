import { config } from "../config.js";

const DEFAULT_NOMINATIM_URL = "https://nominatim.openstreetmap.org";
const DEFAULT_LOCATIONIQ_URL = "https://us1.locationiq.com/v1";
const DEFAULT_PROVIDER = "nominatim";

const lookupQueue = [];
let activeLookups = 0;
let lastLookupStartedAt = 0;

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveProviderName() {
  return (config.geocoder?.provider || DEFAULT_PROVIDER).toLowerCase();
}

function resolveQpsLimit() {
  const qps = toNumber(config.geocoder?.qpsLimit, 1);
  return qps > 0 ? qps : 1;
}

function resolveMinIntervalMs() {
  return Math.max(1, Math.round(1000 / resolveQpsLimit()));
}

function resolveMaxConcurrent() {
  const maxConcurrent = toNumber(config.geocoder?.maxConcurrent, 3);
  return maxConcurrent > 0 ? maxConcurrent : 3;
}

function resolveTimeoutMs() {
  const timeout = toNumber(config.geocoder?.timeoutMs, 8000);
  return timeout > 0 ? timeout : 8000;
}

function resolveUserAgent() {
  return config.geocoder?.userAgent || "Euro-One Geocode Worker";
}

function buildGeocoderUrl(baseUrl, pathname = "reverse") {
  try {
    const url = new URL(baseUrl);
    const basePath = url.pathname.replace(/\/+$/, "");
    const targetPath = pathname.startsWith("/") ? pathname.slice(1) : pathname;
    if (basePath.toLowerCase().endsWith(`/${targetPath.toLowerCase()}`)) {
      url.pathname = basePath;
    } else {
      url.pathname = `${basePath}/${targetPath}`.replace(/\/{2,}/g, "/");
    }
    return url;
  } catch (_error) {
    const fallback = new URL(DEFAULT_NOMINATIM_URL);
    fallback.pathname = `${fallback.pathname.replace(/\/+$/, "")}/${pathname}`;
    return fallback;
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolveTimeoutMs());
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchNominatimReverse(lat, lng) {
  const baseUrl = config.geocoder?.baseUrl || DEFAULT_NOMINATIM_URL;
  const url = buildGeocoderUrl(baseUrl, "reverse");
  url.searchParams.set("format", "json");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      "User-Agent": resolveUserAgent(),
      Accept: "application/json",
    },
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(`Geocode HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function fetchLocationIqReverse(lat, lng) {
  const apiKey = config.geocoder?.apiKey;
  if (!apiKey) {
    throw new Error("GEOCODER_API_KEY obrigatório para LocationIQ");
  }
  const baseUrl = config.geocoder?.baseUrl || DEFAULT_LOCATIONIQ_URL;
  const url = buildGeocoderUrl(baseUrl, "reverse.php");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      "User-Agent": resolveUserAgent(),
      Accept: "application/json",
    },
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(`Geocode HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function fetchReverse(lat, lng) {
  const provider = resolveProviderName();
  if (provider === "locationiq") {
    return fetchLocationIqReverse(lat, lng);
  }
  return fetchNominatimReverse(lat, lng);
}

async function fetchReverseWithRetry(lat, lng) {
  const retryableStatus = new Set([429, 503, 504]);
  const delays = [300, 800, 1500];
  let lastError;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    try {
      return await fetchReverse(lat, lng);
    } catch (error) {
      lastError = error;
      const status = error?.status || error?.statusCode;
      if (!retryableStatus.has(status)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }

  throw lastError || new Error("Falha ao buscar endereço reverso");
}

function runNextLookup() {
  if (activeLookups >= resolveMaxConcurrent()) return;
  const task = lookupQueue.shift();
  if (!task) return;

  const now = Date.now();
  const waitFor = Math.max(0, resolveMinIntervalMs() - (now - lastLookupStartedAt));

  const execute = async () => {
    activeLookups += 1;
    lastLookupStartedAt = Date.now();
    try {
      const result = await task.fn();
      task.resolve(result);
    } catch (error) {
      task.reject(error);
    } finally {
      activeLookups -= 1;
      if (lookupQueue.length) {
        setTimeout(runNextLookup, resolveMinIntervalMs());
      }
    }
  };

  if (waitFor > 0) {
    setTimeout(execute, waitFor);
  } else {
    execute();
  }
}

function scheduleLookup(taskFn) {
  return new Promise((resolve, reject) => {
    lookupQueue.push({ fn: taskFn, resolve, reject });
    runNextLookup();
  });
}

export function getGeocoderProviderName() {
  return resolveProviderName();
}

export async function resolveReverseGeocode(lat, lng) {
  const normalizedLat = Number(lat);
  const normalizedLng = Number(lng);
  if (!Number.isFinite(normalizedLat) || !Number.isFinite(normalizedLng)) {
    throw new Error("Coordenadas inválidas para geocode");
  }
  if (normalizedLat === 0 && normalizedLng === 0) {
    throw new Error("Coordenadas nulas não são geocodificadas");
  }

  return scheduleLookup(() => fetchReverseWithRetry(normalizedLat, normalizedLng));
}

export default resolveReverseGeocode;
