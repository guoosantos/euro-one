import { useCallback, useEffect, useState } from "react";
import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";

export function useReportsSummary() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const persistData = useCallback((value) => {
    setData(value);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("reports:summary:last", JSON.stringify(value));
    } catch (_error) {
      // Ignore persistence failures
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const cached = window.localStorage.getItem("reports:summary:last");
      if (cached) {
        setData(JSON.parse(cached));
      }
    } catch (_error) {
      // Ignore hydration failures
    }
  }, []);

  const generate = useCallback(async (params) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(API_ROUTES.reports.summary, { params });
      const enriched =
        response?.data && typeof response.data === "object"
          ? { ...response.data, __meta: { generatedAt: new Date().toISOString(), params } }
          : response?.data ?? null;
      persistData(enriched);
      return enriched;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : new Error("Erro ao gerar relatório de resumo"));
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, [persistData]);

  return { data, loading, error, generate };
}

export default useReportsSummary;
