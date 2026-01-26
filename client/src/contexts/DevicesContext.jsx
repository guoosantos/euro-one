import React, { createContext, useCallback, useContext, useMemo } from "react";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { useTranslation } from "../lib/i18n.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { usePolling } from "../lib/hooks/usePolling.js";
import useAutoRefresh from "../lib/hooks/useAutoRefresh.js";
import { useVehicleAccess } from "./VehicleAccessContext.jsx";
import { usePermissionGate } from "../lib/permissions/permission-gate.js";

function normaliseDeviceList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.devices)) return payload.devices;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

const DevicesContext = createContext({ data: [], devices: [], loading: false, error: null, refresh: () => {} });

export function DevicesProvider({ children, interval = 60_000 }) {
  const { t } = useTranslation();
  const { tenantId, isAuthenticated } = useTenant();
  const { accessibleDeviceIds, isRestricted, loading: accessLoading } = useVehicleAccess();
  const devicesPermission = usePermissionGate({ menuKey: "primary", pageKey: "devices", subKey: "devices-list" });
  const autoRefresh = useAutoRefresh({ enabled: isAuthenticated, intervalMs: interval, pauseWhenOverlayOpen: true });
  const canAccessDevices = devicesPermission.hasAccess;

  const fetchDevices = useCallback(async () => {
    if (!canAccessDevices) return [];
    const params = tenantId ? { clientId: tenantId } : undefined;
    const { data: payload, error: apiError } = await safeApi.get(API_ROUTES.core.devices, { params });
    if (apiError) {
      const status = Number(apiError?.response?.status ?? apiError?.status);
      const friendly = apiError?.response?.data?.message || apiError.message || t("errors.loadDevices");
      const normalised = new Error(friendly);
      if (Number.isFinite(status)) {
        normalised.status = status;
        if (status >= 400 && status < 500) normalised.permanent = true;
      }
      if (apiError?.permanent) normalised.permanent = true;
      throw normalised;
    }
    const list = normaliseDeviceList(payload);
    return Array.isArray(list)
      ? list.map((device) => ({
          ...device,
          deviceId: device?.deviceId ?? device?.traccarId ?? device?.id ?? device?.uniqueId ?? null,
        }))
      : [];
  }, [canAccessDevices, t, tenantId]);

  const { data, loading, error, lastUpdated, refresh } = usePolling({
    fetchFn: fetchDevices,
    intervalMs: autoRefresh.intervalMs,
    enabled: isAuthenticated && canAccessDevices,
    paused: autoRefresh.paused,
    dependencies: [canAccessDevices, tenantId, isAuthenticated],
    resetOnChange: true,
  });

  const filteredDevices = useMemo(() => {
    const source = Array.isArray(data) ? data : [];
    if (accessLoading) return source;
    if (!isRestricted && accessibleDeviceIds.length === 0) return source;
    const allowedDevices = new Set(accessibleDeviceIds.map(String));
    return source.filter((device) => {
      const deviceId = device?.deviceId ?? device?.traccarId ?? device?.id ?? device?.uniqueId ?? null;
      if (!deviceId) return false;
      return allowedDevices.has(String(deviceId));
    });
  }, [accessLoading, accessibleDeviceIds, data, isRestricted]);

  const value = useMemo(
    () => ({
      data: filteredDevices,
      devices: filteredDevices,
      loading: canAccessDevices ? loading : false,
      error,
      refresh,
      fetchedAt: lastUpdated,
      liveStatus: {
        connected: false,
        fallback: true,
        fallbackMessage:
          t("monitoring.liveFallback", {
            defaultValue: "Conexão em tempo real indisponível. Atualizando a cada 5 segundos.",
          }) || "",
      },
    }),
    [canAccessDevices, filteredDevices, error, lastUpdated, loading, refresh, t],
  );

  return <DevicesContext.Provider value={value}>{children}</DevicesContext.Provider>;
}

export function useDevicesContext() {
  return useContext(DevicesContext);
}

export default DevicesContext;
