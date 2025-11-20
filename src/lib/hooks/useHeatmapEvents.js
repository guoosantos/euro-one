import { useCallback, useEffect, useMemo, useState } from "react";

import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTranslation } from "../i18n.js";
import { useTenant } from "../tenant-context.jsx";

export function useHeatmapEvents({ from, to, eventType, eventTypes, groupId, tenantId: overrideTenant } = {}) {
  const { tenantId } = useTenant();
  const { t } = useTranslation();
  const [points, setPoints] = useState([]);
  const [topZones, setTopZones] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);

  const params = useMemo(() => {
    const next = {};
    if (from) next.from = from;
    if (to) next.to = to;
    const resolvedTypes = eventTypes || eventType;
    if (resolvedTypes?.length) {
      next.type = Array.isArray(resolvedTypes) ? resolvedTypes.join(",") : resolvedTypes;
    }
    if (groupId) next.groupId = groupId;
    const resolvedTenant = overrideTenant ?? tenantId;
    if (resolvedTenant) next.clientId = resolvedTenant;
    return next;
  }, [from, to, eventType, groupId, tenantId, overrideTenant]);

  useEffect(() => {
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
      } catch (requestError) {
        if (cancelled) return;
        console.error("Falha ao carregar heatmap de eventos", requestError);
        const friendlyMessage =
          requestError?.response?.data?.message || requestError.message || t("errors.loadHeatmap");
        setError(new Error(friendlyMessage));
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
  }, [params, version, t]);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  return { points, topZones, total, loading, error, refresh };
}

export default useHeatmapEvents;
