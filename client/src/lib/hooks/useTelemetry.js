import { useCallback, useMemo } from "react";
import safeApi from "../safe-api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTranslation } from "../i18n.js";
import { useSharedPollingResource } from "./useSharedPollingResource.js";

function normaliseTelemetry(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.telemetry)) return payload.telemetry;
  if (Array.isArray(payload?.devices)) return payload.devices;
  return [];
}

export function useTelemetry({ refreshInterval = 5_000, maxConsecutiveErrors = 3, enabled = true } = {}) {
  const { t } = useTranslation();

  const { data: telemetry, loading, error, refresh } = useSharedPollingResource(
    "telemetry/all",
    useCallback(
      async ({ signal }) => {
        const { data: payload, error: requestError } = await safeApi.get(API_ROUTES.core.telemetry, {
          signal,
        });
        if (requestError) {
          if (safeApi.isAbortError(requestError)) throw requestError;
          const status = Number(requestError?.response?.status);
          const friendly = requestError?.response?.data?.message || requestError.message || t("monitoring.loadErrorTitle");
          const error = new Error(friendly);
          if (Number.isFinite(status) && status >= 400 && status < 500) {
            error.permanent = true;
          }
          throw error;
        }
        const items = normaliseTelemetry(payload);
        return Array.isArray(items) ? items : [];
      },
      [t],
    ),
    {
      enabled,
      intervalMs: refreshInterval,
      maxConsecutiveErrors,
      backoffFactor: 2,
      maxIntervalMs: 60_000,
      initialData: [],
    },
  );

  const stats = useMemo(() => {
    const total = Array.isArray(telemetry) ? telemetry.length : 0;
    const withPosition = Array.isArray(telemetry) ? telemetry.filter((item) => item?.position).length : 0;
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
  return { telemetry: data, data, loading, error, reload: refresh, stats, liveStatus };
}

export default useTelemetry;
