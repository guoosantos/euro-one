import { formatGeocodeAddress } from "../utils/formatGeocodeAddress.js";

const DEFAULT_BASE_URL = "https://nominatim.openstreetmap.org/reverse";

export async function reverseGeocode(latitude, longitude, { signal, baseUrl } = {}) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const target = baseUrl || DEFAULT_BASE_URL;
  const url = new URL(target);
  url.searchParams.set("format", "json");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("addressdetails", "1");

  try {
    const response = await fetch(url.toString(), { signal });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    const formatted = formatGeocodeAddress(payload);
    return formatted || null;
  } catch (_error) {
    return null;
  }
}

export default reverseGeocode;
