import { useCallback, useEffect, useMemo, useState } from "react";

import safeApi from "../safe-api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTenant } from "../tenant-context.jsx";

export function useConjugatedAlerts({
  params = {},
  refreshInterval = 30_000,
  enabled = true,
} = {}) {
  const { tenantId } = useTenant();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const paramsKey = useMemo(() => JSON.stringify(params || {}), [params]);

  const fetchAlerts = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const parsedParams = paramsKey ? JSON.parse(paramsKey) : {};
      const response = await safeApi.get(API_ROUTES.alertsConjugated, {
        params: {
          ...parsedParams,
          clientId: parsedParams.clientId ?? tenantId,
        },
      });
      const list = Array.isArray(response?.data?.data)
        ? response.data.data
        : Array.isArray(response?.data?.events)
        ? response.data.events
        : [];
      setData(list);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Erro ao carregar alertas conjugados"));
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, paramsKey, tenantId]);

  useEffect(() => {
    let timer;
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    fetchAlerts();
    if (refreshInterval) {
      timer = setInterval(fetchAlerts, refreshInterval);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [enabled, fetchAlerts, refreshInterval]);

  return useMemo(
    () => ({ alerts: data, loading, error, refresh: fetchAlerts }),
    [data, loading, error, fetchAlerts],
  );
}

export default useConjugatedAlerts;
