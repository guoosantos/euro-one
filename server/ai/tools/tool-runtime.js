import { listVehicles } from "../../models/vehicle.js";
import { listDevices } from "../../models/device.js";
import { listAlerts } from "../../services/alerts.js";
import { getAccessibleVehicles } from "../../services/accessible-vehicles.js";
import {
  fetchEventsWithFallback,
  fetchLatestPositionsWithFallback,
} from "../../services/traccar-db.js";

function sanitizeString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function pickTruthy(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function inferCommunicationStatus(position) {
  const timestamp = position?.fixTime || position?.deviceTime || position?.serverTime || null;
  if (!timestamp) {
    return { status: "unknown", minutesWithoutCommunication: null };
  }
  const diffMs = Math.max(0, Date.now() - new Date(timestamp).getTime());
  const minutes = Math.round(diffMs / 60000);
  if (minutes <= 15) return { status: "online", minutesWithoutCommunication: minutes };
  if (minutes <= 60) return { status: "delayed", minutesWithoutCommunication: minutes };
  return { status: "offline", minutesWithoutCommunication: minutes };
}

function getIgnitionFromPosition(position) {
  const attributes = position?.attributes || {};
  const raw = pickTruthy(
    attributes.ignition,
    attributes.ignitionOn,
    attributes.io239,
    attributes.motion,
  );
  if (raw === true || raw === "true" || raw === 1 || raw === "1") return "on";
  if (raw === false || raw === "false" || raw === 0 || raw === "0") return "off";
  return "unknown";
}

function buildVehicleLabel(vehicle) {
  return vehicle?.name || vehicle?.plate || vehicle?.item || vehicle?.identifier || vehicle?.id || "Veiculo";
}

function resolveTimeRange({ hours = 6, from, to } = {}) {
  const now = new Date();
  const resolvedTo = to ? new Date(to) : now;
  const resolvedFrom = from ? new Date(from) : new Date(resolvedTo.getTime() - Math.max(1, Number(hours) || 6) * 3600000);
  return {
    from: resolvedFrom.toISOString(),
    to: resolvedTo.toISOString(),
  };
}

export function createToolRuntime({ req, contextSnapshot } = {}) {
  let scopePromise = null;
  let devicesCache = null;

  async function getScope() {
    if (!scopePromise) {
      scopePromise = getAccessibleVehicles({
        user: req?.user,
        clientId: req?.clientId ?? req?.user?.clientId ?? null,
        mirrorContext: req?.mirrorContext ?? null,
      });
    }
    return scopePromise;
  }

  async function getDevices() {
    if (!devicesCache) {
      const scope = await getScope();
      const clientId = scope?.clientId || req?.clientId || req?.user?.clientId || null;
      devicesCache = listDevices(clientId ? { clientId } : {});
    }
    return devicesCache;
  }

  async function resolveVehicle(input = {}) {
    const requestedVehicleId = sanitizeString(
      input.vehicleId || input.id || contextSnapshot?.entity?.entityId,
    );
    const requestedPlate = sanitizeString(
      input.plate || input.placa || contextSnapshot?.entity?.plate,
    );
    const scope = await getScope();
    const vehicles = Array.isArray(scope?.vehicles) ? scope.vehicles : listVehicles({});

    let match = null;
    if (requestedVehicleId) {
      match = vehicles.find((vehicle) => String(vehicle.id) === String(requestedVehicleId)) || null;
    }
    if (!match && requestedPlate) {
      const plateKey = requestedPlate.toLowerCase();
      match = vehicles.find((vehicle) => String(vehicle.plate || "").toLowerCase() === plateKey) || null;
    }

    if (!match) {
      return { vehicle: null, devices: [], latestPosition: null };
    }

    const devices = (await getDevices()).filter(
      (device) =>
        String(device?.vehicleId || "") === String(match.id) ||
        String(device?.id || "") === String(match.deviceId || ""),
    );
    const traccarIds = devices
      .map((device) => sanitizeString(device?.traccarId || device?.id))
      .filter(Boolean);
    const latestPositions = traccarIds.length ? await fetchLatestPositionsWithFallback(traccarIds, null) : [];
    const latestPosition = Array.isArray(latestPositions) && latestPositions.length ? latestPositions[0] : null;

    return {
      vehicle: { ...match, label: buildVehicleLabel(match) },
      devices,
      latestPosition,
    };
  }

  async function listVehicleEvents(vehicle, devices, options = {}) {
    const traccarIds = (Array.isArray(devices) ? devices : [])
      .map((device) => sanitizeString(device?.traccarId || device?.id))
      .filter(Boolean);
    if (!traccarIds.length) return [];
    const range = resolveTimeRange(options);
    return fetchEventsWithFallback(traccarIds, range.from, range.to, Number(options.limit) || 12);
  }

  function listVehicleAlerts(vehicleId, options = {}) {
    return listAlerts({
      clientId: req?.clientId || req?.user?.clientId || null,
      vehicleId: vehicleId || undefined,
      status: sanitizeString(options.status) || undefined,
      severity: sanitizeString(options.severity) || undefined,
      from: options.from || undefined,
      to: options.to || undefined,
    });
  }

  return {
    req,
    contextSnapshot,
    resolveVehicle,
    listVehicleEvents,
    listVehicleAlerts,
    inferCommunicationStatus,
    getIgnitionFromPosition,
    resolveTimeRange,
  };
}

