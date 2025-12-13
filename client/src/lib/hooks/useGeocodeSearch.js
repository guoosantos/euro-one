import { useCallback, useMemo, useRef, useState } from "react";

import { resolveAuthorizationHeader } from "../api.js";

const MAX_CACHE = 24;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos
const MIN_QUERY_LENGTH = 3;
const RESULT_LIMIT = 8;
const COUNTRY_BIAS = "br";
const ACCEPT_LANGUAGE = "pt-BR";

export default function useGeocodeSearch() {
  const [isSearching, setIsSearching] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [error, setError] = useState(null);
  const cacheRef = useRef(new Map());
  const abortRef = useRef(null);
  const debounceRef = useRef(null);
  const unauthorizedRef = useRef(false);
  const guestFallbackRef = useRef(false);

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

  const normaliseList = useCallback((payload, term) => {
    const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];

    return list
      .map((item) => {
        const lat = Number(item.lat ?? item.latitude ?? item.latitud);
        const lng = Number(item.lng ?? item.lon ?? item.longitude ?? item.longitud);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

        const address = item.address || item.display_name || item.label || term;
        const concise =
          item.concise ||
          (item.address?.road &&
            [
              item.address.road,
              item.address.city || item.address.town || item.address.village,
              item.address.state,
            ]
              .filter(Boolean)
              .join(", ")) ||
          address;

        return {
          id: item.id || item.place_id || `${lat},${lng}`,
          lat,
          lng,
          label: item.label || item.display_name || term,
          concise,
          raw: item.raw || item,
          boundingBox: item.boundingBox || item.boundingbox,
        };
      })
      .filter(Boolean);
  }, []);

  const fetchFromApi = useCallback(async (term, signal) => {
    const url = `/api/geocode/search?q=${encodeURIComponent(term)}&limit=${RESULT_LIMIT}`;
    const headers = new Headers({ Accept: "application/json" });
    const authorization = resolveAuthorizationHeader();
    if (authorization) {
      headers.set("Authorization", authorization);
    }

    const response = await fetch(url, { credentials: "include", signal, headers });

    let payload;
    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }

    if (!response.ok) {
      const unauthorized = response.status === 401 || response.status === 403;
      if (unauthorized) {
        unauthorizedRef.current = true;
      }

      const defaultMessage = unauthorized
        ? "Geocoding indisponível — faça login novamente."
        : "Não foi possível buscar endereços.";
      const message = payload?.error?.message || defaultMessage;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    return normaliseList(payload, term);
  }, [normaliseList]);

  const fetchFromPublic = useCallback(async (term, signal) => {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "json");
    url.searchParams.set("q", term);
    url.searchParams.set("limit", String(RESULT_LIMIT));
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("polygon_geojson", "0");
    url.searchParams.set("accept-language", ACCEPT_LANGUAGE);
    url.searchParams.set("countrycodes", COUNTRY_BIAS);

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal,
    });

    if (!response.ok) {
      const fallbackError = new Error("Não foi possível buscar endereços agora.");
      fallbackError.status = response.status;
      throw fallbackError;
    }

    const payload = await response.json().catch(() => []);
    return normaliseList(payload, term);
  }, [normaliseList]);

  const fetchCandidates = useCallback(async (term) => {
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    if (unauthorizedRef.current || guestFallbackRef.current) {
      return fetchFromPublic(term, controller.signal).catch(() => []);
    }

    try {
      return await fetchFromApi(term, controller.signal);
    } catch (apiError) {
      const unauthorized = apiError?.status === 401 || apiError?.status === 403;
      if (unauthorized) {
        unauthorizedRef.current = true;
      }

      if (unauthorized || unauthorizedRef.current) {
        guestFallbackRef.current = true;
        return fetchFromPublic(term, controller.signal).catch(() => []);
      }

      throw apiError;
    }
  }, [fetchFromApi, fetchFromPublic]);

  const searchRegion = useCallback(async (query) => {
    const term = query?.trim();
    if (!term || term.length < MIN_QUERY_LENGTH) return null;

    const cached = getCached(term.toLowerCase());
    if (cached) {
      setSuggestions(cached.list);
      setLastResult(cached.best || cached.list[0] || null);
      setError(cached.list.length ? null : new Error("Nenhum resultado encontrado."));
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
      setError(list.length ? null : new Error("Nenhum resultado encontrado."));
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
    setError(null);
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

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    return new Promise((resolve) => {
      debounceRef.current = setTimeout(async () => {
        setIsSearching(true);
        try {
          const candidates = await fetchCandidates(term);
          const list = candidates;
          setSuggestions(list);
          setError(list.length ? null : new Error("Nenhum resultado encontrado."));
          setCache(term.toLowerCase(), { list, best: list[0] || null });
          resolve(list);
        } catch (previewError) {
          setSuggestions([]);
          setLastResult(null);
          setError(previewError);
          resolve([]);
        } finally {
          setIsSearching(false);
        }
      }, 300);
    });
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
