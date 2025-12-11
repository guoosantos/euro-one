import React from "react";

const filterOptions = [
  { key: "all", label: "Todos" },
  { key: "online", label: "Online" },
  { key: "offline", label: "Offline" },
  { key: "ignition", label: "Ign. Ligada" },
];

export default function MonitoringToolbar({
  query,
  onQueryChange,
  filterMode,
  onFilterChange,
  onOpenColumns,
  onOpenLayout,
}) {
  return (
    <div className="flex items-center justify-between border-y border-white/5 bg-[#0d121b] px-4 py-3 text-sm text-white/80">
      <div className="flex items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange?.(event.target.value)}
          placeholder="Buscar veículo, placa..."
          className="h-10 w-64 rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-sm text-white placeholder:text-white/40 focus:border-primary/40 focus:outline-none"
        />
        <div className="flex items-center gap-2">
          {filterOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => onFilterChange?.(option.key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                filterMode === option.key
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "border border-white/10 text-white/70 hover:border-white/30"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-white/80 hover:border-white/30"
          onClick={onOpenColumns}
        >
          Colunas
        </button>
        <button
          type="button"
          className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-white/80 hover:border-white/30"
          onClick={onOpenLayout}
        >
          Layout
        </button>
      </div>
    </div>
  );
}
