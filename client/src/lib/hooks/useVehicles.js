import { useCallback, useEffect, useMemo, useState } from "react";
import { CoreApi } from "../coreApi.js";
import { useTenant } from "../tenant-context.jsx";
import { toDeviceKey } from "./useDevices.helpers.js";

const pickDeviceKey = (device) =>
  toDeviceKey(device?.id ?? device?.deviceId ?? device?.device_id ?? device?.uniqueId ?? device?.unique_id ?? device?.traccarId);

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

export function useVehicles({ includeUnlinked = true } = {}) {
  const { tenantId } = useTenant();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchVehicles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = tenantId ? { clientId: tenantId } : {};
      if (includeUnlinked) {
        params.includeUnlinked = true;
      }
      const response = await CoreApi.listVehicles(params);
      const list = Array.isArray(response) ? response : [];
      setVehicles(list);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : new Error("Falha ao carregar veículos"));
    } finally {
      setLoading(false);
    }
  }, [includeUnlinked, tenantId]);

  useEffect(() => {
    fetchVehicles().catch(() => {});
  }, [fetchVehicles]);

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
