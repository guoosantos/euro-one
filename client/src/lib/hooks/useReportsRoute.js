import { useCallback, useEffect, useState } from "react";
import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";

export function useReportsRoute() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const normalizeRoute = useCallback((payload) => {
    if (!payload) return { positions: [] };
    const base = Array.isArray(payload)
      ? { positions: payload }
      : typeof payload === "object"
        ? { ...payload }
        : {};

    const positions = Array.isArray(base.positions)
      ? base.positions
      : Array.isArray(base.data)
        ? base.data
        : [];

    return { ...base, positions: positions.filter(Boolean) };
  }, []);

  const persistData = useCallback((value) => {
    setData(value);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("reports:route:last", JSON.stringify(value));
    } catch (_error) {
      // Ignore persistence failures
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const cached = window.localStorage.getItem("reports:route:last");
      if (cached) {
        const parsed = JSON.parse(cached);
        persistData(normalizeRoute(parsed));
      }
    } catch (_error) {
      // Ignore hydration failures
    }
  }, [normalizeRoute, persistData]);

  const generate = useCallback(async (params) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(API_ROUTES.reports.route, { params });
      const enriched = {
        ...normalizeRoute(response?.data),
        __meta: { generatedAt: new Date().toISOString(), params },
      };
      persistData(enriched);
      return enriched;
    } catch (requestError) {
      const fallbackError = requestError instanceof Error ? requestError : new Error("Erro ao gerar relatório de rota");
      setError(fallbackError);
      throw fallbackError;
    } finally {
      setLoading(false);
    }
  }, [normalizeRoute, persistData]);

  return { data, loading, error, generate };
}

export default useReportsRoute;
