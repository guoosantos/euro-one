import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

  const abortRef = useRef(null);

  // -------------- PARAMS ESTÁVEIS (sem loop) --------------
  const stableParams = useMemo(() => {
    const next = {};

    if (from) next.from = from;
    if (to) next.to = to;

    const resolvedTypes = eventTypes?.length ? eventTypes : eventType;
    if (resolvedTypes) {
      const arr = Array.isArray(resolvedTypes) ? resolvedTypes : [resolvedTypes];
      const joined = arr.join(",");
      next.eventTypes = joined;
      next.type = joined;
    }

    if (groupId) next.groupId = groupId;

    const resolvedTenant = overrideTenant ?? tenantId;
    if (resolvedTenant) next.clientId = resolvedTenant;

    return next;
  }, [from, to, eventType, eventTypes, groupId, overrideTenant, tenantId]);

  // Hash estável para evitar JSON.stringify dentro do effect
  const paramsKey = useMemo(() => JSON.stringify(stableParams), [stableParams]);

  // -------------- FETCH SEGURO E SEM LOOP --------------
  const fetchHeatmap = useCallback(async () => {
    if (!enabled) return;

    setLoading(true);
    setError(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await api.get(API_ROUTES.analytics.eventsHeatmap, {
        params: stableParams,
        signal: controller.signal,
      });

      const payload = response?.data || {};

      setPoints(Array.isArray(payload.points) ? payload.points : []);
      setTopZones(Array.isArray(payload.topZones) ? payload.topZones : []);
      setTotal(Number(payload.total) || 0);
    } catch (err) {
      if (controller.signal.aborted) return;

      console.error("Falha ao carregar heatmap de eventos", err);

      const friendly =
        err?.response?.data?.message ||
        err?.message ||
        t("errors.loadHeatmap");

      setError(new Error(friendly));
      setPoints([]);
      setTopZones([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [enabled, paramsKey, t]);

  // -------------- EFFECT ESTÁVEL --------------
  useEffect(() => {
    if (!enabled) return;

    fetchHeatmap();

    return () => {
      abortRef.current?.abort();
    };
  }, [fetchHeatmap, enabled]);

  // -------------- REFRESH SEGURO --------------
  const refresh = useCallback(() => {
    fetchHeatmap();
  }, [fetchHeatmap]);

  return { points, topZones, total, loading, error, refresh };
}

export default useHeatmapEvents;
