import { useCallback, useMemo } from "react";

import { useLivePositions } from "./useLivePositions.js";
import { toDeviceKey } from "./useDevices.helpers.js";

function getPositionDeviceKey(position) {
  const candidates = [
    position?.deviceId,
    position?.device_id,
    position?.deviceID,
    position?.deviceid,
    position?.id,
    position?.uniqueId,
  ];
  for (const candidate of candidates) {
    const key = toDeviceKey(candidate);
    if (key) return key;
  }
  return null;
}

function getTargetDeviceKey(target) {
  const candidates = [
    target?.deviceId,
    target?.device?.deviceId,
    target?.device?.traccarId,
    target?.device?.id,
    target?.device?.uniqueId,
    target?.device_id,
    target?.traccarId,
    target?.uniqueId,
    target?.id,
  ];
  for (const candidate of candidates) {
    const key = toDeviceKey(candidate);
    if (key) return key;
  }
  return null;
}

export function useTraccarDevices({ deviceIds, enabled = true } = {}) {
  const trackedIds = useMemo(() => {
    if (!deviceIds) return undefined;
    const values = Array.isArray(deviceIds) ? deviceIds : [deviceIds];
    const mapped = values.map((value) => toDeviceKey(value)).filter(Boolean);
    return mapped.length ? mapped : undefined;
  }, [deviceIds]);

  const { positions, loading, error, refresh, fetchedAt } = useLivePositions({ deviceIds: trackedIds, enabled });

  const latestPositionByDevice = useMemo(() => {
    const map = new Map();
    (Array.isArray(positions) ? positions : []).forEach((position) => {
      const key = getPositionDeviceKey(position);
      if (!key) return;
      const time = Date.parse(position.fixTime ?? position.deviceTime ?? position.serverTime ?? position.time ?? 0);
      const existing = map.get(key);
      if (!existing || (!Number.isNaN(time) && time > existing.time)) {
        map.set(key, { ...position, parsedTime: time });
      }
    });
    return map;
  }, [positions]);

  const getDevicePosition = useCallback(
    (target) => {
      const key = getTargetDeviceKey(target);
      if (!key) return null;
      return latestPositionByDevice.get(key) || null;
    },
    [latestPositionByDevice],
  );

  const ensurePosition = useCallback(
    (targetOrPosition) => {
      if (!targetOrPosition) return null;
      if (
        typeof targetOrPosition === "object" &&
        ("latitude" in targetOrPosition || "lat" in targetOrPosition || "longitude" in targetOrPosition || "lon" in targetOrPosition)
      ) {
        return targetOrPosition;
      }
      return getDevicePosition(targetOrPosition);
    },
    [getDevicePosition],
  );

  const getDeviceStatus = useCallback(
    (target, positionOverride) => {
      const position = ensurePosition(positionOverride || target);
      if (position?.parsedTime) {
        const isOnline = Date.now() - position.parsedTime < 5 * 60 * 1000;
        return isOnline ? "Online" : "Offline";
      }
      return (
        target?.connectionStatusLabel ||
        target?.device?.connectionStatusLabel ||
        target?.status ||
        target?.device?.status ||
        "—"
      );
    },
    [ensurePosition],
  );

  const getDeviceLastSeen = useCallback(
    (target, positionOverride) => {
      const position = ensurePosition(positionOverride || target);
      const timestamp =
        position?.parsedTime ||
        Date.parse(
          target?.lastCommunication ||
            target?.device?.lastCommunication ||
            target?.serverTime ||
            target?.device?.serverTime ||
            0,
        );
      if (!timestamp || Number.isNaN(timestamp)) return "—";
      return new Date(timestamp).toLocaleString();
    },
    [ensurePosition],
  );

  const getDeviceCoordinates = useCallback(
    (target, positionOverride) => {
      const position = ensurePosition(positionOverride || target);
      const lat = Number(position?.latitude ?? position?.lat);
      const lon = Number(position?.longitude ?? position?.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      }
      return "—";
    },
    [ensurePosition],
  );

  return {
    positions,
    latestPositionByDevice,
    getDevicePosition,
    getDeviceStatus,
    getDeviceLastSeen,
    getDeviceCoordinates,
    loading,
    error,
    refresh,
    fetchedAt,
  };
}

export default useTraccarDevices;
