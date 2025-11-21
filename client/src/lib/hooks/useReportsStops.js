import { useCallback, useEffect, useState } from "react";
import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";

export function useReportsStops() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const normalizeStops = useCallback((payload) => {
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
  }, []);

  const persistData = useCallback((value) => {
    setData(value);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("reports:stops:last", JSON.stringify(value));
    } catch (_error) {
      // Ignore persistence failures
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const cached = window.localStorage.getItem("reports:stops:last");
      if (cached) {
        const parsed = JSON.parse(cached);
        persistData(normalizeStops(parsed));
      }
    } catch (_error) {
      // Ignore hydration failures
    }
  }, [normalizeStops, persistData]);

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
