import React from "react";
import { useTranslation } from "../../lib/i18n.js";

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

const SlidersIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
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
  onOpenLayout,    // Props antigas (fallback)
  regionQuery,
  onRegionQueryChange,
  onRegionSearch,
  isSearchingRegion,
}) {
  const { t } = useTranslation();
  
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
    <div className="flex h-full w-full flex-col gap-2 text-[11px] text-white/80">
      <div className="flex h-full flex-wrap items-center gap-2 lg:gap-3">
        <div className="relative flex min-w-[220px] max-w-[320px] flex-1 items-center rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 shadow-inner">
          <div className="pointer-events-none text-white/40">
            <SearchIcon />
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange?.(e.target.value)}
            placeholder={t("monitoring.searchPlaceholderSimple")}
            className="ml-2 w-full bg-transparent text-xs text-white placeholder-white/40 focus:outline-none"
          />
        </div>

        <div className="relative flex min-w-[240px] max-w-[360px] flex-1 items-center rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 shadow-inner">
          <div className="pointer-events-none text-white/40">
            <SearchIcon />
          </div>
          <input
            type="text"
            value={regionQuery}
            onChange={(e) => onRegionQueryChange?.(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onRegionSearch?.();
              }
            }}
            placeholder={t("monitoring.searchRegionPlaceholder")}
            className="ml-2 w-full bg-transparent text-xs text-white placeholder-white/40 focus:outline-none"
          />
          <button
            type="button"
            onClick={onRegionSearch}
            className="ml-2 rounded-md border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-white transition hover:border-primary/60"
          >
            {isSearchingRegion ? t("loading") : t("monitoring.searchAction")}
          </button>
        </div>

        <div className="flex flex-1 flex-wrap items-center gap-1 lg:flex-none">
          <FilterPill
            label={t("monitoring.filters.all")}
            count={summary?.total}
            active={filterMode === 'all'}
            onClick={() => onFilterChange?.('all')}
          />
          <FilterPill
            label={t("monitoring.filters.online")}
            count={summary?.online}
            active={filterMode === 'online'}
            onClick={() => onFilterChange?.('online')}
            color="text-emerald-400"
          />
          <FilterPill
            label={t("monitoring.filters.offline")}
            count={summary?.offline}
            active={filterMode === 'stale'}
            onClick={() => onFilterChange?.('stale')}
            color="text-red-400"
          />
          <FilterPill
            label={t("monitoring.filters.criticalEvents")}
            count={summary?.critical}
            active={filterMode === 'critical'}
            onClick={() => onFilterChange?.('critical')}
            color="text-amber-400"
          />
        </div>

        <div className="ml-auto flex h-full items-center gap-1">
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
        flex h-10 w-10 items-center justify-center rounded-md border text-xs leading-none transition-all
        ${active
          ? "bg-primary/20 text-white border-primary/50 shadow-inner shadow-primary/20"
          : "bg-[#0d1117] text-white/60 border-white/15 hover:text-white hover:border-white/40"}
      `}
    >
      {icon}
    </button>
  );
}
