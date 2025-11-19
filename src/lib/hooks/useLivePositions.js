import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTenant } from "../tenant-context.jsx";

function normalise(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.positions)) return payload.positions;
  if (Array.isArray(payload?.data)) return payload.data;
  return payload ? [payload] : [];
}

export function useLivePositions({ deviceIds, refreshInterval = 30_000 } = {}) {
  const { tenantId } = useTenant();
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
        const requests = targets.map((deviceId) => {
          const params = deviceId ? { deviceId } : {};
          if (tenantId) params.clientId = tenantId;
          return api
            .get(API_ROUTES.lastPositions, { params: Object.keys(params).length ? params : undefined })
            .then((response) => normalise(response?.data))
            .catch((requestError) => {
              console.warn("Failed to load live position", deviceId, requestError);
              return [];
            });
        });
        const results = await Promise.all(requests);
        if (cancelled) return;
        const merged = [].concat(...results).filter(Boolean);
        setPositions(merged);
        setFetchedAt(new Date());
      } catch (requestError) {
        if (cancelled) return;
        const friendly = requestError?.response?.data?.message || requestError.message || "Erro ao carregar posições";
        setError(new Error(friendly));
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
  }, [ids, refreshInterval, version, tenantId]);

  const refresh = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  return { positions, loading, error, refresh, fetchedAt };
}

export default useLivePositions;
