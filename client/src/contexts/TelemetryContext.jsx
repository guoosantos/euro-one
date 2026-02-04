import React, { createContext, useContext, useMemo, useRef } from "react";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { usePermissionGate } from "../lib/permissions/permission-gate.js";
import { usePolling } from "../lib/hooks/usePolling.js";
import useAutoRefresh from "../lib/hooks/useAutoRefresh.js";
import { useVehicleAccess } from "./VehicleAccessContext.jsx";
import { resolveMirrorClientParams } from "../lib/mirror-params.js";

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
  const {
    tenantId,
    isAuthenticated,
    initialising,
    loading: tenantLoading,
    mirrorContextMode,
    activeMirror,
    activeMirrorOwnerClientId,
    contextSwitching,
    contextSwitchKey,
    contextAbortSignal,
  } = useTenant();
  const monitoringPermission = usePermissionGate({ menuKey: "primary", pageKey: "monitoring" });
  const canAccessMonitoring = monitoringPermission.hasAccess;
  const { accessibleVehicleIds, accessibleDeviceIds, isRestricted, loading: accessLoading } = useVehicleAccess();
  const autoRefresh = useAutoRefresh({
    enabled: isAuthenticated && !initialising && !tenantLoading && !contextSwitching,
    intervalMs: interval,
    pauseWhenOverlayOpen: true,
  });
  const lastTelemetryRef = useRef({ telemetry: [], warnings: [] });

  const mirrorOwnerClientId = activeMirror?.ownerClientId ?? activeMirrorOwnerClientId;
  const params = useMemo(
    () => resolveMirrorClientParams({ tenantId, mirrorContextMode, mirrorOwnerClientId }),
    [mirrorContextMode, mirrorOwnerClientId, tenantId],
  );
  const { data, loading, error, lastUpdated, refresh } = usePolling(
    async () => {
      if (!isAuthenticated || !canAccessMonitoring) return { telemetry: [], warnings: [] };
      const { data: payload, error: requestError } = await safeApi.get(API_ROUTES.core.telemetry, {
        params,
        signal: contextAbortSignal,
      });
      if (requestError?.name === "AbortError" || requestError?.code === "ERR_CANCELED") {
        return lastTelemetryRef.current;
      }
      if (requestError) throw requestError;

      const normalisedTelemetry = normaliseTelemetry(payload);
      const resolvedWarnings = Array.isArray(payload?.data?.warnings)
        ? payload.data.warnings
        : Array.isArray(payload?.warnings)
          ? payload.warnings
          : [];

      const result = { telemetry: normalisedTelemetry, warnings: resolvedWarnings };
      lastTelemetryRef.current = result;
      return result;
    },
    {
      enabled:
        isAuthenticated &&
        canAccessMonitoring &&
        !initialising &&
        !tenantLoading &&
        !accessLoading &&
        !contextSwitching,
      intervalMs: autoRefresh.intervalMs,
      paused: autoRefresh.paused,
      dependencies: [
        mirrorContextMode,
        tenantId,
        isAuthenticated,
        canAccessMonitoring,
        initialising,
        tenantLoading,
        accessLoading,
        contextSwitchKey,
      ],
      resetOnChange: true,
    },
  );

  const telemetry = useMemo(() => {
    const source = Array.isArray(data?.telemetry) ? data.telemetry : [];
    if (accessLoading) return source;
    if (!isRestricted && accessibleVehicleIds.length === 0 && accessibleDeviceIds.length === 0) {
      return source;
    }
    const allowedVehicles = new Set(accessibleVehicleIds.map(String));
    const allowedDevices = new Set(accessibleDeviceIds.map(String));
    return source.filter((item) => {
      const vehicleId = item?.vehicleId ?? item?.vehicle?.id ?? null;
      const deviceId = item?.deviceId ?? item?.device?.id ?? item?.traccarId ?? null;
      if (vehicleId && allowedVehicles.has(String(vehicleId))) return true;
      if (deviceId && allowedDevices.has(String(deviceId))) return true;
      return false;
    });
  }, [accessibleDeviceIds, accessibleVehicleIds, accessLoading, data?.telemetry, isRestricted]);
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
