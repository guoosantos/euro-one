import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { API } from "./api";
import { useTenant } from "./tenant-context";
import { vehicles as mockVehicles } from "../mock/fleet";

export const FLEET_STATUS_LABELS = {
  online: "Online",
  alert: "Em alerta",
  offline: "Offline",
  blocked: "Bloqueado",
};

const STATUS_PRIORITY = ["alert", "blocked", "online", "offline"];
const OFFLINE_THRESHOLD = 10 * 60 * 1000; // 10 minutos
const LIVE_THRESHOLD = 2 * 60 * 1000; // 2 minutos
const SOCKET_RETRY_MS = 5_000;

export function useFleetDevices(options = {}) {
  const { tenantId } = useTenant();
  const {
    autoRefresh = 30_000,
    listRefresh = 120_000,
    positionsRefresh = 30_000,
    includeInactive = true,
    enableRealtime = true,
    socketPath: socketPathOption,
  } = options;

  const socketPath = socketPathOption ?? import.meta.env?.VITE_CORE_SOCKET_PATH ?? "/socket";

  const livePositionsRef = useRef(new Map());
  const [liveVersion, setLiveVersion] = useState(0);
  const [lastRealtimeTs, setLastRealtimeTs] = useState(null);

  const listQuery = useQuery({
    queryKey: ["devices", tenantId, includeInactive],
    queryFn: async () => {
      const { data } = await API.devices.list({ tenantId, includeInactive });
      return data;
    },
    enabled: Boolean(tenantId),
    refetchInterval: listRefresh ?? autoRefresh,
    staleTime: listRefresh ?? autoRefresh,
    retry: false,
  });

  const positionsQuery = useQuery({
    queryKey: ["device-positions", tenantId],
    queryFn: async () => {
      const { data } = await API.devices.lastPositions({ tenantId });
      return data;
    },
    enabled: Boolean(tenantId),
    refetchInterval: positionsRefresh ?? autoRefresh,
    staleTime: positionsRefresh ?? autoRefresh,
    retry: false,
  });

  const fallbackDevices = useMemo(() => buildFromMocks(tenantId), [tenantId]);

  useEffect(() => {
    livePositionsRef.current = new Map();
    setLiveVersion((value) => value + 1);
  }, [tenantId]);

  useEffect(() => {
    if (!enableRealtime) {
      livePositionsRef.current = new Map();
      setLiveVersion((value) => value + 1);
      return undefined;
    }

    if (typeof window === "undefined" || typeof WebSocket === "undefined") {
      return undefined;
    }

    let cancelled = false;
    let retryHandle = null;
    let socket = null;

    const scheduleRetry = () => {
      if (cancelled) return;
      if (retryHandle) window.clearTimeout(retryHandle);
      retryHandle = window.setTimeout(connect, SOCKET_RETRY_MS);
    };

    const connect = () => {
      if (cancelled) return;

      const url = buildSocketUrl(socketPath);
      if (!url) {
        return;
      }

      try {
        socket = new WebSocket(url);
      } catch (error) {
        console.warn("[fleet] não foi possível abrir WebSocket", error);
        scheduleRetry();
        return;
      }

      socket.onopen = () => {
        if (tenantId) {
          try {
            socket.send(JSON.stringify({ action: "subscribe", tenantId }));
          } catch (error) {
            console.warn("[fleet] subscribe falhou", error);
          }
        }
      };

      socket.onmessage = (event) => {
        if (cancelled) return;
        const updates = parseSocketMessage(event.data);
        if (!updates.length) return;

        let changed = false;
        const map = new Map(livePositionsRef.current);

        updates.forEach((payload) => {
          const id = normalizeId(payload);
          if (!id) return;
          if (tenantId && payload?.tenantId && String(payload.tenantId) !== String(tenantId)) return;
          map.set(id, payload);
          changed = true;
        });

        if (changed) {
          livePositionsRef.current = map;
          setLiveVersion((value) => value + 1);
          setLastRealtimeTs(Date.now());
        }
      };

      socket.onerror = (error) => {
        console.warn("[fleet] erro no WebSocket", error);
        try {
          socket?.close();
        } catch (err) {
          /* noop */
        }
      };

      socket.onclose = () => {
        if (cancelled) return;
        scheduleRetry();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retryHandle) window.clearTimeout(retryHandle);
      try {
        socket?.close();
      } catch (error) {
        /* noop */
      }
    };
  }, [enableRealtime, socketPath, tenantId]);

  const normalized = useMemo(() => {
    const list = Array.isArray(listQuery.data) ? listQuery.data : [];
    const positions = Array.isArray(positionsQuery.data) ? positionsQuery.data : [];
    const livePositions = Array.from(livePositionsRef.current.values());

    if (!list.length && !positions.length && !livePositions.length) {
      return fallbackDevices;
    }

    return mergeRemote(list, positions, tenantId, livePositions);
  }, [fallbackDevices, listQuery.data, liveVersion, positionsQuery.data, tenantId]);

  const summary = useMemo(
    () =>
      normalized.reduce(
        (acc, device) => {
          acc.total += 1;
          acc[device.status] = (acc[device.status] ?? 0) + 1;
          if (device.isCommunicating) acc.live += 1;
          return acc;
        },
        { total: normalized.length, online: 0, offline: 0, alert: 0, blocked: 0, live: 0 },
      ),
    [normalized],
  );

  const lastUpdated = useMemo(() => {
    const latest = normalized.reduce((max, device) => {
      if (!device.lastUpdateTs) return max;
      return Math.max(max, device.lastUpdateTs);
    }, 0);
    return latest || null;
  }, [normalized]);

  const hasLiveStream = livePositionsRef.current.size > 0;
  const source = normalized === fallbackDevices ? "mock" : hasLiveStream ? "socket" : "realtime";

  return {
    devices: normalized,
    summary,
    lastUpdated,
    source,
    liveDevices: livePositionsRef.current.size,
    lastRealtime: lastRealtimeTs,
    isLoading: listQuery.isLoading || positionsQuery.isLoading,
    isFetching: listQuery.isFetching || positionsQuery.isFetching,
    error: listQuery.error || positionsQuery.error,
    refetch: async () => {
      await Promise.all([listQuery.refetch(), positionsQuery.refetch()]);
    },
  };
}

