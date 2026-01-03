import React, { createContext, useCallback, useContext, useMemo } from "react";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { useTranslation } from "../lib/i18n.js";
import { usePolling } from "../lib/hooks/usePolling.js";

function normalise(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.positions)) return payload.positions;
  if (Array.isArray(payload?.data)) return payload.data;
  return payload ? [payload] : [];
}

const LivePositionsContext = createContext({ data: [], positions: [], loading: false, error: null, refresh: () => {} });

export function LivePositionsProvider({ children, interval = 60_000 }) {
  const { tenantId, isAuthenticated } = useTenant();
  const { t } = useTranslation();

  const params = useMemo(() => (tenantId ? { clientId: tenantId } : undefined), [tenantId]);

  const fetchPositions = useCallback(async () => {
    const { data: payload, error } = await safeApi.get(API_ROUTES.lastPositions, { params });
    if (error) {
      const status = Number(error?.response?.status ?? error?.status);
      const friendly = error?.response?.data?.message || error.message || t("errors.loadPositions");
      const normalised = new Error(friendly);
      if (Number.isFinite(status)) {
        normalised.status = status;
        if (status >= 400 && status < 500) normalised.permanent = true;
      }
      if (error?.permanent) normalised.permanent = true;
      throw normalised;
    }
    return normalise(payload);
  }, [params, t]);

  const { data, loading, error, lastUpdated, refresh } = usePolling({
    fetchFn: fetchPositions,
    intervalMs: interval,
    enabled: isAuthenticated,
    dependencies: [tenantId, isAuthenticated],
    resetOnChange: true,
  });

  const value = useMemo(
    () => ({
      data: Array.isArray(data) ? data : [],
      positions: Array.isArray(data) ? data : [],
      loading,
      error,
      refresh,
      fetchedAt: lastUpdated,
    }),
    [data, error, lastUpdated, loading, refresh],
  );

  return <LivePositionsContext.Provider value={value}>{children}</LivePositionsContext.Provider>;
}

export function useLivePositionsContext() {
  return useContext(LivePositionsContext);
}

export default LivePositionsContext;
