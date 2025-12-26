import { useCallback, useEffect, useMemo, useState } from "react";

import safeApi from "../safe-api.js";
import { API_ROUTES } from "../api-routes.js";
import { readCachedReport, writeCachedReport } from "./reportStorage.js";
import { useTenant } from "../tenant-context.jsx";

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
  const { tenantId } = useTenant();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const cacheKey = useMemo(() => `reports:route:last:${tenantId || "all"}`, [tenantId]);

  const persistData = useCallback((value) => {
    setData(value);
    writeCachedReport(cacheKey, value);
  }, [cacheKey]);

  useEffect(() => {
    const cached = readCachedReport(cacheKey, normalizeRoute);
    if (cached) {
      persistData(cached);
    }
  }, [cacheKey, persistData]);

  useEffect(() => {
    setData(null);
    setError(null);
  }, [cacheKey]);

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
