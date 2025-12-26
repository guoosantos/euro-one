import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useUI } from "../store.js";
import useVehicles, { resetVehiclesCache } from "./useVehicles.js";
import { useTenant } from "../tenant-context.jsx";

const normalizeId = (value) => {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
};

export default function useVehicleSelection({ syncQuery = true } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { vehicles } = useVehicles();
  const { tenantId } = useTenant();
  const { selectedVehicleId, selectedTelemetryDeviceId, setVehicleSelection, clearVehicleSelection } = useUI();
  const lastAppliedQueryRef = useRef(null);
  const lastSyncedVehicleRef = useRef(null);
  const lastTenantRef = useRef(tenantId);
  const lastSelectionRef = useRef({ vehicleId: null, deviceId: null });

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
    const normalizedSelected = normalizeId(selectedVehicleId);
    if (!normalizedQuery || normalizedQuery === normalizedSelected) {
      lastAppliedQueryRef.current = normalizedQuery;
      return;
    }
    if (lastAppliedQueryRef.current === normalizedQuery) return;
    const nextVehicle = vehicleById.get(normalizedQuery);
    lastAppliedQueryRef.current = normalizedQuery;
    const nextDeviceId = normalizeId(nextVehicle?.primaryDeviceId ?? null);
    if (
      lastSelectionRef.current.vehicleId === normalizedQuery &&
      lastSelectionRef.current.deviceId === nextDeviceId
    ) {
      return;
    }
    lastSelectionRef.current = { vehicleId: normalizedQuery, deviceId: nextDeviceId };
    setVehicleSelection(normalizedQuery, nextDeviceId);
  }, [location.search, selectedVehicleId, setVehicleSelection, syncQuery, vehicleById]);

  useEffect(() => {
    if (!selectedVehicleId) return;
    const normalizedVehicleId = normalizeId(selectedVehicleId);
    const match = vehicleById.get(normalizedVehicleId);
    const normalizedSelectedDevice = normalizeId(selectedTelemetryDeviceId);
    const normalizedMatchDevice = normalizeId(match?.primaryDeviceId);
    if (match && normalizedSelectedDevice !== normalizedMatchDevice) {
      if (
        lastSelectionRef.current.vehicleId === normalizedVehicleId &&
        lastSelectionRef.current.deviceId === normalizedMatchDevice
      ) {
        return;
      }
      lastSelectionRef.current = { vehicleId: normalizedVehicleId, deviceId: normalizedMatchDevice };
      setVehicleSelection(normalizedVehicleId, match?.primaryDeviceId ?? null);
    }
  }, [selectedTelemetryDeviceId, selectedVehicleId, setVehicleSelection, vehicleById]);

  useEffect(() => {
    if (!syncQuery) return;
    const search = new URLSearchParams(location.search || "");
    const currentVehicle = normalizeId(search.get("vehicleId"));
    const normalizedVehicleId = normalizeId(resolvedSelection.vehicleId);

    if (currentVehicle === normalizedVehicleId) {
      lastSyncedVehicleRef.current = normalizedVehicleId;
      return;
    }

    if (lastSyncedVehicleRef.current === normalizedVehicleId && currentVehicle === normalizedVehicleId) {
      return;
    }

    if (normalizedVehicleId) {
      search.set("vehicleId", normalizedVehicleId);
    } else {
      search.delete("vehicleId");
    }

    const nextQuery = search.toString();
    const nextPath = nextQuery ? `${location.pathname}?${nextQuery}` : location.pathname;
    lastSyncedVehicleRef.current = normalizedVehicleId;
    navigate(nextPath, { replace: true });
  }, [location.pathname, location.search, navigate, resolvedSelection.vehicleId, syncQuery]);

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
    lastSelectionRef.current = { vehicleId: normalizedVehicleId, deviceId: resolvedDevice };
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
