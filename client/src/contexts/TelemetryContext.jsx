import React, { createContext, useCallback, useContext, useMemo } from "react";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { useTranslation } from "../lib/i18n.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { usePolling } from "../lib/hooks/usePolling.js";

function normaliseTelemetry(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.telemetry)) return payload.telemetry;
  if (Array.isArray(payload?.devices)) return payload.devices;
  return [];
}

const TelemetryContext = createContext({ data: [], telemetry: [], loading: false, error: null, refresh: () => {} });

export function TelemetryProvider({ children, interval = 5_000 }) {
  const { t } = useTranslation();
  const { tenantId, isAuthenticated } = useTenant();

  const params = useMemo(() => (tenantId ? { clientId: tenantId } : undefined), [tenantId]);

  const fetchTelemetry = useCallback(async () => {
    const { data: payload, error } = await safeApi.get(API_ROUTES.core.telemetry, { params });
    if (error) {
      const status = Number(error?.response?.status ?? error?.status);
      const friendly = error?.response?.data?.message || error.message || t("monitoring.loadErrorTitle");
      const normalised = new Error(friendly);
      if (Number.isFinite(status)) {
        normalised.status = status;
        if (status >= 400 && status < 500) normalised.permanent = true;
      }
      if (error?.permanent) normalised.permanent = true;
      throw normalised;
    }
    return normaliseTelemetry(payload);
  }, [params, t]);

  const { data, loading, error, lastUpdated, refresh } = usePolling({
    fetchFn: fetchTelemetry,
    intervalMs: interval,
    enabled: isAuthenticated,
  });

  const value = useMemo(
    () => ({
      data: Array.isArray(data) ? data : [],
      telemetry: Array.isArray(data) ? data : [],
      loading,
      error,
      refresh,
      fetchedAt: lastUpdated,
    }),
    [data, error, lastUpdated, loading, refresh],
  );

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
}

export function useTelemetryContext() {
  return useContext(TelemetryContext);
}

export default TelemetryContext;
