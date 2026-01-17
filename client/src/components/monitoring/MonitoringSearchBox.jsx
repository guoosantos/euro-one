import React from "react";

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
);

export default function MonitoringSearchBox({
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
