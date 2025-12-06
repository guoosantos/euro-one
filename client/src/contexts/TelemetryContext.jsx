import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { useTranslation } from "../lib/i18n.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { usePolling } from "../lib/hooks/usePolling.js";
import { getApiBaseUrl } from "../lib/api.js";

function normaliseTelemetry(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data?.telemetry)) return payload.data.telemetry;
  if (Array.isArray(payload?.telemetry)) return payload.telemetry;
  if (Array.isArray(payload?.devices)) return payload.devices;
  return [];
}

function buildTelemetryFromPositions(rawPositions = []) {
  return (rawPositions || [])
    .map((raw) => {
      const source = raw?.position || raw;
      if (!source) return null;

      const deviceId =
        source.deviceId ?? source.deviceid ?? raw?.deviceId ?? raw?.deviceid ?? raw?.device?.id ?? null;
      const timestamp =
        source.timestamp || source.serverTime || source.deviceTime || source.fixTime || source.fixtime || null;

      const position = {
        ...source,
        deviceId: deviceId != null ? String(deviceId) : null,
        timestamp: timestamp || null,
      };

      if (!position.deviceId) return null;

      const device = {
        id: position.deviceId,
        name: raw?.device?.name ?? raw?.deviceName ?? null,
        uniqueId: raw?.device?.uniqueId ?? raw?.uniqueId ?? null,
        status: raw?.device?.status ?? "unknown",
        lastUpdate: raw?.device?.lastUpdate ?? position.timestamp ?? null,
      };

      return { device, position, lastEvent: raw?.lastEvent ?? null };
    })
    .filter(Boolean);
}

const TelemetryContext = createContext({
  data: [],
  telemetry: [],
  warnings: [],
  loading: false,
  error: null,
  liveStatus: { mode: "websocket", connected: false },
  refresh: () => {},
});

function buildWebSocketUrl(path = "/ws/live") {
  try {
    const base = new URL(getApiBaseUrl());
    const wsUrl = new URL(path, base);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    return wsUrl.toString();
  } catch (error) {
    console.warn("Falha ao construir URL do WebSocket", error);
    return null;
  }
}

