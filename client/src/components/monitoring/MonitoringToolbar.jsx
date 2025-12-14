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
  onAddressSubmit,
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
  addressError,
  hasSelection,
  onClearSelection,
}) {
  const { t } = useTranslation();
  const [showStatusDetails, setShowStatusDetails] = React.useState(false);
  const statusDetailsRef = React.useRef(null);

  React.useEffect(() => {
    if (!showStatusDetails) return undefined;
    const handleClickOutside = (event) => {
      if (statusDetailsRef.current && !statusDetailsRef.current.contains(event.target)) {
        setShowStatusDetails(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [showStatusDetails]);

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
    <div className="flex h-full w-full flex-col gap-3 text-[11px] text-white/80">
      <div className="flex flex-wrap items-start gap-2 lg:items-center lg:gap-3">
        <div className="flex min-w-[280px] flex-1 flex-col gap-2 lg:flex-row lg:items-center lg:gap-2">
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
            onSubmit={onAddressSubmit}
            errorMessage={addressError}
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

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#0d1117]/70 px-3 py-2 shadow-inner shadow-black/20">
        <FilterSegments
          t={t}
          summary={summary}
          activeFilter={filterMode}
          onChange={onFilterChange}
        />

        <div className="relative ml-auto flex flex-1 flex-wrap items-center justify-end gap-2" ref={statusDetailsRef}>
          <StatusBubbleRow summary={summary} />
          <button
            type="button"
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/70 transition hover:border-white/30 hover:text-white"
            onClick={() => setShowStatusDetails((prev) => !prev)}
          >
            Detalhes
          </button>

          {showStatusDetails ? (
            <StatusDetailsPanel
              summary={summary}
              t={t}
              onClose={() => setShowStatusDetails(false)}
            />
          ) : null}
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
}) {
  const trimmedValue = (value || "").trim();
  const [isFocused, setIsFocused] = React.useState(false);
  const showSuggestions =
    isFocused && Boolean(trimmedValue) && Array.isArray(suggestions) && suggestions.length > 0;

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

      {errorMessage ? (
        <div className="text-[10px] text-amber-300/80">{errorMessage}</div>
      ) : null}
    </div>
  );
}

function FilterSegments({ t, summary, activeFilter, onChange }) {
  const options = [
    { key: "all", label: t("monitoring.filters.all"), value: summary?.total },
    { key: "online", label: t("monitoring.filters.online"), value: summary?.online },
    { key: "stale", label: t("monitoring.filters.offline"), value: summary?.offline },
    { key: "critical", label: t("monitoring.filters.criticalEvents"), value: summary?.critical },
  ];

  return (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-lg border border-white/10 bg-[#0d1117]/80 shadow-inner shadow-black/5">
        {options.map((option, index) => {
          const isActive = activeFilter === option.key;
          const divider = index > 0 ? "border-l border-white/5" : "";
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => onChange?.(option.key)}
              className={`flex items-center gap-1 px-3 py-2 text-[11px] font-semibold leading-none transition ${
                isActive
                  ? "bg-white/10 text-white shadow-inner shadow-black/10"
                  : "text-white/60 hover:bg-white/5 hover:text-white"
              } ${divider}`}
            >
              <span className="whitespace-nowrap">{option.label}</span>
              <span
                className={`rounded px-1 text-[10px] ${
                  isActive ? "bg-primary/30 text-primary-100" : "bg-white/5 text-white/60"
                }`}
              >
                {option.value ?? 0}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatusBubbleRow({ summary }) {
  const items = [
    { key: "total", label: "Total", value: summary?.total, tone: "text-white" },
    { key: "online", label: "Online", value: summary?.online, tone: "text-emerald-300" },
    { key: "crit", label: "Críticos", value: summary?.critical, tone: "text-amber-300" },
    { key: "offline", label: "Offline", value: summary?.offline, tone: "text-red-300" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 shadow-inner shadow-black/10">
      {items.map((item) => (
        <div key={item.key} className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold leading-none">
          <span className={item.tone}>{item.label}</span>
          <span className="rounded bg-black/20 px-1 text-white">{item.value ?? 0}</span>
        </div>
      ))}
    </div>
  );
}

function StatusDetailsPanel({ summary, t, onClose }) {
  const detailItems = [
    { label: t("monitoring.filters.all"), value: summary?.total, accent: "text-white" },
    { label: t("monitoring.filters.online"), value: summary?.online, accent: "text-emerald-300" },
    { label: t("monitoring.filters.offline"), value: summary?.offline, accent: "text-red-300" },
    { label: t("monitoring.filters.criticalEvents"), value: summary?.critical, accent: "text-amber-300" },
    { label: t("monitoring.filters.noSignal1to3h"), value: summary?.stale1to3, accent: "text-emerald-100" },
    { label: t("monitoring.filters.noSignal6to18h"), value: summary?.stale6to18, accent: "text-amber-100" },
    { label: t("monitoring.filters.noSignal24h"), value: summary?.stale24, accent: "text-yellow-200" },
    { label: t("monitoring.filters.noSignal10d"), value: summary?.stale10d, accent: "text-orange-200" },
    { label: t("monitoring.filters.ignitionOn"), value: summary?.moving, accent: "text-sky-200" },
  ];

  return (
    <div className="absolute right-0 top-full z-30 mt-2 w-full max-w-xl rounded-xl border border-white/10 bg-[#0f141c] p-3 text-[11px] shadow-3xl">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.08em] text-white/60">
        <span>Resumo detalhado</span>
        <button
          type="button"
          className="rounded border border-white/15 px-2 py-1 text-[10px] text-white/70 hover:border-white/30 hover:text-white"
          onClick={onClose}
        >
          Fechar
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {detailItems.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-[11px] shadow-inner shadow-black/10"
          >
            <span className={`font-semibold ${item.accent}`}>{item.label}</span>
            <span className="text-white">{item.value ?? 0}</span>
          </div>
        ))}
      </div>
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
