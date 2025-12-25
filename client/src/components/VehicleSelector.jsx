import React, { useMemo, useState } from "react";
import useVehicles from "../lib/hooks/useVehicles.js";
import useVehicleSelection from "../lib/hooks/useVehicleSelection.js";

export default function VehicleSelector({
  label = "Veículo",
  placeholder = "Selecione um veículo",
  allowUnlinked = true,
  className = "",
  onChange,
}) {
  const { vehicles, vehicleOptions, loading, error } = useVehicles({ includeUnlinked: allowUnlinked });
  const { selectedVehicleId, setVehicleSelection, clearVehicleSelection } = useVehicleSelection({ syncQuery: true });
  const [search, setSearch] = useState("");

  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return vehicleOptions;
    return vehicleOptions.filter(
      (option) =>
        option.label.toLowerCase().includes(term) ||
        (option.description || "").toLowerCase().includes(term),
    );
  }, [search, vehicleOptions]);

  const handleChange = (event) => {
    const value = event.target.value;
    if (!value) {
      clearVehicleSelection();
      onChange?.(null);
      return;
    }
    const match = vehicles.find((vehicle) => String(vehicle.id) === String(value));
    setVehicleSelection(value, match?.primaryDeviceId ?? null);
    onChange?.(value, match);
  };

  return (
    <div className={className}>
      {label ? <span className="block text-xs uppercase tracking-wide text-white/60">{label}</span> : null}
      <select
        value={selectedVehicleId || ""}
        onChange={handleChange}
        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary/40 focus:outline-none"
      >
        <option value="">{placeholder}</option>
        {filteredOptions.map((vehicle) => (
          <option key={vehicle.value} value={vehicle.value}>
            {vehicle.label} {vehicle.hasDevice ? "" : "— Sem equipamento vinculado"}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Buscar por placa ou nome"
        className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary/40 focus:outline-none"
      />
      {loading && <p className="mt-1 text-xs text-white/60">Carregando veículos…</p>}
      {error && <p className="mt-1 text-xs text-red-300">{error.message}</p>}
    </div>
  );
}
