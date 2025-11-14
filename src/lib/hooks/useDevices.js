// Resolved merge: unified hook combining main branch stability with PR telemetry improvements
// Exports a hook: useDevices()
// Returns: { devices, positionsByDeviceId, loading, error, reload, stats }

import { useState, useEffect, useCallback, useRef } from 'react';

const POSITION_ENDPOINTS = ['/core/api/positions', '/core/api/positions/last', '/core/api/lastpositions'];

function normaliseArrayPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.positions)) return payload.positions;
  return [];
}

function toDeviceKey(value) {
  if (value === null || value === undefined) return null;
  try {
    return String(value);
  } catch (error) {
    return null;
  }
}

function pickTime(position) {
  const candidates = [
    position?.serverTime,
    position?.time,
    position?.fixTime,
    position?.server_time,
    position?.fixtime,
  ];

  for (const value of candidates) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function mapPositions(rawPositions) {
  if (!Array.isArray(rawPositions) || rawPositions.length === 0) {
    return {};
  }

  const byDevice = {};

  for (const position of rawPositions) {
    const key =
      toDeviceKey(position?.deviceId) ??
      toDeviceKey(position?.device_id) ??
      toDeviceKey(position?.idDevice) ??
      toDeviceKey(position?.device);

    if (!key) continue;

    const current = byDevice[key];
    const incomingTime = pickTime(position);

    if (!current || (current.__timeValue ?? 0) < incomingTime) {
      byDevice[key] = { ...position, __timeValue: incomingTime };
    }
  }

  for (const key of Object.keys(byDevice)) {
    delete byDevice[key].__timeValue;
  }

  return byDevice;
}

function parseDevices(payload) {
  const list = normaliseArrayPayload(payload);
  return Array.isArray(list) ? list : [];
}

function ensureError(value) {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  return new Error('Falha ao carregar dispositivos');
}

function useDevices(options = {}) {
  const { tenantId } = options ?? {};

  const [devices, setDevices] = useState([]);
  const [positionsByDeviceId, setPositionsByDeviceId] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const mounted = useRef(true);

  const reload = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

    async function fetchAll() {
      setLoading(true);
      setError(null);

      const headers = {
        'Content-Type': 'application/json',
        ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
      };

      try {
        const devicesResponse = await fetch('/core/api/devices', {
          headers,
          credentials: 'same-origin',
          signal: controller?.signal,
        });

        if (!devicesResponse.ok) {
          throw new Error(`${devicesResponse.status} ${devicesResponse.statusText}`);
        }

        const devicesPayload = await devicesResponse.json();
        const normalisedDevices = parseDevices(devicesPayload);

        let positions = [];
        for (const endpoint of POSITION_ENDPOINTS) {
          try {
            const response = await fetch(endpoint, {
              headers,
              credentials: 'same-origin',
              signal: controller?.signal,
            });

            if (!response.ok) continue;

            const payload = await response.json();
            positions = normaliseArrayPayload(payload);

            if (positions.length > 0 || Array.isArray(payload)) {
              break;
            }
          } catch (positionError) {
            if (positionError?.name === 'AbortError') {
              throw positionError;
            }
            // try the next endpoint
          }
        }

        if (!active || !mounted.current) return;

        setDevices(normalisedDevices);
        setPositionsByDeviceId(mapPositions(positions));
      } catch (requestError) {
        if (!active || !mounted.current) return;

        if (requestError?.name === 'AbortError') {
          return;
        }

        const resolvedError = ensureError(requestError);
        const logger = requestError instanceof SyntaxError ? console.warn : console.error;
        logger('useDevices', resolvedError);
        setError(resolvedError);
        setDevices([]);
        setPositionsByDeviceId({});
      } finally {
        if (active && mounted.current) {
          setLoading(false);
        }
      }
    }

    fetchAll();

    return () => {
      active = false;
      controller?.abort();
    };
  }, [reloadKey, tenantId]);

  const stats = {
    total: Array.isArray(devices) ? devices.length : 0,
    withPosition: Object.keys(positionsByDeviceId || {}).length,
  };

  return {
    devices,
    positionsByDeviceId,
    loading,
    error,
    reload,
    stats,
  };
}

export default useDevices;
export { useDevices };
