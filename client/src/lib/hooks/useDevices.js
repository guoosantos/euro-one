import { useMemo } from "react";
import { useDevicesContext } from "../../contexts/DevicesContext.js";
import { useLivePositionsContext } from "../../contexts/LivePositionsContext.js";
import {
  normaliseDeviceList,
  normalisePositionResponse,
  pickNewestPosition,
  toDeviceKey,
} from "./useDevices.helpers.js";

export function useDevices({ withPositions = false } = {}) {
  const { devices, loading: devicesLoading, error: devicesError, refresh, liveStatus } = useDevicesContext();
  const { positions, loading: positionsLoading, error: positionsError } = useLivePositionsContext();

  const deviceIds = useMemo(
    () =>
      (Array.isArray(devices) ? devices : [])
        .map((device) => toDeviceKey(device?.deviceId ?? device?.id ?? device?.uniqueId ?? device?.unique_id))
        .filter(Boolean),
    [devices],
  );

  const positionsByDeviceId = useMemo(() => {
    if (!withPositions) return {};
    const latestByDevice = {};
    (Array.isArray(positions) ? positions : []).forEach((pos) => {
      const deviceId = toDeviceKey(pos?.deviceId ?? pos?.device_id ?? pos?.deviceID ?? pos?.deviceid);
      if (!deviceId || !deviceIds.includes(deviceId)) return;
      const time = Date.parse(pos.fixTime ?? pos.serverTime ?? pos.deviceTime ?? pos.time ?? 0);
      const current = latestByDevice[deviceId];
      if (!current || (!Number.isNaN(time) && time > current.time)) {
        latestByDevice[deviceId] = { pos, time };
      }
    });
    return Object.fromEntries(Object.entries(latestByDevice).map(([key, value]) => [key, value.pos]));
  }, [positions, deviceIds, withPositions]);

  const stats = useMemo(() => {
    const total = Array.isArray(devices) ? devices.length : 0;
    const withPosition = positionsByDeviceId ? Object.keys(positionsByDeviceId).length : 0;
    return { total, withPosition };
  }, [devices, positionsByDeviceId]);

  const data = Array.isArray(devices) ? devices : [];
  const combinedError = devicesError || (withPositions ? positionsError : null);
  const combinedLoading = Boolean(devicesLoading || (withPositions && positionsLoading));

  return { devices: data, data, positionsByDeviceId, loading: combinedLoading, error: combinedError, reload: refresh, stats, liveStatus };
}

export default useDevices;
