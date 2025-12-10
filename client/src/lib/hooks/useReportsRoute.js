import { useCallback, useEffect, useState } from "react";

import safeApi from "../safe-api.js";
import { API_ROUTES } from "../api-routes.js";
import { readCachedReport, writeCachedReport } from "./reportStorage.js";

const ROUTE_CACHE_KEY = "reports:route:last";

export const normalizeRoute = (payload) => {
  if (!payload) return { positions: [] };
  const base = Array.isArray(payload)
    ? { positions: payload }
    : typeof payload === "object"
      ? { ...payload }
      : {};

  const positions = Array.isArray(base.positions)
    ? base.positions
    : Array.isArray(base.data?.positions)
      ? base.data.positions
      : Array.isArray(base.data)
        ? base.data
      : [];

  return { ...base, positions: positions.filter(Boolean) };
};

export function useReportsRoute() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const persistData = useCallback((value) => {
    setData(value);
    writeCachedReport(ROUTE_CACHE_KEY, value);
  }, []);

  useEffect(() => {
    const cached = readCachedReport(ROUTE_CACHE_KEY, normalizeRoute);
    if (cached) {
      persistData(cached);
    }
  }, [persistData]);

  const generate = useCallback(async (params) => {
    setLoading(true);
    setError(null);
    try {
      const { data: response, error: requestError } = await safeApi.get(API_ROUTES.traccar.reports.route, { params });
      if (requestError) {
        throw requestError;
      }
      const enriched = {
        ...normalizeRoute(response?.data ?? response),
        __meta: { generatedAt: new Date().toISOString(), params },
      };
      persistData(enriched);
      return enriched;
    } catch (requestError) {
      const friendlyMessage = "Não foi possível gerar o relatório de rotas. Tente novamente mais tarde.";
      const fallbackError =
        requestError instanceof Error ? new Error(friendlyMessage, { cause: requestError }) : new Error(friendlyMessage);
      setError(fallbackError);
      throw fallbackError;
    } finally {
      setLoading(false);
    }
  }, [normalizeRoute, persistData]);

  return { data, loading, error, generate };
}

export default useReportsRoute;
