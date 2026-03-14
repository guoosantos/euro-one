export function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function minutesSince(value) {
  const iso = toIso(value);
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

export function buildPositionIndex(positions = []) {
  const map = new Map();
  positions.forEach((position) => {
    const deviceId = position?.deviceId ?? position?.device?.id ?? null;
    if (!deviceId) return;
    const key = String(deviceId);
    const timestamp = toIso(position?.fixTime || position?.deviceTime || position?.serverTime);
    const current = map.get(key);
    if (!current) {
      map.set(key, position);
      return;
    }
    const currentTs = toIso(current?.fixTime || current?.deviceTime || current?.serverTime);
    if ((timestamp || "") > (currentTs || "")) {
      map.set(key, position);
    }
  });
  return map;
}

export function resolveVehicleDeviceIds(vehicle) {
  const candidates = [
    vehicle?.primaryDeviceId,
    vehicle?.principalDeviceId,
    vehicle?.deviceId,
    vehicle?.device?.id,
    vehicle?.device?.deviceId,
  ]
    .filter(Boolean)
    .map((item) => String(item));
  const devices = Array.isArray(vehicle?.devices) ? vehicle.devices : [];
  devices.forEach((device) => {
    const key = device?.id ?? device?.deviceId ?? null;
    if (key) candidates.push(String(key));
  });
  return Array.from(new Set(candidates));
}

export function buildAttentionRows({ vehicles = [], positionByDeviceId, alerts = [] }) {
  return vehicles
    .map((vehicle) => {
      const deviceIds = resolveVehicleDeviceIds(vehicle);
      const latestPosition = deviceIds.map((id) => positionByDeviceId.get(String(id))).find(Boolean) || null;
      const staleMinutes = minutesSince(latestPosition?.fixTime || latestPosition?.deviceTime || latestPosition?.serverTime);
      const relatedAlerts = alerts.filter((alert) => String(alert?.vehicleId || "") === String(vehicle?.id || ""));
      return {
        vehicleId: vehicle?.id || null,
        plate: vehicle?.plate || "Sem placa",
        name: vehicle?.name || vehicle?.plate || "Veiculo",
        address: latestPosition?.address || latestPosition?.fullAddress || null,
        staleMinutes,
        alertCount: relatedAlerts.length,
        critical: relatedAlerts.some((alert) => String(alert?.severity || "").toLowerCase() === "critical"),
      };
    })
    .filter((row) => row.vehicleId)
    .sort((left, right) => {
      const rightScore = (right.critical ? 100000 : 0) + (right.alertCount * 1000) + (right.staleMinutes || 0);
      const leftScore = (left.critical ? 100000 : 0) + (left.alertCount * 1000) + (left.staleMinutes || 0);
      return rightScore - leftScore;
    })
    .slice(0, 8);
}

export function buildOperationalSummary({ totalVehicles, onlineVehicles, pendingAlerts, openTasks, staleVehicles }) {
  return [
    `Veiculos monitorados: ${totalVehicles}.`,
    `Comunicando agora: ${onlineVehicles}.`,
    `Alertas pendentes: ${pendingAlerts}.`,
    `Tasks abertas: ${openTasks}.`,
    `Veiculos com comunicacao degradada: ${staleVehicles}.`,
  ].join(" ");
}

