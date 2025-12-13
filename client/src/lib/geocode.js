import { resolveAuthorizationHeader } from "./api.js";

const ACCEPT_LANGUAGE = "pt-BR";
const COUNTRY_BIAS = "br";
const RESULT_LIMIT = 8;

async function geocodeViaApi(term) {
  const url = `/api/geocode/search?q=${encodeURIComponent(term)}&limit=${RESULT_LIMIT}`;
  const headers = new Headers({ Accept: "application/json" });
  const authorization = resolveAuthorizationHeader();
  if (authorization) {
    headers.set("Authorization", authorization);
  }

  const response = await fetch(url, { headers, credentials: "include" });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(`Geocode HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  return data;
}

async function geocodeViaPublic(term) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("q", term);
  url.searchParams.set("limit", String(RESULT_LIMIT));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("polygon_geojson", "0");
  url.searchParams.set("accept-language", ACCEPT_LANGUAGE);
  url.searchParams.set("countrycodes", COUNTRY_BIAS);

  const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Geocode HTTP ${response.status}`);
  return response.json().catch(() => []);
}

export async function geocodeAddress(q) {
  const term = q?.trim();
  if (!term) return null;

  try {
    const data = await geocodeViaApi(term);
    const [first] = data || [];
    if (!first) return null;
    const { lat, lng, label } = first;
    return { lat: +lat, lng: +lng, address: label };
  } catch (error) {
    const unauthorized = error?.status === 401 || error?.status === 403;
    try {
      const fallback = await geocodeViaPublic(term);
      const [first] = fallback || [];
      if (!first) return null;
      const lat = Number(first.lat ?? first.latitude);
      const lng = Number(first.lng ?? first.lon ?? first.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng, address: first.display_name || first.label || term };
    } catch (_fallbackError) {
      if (!unauthorized) throw error;
      return null;
    }
  }
}
