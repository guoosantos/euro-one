import React from "react";
import { useTranslation } from "../../lib/i18n.js";
import AddressSearchInput from "../shared/AddressSearchInput.jsx";

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
  vehicleSearchTerm,
  onVehicleSearchChange,
  vehicleSuggestions,
  onSelectVehicleSuggestion,
  addressSearchState,
  onSelectAddress,
  filterMode,
  onFilterChange,
  summary,
  activePopup,     // Props novas (do Monitoring.jsx atualizado)
  onTogglePopup,   // Props novas
  onOpenColumns,   // Props antigas (fallback)
  onOpenLayout,    // Props antigas (fallback)
  layoutButtonRef,
  onClearAddress,
  hasSelection,
  onClearSelection,
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
    <div className="flex h-full w-full flex-col gap-3 overflow-visible text-[11px] text-white/80">
      <div className="flex flex-wrap items-start gap-2 overflow-visible lg:items-center lg:gap-3">
        <div className="flex min-w-[280px] flex-1 flex-col gap-2 overflow-visible lg:flex-row lg:items-center lg:gap-2">
          <MonitoringSearchBox
            value={vehicleSearchTerm}
            onChange={onVehicleSearchChange}
            placeholder={t("monitoring.searchPlaceholderSimple")}
            suggestions={vehicleSuggestions}
            onSelectSuggestion={onSelectVehicleSuggestion}
            icon={<SearchIcon />}
          />

          <AddressSearchInput
            state={addressSearchState}
            onSelect={onSelectAddress}
            onClear={onClearAddress}
            placeholder={t("monitoring.searchRegionPlaceholder")}
            containerClassName="w-full"
            variant="toolbar"
          />
        </div>

        <div className="ml-auto flex h-full items-center gap-1 overflow-visible">
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
          {hasSelection ? (
            <button
              type="button"
              onClick={onClearSelection}
              className="ml-1 flex h-10 items-center justify-center rounded-md border border-white/15 bg-[#0d1117] px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/70 transition hover:border-white/30 hover:text-white"
              title="Limpar seleção"
            >
              Limpar
            </button>
          ) : null}
        </div>
      </div>

      <StatusSummaryLine summary={summary} t={t} activeFilter={filterMode} onChange={onFilterChange} />
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
  onSubmit,
  errorMessage,
  onClear,
}) {
  const trimmedValue = (value || "").trim();
  const [isFocused, setIsFocused] = React.useState(false);
  const showSuggestions =
    isFocused && Boolean(trimmedValue) && Array.isArray(suggestions) && suggestions.length > 0;
  const showClearButton = Boolean(onClear) && Boolean(trimmedValue);

  const handleKeyDown = (event) => {
    if (event.key === "Enter") {
      if (showSuggestions) {
        event.preventDefault();
        onSelectSuggestion?.(suggestions[0]);
        return;
      }
      if (onSubmit) {
        event.preventDefault();
        onSubmit(trimmedValue);
      }
    }
  };

  return (
    <div
      className={`relative flex min-w-[240px] max-w-xl flex-1 items-center gap-2 overflow-visible rounded-md border border-white/10 bg-[#0d1117] px-3 py-2.5 shadow-inner ${containerClassName}`}
    >
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
        className="ml-2 w-full bg-transparent pr-10 text-xs text-white placeholder-white/40 focus:outline-none"
      />

      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-2 text-white/40">
        {isLoading ? (
          <div
            className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-transparent"
            aria-label="loading"
          />
        ) : null}
        {showClearButton ? (
          <button
            type="button"
            className="pointer-events-auto text-white/50 transition hover:text-white"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onClear?.()}
            aria-label="Limpar busca"
          >
            ✕
          </button>
        ) : null}
      </div>

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

      {errorMessage ? (
        <div className="text-[10px] text-amber-300/80">{errorMessage}</div>
      ) : null}
    </div>
  );
}

function StatusSummaryLine({ t, summary, activeFilter, onChange }) {
  const primaryItems = [
    { key: "all", label: t("monitoring.filters.all"), value: summary?.total ?? 0 },
    { key: "online", label: t("monitoring.filters.online"), value: summary?.online ?? 0 },
    { key: "stale_1_6", label: t("monitoring.filters.noSignal1to6h"), value: summary?.stale1to6 ?? 0 },
    { key: "stale_6_24", label: t("monitoring.filters.noSignal6to24h"), value: summary?.stale6to24 ?? 0 },
    { key: "stale_24_plus", label: t("monitoring.filters.noSignal24h"), value: summary?.stale24Plus ?? 0 },
  ];
  const secondaryItems = [
    { key: "critical", label: t("monitoring.filters.criticalEvents"), value: summary?.critical ?? 0 },
    { key: "conjugated", label: t("monitoring.filters.conjugatedAlerts"), value: summary?.conjugated ?? 0 },
  ];

  const renderRow = (items, rowId) => (
    <div
      key={rowId}
      className="flex min-h-[24px] flex-nowrap items-center gap-2 overflow-x-auto px-1 py-0.5 text-[10px] leading-[14px] text-white/60"
    >
      {items.map((item) => {
        const isActive = activeFilter === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange?.(item.key)}
            aria-pressed={isActive}
            className={`flex min-w-[108px] cursor-pointer items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-left text-[10px] leading-[14px] font-medium transition-colors focus:outline-none ${
              isActive ? "bg-primary/15 text-primary" : "text-white/70 hover:text-white/90"
            }`}
          >
            <span className="uppercase tracking-[0.08em]">{item.label}</span>
            <span className="font-semibold text-white">{item.value}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="relative -mx-1 flex flex-col gap-1">
      {renderRow(primaryItems, "primary")}
      {renderRow(secondaryItems, "secondary")}
    </div>
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
