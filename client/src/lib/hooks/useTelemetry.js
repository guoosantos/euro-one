import { useMemo } from "react";
import { useTelemetryContext } from "../../contexts/TelemetryContext.js";
import { useTranslation } from "../i18n.js";

export function useTelemetry() {
  const { telemetry, data, loading, error, refresh } = useTelemetryContext();
  const { t } = useTranslation();

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

  const resolvedData = Array.isArray(telemetry) ? telemetry : Array.isArray(data) ? data : [];
  return { telemetry: resolvedData, data: resolvedData, loading, error, reload: refresh, stats, liveStatus };
}

export default useTelemetry;
