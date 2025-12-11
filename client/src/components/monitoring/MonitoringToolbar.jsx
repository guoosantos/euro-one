import React from "react";

// --- ÍCONES SVG (Para não depender de bibliotecas externas) ---
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
);
const SlidersIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>
);
const LayoutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
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
    // CÁPSULA FLUTUANTE COMPACTA
    <div className="flex items-center gap-2 bg-[#161b22]/95 backdrop-blur-md border border-white/10 p-1.5 rounded-xl shadow-2xl w-max max-w-full">
      
      {/* 1. BUSCA COMPACTA */}
      <div className="relative group">
        <div className="absolute inset-y-0 left-0 flex items-center pl-2.5 text-white/40 pointer-events-none group-focus-within:text-primary">
          <SearchIcon />
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange?.(e.target.value)}
          placeholder="Buscar..."
          className="w-32 sm:w-48 bg-[#0d1117] border border-white/10 text-xs rounded-lg pl-8 pr-2 py-1.5 text-white placeholder-white/30 focus:outline-none focus:border-primary/50 transition-all"
        />
      </div>

      {/* Divisória Vertical */}
      <div className="h-5 w-px bg-white/10 mx-1 hidden sm:block"></div>

      {/* 2. FILTROS (PILLS) */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
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

      {/* Divisória Vertical */}
      <div className="h-5 w-px bg-white/10 mx-1"></div>

      {/* 3. BOTÕES DE AÇÃO (ÍCONES) */}
      <div className="flex items-center gap-1">
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
  );
}

// --- SUB-COMPONENTES PARA ESTILO ---

function FilterPill({ label, count, active, onClick, color = "text-gray-300" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap
        ${active 
          ? 'bg-primary/20 text-white border border-primary/30 shadow-sm' 
          : 'hover:bg-white/5 text-white/60 border border-transparent'}
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
        p-1.5 rounded-lg transition-all border
        ${active 
          ? "bg-primary text-white border-primary shadow-lg shadow-primary/20" 
          : "bg-[#0d1117] text-white/50 border-white/10 hover:text-white hover:bg-white/10 hover:border-white/30"}
      `}
    >
      {icon}
    </button>
  );
}
