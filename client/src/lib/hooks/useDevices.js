import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTranslation } from "../i18n.js";
import { useSharedPollingResource } from "./useSharedPollingResource.js";

function toDeviceKey(value) {
  if (value === null || value === undefined) return null;
  try {
    return String(value);
  } catch (error) {
    return null;
  }
}

export function normaliseDeviceList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.devices)) return payload.devices;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export function pickNewestPosition(positions) {
  if (!Array.isArray(positions) || positions.length === 0) return null;
  return positions.reduce((latest, current) => {
    const latestTime = latest ? Date.parse(latest.fixTime ?? latest.serverTime ?? latest.time ?? 0) : 0;
    const currentTime = Date.parse(current.fixTime ?? current.serverTime ?? current.time ?? 0);
    if (Number.isNaN(currentTime)) {
      return latest;
    }
    if (!latest || currentTime > latestTime) {
      return current;
    }
    return latest;
  }, null);
}

export function normalisePositionResponse(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.positions)) return payload.positions;
  if (payload?.data && Array.isArray(payload.data)) return payload.data;
  return payload ? [payload] : [];
}

export function useDevices({
  withPositions = false,
  refreshInterval = 15_000,
  maxConsecutiveErrors = 3,
  pauseWhenHidden = true,
} = {}) {
  const { t } = useTranslation();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const devicesRef = useRef([]);
  const devicesAbortRef = useRef(null);
  const mountedRef = useRef(true);

  const reload = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      devicesAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchDevices() {
      setLoading(true);
      setError(null);
      devicesAbortRef.current?.abort();
      const controller = new AbortController();
      devicesAbortRef.current = controller;
      try {
        const response = await api.get(API_ROUTES.core.devices, { signal: controller.signal });
        if (cancelled) return;
        const list = normaliseDeviceList(response?.data);
        const normalisedList = Array.isArray(list)
          ? list.map((device) => ({
              ...device,
              deviceId: device?.deviceId ?? device?.traccarId ?? device?.id ?? device?.uniqueId ?? null,
            }))
          : [];
        setDevices(normalisedList);
        devicesRef.current = normalisedList;
      } catch (requestError) {
        if (cancelled) return;
        if (controller.signal?.aborted) return;
        console.error("Failed to load devices", requestError);
        setError(requestError instanceof Error ? requestError : new Error("Erro ao carregar dispositivos"));
      } finally {
        if (!cancelled && devicesAbortRef.current === controller) {
          setLoading(false);
        }
      }
    }

    void fetchDevices();

    return () => {
      cancelled = true;
      devicesAbortRef.current?.abort();
    };
  }, [reloadKey]);

  const deviceIds = useMemo(
    () =>
      (Array.isArray(devices) ? devices : [])
        .map((device) => toDeviceKey(device?.deviceId ?? device?.id ?? device?.uniqueId ?? device?.unique_id))
        .filter(Boolean),
    [devices],
  );

  const positionsKey = useMemo(() => {
    const idsKey = [...deviceIds].sort().join(",");
    return `last-positions:devices:${idsKey || "none"}`;
  }, [deviceIds]);

  const {
    data: positionsList = [],
    loading: positionsLoading,
    error: positionsError,
  } = useSharedPollingResource(
    positionsKey,
    useCallback(
      async ({ signal }) => {
        if (!withPositions || !deviceIds.length) return [];
        try {
          const response = await api.get(API_ROUTES.lastPositions, {
            params: { deviceId: deviceIds },
            signal,
          });

          return normalisePositionResponse(response?.data);
        } catch (requestError) {
          const friendly =
            requestError?.response?.data?.message ||
            requestError?.message ||
            t("errors.loadPositions") ||
            "Erro ao carregar posições";
          throw new Error(friendly);
        }
      },
      [deviceIds, t, withPositions],
    ),
    {
      enabled: withPositions && deviceIds.length > 0,
      intervalMs: refreshInterval,
      pauseWhenHidden,
      maxConsecutiveErrors,
      backoffFactor: 2,
      maxIntervalMs: 90_000,
      initialData: [],
    },
  );

  const positionsByDeviceId = useMemo(() => {
    const latestByDevice = {};
    positionsList.forEach((pos) => {
      const deviceId = toDeviceKey(pos?.deviceId ?? pos?.device_id ?? pos?.deviceID ?? pos?.deviceid);
      if (!deviceId) return;
      const time = Date.parse(pos.fixTime ?? pos.serverTime ?? pos.deviceTime ?? pos.time ?? 0);
      const current = latestByDevice[deviceId];
      if (!current || (!Number.isNaN(time) && time > current.time)) {
        latestByDevice[deviceId] = { pos, time };
      }
    });
    return Object.fromEntries(Object.entries(latestByDevice).map(([key, value]) => [key, value.pos]));
  }, [positionsList]);

  const stats = useMemo(() => {
    const total = Array.isArray(devices) ? devices.length : 0;
    const withPosition = positionsByDeviceId ? Object.keys(positionsByDeviceId).length : 0;
    return { total, withPosition };
  }, [devices, positionsByDeviceId]);

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

  const data = Array.isArray(devices) ? devices : [];
  const combinedError = error || positionsError;
  const combinedLoading = loading || (withPositions && positionsLoading);

  return { devices: data, data, positionsByDeviceId, loading: combinedLoading, error: combinedError, reload, stats, liveStatus };
}

export default useDevices;
