import { resolveAuthorizationHeader } from "../lib/api.js";

export const DEFAULT_RESULT_LIMIT = 10;
export const DEFAULT_COUNTRY_BIAS = "br";
export const DEFAULT_ACCEPT_LANGUAGE = "pt-BR";
export const GEOCODER_FORBIDDEN_MESSAGE =
  "Geocoder recusou a requisição (403/429). Verifique bloqueio/rate limit e considere usar geocoder próprio.";
export const GEOCODER_NETWORK_MESSAGE = "Falha ao consultar geocoder. Verifique conectividade/firewall/CORS.";

export function mapGeocoderError(error) {
  const status = Number(error?.status);
  if (status === 403 || status === 429) {
    return GEOCODER_FORBIDDEN_MESSAGE;
  }
  if (error?.message === GEOCODER_NETWORK_MESSAGE || error?.cause instanceof TypeError) {
    return GEOCODER_NETWORK_MESSAGE;
  }
  return error?.message || "Não foi possível buscar endereços.";
}

function toSafeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((entry) => toSafeText(entry, "")).filter(Boolean);
    return parts.join(", ");
  }
  if (typeof value === "object") {
    if (value.label) return toSafeText(value.label, fallback);
    if (value.name) return toSafeText(value.name, fallback);
  }
  return String(value);
}

export function normalizeGeocodeList(payload, term) {
  const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];

  return list
    .map((item) => {
      const lat = Number(item.lat ?? item.latitude ?? item.latitud);
      const lng = Number(item.lng ?? item.lon ?? item.longitude ?? item.longitud);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      const address = toSafeText(item.address || item.display_name || item.label || term, term);
      const concise =
        toSafeText(item.concise, "") ||
        (item.address?.road &&
          [
            toSafeText(item.address.road, ""),
            toSafeText(item.address.city || item.address.town || item.address.village, ""),
            toSafeText(item.address.state, ""),
          ]
            .filter(Boolean)
            .join(", ")) ||
        address;

      const boundingBox = item.boundingBox || item.boundingbox;
      const importance = Number(item.importance ?? item.place_rank ?? item.rank ?? 0);
      const areaScore = Array.isArray(boundingBox)
        ? Math.max(
            0.1,
            1 /
              Math.max(
                Math.abs(boundingBox[1] - boundingBox[0]) * Math.abs(boundingBox[3] - boundingBox[2]),
                0.001,
              ),
          )
        : 0;

      const safeLabel = toSafeText(item.label || item.display_name || term, term);
      return {
        id: item.id || item.place_id || `${lat},${lng}`,
        lat,
        lng,
        label: safeLabel,
        concise: toSafeText(concise, safeLabel),
        raw: item.raw || item,
        boundingBox,
        score: importance + areaScore,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

export function buildGeocoderUrl(base, pathname = "search") {
  try {
    const url = new URL(base || "https://nominatim.openstreetmap.org");
    const hasPath = url.pathname && url.pathname !== "/";
    if (!hasPath || !url.pathname.endsWith(pathname)) {
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/${pathname}`.replace(/\/{2,}/g, "/");
    }
    return url;
  } catch (_error) {
    return new URL(`https://nominatim.openstreetmap.org/${pathname}`);
  }
}

export async function searchAddressApi(term, { limit = DEFAULT_RESULT_LIMIT, signal, authorization } = {}) {
  const url = `/api/geocode/search?q=${encodeURIComponent(term)}&limit=${limit}`;
  const headers = new Headers({ Accept: "application/json" });
  const resolvedAuthorization = authorization ?? resolveAuthorizationHeader();
  if (resolvedAuthorization) {
    headers.set("Authorization", resolvedAuthorization);
  }

  const response = await fetch(url, { credentials: "include", signal, headers });

  let payload;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Geocode HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  if (payload?.status === "fallback") {
    const error = new Error(payload?.error?.message || "Não foi possível buscar endereços agora. Tente novamente em instantes.");
    error.status = payload?.error?.code || 503;
    throw error;
  }

  return normalizeGeocodeList(payload, term);
}

export async function searchAddressPublic(
  term,
  {
    baseUrl = "https://nominatim.openstreetmap.org",
    limit = DEFAULT_RESULT_LIMIT,
    country = DEFAULT_COUNTRY_BIAS,
    acceptLanguage = DEFAULT_ACCEPT_LANGUAGE,
    signal,
  } = {},
) {
  const url = buildGeocoderUrl(baseUrl, "search");
  url.searchParams.set("format", "json");
  url.searchParams.set("q", term);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("polygon_geojson", "0");
  if (acceptLanguage) {
    url.searchParams.set("accept-language", acceptLanguage);
  }
  if (country) {
    url.searchParams.set("countrycodes", country);
  }

  let response;
  try {
    response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (networkError) {
    const fallbackError = new Error(GEOCODER_NETWORK_MESSAGE);
    fallbackError.cause = networkError;
    throw fallbackError;
  }

  if (!response.ok) {
    const forbidden = response.status === 403 || response.status === 429;
    const fallbackError = new Error(forbidden ? GEOCODER_FORBIDDEN_MESSAGE : "Não foi possível buscar endereços agora.");
    fallbackError.status = response.status;
    throw fallbackError;
  }

  const payload = await response.json().catch(() => []);
  return normalizeGeocodeList(payload, term);
}

export async function searchAddress(term, options = {}) {
  const trimmed = String(term || "").trim();
  if (!trimmed) return [];
  const { useApi = false, allowFallback = true } = options;
  if (!useApi) {
    return searchAddressPublic(trimmed, options);
  }
  try {
    return await searchAddressApi(trimmed, options);
  } catch (error) {
    if (!allowFallback) throw error;
    return searchAddressPublic(trimmed, options);
  }
}
