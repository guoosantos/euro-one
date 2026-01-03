import React, { createContext, useContext, useMemo } from "react";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { usePolling } from "../lib/hooks/usePolling.js";

function normaliseTelemetry(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data?.telemetry)) return payload.data.telemetry;
  if (Array.isArray(payload?.telemetry)) return payload.telemetry;
  if (Array.isArray(payload?.devices)) return payload.devices;
  return [];
}

const TelemetryContext = createContext({
  data: [],
  telemetry: [],
  warnings: [],
  loading: false,
  error: null,
  liveStatus: { mode: "polling", connected: false },
  refresh: () => {},
});

const ENABLE_WEBSOCKET = false;

export function TelemetryProvider({ children, interval = 60_000 }) {
  const { tenantId, isAuthenticated } = useTenant();

  const params = useMemo(() => (tenantId ? { clientId: tenantId } : undefined), [tenantId]);

  const { data, loading, error, lastUpdated, refresh } = usePolling(
    async () => {
      if (!isAuthenticated) return { telemetry: [], warnings: [] };

      const { data: payload, error: requestError } = await safeApi.get(API_ROUTES.core.telemetry, { params });
      if (requestError) throw requestError;

      const normalisedTelemetry = normaliseTelemetry(payload);
      const resolvedWarnings = Array.isArray(payload?.data?.warnings)
        ? payload.data.warnings
        : Array.isArray(payload?.warnings)
          ? payload.warnings
          : [];

      return { telemetry: normalisedTelemetry, warnings: resolvedWarnings };
    },
    {
      enabled: isAuthenticated,
      intervalMs: interval,
      dependencies: [tenantId, isAuthenticated],
      resetOnChange: true,
    },
  );

  const telemetry = Array.isArray(data?.telemetry) ? data.telemetry : [];
  const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
  const liveStatus = useMemo(
    () => ({ mode: ENABLE_WEBSOCKET ? "websocket" : "polling", connected: false }),
    [],
  );

  const value = useMemo(
    () => ({
      data: telemetry,
      telemetry,
      warnings,
      loading: Boolean(loading),
      error: error || null,
      refresh,
      fetchedAt: lastUpdated,
      liveStatus,
    }),
    [telemetry, warnings, loading, liveStatus, error, refresh, lastUpdated],
  );

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
}

export function useTelemetryContext() {
  return useContext(TelemetryContext);
}

export default TelemetryContext;
