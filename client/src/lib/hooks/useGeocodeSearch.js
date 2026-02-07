import { useCallback, useMemo, useRef, useState } from "react";

import { normaliseGeocoderUrl, resolveMapPreferences } from "../map-config.js";
import { useTenant } from "../tenant-context.jsx";
import {
  DEFAULT_ACCEPT_LANGUAGE,
  DEFAULT_COUNTRY_BIAS,
  DEFAULT_RESULT_LIMIT,
  GEOCODER_FORBIDDEN_MESSAGE,
  mapGeocoderError,
  searchAddressApi,
  searchAddressPublic,
} from "../../services/geocodeClient.js";

const MAX_CACHE = 24;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos
const MIN_QUERY_LENGTH = 3;
const UNAUTHORIZED_COOLDOWN_MS = 3 * 60 * 1000; // aguarda antes de novas tentativas
const FORBIDDEN_COOLDOWN_MS = 3 * 60 * 1000; // evita spam quando 403
const UNAVAILABLE_MESSAGE = "Endereço indisponível — faça login novamente";

function parseCoordinateQuery(term) {
  if (!term) return null;
  const normalised = term.replace(/;/g, ",").trim();
  const parts = normalised
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const [latRaw, lngRaw] = parts;
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const padding = 0.01;
  const boundingBox = [lat - padding, lat + padding, lng - padding, lng + padding];
  const label = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  return {
    id: label,
    lat,
    lng,
    label,
    concise: label,
    boundingBox,
    score: 1_000_000,
  };
}

