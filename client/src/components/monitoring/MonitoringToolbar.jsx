import React from "react";

// --- ÍCONES SVG (Para não depender de bibliotecas externas) ---
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
);
const ColumnsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="5" height="14" rx="1" />
    <rect x="10" y="5" width="5" height="14" rx="1" />
    <rect x="17" y="5" width="4" height="14" rx="1" />
  </svg>
);

const LayoutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="3" y1="11" x2="21" y2="11" />
    <line x1="12" y1="4" x2="12" y2="20" />

  </svg>
);

export default function MonitoringToolbar({
  query,
  onQueryChange,
  filterMode,
  onFilterChange,
  summary,
  activePopup,     // Props novas (do Monitoring.jsx atualizado)
  onTogglePopup,   // Props novas
  onOpenColumns,   // Props antigas (fallback)
  onOpenLayout     // Props antigas (fallback)
}) {
  
  // Adaptador para funcionar com ambas versões do Monitoring.jsx
  const handleToggleColumns = () => {
    if (onTogglePopup) onTogglePopup('columns');
    else if (onOpenColumns) onOpenColumns();
  };

  const handleToggleLayout = () => {
    if (onTogglePopup) onTogglePopup('layout');
    else if (onOpenLayout) onOpenLayout();
  };

  const isColumnsActive = activePopup === 'columns';
  const isLayoutActive = activePopup === 'layout';

  return (
    <div className="flex w-full flex-col gap-2 text-[11px] text-white/80">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex min-w-[240px] flex-1 items-center rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 shadow-inner">
          <div className="pointer-events-none text-white/40">
            <SearchIcon />
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange?.(e.target.value)}
            placeholder="Buscar veículo, placa ou monitor"
            className="ml-2 w-full bg-transparent text-xs text-white placeholder-white/40 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <FilterPill
            label="Todos"
            count={summary?.total}
            active={filterMode === 'all'}
            onClick={() => onFilterChange?.('all')}
          />
          <FilterPill
            label="Online"
            count={summary?.online}
            active={filterMode === 'online'}
            onClick={() => onFilterChange?.('online')}
            color="text-emerald-400"
          />
          <FilterPill
            label="Offline"
            count={summary?.offline}
            active={filterMode === 'offline'}
            onClick={() => onFilterChange?.('offline')}
            color="text-red-400"
          />
          <FilterPill
            label="Ign."
            active={filterMode === 'ignition'}
            onClick={() => onFilterChange?.('ignition')}
            color="text-amber-400"
          />
        </div>

        <div className="ml-auto flex items-center gap-1">
          <ActionButton


            icon={<SlidersIcon />}

            active={isColumnsActive}
            onClick={handleToggleColumns}
            title="Colunas"
          />
          <ActionButton
            icon={<LayoutIcon />}
            active={isLayoutActive}
            onClick={handleToggleLayout}
            title="Layout"
          />
        </div>
      </div>


      <div className="flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.08em] text-white/40">
        <span className="hidden sm:inline">Exibindo {summary?.total ?? 0} veículos</span>
        <div className="flex items-center gap-2 text-white/60">
          <span className="font-semibold text-emerald-400">{summary?.online ?? 0} online</span>
          <span className="font-semibold text-red-400">{summary?.offline ?? 0} offline</span>
        </div>
      </div>
    </div>
  );
}

// --- SUB-COMPONENTES PARA ESTILO ---

function FilterPill({ label, count, active, onClick, color = "text-gray-300" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        flex items-center gap-1.5 rounded-md border px-3 py-2 text-[11px] font-medium transition-all whitespace-nowrap
        ${active
          ? 'bg-primary/15 text-white border-primary/40 shadow-sm'
          : 'bg-[#0d1117] text-white/70 border-white/10 hover:border-white/30 hover:text-white'}
      `}
    >
      <span className={active ? color : ""}>{label}</span>
      {count !== undefined && (
        <span className={`px-1 rounded text-[9px] ${active ? 'bg-black/30' : 'bg-white/10'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function ActionButton({ icon, active, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`
        h-9 w-9 rounded-md border text-xs transition-all
        ${active
          ? "bg-primary/20 text-white border-primary/50 shadow-inner shadow-primary/20"
          : "bg-[#0d1117] text-white/60 border-white/15 hover:text-white hover:border-white/40"}
      `}
    >
      {icon}
    </button>
  );
}