function mergeRemote(devices, positions, tenantId, livePositions = []) {
  const byId = new Map();

  devices.forEach((device) => {
    const id = normalizeId(device);
    if (!id) return;
    if (tenantId && device?.tenantId && String(device.tenantId) !== String(tenantId)) return;
    byId.set(id, { device });
  });

  positions.forEach((position) => {
    const id = normalizeId(position);
    if (!id) return;
    const entry = byId.get(id) ?? {};
    entry.position = position;
    byId.set(id, entry);
  });

  livePositions.forEach((livePosition) => {
    const id = normalizeId(livePosition);
    if (!id) return;
    const entry = byId.get(id) ?? {};
    entry.livePosition = livePosition;
    byId.set(id, entry);
  });

  return Array.from(byId.entries())
    .map(([id, payload]) => normaliseDevice(id, payload.device, payload.position, payload.livePosition))
    .sort((a, b) => {
      const priorityA = resolvePriority(a.status);
      const priorityB = resolvePriority(b.status);
      if (priorityA !== priorityB) return priorityA - priorityB;
      return (b.lastUpdateTs ?? 0) - (a.lastUpdateTs ?? 0);
    });
}

function buildFromMocks(tenantId) {
  return mockVehicles
    .filter((vehicle) => !tenantId || vehicle.tenantId === tenantId)
    .map((vehicle) => ({
      id: String(vehicle.id),
      name: vehicle.name,
      plate: vehicle.plate,
      status: vehicle.status,
      lastUpdate: vehicle.lastUpdate,
      lastUpdateTs: toTimestamp(vehicle.lastUpdate),
      lat: vehicle.lat,
      lng: vehicle.lng,
      speed: vehicle.speed,
      ignition: Boolean(vehicle.ignition),
      battery: vehicle.battery,
      signal: vehicle.signal,
      odometer: vehicle.odometer,
      address: vehicle.address,
      alerts: vehicle.alerts ?? [],
      isCommunicating: true,
      isOnline: vehicle.status !== "offline",
      satellites: vehicle.satellites,
      course: vehicle.heading,
      brand: vehicle.brand,
      model: vehicle.model,
      driver: vehicle.driver,
      tenantId: vehicle.tenantId,
      fuel: vehicle.fuel,
      raw: vehicle,
    }));
}

