import React, { createContext, useCallback, useContext, useMemo } from "react";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { useTranslation } from "../lib/i18n.js";
import { usePolling } from "../lib/hooks/usePolling.js";
import useAutoRefresh from "../lib/hooks/useAutoRefresh.js";
import { useVehicleAccess } from "./VehicleAccessContext.jsx";

function normaliseEvents(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data?.events)) return payload.data.events;
  if (Array.isArray(payload?.events)) return payload.events;
  if (Array.isArray(payload?.data?.events)) return payload.data.events;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

const EventsContext = createContext({ data: [], events: [], loading: false, error: null, refresh: () => {} });

export function EventsProvider({ children, interval = 60_000, limit = 200 }) {
  const { tenantId, isAuthenticated } = useTenant();
  const { t } = useTranslation();
  const { accessibleVehicleIds, accessibleDeviceIds, isRestricted, loading: accessLoading } = useVehicleAccess();
  const autoRefresh = useAutoRefresh({ enabled: isAuthenticated, intervalMs: interval, pauseWhenOverlayOpen: true });

  const fetchEvents = useCallback(async () => {
    const params = tenantId ? { clientId: tenantId, limit } : { limit };
    const { data: payload, error: apiError } = await safeApi.get(API_ROUTES.traccar.events, { params });
    if (apiError) {
      const status = Number(apiError?.response?.status ?? apiError?.status);
      const friendly = apiError?.response?.data?.message || apiError.message || t("errors.loadEvents");
      const normalised = new Error(friendly);
      if (Number.isFinite(status)) {
        normalised.status = status;
        if (status >= 400 && status < 500) normalised.permanent = true;
      }
      if (apiError?.permanent) normalised.permanent = true;
      throw normalised;
    }
    return normaliseEvents(payload).slice(0, limit);
  }, [limit, t, tenantId]);

  const { data, loading, error, lastUpdated, refresh } = usePolling({
    fetchFn: fetchEvents,
    intervalMs: autoRefresh.intervalMs,
    enabled: isAuthenticated,
    paused: autoRefresh.paused,
    dependencies: [tenantId, isAuthenticated, limit],
    resetOnChange: true,
  });

  const filteredEvents = useMemo(() => {
    const source = Array.isArray(data) ? data : [];
    if (accessLoading) return source;
    if (!isRestricted && accessibleVehicleIds.length === 0 && accessibleDeviceIds.length === 0) {
      return source;
    }
    const allowedVehicles = new Set(accessibleVehicleIds.map(String));
    const allowedDevices = new Set(accessibleDeviceIds.map(String));
    return source.filter((event) => {
      const vehicleId = event?.vehicleId ?? event?.vehicle?.id ?? null;
      const deviceId = event?.deviceId ?? event?.device?.id ?? event?.deviceId ?? null;
      if (vehicleId && allowedVehicles.has(String(vehicleId))) return true;
      if (deviceId && allowedDevices.has(String(deviceId))) return true;
      return false;
    });
  }, [accessibleDeviceIds, accessibleVehicleIds, accessLoading, data, isRestricted]);

  const value = useMemo(
    () => ({
      data: filteredEvents,
      events: filteredEvents,
      loading,
      error,
      refresh,
      fetchedAt: lastUpdated,
    }),
    [filteredEvents, error, lastUpdated, loading, refresh],
  );

  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>;
}

export function useEventsContext() {
  return useContext(EventsContext);
}

export default EventsContext;
