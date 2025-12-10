import React, { createContext, useContext, useMemo } from "react";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { useTranslation } from "../lib/i18n.js";
import { usePolling } from "../lib/hooks/usePolling.js";

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

  const { data, loading, error, lastUpdated, refresh } = usePolling({
    fetchFn: async () => {
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
    },
    intervalMs: interval,
    enabled: isAuthenticated,
  });

  const value = useMemo(
    () => ({
      data: Array.isArray(data) ? data : [],
      events: Array.isArray(data) ? data : [],
      loading,
      error,
      refresh,
      fetchedAt: lastUpdated,
    }),
    [data, error, lastUpdated, loading, refresh],
  );

  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>;
}

export function useEventsContext() {
  return useContext(EventsContext);
}

export default EventsContext;
