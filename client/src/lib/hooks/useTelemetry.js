import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTranslation } from "../i18n.js";

function normaliseTelemetry(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.telemetry)) return payload.telemetry;
  if (Array.isArray(payload?.devices)) return payload.devices;
  return [];
}

export function useTelemetry({ refreshInterval = 5_000, maxConsecutiveErrors = 3 } = {}) {
  const { t } = useTranslation();
  const [telemetry, setTelemetry] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const initialLoadRef = useRef(true);
  const failuresRef = useRef(0);
  const intervalRef = useRef(null);

  const fetchTelemetry = useCallback(
    async (options = {}) => {
      const showLoading = options.withLoading || initialLoadRef.current;
      if (showLoading) setLoading(true);
      try {
        const response = await api.get(API_ROUTES.core.telemetry);
        if (!mountedRef.current) return;
        const items = normaliseTelemetry(response?.data);
        setTelemetry(Array.isArray(items) ? items : []);
        setError(null);
        failuresRef.current = 0;
      } catch (requestError) {
        if (!mountedRef.current) return;
        const friendly = requestError?.response?.data?.message || requestError.message || t("monitoring.loadErrorTitle");
        setError(new Error(friendly));
        failuresRef.current += 1;
        if (failuresRef.current >= maxConsecutiveErrors) {
          console.warn("Falhas consecutivas ao atualizar telemetria", requestError);
        }
      } finally {
        if (mountedRef.current && showLoading) {
          setLoading(false);
        }
        initialLoadRef.current = false;
      }
    },
    [maxConsecutiveErrors, t],
  );

  useEffect(() => {
    mountedRef.current = true;

    fetchTelemetry({ withLoading: true });

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = globalThis.setInterval(() => {
      void fetchTelemetry({ withLoading: false });
    }, refreshInterval || 5000);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchTelemetry, refreshInterval]);

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

  return { telemetry, loading, error, reload, stats, liveStatus };
}

export default useTelemetry;
