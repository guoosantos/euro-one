
import { useMemo } from "react";

import safeApi from "../safe-api.js";
import { API_ROUTES } from "../api-routes.js";
import usePolling from "./usePolling.js";

function normaliseDeviceList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.devices)) return payload.devices;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export function useTraccarDevices({ enabled = true, intervalMs = 15_000 } = {}) {
  const { data, loading, error, lastUpdated, refresh } = usePolling(async () => {
    const { data: payload, error: requestError } = await safeApi.get(API_ROUTES.devices, { params: { all: true } });
    if (requestError) throw requestError;
    return normaliseDeviceList(payload);
  }, { enabled, intervalMs });

  const byId = useMemo(() => {
    const map = new Map();
    (Array.isArray(data) ? data : []).forEach((device) => {
      if (device?.id !== undefined && device?.id !== null) {
        map.set(String(device.id), device);
      }
    });
    return map;
  }, [data]);

  const byUniqueId = useMemo(() => {
    const map = new Map();
    (Array.isArray(data) ? data : []).forEach((device) => {
      if (device?.uniqueId) {
        map.set(String(device.uniqueId), device);
      }
    });
    return map;
  }, [data]);

  return {
    devices: Array.isArray(data) ? data : [],
    byId,
    byUniqueId,
    loading,
    error,
    lastUpdated,
    refresh,

  };
}

export default useTraccarDevices;
