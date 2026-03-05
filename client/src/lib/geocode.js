import { resolveAuthorizationHeader } from "./api.js";
import { searchAddress } from "../services/geocodeClient.js";

const GEOCODER_USE_API = String(import.meta?.env?.VITE_GEOCODER_USE_API || "").toLowerCase() === "true";

export async function geocodeAddress(q, { useApi = false } = {}) {
  const term = q?.trim();
  if (!term) return null;

  const canUseApi = Boolean(useApi && GEOCODER_USE_API && resolveAuthorizationHeader());

  try {
    const list = await searchAddress(term, { useApi: canUseApi, allowFallback: true });
    const [first] = list || [];
    if (!first) return null;
    return { lat: Number(first.lat), lng: Number(first.lng), address: first.label || term };
  } catch (_error) {
    return null;
  }
}
