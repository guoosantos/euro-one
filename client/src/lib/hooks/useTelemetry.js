import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import safeApi from "../safe-api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTranslation } from "../i18n.js";
import { usePollingTask } from "./usePollingTask.js";

function normaliseTelemetry(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.telemetry)) return payload.telemetry;
  if (Array.isArray(payload?.devices)) return payload.devices;
  return [];
}

export function useTelemetry({ refreshInterval = 5_000, maxConsecutiveErrors = 3, enabled = true } = {}) {
  const { t } = useTranslation();
  const [telemetry, setTelemetry] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const initialLoadRef = useRef(true);
  const abortRef = useRef(null);

  const fetchTelemetry = useCallback(
    async (options = {}) => {
      if (!enabled || !mountedRef.current) return;
      const showLoading = options.withLoading || initialLoadRef.current;
      if (showLoading) setLoading(true);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const { data: payload, error: requestError } = await safeApi.get(API_ROUTES.core.telemetry, {
          signal: controller.signal,
        });
        if (!mountedRef.current || controller.signal?.aborted) return;
        if (requestError) {
          if (safeApi.isAbortError(requestError)) return;
          const friendly = requestError?.response?.data?.message || requestError.message || t("monitoring.loadErrorTitle");
          const normalised = new Error(friendly);
          setError(normalised);
          throw normalised;
        }
        const items = normaliseTelemetry(payload);
        setTelemetry(Array.isArray(items) ? items : []);
        setError(null);
      } finally {
        if (mountedRef.current && showLoading && abortRef.current === controller) {
          setLoading(false);
        }
        initialLoadRef.current = false;
      }
    },
    [enabled, t],
  );

  usePollingTask(fetchTelemetry, {
    enabled,
    intervalMs: refreshInterval,
    maxConsecutiveErrors,
    backoffFactor: 2,
    maxIntervalMs: 60_000,
    onPermanentFailure: (err) => {
      if (!err || !mountedRef.current) return;
      console.warn("Falhas consecutivas ao atualizar telemetria", err);
    },
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      abortRef.current?.abort();
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    void fetchTelemetry({ withLoading: true });
  }, [fetchTelemetry]);

  const stats = useMemo(() => {
    const total = Array.isArray(telemetry) ? telemetry.length : 0;
    const withPosition = Array.isArray(telemetry)
      ? telemetry.filter((item) => item?.position).length
      : 0;
    return { total, withPosition };
  }, [telemetry]);

  const liveStatus = useMemo(
    () => ({
      connected: false,
      fallback: true,
      fallbackMessage: t(
        "monitoring.liveFallback",
        { defaultValue: "Conexão em tempo real indisponível. Atualizando a cada 5 segundos." },
      ),
    }),
    [t],
  );

  const data = Array.isArray(telemetry) ? telemetry : [];
  return { telemetry: data, data, loading, error, reload, stats, liveStatus };
}

export default useTelemetry;
