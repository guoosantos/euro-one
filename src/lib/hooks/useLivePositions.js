import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api";

function normalise(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.positions)) return payload.positions;
  if (Array.isArray(payload?.data)) return payload.data;
  return payload ? [payload] : [];
}

export function useLivePositions({ deviceIds, refreshInterval = 30_000 } = {}) {
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const [fetchedAt, setFetchedAt] = useState(null);

  const ids = useMemo(() => {
    if (!deviceIds) return [];
    if (Array.isArray(deviceIds)) return deviceIds;
    return [deviceIds];
  }, [deviceIds]);

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function fetchPositions() {
      setLoading(true);
      setError(null);
      try {
        const targets = ids.length ? ids : [null];
        const requests = targets.map((deviceId) =>
          api
            .get("/positions/last", { params: deviceId ? { deviceId } : undefined })
            .then((response) => normalise(response?.data))
            .catch((requestError) => {
              console.warn("Failed to load live position", deviceId, requestError);
              return [];
            }),
        );
        const results = await Promise.all(requests);
        if (cancelled) return;
        const merged = [].concat(...results).filter(Boolean);
        setPositions(merged);
        setFetchedAt(new Date());
      } catch (requestError) {
        if (cancelled) return;
        setError(requestError);
        setPositions([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (refreshInterval) {
            timer = setTimeout(fetchPositions, refreshInterval);
          }
        }
      }
    }

    fetchPositions();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [ids, refreshInterval, version]);

  const refresh = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  return { positions, loading, error, refresh, fetchedAt };
}

export default useLivePositions;
