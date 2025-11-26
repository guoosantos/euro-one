import React, { createContext, useContext, useMemo } from "react";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { useTranslation } from "../lib/i18n.js";
import { usePollingResource } from "./usePollingResource.js";

function normalise(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.positions)) return payload.positions;
  if (Array.isArray(payload?.data)) return payload.data;
  return payload ? [payload] : [];
}

const LivePositionsContext = createContext({ data: [], positions: [], loading: false, error: null, refresh: () => {} });

export function LivePositionsProvider({ children, interval = 5_000 }) {
  const { tenantId } = useTenant();
  const { t } = useTranslation();

  const state = usePollingResource(
    async ({ signal }) => {
      const params = tenantId ? { clientId: tenantId } : undefined;
      const { data: payload, error } = await safeApi.get(API_ROUTES.lastPositions, { params, signal });
      if (error) {
        if (safeApi.isAbortError(error)) throw error;
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
    },
    { interval, initialData: [] },
  );

  const value = useMemo(
    () => ({
      data: Array.isArray(state.data) ? state.data : [],
      positions: Array.isArray(state.data) ? state.data : [],
      loading: state.loading,
      error: state.error,
      refresh: state.refresh,
      fetchedAt: state.fetchedAt,
    }),
    [state.data, state.loading, state.error, state.refresh, state.fetchedAt],
  );

  return <LivePositionsContext.Provider value={value}>{children}</LivePositionsContext.Provider>;
}

export function useLivePositionsContext() {
  return useContext(LivePositionsContext);
}

export default LivePositionsContext;
