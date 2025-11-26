import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTranslation } from "../i18n.js";

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
  const pollingTimerRef = useRef(null);

  const reload = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const clearPollingTimer = () => {
      if (pollingTimerRef.current) {
        globalThis.clearTimeout(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };

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
        await fetchPositionsForDevices(normalisedList);
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

    async function fetchPositionsForDevices(deviceList = devicesRef.current) {
      if (!Array.isArray(deviceList) || deviceList.length === 0) {
        setPositionsByDeviceId({});
        return;
      }
      positionsAbortRef.current?.abort();
      const controller = new AbortController();
      positionsAbortRef.current = controller;
      const requests = deviceList
        .map((device) => toDeviceKey(device?.deviceId ?? device?.id ?? device?.uniqueId ?? device?.unique_id))
        .filter(Boolean)
        .map((deviceId) =>
          api
            .get(API_ROUTES.lastPositions, { params: { deviceId }, signal: controller.signal })
            .then((response) => ({ deviceId, payload: response?.data }))
            .catch((requestError) => {
              console.warn("Falha ao carregar posição do dispositivo", deviceId, requestError);
              return null;
            }),
        );

      const results = await Promise.all(requests);
      if (cancelled) return;
      if (controller.signal?.aborted) return;

      const hasSuccessfulResponse = results.some(Boolean);
      if (!hasSuccessfulResponse) {
        return;
      }

      const next = {};
      results
        .filter(Boolean)
        .forEach(({ deviceId, payload }) => {
          const positions = normalisePositionResponse(payload);
          const position = pickNewestPosition(positions);
          if (position) {
            next[deviceId] = position;
          }
        });

      setPositionsByDeviceId((current) => {
        if (Object.keys(next).length === 0 && current && Object.keys(current).length > 0) {
          return current;
        }
        return next;
      });
    }

    const schedulePositionsPolling = () => {
      if (cancelled) return;
      clearPollingTimer();
      pollingTimerRef.current = globalThis.setTimeout(() => {
        void fetchPositionsForDevices();
        schedulePositionsPolling();
      }, 5_000);
    };

    void fetchDevices().then(() => {
      schedulePositionsPolling();
    });

    return () => {
      cancelled = true;
      clearPollingTimer();
      positionsAbortRef.current?.abort();
      devicesAbortRef.current?.abort();
    };
  }, [reloadKey]);

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

  return { devices, positionsByDeviceId, loading, error, reload, stats, liveStatus };
}

export default useDevices;
