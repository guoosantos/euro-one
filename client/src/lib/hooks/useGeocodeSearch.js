import { useCallback, useMemo, useRef, useState } from "react";

import { resolveAuthorizationHeader } from "../api.js";
import { normaliseGeocoderUrl, resolveMapPreferences } from "../map-config.js";

const MAX_CACHE = 24;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos
const MIN_QUERY_LENGTH = 3;
const RESULT_LIMIT = 10;
const COUNTRY_BIAS = "br";
const ACCEPT_LANGUAGE = "pt-BR";
const UNAUTHORIZED_COOLDOWN_MS = 3 * 60 * 1000; // aguarda antes de novas tentativas
const UNAVAILABLE_MESSAGE = "Endereço indisponível — faça login novamente";
const GEOCODER_FORBIDDEN_MESSAGE = "Geocoder recusou a requisição (403/429). Verifique bloqueio/rate limit e considere usar geocoder próprio.";
const GEOCODER_NETWORK_MESSAGE = "Falha ao consultar geocoder. Verifique conectividade/firewall/CORS.";

export function mapGeocoderError(error) {
  const status = Number(error?.status);
  if (status === 403 || status === 429) {
    return GEOCODER_FORBIDDEN_MESSAGE;
  }
  if (error?.message === GEOCODER_NETWORK_MESSAGE || error?.cause instanceof TypeError) {
    return GEOCODER_NETWORK_MESSAGE;
  }
  return error?.message || "Não foi possível buscar endereços agora. Tente novamente.";
}

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

export default function useGeocodeSearch(mapPreferences) {
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

        const boundingBox = item.boundingBox || item.boundingbox;
        const importance = Number(item.importance ?? item.place_rank ?? item.rank ?? 0);
        const areaScore = Array.isArray(boundingBox)
          ? Math.max(0.1, 1 / Math.max(Math.abs(boundingBox[1] - boundingBox[0]) * Math.abs(boundingBox[3] - boundingBox[2]), 0.001))
          : 0;

        return {
          id: item.id || item.place_id || `${lat},${lng}`,
          lat,
          lng,
          label: item.label || item.display_name || term,
          concise,
          raw: item.raw || item,
          boundingBox,
          score: importance + areaScore,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.score || 0) - (a.score || 0));
  }, []);

  const resolvedPreferences = useMemo(() => resolveMapPreferences(mapPreferences?.attributes, import.meta?.env ?? {}), [mapPreferences?.attributes]);
  const geocoderBaseUrl = useMemo(
    () => normaliseGeocoderUrl(mapPreferences?.geocoderUrl ?? resolvedPreferences.geocoderUrl, { defaultValue: "https://nominatim.openstreetmap.org" }),
    [mapPreferences?.geocoderUrl, resolvedPreferences.geocoderUrl],
  );

  const buildGeocoderUrl = useCallback((base, pathname = "search") => {
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
        cooldownUntilRef.current = Date.now() + UNAUTHORIZED_COOLDOWN_MS;
      }

      const forbidden = response.status === 429 || response.status === 403;
      const defaultMessage = unauthorized
        ? UNAVAILABLE_MESSAGE
        : forbidden
          ? GEOCODER_FORBIDDEN_MESSAGE
          : "Não foi possível buscar endereços.";
      const message = payload?.error?.message || defaultMessage;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    if (payload?.error?.message) {
      const error = new Error(payload.error.message);
      error.status = response.status;
      throw error;
    }

    return normaliseList(payload, term);
  }, [normaliseList]);

  const fetchFromPublic = useCallback(async (term, signal) => {
    const url = buildGeocoderUrl(geocoderBaseUrl, "search");
    url.searchParams.set("format", "json");
    url.searchParams.set("q", term);
    url.searchParams.set("limit", String(RESULT_LIMIT));
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("polygon_geojson", "0");
    url.searchParams.set("accept-language", ACCEPT_LANGUAGE);
    url.searchParams.set("countrycodes", COUNTRY_BIAS);

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
    return normaliseList(payload, term);
  }, [buildGeocoderUrl, geocoderBaseUrl, normaliseList]);

  const fetchCandidates = useCallback(async (term) => {
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

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
      const unauthorized = apiError?.status === 401 || apiError?.status === 403;
      if (unauthorized) {
        unauthorizedRef.current = true;
        cooldownUntilRef.current = Date.now() + UNAUTHORIZED_COOLDOWN_MS;
        setError(new Error(UNAVAILABLE_MESSAGE));
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
      if (unauthorizedRef.current && Date.now() < cooldownUntilRef.current) {
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
          if (unauthorizedRef.current && Date.now() < cooldownUntilRef.current) {
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
