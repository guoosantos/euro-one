import { useCallback, useMemo } from "react";

import safeApi from "../safe-api.js";
import { API_ROUTES } from "../api-routes.js";
import usePolling from "./usePolling.js";
import { toDeviceKey } from "./useDevices.helpers.js";

function normaliseDeviceList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.devices)) return payload.devices;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export function useTraccarDevices({ enabled = true, intervalMs = 15_000, deviceIds = [] } = {}) {
  const normalizedDeviceIds = useMemo(
    () => (Array.isArray(deviceIds) ? deviceIds : [deviceIds]).map((value) => toDeviceKey(value)).filter(Boolean),
    [deviceIds],
  );

  const { data, loading, error, lastUpdated, refresh } = usePolling(async () => {
    const params = { all: true };
    if (normalizedDeviceIds.length) {
      params.deviceIds = normalizedDeviceIds.join(",");
    }

    const { data: payload, error: requestError } = await safeApi.get(API_ROUTES.devices, { params });
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

  const resolveDevice = useCallback(
    (vehicleOrDevice) => {
      const key = toDeviceKey(
        vehicleOrDevice?.device?.traccarId ??
          vehicleOrDevice?.device?.id ??
          vehicleOrDevice?.deviceId ??
          vehicleOrDevice?.device?.uniqueId ??
          vehicleOrDevice?.device?.unique_id ??
          vehicleOrDevice?.device_id,
      );

      if (!key) return null;
      return byId.get(key) || byUniqueId.get(key) || vehicleOrDevice?.device || null;
    },
    [byId, byUniqueId],
  );

  const getDevicePosition = useCallback(
    (vehicleOrDevice) => {
      const device = resolveDevice(vehicleOrDevice) || vehicleOrDevice;
      return device?.lastPosition || device?.position || null;
    },
    [resolveDevice],
  );

  const getDeviceStatus = useCallback(
    (vehicleOrDevice, position) => {
      const device = resolveDevice(vehicleOrDevice) || vehicleOrDevice;
      if (device?.status) return device.status;
      const timestamp = position?.serverTime || position?.deviceTime || position?.fixTime || device?.lastUpdate;
      if (!timestamp) return "Offline";
      const diffMs = Date.now() - new Date(timestamp).getTime();
      if (!Number.isFinite(diffMs)) return "Offline";
      if (diffMs <= 5 * 60 * 1000) return "Online";
      if (diffMs <= 60 * 60 * 1000) return "Ocioso";
      return "Offline";
    },
    [resolveDevice],
  );

  const getDeviceLastSeen = useCallback(
    (vehicleOrDevice, position) => {
      const device = resolveDevice(vehicleOrDevice) || vehicleOrDevice;
      const timestamp = position?.serverTime || position?.deviceTime || position?.fixTime || device?.lastUpdate;
      if (!timestamp) return "Sem comunicação";
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) return "Sem comunicação";
      return date.toLocaleString();
    },
    [resolveDevice],
  );

  const getDeviceCoordinates = useCallback(
    (vehicleOrDevice, position) => {
      const pos = position || getDevicePosition(vehicleOrDevice);
      const lat = pos?.latitude ?? pos?.lat;
      const lon = pos?.longitude ?? pos?.lon;
      if (lat === undefined || lon === undefined || lat === null || lon === null) return "Sem posição";
      return `${lat}, ${lon}`;
    },
    [getDevicePosition],
  );

  return {
    devices: Array.isArray(data) ? data : [],
    byId,
    byUniqueId,
    loading,
    error,
    lastUpdated,
    refresh,
    getDevicePosition,
    getDeviceStatus,
    getDeviceLastSeen,
    getDeviceCoordinates,
  };
}

export default useTraccarDevices;
