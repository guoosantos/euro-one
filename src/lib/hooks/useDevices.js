import { useEffect, useMemo, useState } from "react";
import { CoreApi } from "../coreApi";
import { matchesTenant } from "../tenancy";

export function useDevices({ tenantId, autoRefreshMs } = {}) {
  const [state, setState] = useState({ devices: [], loading: true, error: null, fetchedAt: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    let timer;

    const load = async () => {
      setState((prev) => ({
        ...prev,
        loading: prev.devices.length === 0,
        error: null,
      }));

      try {
        const response = await CoreApi.listDevices();
        if (!active) return;
        const items = Array.isArray(response)
          ? response
          : Array.isArray(response?.devices)
          ? response.devices
          : [];
        const filtered = tenantId ? items.filter((item) => matchesTenant(item, tenantId)) : items;
        setState({ devices: filtered, loading: false, error: null, fetchedAt: new Date() });
      } catch (error) {
        if (!active) return;
        setState((prev) => ({ ...prev, loading: false, error }));
      } finally {
        if (!active || !autoRefreshMs) return;
        timer = setTimeout(() => {
          setVersion((value) => value + 1);
        }, autoRefreshMs);
      }
    };

    load();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [tenantId, version, autoRefreshMs]);

  const refresh = useMemo(
    () => () => {
      setVersion((value) => value + 1);
    },
    [],
  );

  return { ...state, refresh };
}
