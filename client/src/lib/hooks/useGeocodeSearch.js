import { useCallback, useMemo, useRef, useState } from "react";

const MAX_CACHE = 24;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos
const MIN_QUERY_LENGTH = 3;

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
    const url = `/api/geocode/search?query=${encodeURIComponent(term)}&limit=5`;
    const response = await fetch(url, { credentials: "include" });

    let payload;
    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }

    if (!response.ok) {
      const defaultMessage = response.status === 401
        ? "Busca de endereço indisponível no momento."
        : "Não foi possível buscar endereços.";
      const message = payload?.error?.message || defaultMessage;
      throw new Error(message);
    }

    const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    return list
      .map((item) => {
        const lat = Number(item.lat);
        const lng = Number(item.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          id: item.id || `${lat},${lng}`,
          lat,
          lng,
          label: item.label || term,
          concise: item.concise || item.label || term,
          raw: item.raw || item,
          boundingBox: item.boundingBox,
        };
      })
      .filter(Boolean);
  }, []);

  const searchRegion = useCallback(async (query) => {
    const term = query?.trim();
    if (!term || term.length < MIN_QUERY_LENGTH) return null;

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
      const list = candidates;
      const [best] = list;
      setSuggestions(list);
      setLastResult(best || null);
      setCache(term.toLowerCase(), { list, best });
      return best || null;
    } catch (searchError) {
      setSuggestions([]);
      setLastResult(null);
      setError(searchError);
      return null;
    } finally {
      setIsSearching(false);
    }
    }, [fetchCandidates, getCached, setCache]);

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
    setLastResult(null);
  }, []);

  const previewSuggestions = useCallback(async (query) => {
    const term = query?.trim();
    if (!term || term.length < MIN_QUERY_LENGTH) {
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
      const list = candidates;
      setSuggestions(list);
      setCache(term.toLowerCase(), { list, best: list[0] || null });
      return list;
    } catch (previewError) {
      setSuggestions([]);
      setLastResult(null);
      setError(previewError);
      return [];
    } finally {
      setIsSearching(false);
    }
    }, [clearSuggestions, fetchCandidates, getCached, setCache]);

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