export function TelemetryProvider({ children, interval = 5_000 }) {
  const { t } = useTranslation();
  const { tenantId, isAuthenticated } = useTenant();

  const params = useMemo(() => (tenantId ? { clientId: tenantId } : undefined), [tenantId]);

  const [telemetry, setTelemetry] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(Boolean(isAuthenticated));
  const [error, setError] = useState(null);
  const [liveStatus, setLiveStatus] = useState({ mode: "websocket", connected: false });

  const socketRef = useRef(null);
  const socketFallbackTimerRef = useRef(null);

  const fetchTelemetry = useCallback(async () => {
    const { data: payload, error: requestError } = await safeApi.get(API_ROUTES.core.telemetry, { params });
    const payloadError = payload?.error;
    if (requestError || payloadError) {
      const baseError = requestError || new Error(payloadError?.message || t("monitoring.loadErrorTitle"));
      const status = Number(baseError?.response?.status ?? baseError?.status ?? payloadError?.status);
      const friendly =
        payloadError?.message || baseError?.response?.data?.message || baseError.message || t("monitoring.loadErrorTitle");
      const normalised = new Error(friendly);
      if (Number.isFinite(status)) {
        normalised.status = status;
        if (status >= 400 && status < 500) normalised.permanent = true;
      }
      if (baseError?.permanent) normalised.permanent = true;
      throw normalised;
    }

    const normalisedTelemetry = normaliseTelemetry(payload);
    const resolvedWarnings = Array.isArray(payload?.data?.warnings)
      ? payload.data.warnings
      : Array.isArray(payload?.warnings)
      ? payload.warnings
      : [];

    return { telemetry: normalisedTelemetry, warnings: resolvedWarnings };
  }, [params, t]);

  const {
    data: pollingData,
    loading: pollingLoading,
    error: pollingError,
    lastUpdated,
    refresh,
  } = usePolling({
    fetchFn: fetchTelemetry,
    intervalMs: interval,
    enabled: isAuthenticated && liveStatus.mode === "polling",
  });

  useEffect(() => {
    if (liveStatus.mode !== "polling" || !pollingData) return;
    setTelemetry(Array.isArray(pollingData?.telemetry) ? pollingData.telemetry : []);
    setWarnings(Array.isArray(pollingData?.warnings) ? pollingData.warnings : []);
    setError(null);
    setLoading(Boolean(pollingLoading));
  }, [liveStatus.mode, pollingData, pollingLoading]);

  useEffect(() => {
    if (liveStatus.mode !== "polling") return;
    if (pollingError) {
      setError(pollingError);
    }
  }, [liveStatus.mode, pollingError]);

  useEffect(() => {
    if (!isAuthenticated) {
      setTelemetry([]);
      setWarnings([]);
      setLoading(false);
      setError(null);
      setLiveStatus({ mode: "websocket", connected: false });
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      return undefined;
    }

    const wsUrl = buildWebSocketUrl("/ws/live");
    if (!wsUrl) {
      setLiveStatus({ mode: "polling", connected: false });
      setLoading(true);
      return undefined;
    }

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;
    setLiveStatus({ mode: "websocket", connected: false });
    setLoading(true);

    if (socketFallbackTimerRef.current) {
      clearTimeout(socketFallbackTimerRef.current);
    }
    socketFallbackTimerRef.current = setTimeout(() => {
      if (socketRef.current === socket && socket.readyState !== WebSocket.OPEN) {
        try {
          socket.close();
        } catch (closeError) {
          console.warn("Falha ao fechar WebSocket após timeout", closeError);
        }
        setLiveStatus({ mode: "polling", connected: false });
        setLoading(true);
      }
    }, 8_000);

    socket.onopen = () => {
      setLiveStatus({ mode: "websocket", connected: true });
      setLoading(true);
      if (socketFallbackTimerRef.current) {
        clearTimeout(socketFallbackTimerRef.current);
      }
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data || "{}");
        if (message?.type === "positions" && message?.data) {
          const liveTelemetry = normaliseTelemetry(message.data);
          const resolvedTelemetry = liveTelemetry.length
            ? liveTelemetry
            : buildTelemetryFromPositions(message.data);
          setTelemetry(Array.isArray(resolvedTelemetry) ? resolvedTelemetry : []);
          setWarnings([]);
          setError(null);
          setLoading(false);
        } else if (message?.type === "error") {
          const liveError = new Error(message?.data?.message || t("monitoring.loadErrorTitle"));
          setError(liveError);
          setLiveStatus({ mode: "polling", connected: false });
          setLoading(true);
        }
      } catch (parseError) {
        console.warn("Falha ao processar mensagem de telemetria", parseError);
      }
    };

    const fallbackToPolling = (reason) => {
      if (socketRef.current === socket) {
        setLiveStatus({ mode: "polling", connected: false });
        setLoading(true);
        if (reason instanceof Error) {
          setError(reason);
        }
      }
    };

    socket.onerror = (event) => {
      const liveError = new Error(t("monitoring.loadErrorTitle"));
      fallbackToPolling(liveError);
    };

    socket.onclose = () => {
      fallbackToPolling();
    };

    return () => {
      if (socketFallbackTimerRef.current) {
        clearTimeout(socketFallbackTimerRef.current);
      }
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      try {
        socket.close();
      } catch (_closeError) {
        // ignore
      }
    };
  }, [isAuthenticated, params, t]);

  const value = useMemo(
    () => ({
      data: Array.isArray(telemetry) ? telemetry : [],
      telemetry: Array.isArray(telemetry) ? telemetry : [],
      warnings: Array.isArray(warnings) ? warnings : [],
      loading: Boolean(loading || (liveStatus.mode === "polling" && pollingLoading)),
      error,
      refresh,
      fetchedAt: lastUpdated,
      liveStatus,
    }),
    [telemetry, warnings, loading, liveStatus, pollingLoading, error, refresh, lastUpdated],
  );

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
}

export function useTelemetryContext() {
  return useContext(TelemetryContext);
}

export default TelemetryContext;