export default function useGeocodeSearch(mapPreferences, options = {}) {
  const { isAuthenticated, permissionsReady } = useTenant();
  const [isSearching, setIsSearching] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [error, setError] = useState(null);
  const cacheRef = useRef(new Map());
  const abortRef = useRef(null);
  const debounceRef = useRef(null);
  const unauthorizedRef = useRef(false);
  const guestFallbackRef = useRef(false);
  const cooldownUntilRef = useRef(0);
  const forbiddenRef = useRef(false);
  const forbiddenUntilRef = useRef(0);

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

  const resolvedPreferences = useMemo(() => resolveMapPreferences(mapPreferences?.attributes, import.meta?.env ?? {}), [mapPreferences?.attributes]);
  const geocoderBaseUrl = useMemo(
    () => normaliseGeocoderUrl(mapPreferences?.geocoderUrl ?? resolvedPreferences.geocoderUrl, { defaultValue: "https://nominatim.openstreetmap.org" }),
    [mapPreferences?.geocoderUrl, resolvedPreferences.geocoderUrl],
  );
  const resultLimit = useMemo(() => Number(options?.limit ?? DEFAULT_RESULT_LIMIT), [options?.limit]);
  const acceptLanguage = useMemo(
    () => options?.acceptLanguage ?? DEFAULT_ACCEPT_LANGUAGE,
    [options?.acceptLanguage],
  );
  const countryBias = useMemo(
    () => String(options?.country ?? DEFAULT_COUNTRY_BIAS).toLowerCase(),
    [options?.country],
  );
  const debounceMs = useMemo(() => Math.max(0, Number(options?.debounceMs ?? 300)), [options?.debounceMs]);

  const fetchFromApi = useCallback(
    async (term, signal) => searchAddressApi(term, { limit: resultLimit, signal }),
    [resultLimit],
  );

  const fetchFromPublic = useCallback(
    async (term, signal) =>
      searchAddressPublic(term, {
        baseUrl: geocoderBaseUrl,
        limit: resultLimit,
        country: countryBias,
        acceptLanguage,
        signal,
      }),
    [acceptLanguage, countryBias, geocoderBaseUrl, resultLimit],
  );

  const apiEnabled = useMemo(() => {
    if (options?.useApi !== true) return false;
    const envFlag = String(import.meta?.env?.VITE_GEOCODER_USE_API || "").toLowerCase() === "true";
    return Boolean(envFlag && isAuthenticated && permissionsReady);
  }, [isAuthenticated, permissionsReady, options?.useApi]);

  const fetchCandidates = useCallback(async (term) => {
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    if (!apiEnabled) {
      return fetchFromPublic(term, controller.signal).catch(() => []);
    }

    const forbiddenActive = forbiddenRef.current && Date.now() < forbiddenUntilRef.current;
    if (forbiddenActive) {
      setError((prev) => (prev?.message === GEOCODER_FORBIDDEN_MESSAGE ? prev : new Error(GEOCODER_FORBIDDEN_MESSAGE)));
      return fetchFromPublic(term, controller.signal).catch(() => []);
    }

    const cooldownActive = cooldownUntilRef.current && Date.now() < cooldownUntilRef.current;
    if (cooldownActive) {
      setError((prev) => (prev?.message === UNAVAILABLE_MESSAGE ? prev : new Error(UNAVAILABLE_MESSAGE)));
      return fetchFromPublic(term, controller.signal).catch(() => []);
    }

    if (unauthorizedRef.current || guestFallbackRef.current) {
      return fetchFromPublic(term, controller.signal).catch(() => []);
    }

    try {
      return await fetchFromApi(term, controller.signal);
    } catch (apiError) {
      const unauthorized = apiError?.status === 401;
      const forbidden = apiError?.status === 403;
      if (unauthorized) {
        unauthorizedRef.current = true;
        cooldownUntilRef.current = Date.now() + UNAUTHORIZED_COOLDOWN_MS;
        setError(new Error(UNAVAILABLE_MESSAGE));
      }

      if (forbidden || unauthorized || unauthorizedRef.current) {
        guestFallbackRef.current = true;
        return fetchFromPublic(term, controller.signal).catch(() => []);
      }

      throw apiError;
    }
  }, [apiEnabled, fetchFromApi, fetchFromPublic]);

  const searchRegion = useCallback(async (query) => {
    const term = query?.trim();
    if (!term || term.length < MIN_QUERY_LENGTH) return null;

    const forbiddenActive = forbiddenRef.current && Date.now() < forbiddenUntilRef.current;
    if (forbiddenActive) {
      setSuggestions([]);
      setLastResult(null);
      setError(new Error(GEOCODER_FORBIDDEN_MESSAGE));
      return null;
    }

    const coordinateResult = parseCoordinateQuery(term);
    if (coordinateResult) {
      setSuggestions([coordinateResult]);
      setLastResult(coordinateResult);
      setCache(term.toLowerCase(), { list: [coordinateResult], best: coordinateResult });
      setError(null);
      return coordinateResult;
    }

    const cached = getCached(term.toLowerCase());
    if (cached) {
      setSuggestions(cached.list);
      setLastResult(cached.best || cached.list[0] || null);
      if (!unauthorizedRef.current) {
        setError(cached.list.length ? null : new Error("Nenhum resultado encontrado."));
      }
      return cached.best || cached.list[0] || null;
    }

    const inCooldown = unauthorizedRef.current && Date.now() < cooldownUntilRef.current;
    if (!inCooldown) setError(null);
    setIsSearching(true);

    try {
      const candidates = await fetchCandidates(term);
      const list = candidates;
      const [best] = list;
      setSuggestions(list);
      setLastResult(best || null);
      const forbiddenActive = forbiddenRef.current && Date.now() < forbiddenUntilRef.current;
      if (forbiddenActive) {
        setError(new Error(GEOCODER_FORBIDDEN_MESSAGE));
      } else if (unauthorizedRef.current && Date.now() < cooldownUntilRef.current) {
        setError(new Error(UNAVAILABLE_MESSAGE));
      } else {
        setError(list.length ? null : new Error("Nenhum resultado encontrado."));
      }
      setCache(term.toLowerCase(), { list, best });
      return best || null;
    } catch (searchError) {
      setSuggestions([]);
      setLastResult(null);
      setError(new Error(mapGeocoderError(searchError)));
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

    const forbiddenActive = forbiddenRef.current && Date.now() < forbiddenUntilRef.current;
    if (forbiddenActive) {
      setSuggestions([]);
      setLastResult(null);
      setError(new Error(GEOCODER_FORBIDDEN_MESSAGE));
      return [];
    }

    const coordinateResult = parseCoordinateQuery(term);
    if (coordinateResult) {
      setSuggestions([coordinateResult]);
      setLastResult(coordinateResult);
      setCache(term.toLowerCase(), { list: [coordinateResult], best: coordinateResult });
      setError(null);
      return [coordinateResult];
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
          const forbiddenActive = forbiddenRef.current && Date.now() < forbiddenUntilRef.current;
          if (forbiddenActive) {
            setError(new Error(GEOCODER_FORBIDDEN_MESSAGE));
          } else if (unauthorizedRef.current && Date.now() < cooldownUntilRef.current) {
            setError(new Error(UNAVAILABLE_MESSAGE));
          } else {
            setError(list.length ? null : new Error("Nenhum resultado encontrado."));
          }
          setCache(term.toLowerCase(), { list, best: list[0] || null });
          resolve(list);
        } catch (previewError) {
          setSuggestions([]);
          setLastResult(null);
          setError(new Error(mapGeocoderError(previewError)));
          resolve([]);
        } finally {
          setIsSearching(false);
        }
      }, debounceMs);
    });
  }, [clearSuggestions, debounceMs, fetchCandidates, getCached, setCache]);

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

export { mapGeocoderError };
