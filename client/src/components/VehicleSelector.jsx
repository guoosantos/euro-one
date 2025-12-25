import React, { useEffect, useMemo, useRef, useState } from "react";
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
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef(null);

  const selectedOption = useMemo(
    () => vehicleOptions.find((option) => String(option.value) === String(selectedVehicleId)) || null,
    [selectedVehicleId, vehicleOptions],
  );

  useEffect(() => {
    if (selectedOption) {
      setSearch(selectedOption.label);
      return;
    }
    setSearch("");
  }, [selectedOption]);

  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return vehicleOptions;
    return vehicleOptions.filter(
      (option) =>
        option.label.toLowerCase().includes(term) ||
        (option.description || "").toLowerCase().includes(term),
    );
  }, [search, vehicleOptions]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target)) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const handleSelect = (option) => {
    if (!option?.value) {
      clearVehicleSelection();
      onChange?.(null);
      return;
    }
    const match = vehicles.find((vehicle) => String(vehicle.id) === String(option.value));
    setVehicleSelection(option.value, option.deviceId ?? match?.primaryDeviceId ?? null);
    setSearch(option.label);
    setIsOpen(false);
    onChange?.(option.value, match);
  };

  const handleInputChange = (event) => {
    const value = event.target.value;
    setSearch(value);
    setIsOpen(true);
    setHighlightIndex(0);
    if (!value) {
      clearVehicleSelection();
      onChange?.(null);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      setIsOpen(false);
      return;
    }
    if (event.key === "Enter") {
      if (!isOpen) return;
      event.preventDefault();
      const candidate = filteredOptions[highlightIndex] || filteredOptions[0];
      if (candidate) {
        handleSelect(candidate);
      }
    }
  };

  return (
    <div className={className} ref={containerRef}>
      {label ? <span className="block text-xs uppercase tracking-wide text-white/60">{label}</span> : null}
      <div className="relative mt-1">
        <input
          type="text"
          value={search}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setIsOpen(false), 100);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary/40 focus:outline-none"
          aria-autocomplete="list"
          aria-expanded={isOpen}
        />
        {isOpen && (
          <div className="absolute z-50 mt-2 max-h-64 w-full overflow-auto rounded-lg border border-white/10 bg-[#0f141c] py-1 shadow-lg">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-white/50">Nenhum veículo encontrado.</div>
            ) : (
              <ul className="text-sm">
                {filteredOptions.map((option, index) => (
                  <li key={option.value}>
                    <button
                      type="button"
                      className={`flex w-full items-start justify-between px-3 py-2 text-left transition hover:bg-white/5 ${
                        index === highlightIndex ? "bg-white/5" : ""
                      }`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        handleSelect(option);
                      }}
                    >
                      <span className="text-white">{option.label}</span>
                      {!option.hasDevice ? (
                        <span className="ml-2 text-xs text-yellow-200/80">Sem equipamento</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {loading && <p className="mt-1 text-xs text-white/60">Carregando veículos…</p>}
      {error && <p className="mt-1 text-xs text-red-300">{error.message}</p>}
    </div>
  );
}
