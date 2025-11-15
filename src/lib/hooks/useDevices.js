import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api.js";
import useLiveUpdates from "./useLiveUpdates.js";

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
  const [devices, setDevices] = useState([]);
  const [positionsByDeviceId, setPositionsByDeviceId] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const devicesRef = useRef([]);

  const handleLiveMessage = useCallback(
    (payload) => {
      if (!payload || typeof payload !== "object") return;
      if (Array.isArray(payload.devices) && payload.devices.length) {
        setDevices((current) => {
          const map = new Map();
          (Array.isArray(current) ? current : []).forEach((device) => {
            const key = toDeviceKey(device?.id ?? device?.deviceId ?? device?.uniqueId ?? device?.unique_id);
            if (key) {
              map.set(key, device);
            }
          });
          payload.devices.forEach((device) => {
            const key = toDeviceKey(device?.id ?? device?.deviceId ?? device?.uniqueId ?? device?.unique_id);
            if (key) {
              map.set(key, device);
            }
          });
          const list = Array.from(map.values());
          devicesRef.current = list;
          return list;
        });
      }

      if (Array.isArray(payload.positions) && payload.positions.length) {
        setPositionsByDeviceId((current) => {
          const next = { ...current };
          payload.positions.forEach((position) => {
            const key = toDeviceKey(
              position?.deviceId ??
                position?.device?.id ??
                position?.device_id ??
                position?.deviceID ??
                position?.device?.deviceId ??
                position?.device?.uniqueId,
            );
            if (key) {
              next[key] = position;
            }
          });
          return next;
        });
      }
    },
    [setDevices, setPositionsByDeviceId],
  );

  const { connected: liveConnected, error: liveUpdatesError } = useLiveUpdates({ onMessage: handleLiveMessage });

  const reload = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let intervalId;

    async function fetchDevices() {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get("/devices");
        if (cancelled) return;
        const list = normaliseDeviceList(response?.data);
        setDevices(list);
        devicesRef.current = list;
        await fetchPositionsForDevices(list);
      } catch (requestError) {
        if (cancelled) return;
        console.error("Failed to load devices", requestError);
        setError(requestError instanceof Error ? requestError : new Error("Erro ao carregar dispositivos"));
        setDevices([]);
        setPositionsByDeviceId({});
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    async function fetchPositionsForDevices(deviceList = devicesRef.current) {
      if (!Array.isArray(deviceList) || deviceList.length === 0) {
        setPositionsByDeviceId({});
        return;
      }
      const requests = deviceList
        .map((device) => toDeviceKey(device?.id ?? device?.deviceId ?? device?.uniqueId ?? device?.unique_id))
        .filter(Boolean)
        .map((deviceId) =>
          api
            .get("/positions/last", { params: { deviceId } })
            .then((response) => ({ deviceId, payload: response?.data }))
            .catch((requestError) => {
              console.warn("Falha ao carregar posição do dispositivo", deviceId, requestError);
              return null;
            }),
        );

      const results = await Promise.all(requests);
      if (cancelled) return;

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

      setPositionsByDeviceId(next);
    }

    fetchDevices();
    if (!liveConnected) {
      intervalId = globalThis.setInterval(() => {
        fetchPositionsForDevices();
      }, 10_000);
    }

    return () => {
      cancelled = true;
      if (intervalId) {
        globalThis.clearInterval(intervalId);
      }
    };
  }, [reloadKey, liveConnected]);

  useEffect(() => {
    if (liveUpdatesError) {
      setError(liveUpdatesError);
    }
  }, [liveUpdatesError]);

  const stats = useMemo(() => {
    const total = Array.isArray(devices) ? devices.length : 0;
    const withPosition = positionsByDeviceId ? Object.keys(positionsByDeviceId).length : 0;
    return { total, withPosition };
  }, [devices, positionsByDeviceId]);

  return { devices, positionsByDeviceId, loading, error, reload, stats };
}

export default useDevices;
