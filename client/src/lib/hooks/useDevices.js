import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTranslation } from "../i18n.js";
import { usePollingTask } from "./usePollingTask.js";

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

export function useDevices() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState([]);
  const [positionsByDeviceId, setPositionsByDeviceId] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const devicesRef = useRef([]);
  const positionsAbortRef = useRef(null);
  const devicesAbortRef = useRef(null);
  const mountedRef = useRef(true);

  const reload = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  const fetchPositionsForDevices = useCallback(async () => {
    const deviceList = devicesRef.current;
    if (!Array.isArray(deviceList) || deviceList.length === 0) {
      setPositionsByDeviceId({});
      return;
    }

    positionsAbortRef.current?.abort();
    const controller = new AbortController();
    positionsAbortRef.current = controller;

    const ids = deviceList
      .map((device) => toDeviceKey(device?.deviceId ?? device?.id ?? device?.uniqueId ?? device?.unique_id))
      .filter(Boolean);

    if (!ids.length) {
      setPositionsByDeviceId({});
      return;
    }

    try {
      const response = await api.get(API_ROUTES.lastPositions, {
        params: { deviceId: ids },
        signal: controller.signal,
      });

      if (!mountedRef.current || controller.signal?.aborted) return;

      const positions = normalisePositionResponse(response?.data);
      const latestByDevice = {};

      positions.forEach((pos) => {
        const deviceId = toDeviceKey(pos?.deviceId ?? pos?.device_id ?? pos?.deviceID ?? pos?.deviceid);
        if (!deviceId) return;
        const time = Date.parse(pos.fixTime ?? pos.serverTime ?? pos.deviceTime ?? pos.time ?? 0);
        const current = latestByDevice[deviceId];
        if (!current || (!Number.isNaN(time) && time > current.time)) {
          latestByDevice[deviceId] = { pos, time };
        }
      });

      const next = Object.fromEntries(Object.entries(latestByDevice).map(([key, value]) => [key, value.pos]));

      setPositionsByDeviceId((current) => {
        if (Object.keys(next).length === 0 && current && Object.keys(current).length > 0) {
          return current;
        }
        return next;
      });
      setError(null);
    } catch (requestError) {
      if (!mountedRef.current || controller.signal?.aborted) return;
      const friendly =
        requestError?.response?.data?.message ||
        requestError.message ||
        t("errors.loadPositions") ||
        "Erro ao carregar posições";
      setError(new Error(friendly));
      throw requestError;
    }
  }, [t]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      positionsAbortRef.current?.abort();
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
        await fetchPositionsForDevices();
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
      positionsAbortRef.current?.abort();
      devicesAbortRef.current?.abort();
    };
  }, [fetchPositionsForDevices, reloadKey]);

  const pollingEnabled = Array.isArray(devicesRef.current) ? devicesRef.current.length > 0 : false;

  usePollingTask(fetchPositionsForDevices, {
    enabled: pollingEnabled,
    intervalMs: 15_000,
    pauseWhenHidden: true,
    maxConsecutiveErrors: 3,
    backoffFactor: 2,
    maxIntervalMs: 90_000,
    onError: (pollError) => {
      console.warn("Posições em tempo real temporariamente indisponíveis", pollError);
    },
  });

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
  return { devices: data, data, positionsByDeviceId, loading, error, reload, stats, liveStatus };
}

export default useDevices;
