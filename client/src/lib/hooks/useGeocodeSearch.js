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
      const url = `${NOMINATIM_URL}?format=json&q=${encodeURIComponent(term)}&limit=1`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Euro-One/monitoring-ui",
        },
      });

      if (!response.ok) throw new Error("Geocoding failed");
      const data = await response.json();
      const first = Array.isArray(data) ? data[0] : null;

      if (first && first.lat && first.lon) {
        const result = {
          lat: Number(first.lat),
          lng: Number(first.lon),
          label: first.display_name || term,
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
