import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useUI } from "../store.js";
import useVehicles, { resetVehiclesCache } from "./useVehicles.js";
import { useTenant } from "../tenant-context.jsx";

const normalizeId = (value) => {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
};

const selectionKey = (vehicleId, deviceId) =>
  `${normalizeId(vehicleId) ?? ""}:${normalizeId(deviceId) ?? ""}`;

export default function useVehicleSelection({ syncQuery = true } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { vehicles } = useVehicles();
  const { tenantId } = useTenant();
  const { selectedVehicleId, selectedTelemetryDeviceId, setVehicleSelection, clearVehicleSelection } = useUI();
  const lastAppliedQueryRef = useRef(null);
  const lastTenantRef = useRef(tenantId);

  const vehicleById = useMemo(() => new Map(vehicles.map((vehicle) => [String(vehicle.id), vehicle])), [vehicles]);

  const resolvedSelection = useMemo(() => {
    const vehicle = selectedVehicleId ? vehicleById.get(String(selectedVehicleId)) || null : null;
    const deviceId = vehicle?.primaryDeviceId || selectedTelemetryDeviceId || null;
    return { vehicleId: vehicle?.id || selectedVehicleId || null, deviceId, vehicle };
  }, [selectedVehicleId, selectedTelemetryDeviceId, vehicleById]);

  useEffect(() => {
    if (lastTenantRef.current === tenantId) return;
    lastTenantRef.current = tenantId;
    clearVehicleSelection();
    resetVehiclesCache();
  }, [clearVehicleSelection, tenantId]);

  useEffect(() => {
    if (!syncQuery) return;
    const search = new URLSearchParams(location.search || "");
    const normalizedQuery = normalizeId(search.get("vehicleId"));
    const normalizedDevice = normalizeId(search.get("deviceId") || search.get("device"));
    if (!normalizedQuery) {
      lastAppliedQueryRef.current = selectionKey(null, null);
      return;
    }
    const nextVehicle = vehicleById.get(normalizedQuery);
    const nextDeviceId = normalizeId(normalizedDevice ?? nextVehicle?.primaryDeviceId ?? null);
    const nextKey = selectionKey(normalizedQuery, nextDeviceId);
    if (lastAppliedQueryRef.current === nextKey) return;

    const currentKey = selectionKey(selectedVehicleId, selectedTelemetryDeviceId);
    if (currentKey === nextKey) {
      lastAppliedQueryRef.current = nextKey;
      return;
    }

    lastAppliedQueryRef.current = nextKey;
    setVehicleSelection(normalizedQuery, nextDeviceId);
  }, [location.search, selectedTelemetryDeviceId, selectedVehicleId, setVehicleSelection, syncQuery, vehicleById]);

  useEffect(() => {
    if (!selectedVehicleId) return;
    const normalizedVehicleId = normalizeId(selectedVehicleId);
    const match = vehicleById.get(normalizedVehicleId);
    const normalizedSelectedDevice = normalizeId(selectedTelemetryDeviceId);
    const normalizedMatchDevice = normalizeId(match?.primaryDeviceId);
    if (match && normalizedSelectedDevice !== normalizedMatchDevice) {
      setVehicleSelection(normalizedVehicleId, match?.primaryDeviceId ?? null);
    }
  }, [selectedTelemetryDeviceId, selectedVehicleId, setVehicleSelection, vehicleById]);

  useEffect(() => {
    if (!syncQuery) return;
    const search = new URLSearchParams(location.search || "");
    const currentVehicle = normalizeId(search.get("vehicleId"));
    const currentDevice = normalizeId(search.get("deviceId") || search.get("device"));
    const normalizedVehicleId = normalizeId(resolvedSelection.vehicleId);
    const normalizedDeviceId = normalizeId(resolvedSelection.deviceId);

    if (currentVehicle === normalizedVehicleId && currentDevice === normalizedDeviceId) {
      return;
    }

    if (normalizedVehicleId) {
      search.set("vehicleId", normalizedVehicleId);
    } else {
      search.delete("vehicleId");
    }
    if (normalizedDeviceId) {
      search.set("deviceId", normalizedDeviceId);
    } else {
      search.delete("deviceId");
      search.delete("device");
    }

    const nextQuery = search.toString();
    const nextPath = nextQuery ? `${location.pathname}?${nextQuery}` : location.pathname;
    if (nextPath === `${location.pathname}${location.search}`) return;
    navigate(nextPath, { replace: true });
  }, [
    location.pathname,
    location.search,
    navigate,
    resolvedSelection.deviceId,
    resolvedSelection.vehicleId,
    syncQuery,
  ]);

  const setVehicle = (vehicleId, deviceId = null) => {
    if (!vehicleId) {
      clearVehicleSelection();
      return;
    }
    const normalizedVehicleId = normalizeId(vehicleId);
    const target = vehicleById.get(normalizedVehicleId);
    const resolvedDevice = normalizeId(deviceId ?? target?.primaryDeviceId ?? null);
    if (
      normalizeId(selectedVehicleId) === normalizedVehicleId &&
      normalizeId(selectedTelemetryDeviceId) === resolvedDevice
    ) {
      return;
    }
    setVehicleSelection(normalizedVehicleId, resolvedDevice);
  };

  return {
    selectedVehicleId: resolvedSelection.vehicleId,
    selectedTelemetryDeviceId: resolvedSelection.deviceId,
    selectedVehicle: resolvedSelection.vehicle,
    setVehicleSelection: setVehicle,
    clearVehicleSelection,
  };
}
