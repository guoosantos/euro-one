import { useCallback, useEffect, useState } from "react";
import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";
import { readCachedReport, writeCachedReport } from "./reportStorage.js";

const SUMMARY_CACHE_KEY = "reports:summary:last";

export const normalizeSummary = (payload) => {
  if (!payload) return { summary: [] };
  const base = Array.isArray(payload)
    ? { summary: payload }
    : typeof payload === "object"
      ? { ...payload }
      : {};

  const summary = Array.isArray(base.summary)
    ? base.summary
    : Array.isArray(base.data)
      ? base.data
      : [];

  return { ...base, summary: summary.filter(Boolean) };
};

export function useReportsSummary() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const persistData = useCallback((value) => {
    setData(value);
    writeCachedReport(SUMMARY_CACHE_KEY, value);
  }, []);

  useEffect(() => {
    const cached = readCachedReport(SUMMARY_CACHE_KEY, normalizeSummary);
    if (cached) {
      persistData(cached);
    }
  }, [persistData]);

  const generate = useCallback(async (params) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(API_ROUTES.reports.summary, { params });
      const enriched = {
        ...normalizeSummary(response?.data),
        __meta: { generatedAt: new Date().toISOString(), params },
      };
      persistData(enriched);
      return enriched;
    } catch (requestError) {
      const fallbackError = requestError instanceof Error ? requestError : new Error("Erro ao gerar relatório de resumo");
      setError(fallbackError);
      throw fallbackError;
    } finally {
      setLoading(false);
    }
  }, [normalizeSummary, persistData]);

  return { data, loading, error, generate };
}

export default useReportsSummary;
