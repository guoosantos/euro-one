import { useCallback, useEffect, useState } from "react";
import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";
import { readCachedReport, writeCachedReport } from "./reportStorage.js";

const STOPS_CACHE_KEY = "reports:stops:last";

export const normalizeStops = (payload) => {
  if (!payload) return { stops: [] };
  const base = Array.isArray(payload)
    ? { stops: payload }
    : typeof payload === "object"
      ? { ...payload }
      : {};

  const stops = Array.isArray(base.stops)
    ? base.stops
    : Array.isArray(base.data)
      ? base.data
      : [];

  return { ...base, stops: stops.filter(Boolean) };
};

export function useReportsStops() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const persistData = useCallback((value) => {
    setData(value);
    writeCachedReport(STOPS_CACHE_KEY, value);
  }, []);

  useEffect(() => {
    const cached = readCachedReport(STOPS_CACHE_KEY, normalizeStops);
    if (cached) {
      persistData(cached);
    }
  }, [persistData]);

  const generate = useCallback(async (params) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(API_ROUTES.reports.stops, { params });
      const enriched = {
        ...normalizeStops(response?.data),
        __meta: { generatedAt: new Date().toISOString(), params },
      };
      persistData(enriched);
      return enriched;
    } catch (requestError) {
      const fallbackError = requestError instanceof Error ? requestError : new Error("Erro ao gerar relatório de paradas");
      setError(fallbackError);
      throw fallbackError;
    } finally {
      setLoading(false);
    }
  }, [normalizeStops, persistData]);

  return { data, loading, error, generate };
}

export default useReportsStops;
