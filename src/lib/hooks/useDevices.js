// Resolved merge: unified hook combining main branch stability with PR telemetry improvements
// Exports a hook: useDevices()
// Returns: { devices, positionsByDeviceId, loading, error, reload, stats }

import { useState, useEffect, useCallback, useRef } from 'react';

function safeJson(res) {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export default function useDevices() {
  const [devices, setDevices] = useState([]);
  const [positionsByDeviceId, setPositionsByDeviceId] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const mounted = useRef(true);

  const reload = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let abort = false;
    async function fetchAll() {
      setLoading(true);
      setError(null);

      try {
        // Fetch devices
        const devicesResp = await fetch('/core/api/devices', {
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
        });
        const devicesData = await safeJson(devicesResp);

        // Try to fetch last positions. The backend sometimes exposes /positions or /positions/last
        // Try endpoints in order of likelihood.
        let positionsData = [];
        const attempts = ['/core/api/positions', '/core/api/positions/last', '/core/api/lastpositions'];
        for (const ep of attempts) {
          try {
            const resp = await fetch(ep, {
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
            });
            if (!resp.ok) {
              // try next
              continue;
            }
            const json = await resp.json();
            // Some endpoints return { data: [...] } others return array directly
            if (Array.isArray(json)) positionsData = json;
            else if (Array.isArray(json.data)) positionsData = json.data;
            else if (json && typeof json === 'object' && Array.isArray(json.positions)) positionsData = json.positions;
            else positionsData = [];
            break;
          } catch (err) {
            // ignore and try next
            continue;
          }
        }

        // Map positions by deviceId (choose the latest by timestamp if multiple)
        const map = {};
        for (const p of positionsData) {
          // Accept common keys: deviceId, device_id, idDevice
          const deviceId = p.deviceId ?? p.device_id ?? p.idDevice ?? p.device;
          if (!deviceId) continue;

          // pick a numeric timestamp for comparison
          const timeVal =
            (p.serverTime && Date.parse(p.serverTime)) ||
            (p.time && Date.parse(p.time)) ||
            (p.fixTime && Date.parse(p.fixTime)) ||
            (p.server_time && Date.parse(p.server_time)) ||
            (p.fixtime && Date.parse(p.fixtime)) ||
            0;

          if (!map[deviceId] || (map[deviceId].__timeVal || 0) < timeVal) {
            // keep original position object but attach a helper
            map[deviceId] = { ...p, __timeVal: timeVal };
          }
        }

        // Clean helper keys before exposing
        for (const k of Object.keys(map)) {
          delete map[k].__timeVal;
        }

        if (!abort && mounted.current) {
          setDevices(Array.isArray(devicesData) ? devicesData : devicesData.data ?? []);
          setPositionsByDeviceId(map);

          setLoading(false);
          setError(null);
        }
      } catch (err) {
        if (!abort && mounted.current) {
          setError(err);
          setLoading(false);
        }
      }
    }

    fetchAll();

    return () => {
      abort = true;
    };
  }, [reloadKey]);

  // Derive stats: total devices and devices with position
  const stats = {
    total: devices ? devices.length : 0,
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
