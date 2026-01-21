import React, { createContext, useCallback, useContext, useMemo } from "react";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { useTranslation } from "../lib/i18n.js";
import { usePolling } from "../lib/hooks/usePolling.js";
import useAutoRefresh from "../lib/hooks/useAutoRefresh.js";
import { useVehicleAccess } from "./VehicleAccessContext.jsx";

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
  const { accessibleVehicleIds, accessibleDeviceIds, isRestricted, loading: accessLoading } = useVehicleAccess();
  const autoRefresh = useAutoRefresh({ enabled: isAuthenticated, intervalMs: interval, pauseWhenOverlayOpen: true });

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
    intervalMs: autoRefresh.intervalMs,
    enabled: isAuthenticated,
    paused: autoRefresh.paused,
    dependencies: [tenantId, isAuthenticated],
    resetOnChange: true,
  });

  const filteredData = useMemo(() => {
    const source = Array.isArray(data) ? data : [];
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
  }, [accessibleDeviceIds, accessibleVehicleIds, accessLoading, data, isRestricted]);

  const value = useMemo(
    () => ({
      data: filteredData,
      positions: filteredData,
      loading,
      error,
      refresh,
      fetchedAt: lastUpdated,
    }),
    [filteredData, error, lastUpdated, loading, refresh],
  );

  return <LivePositionsContext.Provider value={value}>{children}</LivePositionsContext.Provider>;
}

export function useLivePositionsContext() {
  return useContext(LivePositionsContext);
}

export default LivePositionsContext;
