import { config } from "../config.js";

const DEFAULT_GEOCODER_URL = "https://nominatim.openstreetmap.org";
const RETRY_DELAYS_MS = [300, 800, 1500];
const MIN_LOOKUP_INTERVAL_MS = 1000;
const MAX_CONCURRENT_LOOKUPS = 3;

const lookupQueue = [];
let activeLookups = 0;
let lastLookupStartedAt = 0;

function buildGeocoderUrl(pathname = "reverse") {
  try {
    const url = new URL(config.geocoder?.baseUrl || DEFAULT_GEOCODER_URL);
    const basePath = url.pathname.replace(/\/+$/, "");
    const targetPath = pathname.startsWith("/") ? pathname.slice(1) : pathname;
    if (basePath.toLowerCase().endsWith(`/${targetPath.toLowerCase()}`)) {
      url.pathname = basePath;
    } else {
      url.pathname = `${basePath}/${targetPath}`.replace(/\/{2,}/g, "/");
    }
    return url;
  } catch (_error) {
    const fallback = new URL(DEFAULT_GEOCODER_URL);
    fallback.pathname = `${fallback.pathname.replace(/\/+$/, "")}/${pathname}`;
    return fallback;
  }
}

async function fetchReverse(lat, lng) {
  const url = buildGeocoderUrl("reverse");
  url.searchParams.set("format", "json");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "Euro-One Geocode Worker",
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

async function fetchReverseWithRetry(lat, lng) {
  let lastError;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fetchReverse(lat, lng);
    } catch (error) {
      lastError = error;
      const status = error?.status || error?.statusCode;
      if (status !== 429 && status !== 503) {
        throw error;
      }
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error("Falha ao buscar endereço reverso");
}

function runNextLookup() {
  if (activeLookups >= MAX_CONCURRENT_LOOKUPS) return;
  const task = lookupQueue.shift();
  if (!task) return;

  const now = Date.now();
  const waitFor = Math.max(0, MIN_LOOKUP_INTERVAL_MS - (now - lastLookupStartedAt));

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
        setTimeout(runNextLookup, MIN_LOOKUP_INTERVAL_MS);
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
