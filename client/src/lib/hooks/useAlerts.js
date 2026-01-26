import { useCallback, useEffect, useMemo, useState } from "react";

import safeApi from "../safe-api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTenant } from "../tenant-context.jsx";
import { usePermissionGate } from "../permissions/permission-gate.js";

export function useAlerts({
  params = {},
  refreshInterval = 30_000,
  enabled = true,
} = {}) {
  const { tenantId } = useTenant();
  const alertsPermission = usePermissionGate({ menuKey: "primary", pageKey: "monitoring", subKey: "alerts" });
  const canAccessAlerts = alertsPermission.hasAccess;
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const paramsKey = useMemo(() => JSON.stringify(params || {}), [params]);

  const fetchAlerts = useCallback(async () => {
    if (!enabled || !canAccessAlerts) {
      setLoading(false);
      setError(null);
      setData([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const parsedParams = paramsKey ? JSON.parse(paramsKey) : {};
      const response = await safeApi.get(API_ROUTES.alerts, {
        params: {
          ...parsedParams,
          clientId: parsedParams.clientId ?? tenantId,
        },
        suppressForbidden: true,
        forbiddenFallbackData: [],
      });
      if (response?.error) {
        setError(response.error);
        setData([]);
        return;
      }
      const list = Array.isArray(response?.data?.data)
        ? response.data.data
        : Array.isArray(response?.data?.alerts)
        ? response.data.alerts
        : [];
      setData(list);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Erro ao carregar alertas"));
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [canAccessAlerts, enabled, paramsKey, tenantId]);

  useEffect(() => {
    let timer;
    if (!enabled || !canAccessAlerts) {
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
  }, [canAccessAlerts, enabled, fetchAlerts, refreshInterval]);

  return useMemo(
    () => ({ alerts: data, loading, error, refresh: fetchAlerts }),
    [data, loading, error, fetchAlerts],
  );
}

export default useAlerts;
