import React, { createContext, useContext, useMemo } from "react";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { useTranslation } from "../lib/i18n.js";
import { usePollingResource } from "./usePollingResource.js";

function normaliseEvents(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.events)) return payload.events;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

const EventsContext = createContext({ data: [], events: [], loading: false, error: null, refresh: () => {} });

export function EventsProvider({ children, interval = 60_000, limit = 200 }) {
  const { tenantId } = useTenant();
  const { t } = useTranslation();

  const state = usePollingResource(
    async ({ signal }) => {
      const params = tenantId ? { clientId: tenantId, limit } : { limit };
      const { data: payload, error } = await safeApi.get(API_ROUTES.events, { params, signal });
      if (error) {
        if (safeApi.isAbortError(error)) throw error;
        const status = Number(error?.response?.status ?? error?.status);
        const friendly = error?.response?.data?.message || error.message || t("errors.loadEvents");
        const normalised = new Error(friendly);
        if (Number.isFinite(status)) {
          normalised.status = status;
          if (status >= 400 && status < 500) normalised.permanent = true;
        }
        if (error?.permanent) normalised.permanent = true;
        throw normalised;
      }
      return normaliseEvents(payload).slice(0, limit);
    },
    { interval, initialData: [] },
  );

  const value = useMemo(
    () => ({
      data: Array.isArray(state.data) ? state.data : [],
      events: Array.isArray(state.data) ? state.data : [],
      loading: state.loading,
      error: state.error,
      refresh: state.refresh,
      fetchedAt: state.fetchedAt,
    }),
    [state.data, state.loading, state.error, state.refresh, state.fetchedAt],
  );

  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>;
}

export function useEventsContext() {
  return useContext(EventsContext);
}

export default EventsContext;