function normaliseDevice(id, device = {}, position = {}, livePosition = {}) {
  const attributes = {
    ...(device?.attributes || {}),
    ...(position?.attributes || {}),
    ...(livePosition?.attributes || {}),
  };

  const lat = toNumber(
    livePosition.latitude ??
      livePosition.lat ??
      position.latitude ??
      position.lat ??
      attributes.latitude ??
      device.latitude,
  );
  const lng = toNumber(
    livePosition.longitude ??
      livePosition.lng ??
      position.longitude ??
      position.lng ??
      attributes.longitude ??
      device.longitude,
  );

  const lastUpdate =
    livePosition.deviceTime ||
    livePosition.fixTime ||
    livePosition.serverTime ||
    position.deviceTime ||
    position.fixTime ||
    position.serverTime ||
    device.lastUpdate ||
    device.lastCommunication;
  const lastUpdateTs = toTimestamp(lastUpdate);

  const alarm = attributes.alarm || livePosition.alarm || position.alarm || device.alarm;
  const blocked =
    Boolean(attributes.blocked || attributes.block || attributes.engineBlocked || attributes.io83) ||
    device?.blocked === true;
  const odometerMeters =
    firstNumber(
      attributes.totalDistance,
      attributes.odometer,
      attributes.odometerMeters,
      livePosition.totalDistance,
      livePosition.odometer,
      device.totalDistance,
    ) ?? null;
  const odometer = typeof odometerMeters === "number" ? Math.round(odometerMeters / 1000) : null;

  const speedValue = firstNumber(livePosition.speed, position.speed, attributes.speed, device.speed);
  const speed = typeof speedValue === "number" ? normaliseSpeed(speedValue) : null;

  const ignition = parseBoolean(
    attributes.ignition ??
      attributes.acc ??
      attributes.engine ??
      livePosition.ignition ??
      livePosition.acc ??
      livePosition.engine ??
      device.ignition,
  );
  const battery = firstNumber(attributes.batteryLevel, attributes.battery, attributes.power, device.batteryLevel);
  const signal = firstNumber(attributes.rssi, attributes.signal, attributes.gsm, device.signal);
  const satellites = firstNumber(
    livePosition.sat,
    position.sat,
    attributes.sat,
    attributes.satellites,
    device.satellites,
  );
  const course = firstNumber(livePosition.course, position.course, attributes.course, device.course);

  const driver =
    attributes.driverName ||
    attributes.driver ||
    device.driverName ||
    (device.driver && (device.driver.name || device.driver.fullName));

  const address = livePosition.address || position.address || attributes.address || device.address;

  const isCommunicating = lastUpdateTs ? Date.now() - lastUpdateTs <= LIVE_THRESHOLD : false;
  const isOnline = lastUpdateTs ? Date.now() - lastUpdateTs <= OFFLINE_THRESHOLD : false;

  let status = String(device.status || "").toLowerCase();
  if (!status || status === "unknown") status = isOnline ? "online" : "offline";
  if (blocked) status = "blocked";
  if (alarm && alarm !== "lowBattery") status = "alert";
  if (!isOnline && status === "online") status = "offline";

  return {
    id: String(id),
    tenantId: device.tenantId ?? livePosition.tenantId ?? position.tenantId,
    name: device.name || attributes.name || attributes.vehicleName || `Dispositivo ${id}`,
    plate:
      device.plate ||
      attributes.plate ||
      attributes.vehiclePlate ||
      attributes.vehicleRegistration ||
      device.registration ||
      null,
    status,
    lastUpdate,
    lastUpdateTs,
    lat,
    lng,
    speed,
    ignition,
    battery,
    signal,
    odometer,
    address,
    satellites,
    course,
    alerts: buildAlerts(alarm, attributes),
    isCommunicating,
    isOnline,
    blocked,
    driver,
    model: device.model || attributes.model,
    brand: device.brand || attributes.brand,
    group: device.group || device.groupName || attributes.group,
    fuel: firstNumber(attributes.fuel, attributes.fuelLevel, attributes.tankLevel),
    rawDevice: device,
    rawPosition: position,
    rawLive: livePosition,
  };
}

function buildAlerts(alarm, attributes) {
  const alerts = [];
  if (alarm) alerts.push(alarm);
  if (Array.isArray(attributes.alerts)) return [...new Set([...alerts, ...attributes.alerts])];
  return alerts;
}

function resolvePriority(status) {
  const index = STATUS_PRIORITY.indexOf(status);
  return index === -1 ? STATUS_PRIORITY.length + 1 : index;
}

function normaliseSpeed(value) {
  if (value == null) return null;
  if (value > 160) return Math.round(value);
  const kmh = value * 1.852;
  return Math.round(kmh);
}

function normalizeId(entity) {
  if (!entity) return null;
  if (entity.deviceId != null) return String(entity.deviceId);
  if (entity.id != null) return String(entity.id);
  if (entity.uniqueId != null) return String(entity.uniqueId);
  if (entity.device?.id != null) return String(entity.device.id);
  return null;
}

function toTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const ts = Number(value);
  if (!Number.isNaN(ts) && String(value).length === 13) return ts;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "on", "yes", "sim"].includes(normalized);
  }
  return false;
}

function firstNumber(...values) {
  for (const value of values) {
    if (value == null) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function buildSocketUrl(path) {
  try {
    if (!path) return null;
    const base = import.meta.env?.VITE_CORE_WS || import.meta.env?.VITE_CORE_BASE || window.location.origin;
    const initial = base.startsWith("http") || base.startsWith("ws") ? base : window.location.origin;
    const url = new URL(path, initial);
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol === "https:") url.protocol = "wss:";
    return url.toString();
  } catch (error) {
    console.warn("[fleet] socket url inválida", error);
    return null;
  }
}

function parseSocketMessage(raw) {
  if (!raw) return [];
  let data = null;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (error) {
    return [];
  }

  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.positions)) return data.positions;
  if (data?.position) return [data.position];
  if (data?.event?.position) return [data.event.position];
  if (data?.deviceId) return [data];
  return [];
}
