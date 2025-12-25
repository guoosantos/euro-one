import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useUI } from "../store.js";
import useVehicles from "./useVehicles.js";

export default function useVehicleSelection({ syncQuery = true } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { vehicles } = useVehicles({ includeUnlinked: true });
  const { selectedVehicleId, selectedTelemetryDeviceId, setVehicleSelection, clearVehicleSelection } = useUI();

  const vehicleById = useMemo(() => new Map(vehicles.map((vehicle) => [String(vehicle.id), vehicle])), [vehicles]);

  const resolvedSelection = useMemo(() => {
    const vehicle = selectedVehicleId ? vehicleById.get(String(selectedVehicleId)) || null : null;
    const deviceId = vehicle?.primaryDeviceId || selectedTelemetryDeviceId || null;
    return { vehicleId: vehicle?.id || selectedVehicleId || null, deviceId, vehicle };
  }, [selectedVehicleId, selectedTelemetryDeviceId, vehicleById]);

  useEffect(() => {
    const search = new URLSearchParams(location.search || "");
    const queryVehicleId = search.get("vehicleId");
    const normalizedQuery = queryVehicleId ? String(queryVehicleId) : null;
    const normalizedSelected = selectedVehicleId ? String(selectedVehicleId) : null;
    if (normalizedQuery && normalizedQuery !== normalizedSelected) {
      const nextVehicle = vehicleById.get(normalizedQuery);
      setVehicleSelection(normalizedQuery, nextVehicle?.primaryDeviceId ?? null);
    }
  }, [location.search, selectedVehicleId, setVehicleSelection, vehicleById]);

  useEffect(() => {
    if (!selectedVehicleId) return;
    const normalizedVehicleId = String(selectedVehicleId);
    const match = vehicleById.get(normalizedVehicleId);
    const normalizedSelectedDevice = selectedTelemetryDeviceId ? String(selectedTelemetryDeviceId) : null;
    const normalizedMatchDevice = match?.primaryDeviceId ? String(match.primaryDeviceId) : null;
    if (match && normalizedSelectedDevice !== normalizedMatchDevice) {
      setVehicleSelection(normalizedVehicleId, match?.primaryDeviceId ?? null);
    }
  }, [selectedTelemetryDeviceId, selectedVehicleId, setVehicleSelection, vehicleById]);

  useEffect(() => {
    if (!syncQuery) return;
    const search = new URLSearchParams(location.search || "");
    const currentVehicle = search.get("vehicleId") || null;

    if (resolvedSelection.vehicleId) {
      if (currentVehicle === String(resolvedSelection.vehicleId)) return;
      search.set("vehicleId", resolvedSelection.vehicleId);
      navigate(`${location.pathname}?${search.toString()}`, { replace: true });
    } else if (currentVehicle) {
      search.delete("vehicleId");
      navigate(
        search.toString() ? `${location.pathname}?${search.toString()}` : location.pathname,
        { replace: true },
      );
    }
  }, [location.pathname, location.search, navigate, resolvedSelection.vehicleId, syncQuery]);

  const setVehicle = (vehicleId, deviceId = null) => {
    if (!vehicleId) {
      clearVehicleSelection();
      return;
    }
    const normalizedVehicleId = String(vehicleId);
    const target = vehicleById.get(normalizedVehicleId);
    const resolvedDevice = deviceId ?? target?.primaryDeviceId ?? null;
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
