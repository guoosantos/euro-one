import { useEffect, useMemo, useState } from "react";
import { API } from "../api";
import { matchesTenant } from "../tenancy";

export function useLivePositions({ tenantId, deviceIds, refreshInterval = 30000, params } = {}) {
  const [state, setState] = useState({ positions: [], loading: true, error: null, fetchedAt: null });
  const [version, setVersion] = useState(0);

  const serialized = JSON.stringify({ tenantId, deviceIds, params });

  useEffect(() => {
    let active = true;
    let timer;

    const load = async () => {
      setState((prev) => ({
        ...prev,
        loading: prev.positions.length === 0,
        error: null,
      }));

      try {
        const query = { ...(params || {}) };
        if (tenantId !== undefined && tenantId !== null) {
          if (!("tenantId" in query)) query.tenantId = tenantId;
          if (!("groupId" in query)) query.groupId = tenantId;
        }
        if (Array.isArray(deviceIds) && deviceIds.length) {
          query.deviceId = deviceIds.join(",");
        }

        const response = await API.devices.lastPositions(query);
        if (!active) return;
        const data = response?.data ?? response;
        const items = Array.isArray(data)
          ? data
          : Array.isArray(data?.positions)
          ? data.positions
          : [];
        const filtered = tenantId ? items.filter((item) => matchesTenant(item, tenantId)) : items;
        setState({ positions: filtered, loading: false, error: null, fetchedAt: new Date() });
      } catch (error) {
        if (!active) return;
        setState((prev) => ({ ...prev, loading: false, error }));
      } finally {
        if (!active) return;
        timer = setTimeout(() => {
          setVersion((value) => value + 1);
        }, refreshInterval);
      }
    };

    load();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [serialized, refreshInterval, version]);

  const refresh = useMemo(
    () => () => {
      setVersion((value) => value + 1);
    },
    [],
  );

  return { ...state, refresh };
}
