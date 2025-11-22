import { useCallback, useEffect, useMemo, useState } from "react";

import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTranslation } from "../i18n.js";
import { useTenant } from "../tenant-context.jsx";

const MAX_CONSECUTIVE_ERRORS = 3;

export function useHeatmapEvents({
  from,
  to,
  eventType,
  eventTypes,
  groupId,
  tenantId: overrideTenant,
  enabled = true,
} = {}) {
  const { tenantId } = useTenant();
  const { t } = useTranslation();
  const [points, setPoints] = useState([]);
  const [topZones, setTopZones] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const [stopped, setStopped] = useState(false);

  const params = useMemo(() => {
    const next = {};
    if (from) next.from = from;
    if (to) next.to = to;
    const resolvedTypes = eventTypes?.length ? eventTypes : eventType;
    if (resolvedTypes?.length) {
      const list = Array.isArray(resolvedTypes) ? resolvedTypes : [resolvedTypes];
      const joined = list.join(",");
      next.eventTypes = joined;
      next.type = joined; // compat with backend filters
    }
    if (groupId) next.groupId = groupId;
    const resolvedTenant = overrideTenant ?? tenantId;
    if (resolvedTenant) next.clientId = resolvedTenant;
    return next;
  }, [eventType, eventTypes, from, groupId, overrideTenant, tenantId, to]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    if (stopped) {
      return undefined;
    }

    let cancelled = false;

    async function fetchHeatmap() {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get(API_ROUTES.analytics.eventsHeatmap, { params });
        if (cancelled) return;
        const payload = response?.data || {};
        setPoints(Array.isArray(payload.points) ? payload.points : []);
        setTopZones(Array.isArray(payload.topZones) ? payload.topZones : []);
        setTotal(Number(payload.total) || 0);
        setConsecutiveErrors(0);
      } catch (requestError) {
        if (cancelled) return;
        console.error("Falha ao carregar heatmap de eventos", requestError);
        const friendlyMessage =
          requestError?.response?.data?.message || requestError.message || t("errors.loadHeatmap");
        const nextErrorCount = consecutiveErrors + 1;
        const reachedLimit = nextErrorCount >= MAX_CONSECUTIVE_ERRORS;
        setError(new Error(friendlyMessage));
        setConsecutiveErrors(nextErrorCount);
        if (reachedLimit) {
          setStopped(true);
        }
        setPoints([]);
        setTopZones([]);
        setTotal(0);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchHeatmap();

    return () => {
      cancelled = true;
    };
  }, [params, version, t, consecutiveErrors, enabled, stopped]);

  const refresh = useCallback(() => {
    setStopped(false);
    setConsecutiveErrors(0);
    setVersion((value) => value + 1);
  }, []);

  return { points, topZones, total, loading, error, refresh };
}

export default useHeatmapEvents;
