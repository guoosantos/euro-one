function toTimestamp(value) {
  if (typeof value === "number") return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function normaliseVehicleId(source) {
  if (!source) return null;
  const candidates = [source.vehicleId, source.deviceId, source.device_id, source.id];
  const match = candidates.find((v) => v !== undefined && v !== null);
  return match !== undefined && match !== null ? String(match) : null;
}

export function classifyVehicleStates({ positions = [], tasks = [], now = Date.now() } = {}) {
  const nowTs = toTimestamp(now) ?? Date.now();
  const states = {
    enRoute: new Set(),
    collecting: new Set(),
    delivering: new Set(),
    routeDelay: new Set(),
    serviceDelay: new Set(),
  };

  positions.forEach((position) => {
    const vehicleId = normaliseVehicleId(position);
    if (!vehicleId) return;
    const speed = Number(position?.speed ?? position?.attributes?.speed ?? 0);
    const moving = !Number.isNaN(speed) && speed > 5;
    if (moving) {
      states.enRoute.add(vehicleId);
    }
  });

  tasks.forEach((task) => {
    const vehicleId = normaliseVehicleId(task);
    if (!vehicleId) return;
    const status = String(task.status || "").toLowerCase();
    const type = String(task.type || "").toLowerCase();
    const endExpected = toTimestamp(task.endTimeExpected);

    if (type === "coleta") states.collecting.add(vehicleId);
    if (type === "entrega") states.delivering.add(vehicleId);

    if (status === "atrasada") {
      states.routeDelay.add(vehicleId);
      states.serviceDelay.add(vehicleId);
    }
    if (status === "em rota" && endExpected && nowTs > endExpected) {
      states.routeDelay.add(vehicleId);
    }
    if ((status === "em atendimento" || status === "pendente") && endExpected && nowTs > endExpected) {
      states.serviceDelay.add(vehicleId);
    }
  });

  return Object.fromEntries(Object.entries(states).map(([key, value]) => [key, Array.from(value)]));
}

export default classifyVehicleStates;
