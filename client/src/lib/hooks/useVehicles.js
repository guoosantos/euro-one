import { useCallback, useEffect, useMemo, useState } from "react";
import { CoreApi } from "../coreApi.js";
import { useTenant } from "../tenant-context.jsx";
import { resolveMirrorClientParams } from "../mirror-params.js";
import { getDeviceKey, toDeviceKey } from "./useDevices.helpers.js";

const vehiclesCache = new Map();
const vehiclesCooldowns = new Map();
const cacheListeners = new Set();
const compareVehicleEntries = (prev = [], next = []) => {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let index = 0; index < prev.length; index += 1) {
    const prevItem = prev[index];
    const nextItem = next[index];
    const prevId = prevItem?.id ?? prevItem?.vehicleId ?? prevItem?.vehicle_id;
    const nextId = nextItem?.id ?? nextItem?.vehicleId ?? nextItem?.vehicle_id;
    if (String(prevId ?? "") !== String(nextId ?? "")) return false;
    const prevUpdated = prevItem?.updatedAt ?? prevItem?.updated_at ?? prevItem?.updatedOn;
    const nextUpdated = nextItem?.updatedAt ?? nextItem?.updated_at ?? nextItem?.updatedOn;
    if (String(prevUpdated ?? "") !== String(nextUpdated ?? "")) return false;
  }
  return true;
};

export function resetVehiclesCache() {
  vehiclesCache.clear();
  cacheListeners.forEach((listener) => listener());
}

const pickDeviceKey = (deviceOrValue) => getDeviceKey(deviceOrValue) ?? toDeviceKey(deviceOrValue);

export function normalizeVehicleDevices(vehicle) {
  const list = [];
  if (Array.isArray(vehicle?.devices)) list.push(...vehicle.devices);
  if (vehicle?.device) list.push(vehicle.device);
  if (vehicle?.primaryDevice) list.push(vehicle.primaryDevice);
  if (vehicle?.principalDevice) list.push(vehicle.principalDevice);

  const deduped = new Map();
  list.forEach((device) => {
    const key = pickDeviceKey(device);
    if (!key) return;
    if (deduped.has(key)) return;
    deduped.set(key, { ...device, __deviceKey: key });
  });

  return Array.from(deduped.values());
}

export function pickPrimaryDevice(vehicle) {
  const devices = normalizeVehicleDevices(vehicle);
  const preferredKey = pickDeviceKey(
    vehicle?.principalDeviceId ??
      vehicle?.primaryDeviceId ??
      vehicle?.deviceId ??
      vehicle?.device?.id ??
      vehicle?.device?.deviceId ??
      vehicle?.device?.uniqueId ??
      vehicle?.device_id,
  );
  if (preferredKey) {
    const preferredDevice = devices.find((item) => pickDeviceKey(item) === preferredKey);
    if (preferredDevice) return preferredDevice;
  }
  return devices[0] ?? null;
}

export function formatVehicleLabel(vehicle) {
  const plate = vehicle?.plate;
  const name = vehicle?.name;
  if (plate && name) return `${plate} · ${name}`;
  return plate || name || vehicle?.identifier || vehicle?.id || "Veículo";
}

export function useVehicles({ includeUnlinked = false, accessible = true, enabled = true } = {}) {
  const { tenantId, mirrorContextMode } = useTenant();
  const cacheKey = `${tenantId ?? "all"}:${mirrorContextMode ?? "self"}:${includeUnlinked ? "1" : "0"}:${accessible ? "1" : "0"}`;
  const [vehicles, setVehicles] = useState(() => vehiclesCache.get(cacheKey) || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchVehicles = useCallback(async ({ force = false } = {}) => {
    if (!enabled) {
      setLoading(false);
      setError(null);
      setVehicles([]);
      return;
    }
    const now = Date.now();
    const cooldownUntil = vehiclesCooldowns.get(cacheKey) || 0;
    if (!force && cooldownUntil > now) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = resolveMirrorClientParams({ tenantId, mirrorContextMode }) || {};
      if (includeUnlinked) {
        params.includeUnlinked = true;
      }
      if (accessible) {
        params.accessible = true;
      }
      const response = await CoreApi.listVehicles(params);
      const list = Array.isArray(response) ? response : [];
      setVehicles((prev) => (compareVehicleEntries(prev, list) ? prev : list));
      const cached = vehiclesCache.get(cacheKey) || [];
      if (!compareVehicleEntries(cached, list)) {
        vehiclesCache.set(cacheKey, list);
      }
      vehiclesCooldowns.delete(cacheKey);
    } catch (requestError) {
      const status = requestError?.status || requestError?.response?.status;
      if (status === 403) {
        setVehicles([]);
        setError(null);
        return;
      }
      if (status === 503) {
        vehiclesCooldowns.set(cacheKey, now + 30_000);
        const unavailable = new Error("Telemetria indisponível no momento. Tente novamente em instantes.");
        unavailable.status = status;
        setError(unavailable);
        return;
      }
      if (status >= 500) {
        const requestId =
          requestError?.response?.data?.requestId ||
          requestError?.response?.data?.request_id ||
          requestError?.response?.data?.id ||
          null;
        console.error("Erro interno ao carregar veículos", { status, requestId, error: requestError });
        const internal = new Error("Erro interno no servidor ao carregar veículos.");
        internal.status = status;
        setError(internal);
        return;
      }
      setError(requestError instanceof Error ? requestError : new Error("Falha ao carregar veículos"));
    } finally {
      setLoading(false);
    }
  }, [accessible, cacheKey, enabled, includeUnlinked, mirrorContextMode, tenantId]);

  useEffect(() => {
    fetchVehicles().catch(() => {});
  }, [fetchVehicles]);

  useEffect(() => {
    const cached = vehiclesCache.get(cacheKey) || [];
    setVehicles((prev) => (compareVehicleEntries(prev, cached) ? prev : cached));
    setError(null);
  }, [cacheKey, enabled]);

  useEffect(() => {
    const handleReset = () => {
      setVehicles([]);
      setError(null);
    };
    cacheListeners.add(handleReset);
    return () => {
      cacheListeners.delete(handleReset);
    };
  }, []);

  const enrichedVehicles = useMemo(() => {
    return (Array.isArray(vehicles) ? vehicles : []).map((vehicle) => {
      const devices = normalizeVehicleDevices(vehicle);
      const primaryDevice = pickPrimaryDevice(vehicle);
      return {
        ...vehicle,
        devices,
        primaryDevice,
        primaryDeviceId: pickDeviceKey(primaryDevice),
      };
    });
  }, [vehicles]);

  const filteredVehicles = useMemo(
    () => enrichedVehicles.filter((vehicle) => includeUnlinked || Boolean(vehicle.primaryDeviceId)),
    [enrichedVehicles, includeUnlinked],
  );

  const vehicleOptions = useMemo(
    () =>
      filteredVehicles.map((vehicle) => ({
        value: vehicle.id,
        label: formatVehicleLabel(vehicle),
        description: vehicle.plate && vehicle.name ? `${vehicle.plate} · ${vehicle.name}` : vehicle.plate || vehicle.name,
        deviceId: vehicle.primaryDeviceId,
        hasDevice: Boolean(vehicle.primaryDeviceId),
      })),
    [filteredVehicles],
  );

  return {
    vehicles: filteredVehicles,
    vehicleOptions,
    loading,
    error,
    reload: fetchVehicles,
  };
}

export default useVehicles;
