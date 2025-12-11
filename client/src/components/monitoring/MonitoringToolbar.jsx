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
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-sm text-white shadow-lg backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange?.(event.target.value)}
          placeholder="Buscar veículo, placa..."
          className="h-10 w-full min-w-[240px] flex-1 rounded-xl border border-white/15 bg-black/30 px-4 text-sm text-white placeholder:text-white/40 shadow-inner focus:border-primary/40 focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          {filterOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => onFilterChange?.(option.key)}
              className={`rounded-full border px-3 py-2 text-[11px] font-semibold transition shadow-sm ${
                filterMode === option.key
                  ? "border-primary/40 bg-primary/20 text-primary"
                  : "border-white/15 bg-white/5 text-white/80 hover:border-white/30 hover:bg-white/10"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-[11px] font-semibold text-white/80 shadow-sm transition hover:border-white/30 hover:bg-white/10"
          onClick={onOpenColumns}
        >
          Colunas
        </button>
        <button
          type="button"
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-[11px] font-semibold text-white/80 shadow-sm transition hover:border-white/30 hover:bg-white/10"
          onClick={onOpenLayout}
        >
          Layout
        </button>
      </div>
    </div>
  );
}
