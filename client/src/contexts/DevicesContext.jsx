import React, { createContext, useContext, useMemo } from "react";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { useTranslation } from "../lib/i18n.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { usePollingResource } from "./usePollingResource.js";

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

  const state = usePollingResource(
    async ({ signal }) => {
      const params = tenantId ? { clientId: tenantId } : undefined;
      const { data: payload, error } = await safeApi.get(API_ROUTES.core.devices, { params, signal });
      if (error) {
        if (safeApi.isAbortError(error)) throw error;
        const status = Number(error?.response?.status ?? error?.status);
        const friendly = error?.response?.data?.message || error.message || t("errors.loadDevices");
        const normalised = new Error(friendly);
        if (Number.isFinite(status)) {
          normalised.status = status;
          if (status >= 400 && status < 500) normalised.permanent = true;
        }
        if (error?.permanent) normalised.permanent = true;
        throw normalised;
      }
      const list = normaliseDeviceList(payload);
      return Array.isArray(list)
        ? list.map((device) => ({
            ...device,
            deviceId: device?.deviceId ?? device?.traccarId ?? device?.id ?? device?.uniqueId ?? null,
          }))
        : [];
    },
    { interval, initialData: [], enabled: isAuthenticated },
  );

  const value = useMemo(
    () => ({
      data: Array.isArray(state.data) ? state.data : [],
      devices: Array.isArray(state.data) ? state.data : [],
      loading: state.loading,
      error: state.error,
      refresh: state.refresh,
      fetchedAt: state.fetchedAt,
      liveStatus: {
        connected: false,
        fallback: true,
        fallbackMessage:
          t("monitoring.liveFallback", {
            defaultValue: "Conexão em tempo real indisponível. Atualizando a cada 5 segundos.",
          }) || "",
      },
    }),
    [state.data, state.loading, state.error, state.refresh, state.fetchedAt, t],
  );

  return <DevicesContext.Provider value={value}>{children}</DevicesContext.Provider>;
}

export function useDevicesContext() {
  return useContext(DevicesContext);
}

export default DevicesContext;
