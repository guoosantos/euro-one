import { useCallback, useState } from "react";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export default function useGeocodeSearch() {
  const [isSearching, setIsSearching] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [error, setError] = useState(null);

  const searchRegion = useCallback(async (query) => {
    const term = query?.trim();
    if (!term) return null;

    setIsSearching(true);
    setError(null);

    try {
      const url = `${NOMINATIM_URL}?format=json&q=${encodeURIComponent(term)}&limit=5&addressdetails=1&polygon_geojson=0`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Euro-One/monitoring-ui",
        },
      });

      if (!response.ok) throw new Error("Geocoding failed");
      const data = await response.json();
      const candidates = Array.isArray(data)
        ? data.filter((item) => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)))
        : [];

      const [best] = candidates.sort((a, b) => (b.importance || 0) - (a.importance || 0));

      if (best) {
        const label = best.display_name || term;
        const address = best.address || {};
        const conciseAddress = [address.city || address.town || address.village, address.state, address.country]
          .filter(Boolean)
          .join(", ");

        const result = {
          lat: Number(best.lat),
          lng: Number(best.lon),
          label,
          address: conciseAddress || label,
          raw: best,
          boundingBox: best.boundingbox,
        };
        setLastResult(result);
        return result;
      }

      setLastResult(null);
      return null;
    } catch (searchError) {
      setError(searchError);
      return null;
    } finally {
      setIsSearching(false);
    }
  }, []);

  return {
    isSearching,
    lastResult,
    error,
    searchRegion,
  };
}
