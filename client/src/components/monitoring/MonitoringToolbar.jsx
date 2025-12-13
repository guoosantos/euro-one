import React from "react";
import { useTranslation } from "../../lib/i18n.js";

// --- ÍCONES SVG (Para não depender de bibliotecas externas) ---
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
);
const LocationIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 1 1 18 0z"></path>
    <circle cx="12" cy="10" r="3"></circle>
  </svg>
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
  vehicleSearchTerm,
  onVehicleSearchChange,
  vehicleSuggestions,
  onSelectVehicleSuggestion,
  addressSearchTerm,
  onAddressSearchChange,
  addressSuggestions,
  onSelectAddressSuggestion,
  filterMode,
  onFilterChange,
  summary,
  activePopup,     // Props novas (do Monitoring.jsx atualizado)
  onTogglePopup,   // Props novas
  onOpenColumns,   // Props antigas (fallback)
  onOpenLayout,    // Props antigas (fallback)
  isSearchingRegion,
  layoutButtonRef,
  addressFilter,
  onClearAddress,
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
        <div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:items-center lg:gap-2">
          <MonitoringSearchBox
            value={vehicleSearchTerm}
            onChange={onVehicleSearchChange}
            placeholder={t("monitoring.searchPlaceholderSimple")}
            suggestions={vehicleSuggestions}
            onSelectSuggestion={onSelectVehicleSuggestion}
            icon={<SearchIcon />}
          />

          <MonitoringSearchBox
            value={addressSearchTerm}
            onChange={onAddressSearchChange}
            placeholder={t("monitoring.searchRegionPlaceholder")}
            suggestions={addressSuggestions}
            onSelectSuggestion={onSelectAddressSuggestion}
            icon={<LocationIcon />}
            isLoading={isSearchingRegion}
          />
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
            ref={layoutButtonRef}
            icon={<LayoutIcon />}
            active={isLayoutActive}
            onClick={handleToggleLayout}
            title="Layout"
          />
        </div>
      </div>

      {addressFilter ? (
        <div className="flex items-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-[11px] text-white/80">
          <span className="text-cyan-300">📍 {addressFilter.label}</span>
          {addressFilter.radius ? <span className="text-white/60">({addressFilter.radius} m)</span> : null}
          <button
            type="button"
            className="rounded border border-white/10 px-2 py-1 text-[10px] uppercase text-white/70 hover:border-white/30"
            onClick={onClearAddress}
          >
            Limpar
          </button>
        </div>
      ) : null}

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

export function MonitoringSearchBox({
  value,
  onChange,
  placeholder,
  suggestions = [],
  onSelectSuggestion,
  icon = <SearchIcon />,
  isLoading = false,
  containerClassName = "",
}) {
  const trimmedValue = (value || "").trim();
  const [isFocused, setIsFocused] = React.useState(false);
  const showSuggestions =
    isFocused && Boolean(trimmedValue) && Array.isArray(suggestions) && suggestions.length > 0;

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && showSuggestions) {
      event.preventDefault();
      onSelectSuggestion?.(suggestions[0]);
    }
  };

  return (
    <div className={`relative flex min-w-[240px] max-w-xl flex-1 items-center gap-2 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2.5 shadow-inner ${containerClassName}`}>
      <div className="pointer-events-none flex items-center justify-center text-white/40">
        {icon}
      </div>
      <input
        type="text"
        value={value}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="ml-2 w-full bg-transparent text-xs text-white placeholder-white/40 focus:outline-none"
      />

      {isLoading ? (
        <div
          className="ml-2 h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-transparent"
          aria-label="loading"
        />
      ) : null}

      {showSuggestions && (
        <div className="absolute left-0 top-11 z-20 w-full rounded-lg border border-white/10 bg-[#0f141c] shadow-3xl">
          <ul className="max-h-64 overflow-auto text-xs text-white/80">
            {suggestions.map((item) => (
              <li
                key={`${item.type}-${item.id ?? item.deviceId ?? item.label}`}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-white/5"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelectSuggestion?.(item)}
              >
                <span className="text-white/60">
                  {item.type === "address" ? "📍" : "🚗"}
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-white">{item.label}</span>
                  {item.description ? (
                    <span className="truncate text-[10px] text-white/60">{item.description}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

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

const ActionButton = React.forwardRef(function ActionButton({ icon, active, onClick, title }, ref) {
  return (
    <button
      ref={ref}
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
});
