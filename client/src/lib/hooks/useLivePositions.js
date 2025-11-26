import { useMemo } from "react";
import { useLivePositionsContext } from "../../contexts/LivePositionsContext.js";

function dedupeByDevice(positions = []) {
  const latestByDevice = new Map();
  positions.forEach((pos) => {
    const deviceId = pos?.deviceId ?? pos?.device_id ?? pos?.deviceid ?? pos?.deviceID;
    const key = deviceId != null ? String(deviceId) : null;
    if (!key) return;
    const time = Date.parse(pos.fixTime ?? pos.serverTime ?? pos.deviceTime ?? pos.time ?? 0);
    const current = latestByDevice.get(key);
    if (!current || (!Number.isNaN(time) && time > current.time)) {
      latestByDevice.set(key, { pos, time });
    }
  });
  return Array.from(latestByDevice.values())
    .map((entry) => entry.pos)
    .filter(Boolean);
}

export function useLivePositions({ deviceIds, enabled = true } = {}) {
  const { positions = [], loading, error, refresh, fetchedAt } = useLivePositionsContext();

  const ids = useMemo(() => {
    if (!deviceIds) return [];
    if (Array.isArray(deviceIds)) return deviceIds;
    return [deviceIds];
  }, [deviceIds]);

  const filteredPositions = useMemo(() => {
    const source = Array.isArray(positions) ? positions : [];
    if (!enabled) return [];
    if (!ids.length) return dedupeByDevice(source);
    const idSet = new Set(ids.map((value) => String(value)));
    return dedupeByDevice(source.filter((pos) => idSet.has(String(pos?.deviceId ?? pos?.device_id))));
  }, [positions, ids, enabled]);

  return {
    data: filteredPositions,
    positions: filteredPositions,
    loading: loading && enabled,
    error,
    refresh,
    fetchedAt,
  };
}

export default useLivePositions;
