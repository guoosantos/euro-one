import { useCallback, useMemo, useRef, useState } from "react";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const MAX_CACHE = 24;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

export default function useGeocodeSearch() {
  const [isSearching, setIsSearching] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [error, setError] = useState(null);
  const cacheRef = useRef(new Map());

  const setCache = useCallback((key, value) => {
    const cache = cacheRef.current;
    if (cache.size >= MAX_CACHE) {
      const [firstKey] = cache.keys();
      cache.delete(firstKey);
    }
    cache.set(key, { value, timestamp: Date.now() });
  }, []);

  const getCached = useCallback((key) => {
    const cached = cacheRef.current.get(key);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL) {
      cacheRef.current.delete(key);
      return null;
    }
    return cached.value;
  }, []);

  const fetchCandidates = useCallback(async (term) => {
    const url = `${NOMINATIM_URL}?format=json&q=${encodeURIComponent(term)}&limit=5&addressdetails=1&polygon_geojson=0`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Euro-One/monitoring-ui",
      },
    });

    if (!response.ok) throw new Error("Geocoding failed");
    const data = await response.json();
    return Array.isArray(data)
      ? data.filter((item) => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)))
      : [];
  }, []);

  const buildSuggestion = useCallback((item, fallbackLabel) => {
    const address = item.address || {};
    const conciseAddress = [address.road, address.neighbourhood, address.city || address.town || address.village, address.state, address.country]
      .filter(Boolean)
      .join(", ");

    return {
      id: `${item.place_id}`,
      lat: Number(item.lat),
      lng: Number(item.lon),
      label: item.display_name || fallbackLabel,
      concise: conciseAddress || item.display_name || fallbackLabel,
      raw: item,
      boundingBox: item.boundingbox,
    };
  }, []);

  const searchRegion = useCallback(async (query) => {
    const term = query?.trim();
    if (!term) return null;

    const cached = getCached(term.toLowerCase());
    if (cached) {
      setSuggestions(cached.list);
      setLastResult(cached.best || cached.list[0] || null);
      return cached.best || cached.list[0] || null;
    }

    setIsSearching(true);
    setError(null);

    try {
      const candidates = await fetchCandidates(term);
      const list = candidates.map((item) => buildSuggestion(item, term));
      const [best] = list;
      setSuggestions(list);
      setLastResult(best || null);
      setCache(term.toLowerCase(), { list, best });
      return best || null;
    } catch (searchError) {
      setError(searchError);
      return null;
    } finally {
      setIsSearching(false);
    }
  }, [buildSuggestion, fetchCandidates, getCached, setCache]);

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
    setLastResult(null);
  }, []);

  const previewSuggestions = useCallback(async (query) => {
    const term = query?.trim();
    if (!term) {
      clearSuggestions();
      return [];
    }

    const cached = getCached(term.toLowerCase());
    if (cached) {
      setSuggestions(cached.list);
      return cached.list;
    }

    setIsSearching(true);
    try {
      const candidates = await fetchCandidates(term);
      const list = candidates.map((item) => buildSuggestion(item, term));
      setSuggestions(list);
      setCache(term.toLowerCase(), { list, best: list[0] || null });
      return list;
    } catch (previewError) {
      setError(previewError);
      return [];
    } finally {
      setIsSearching(false);
    }
  }, [buildSuggestion, clearSuggestions, fetchCandidates, getCached, setCache]);

  return useMemo(() => ({
    isSearching,
    lastResult,
    error,
    searchRegion,
    suggestions,
    previewSuggestions,
    clearSuggestions,
  }), [clearSuggestions, error, isSearching, lastResult, previewSuggestions, searchRegion, suggestions]);
}
