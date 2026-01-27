import { useCallback, useEffect, useMemo, useState } from "react";

import safeApi from "../safe-api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTenant } from "../tenant-context.jsx";
import { usePermissionGate } from "../permissions/permission-gate.js";
import { resolveMirrorClientParams, resolveMirrorHeaders } from "../mirror-params.js";

export function useConjugatedAlerts({
  params = {},
  refreshInterval = 30_000,
  enabled = true,
} = {}) {
  const { tenantId, mirrorContextMode, mirrorModeEnabled, activeMirror, activeMirrorOwnerClientId } = useTenant();
  const alertsPermission = usePermissionGate({
    menuKey: "primary",
    pageKey: "monitoring",
    subKey: "alerts-conjugated",
  });
  const canAccessAlerts = alertsPermission.hasAccess;
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const paramsKey = useMemo(() => JSON.stringify(params || {}), [params]);
  const mirrorOwnerClientId = activeMirror?.ownerClientId ?? activeMirrorOwnerClientId;
  const mirrorHeaders = useMemo(
    () => resolveMirrorHeaders({ mirrorModeEnabled, mirrorOwnerClientId, mirrorContextMode }),
    [mirrorContextMode, mirrorModeEnabled, mirrorOwnerClientId],
  );

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
      const response = await safeApi.get(API_ROUTES.alertsConjugated, {
        params: resolveMirrorClientParams({ params: parsedParams, tenantId, mirrorContextMode }),
        headers: mirrorHeaders,
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
  }, [canAccessAlerts, enabled, mirrorContextMode, mirrorHeaders, paramsKey, tenantId]);

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

export default useConjugatedAlerts;
