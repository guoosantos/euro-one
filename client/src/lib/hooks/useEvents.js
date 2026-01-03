import { useCallback, useMemo } from "react";
import safeApi from "../safe-api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTranslation } from "../i18n.js";
import { useTenant } from "../tenant-context.jsx";
import { buildParams } from "./events-helpers.js";
import { useSharedPollingResource } from "./useSharedPollingResource.js";
import { useEventsContext } from "../../contexts/EventsContext.jsx";

export function useEvents({
  deviceId,
  types,
  from,
  to,
  severity,
  resolved,
  limit = 50,
  refreshInterval = 15_000,
  autoRefreshMs,
  maxConsecutiveErrors = 3,
  pauseWhenHidden = true,
  enabled = true,
} = {}) {
  const { tenantId } = useTenant();
  const { t } = useTranslation();
  const resolvedInterval = autoRefreshMs ?? refreshInterval;
  const { events: cachedEvents, loading: cachedLoading, error: cachedError, fetchedAt, refresh: refreshCached } =
    useEventsContext();

  const hasFilters = Boolean(deviceId || (types && types.length) || from || to || severity || resolved !== undefined);

  const cacheKey = useMemo(
    () =>
      [
        "events",
        tenantId || "global",
        deviceId || "all",
        types?.join?.("|") || "all",
        from || "",
        to || "",
        severity || "",
        resolved === undefined ? "any" : String(resolved),
        limit,
      ]
        .filter((part) => part !== undefined)
        .join(":"),
    [deviceId, from, limit, tenantId, severity, to, types, resolved],
  );

  const { data, loading, error, fetchedAt: polledAt, refresh } = useSharedPollingResource(
    cacheKey,
    useCallback(
      async ({ signal }) => {
        const params = buildParams({ deviceId, types, from, to, limit, severity, resolved });
        if (tenantId) params.clientId = tenantId;

        const { data: payload, error: requestError } = await safeApi.get(API_ROUTES.traccar.events, {
          params,
          signal,
        });

        if (requestError) {
          if (safeApi.isAbortError(requestError)) throw requestError;
          const friendly = requestError?.response?.data?.message || requestError.message || t("errors.loadEvents");
          const normalised = new Error(friendly);
          const status = Number(requestError?.response?.status ?? requestError?.status);
          if (Number.isFinite(status)) {
            normalised.status = status;
            if (status >= 400 && status < 500) normalised.permanent = true;
          }
          if (requestError?.permanent) normalised.permanent = true;
          throw normalised;
        }

        const list = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.data?.events)
          ? payload.data.events
          : Array.isArray(payload?.events)
          ? payload.events
          : Array.isArray(payload?.data)
          ? payload.data
          : [];
        return list.slice(0, limit);
      },
      [deviceId, types, from, to, limit, severity, tenantId, t],
    ),
    {
      enabled: enabled && hasFilters,
      intervalMs: resolvedInterval,
      maxConsecutiveErrors,
      pauseWhenHidden,
      backoffFactor: 2,
      maxIntervalMs: 60_000,
      initialData: [],
    },
  );

  const events = useMemo(() => {
    if (!hasFilters && enabled) {
      const source = Array.isArray(cachedEvents) ? cachedEvents : [];
      return source.slice(0, limit);
    }
    return Array.isArray(data) ? data : [];
  }, [cachedEvents, data, hasFilters, enabled, limit]);

  const combinedLoading = hasFilters ? loading : cachedLoading && enabled;
  const combinedError = hasFilters ? error : cachedError;
  const lastUpdated = hasFilters ? polledAt : fetchedAt;
  const refreshFn = hasFilters ? refresh : refreshCached;

  return useMemo(
    () => ({ events, loading: combinedLoading, error: combinedError, refresh: refreshFn, lastUpdated }),
    [events, combinedLoading, combinedError, refreshFn, lastUpdated],
  );
}

export default useEvents;
