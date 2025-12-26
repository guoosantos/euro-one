import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useUI } from "../store.js";
import useVehicles from "./useVehicles.js";

const normalizeId = (value) => {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
};

export default function useVehicleSelection({ syncQuery = true } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { vehicles } = useVehicles();
  const { selectedVehicleId, selectedTelemetryDeviceId, setVehicleSelection, clearVehicleSelection } = useUI();
  const lastAppliedQueryRef = useRef(null);

  const vehicleById = useMemo(() => new Map(vehicles.map((vehicle) => [String(vehicle.id), vehicle])), [vehicles]);

  const resolvedSelection = useMemo(() => {
    const vehicle = selectedVehicleId ? vehicleById.get(String(selectedVehicleId)) || null : null;
    const deviceId = vehicle?.primaryDeviceId || selectedTelemetryDeviceId || null;
    return { vehicleId: vehicle?.id || selectedVehicleId || null, deviceId, vehicle };
  }, [selectedVehicleId, selectedTelemetryDeviceId, vehicleById]);

  useEffect(() => {
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
    setVehicleSelection(normalizedQuery, nextVehicle?.primaryDeviceId ?? null);
  }, [location.search, selectedVehicleId, setVehicleSelection, vehicleById]);

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
    const normalizedVehicleId = normalizeId(resolvedSelection.vehicleId);

    if (normalizedVehicleId) {
      if (currentVehicle === normalizedVehicleId) return;
      search.set("vehicleId", normalizedVehicleId);
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
    const normalizedVehicleId = normalizeId(vehicleId);
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
