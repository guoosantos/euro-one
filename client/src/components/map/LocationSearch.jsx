import React, { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";

import Input from "../../ui/Input.jsx";

export default function LocationSearch({
  value,
  onChange,
  onSubmit,
  suggestions = [],
  onSelectSuggestion,
  isSearching,
  errorMessage,
  placeholder = "Buscar endereço ou coordenada",
  containerClassName = "",
  floating = false,
  onClear,
}) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const safeSuggestions = useMemo(() => (Array.isArray(suggestions) ? suggestions : []), [suggestions]);
  const hasSuggestions = safeSuggestions.length > 0;

  useEffect(() => {
    setActiveIndex(-1);
  }, [value, safeSuggestions.length]);

  const handleKeyDown = (event) => {
    if (!hasSuggestions) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, safeSuggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === "Enter") {
      const selected = safeSuggestions[Math.max(activeIndex, 0)];
      if (selected) {
        event.preventDefault();
        onSelectSuggestion?.(selected);
      } else if (onSubmit) {
        event.preventDefault();
        onSubmit();
      }
    }
  };

  return (
    <div className={`${floating ? "floating-search" : ""} ${containerClassName}`.trim()}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.(event);
        }}
        className="map-search-form shadow-2xl"
      >
        <Input
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          icon={Search}
          className="map-search-input pr-12"
          onKeyDown={handleKeyDown}
        />
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2 text-xs text-white/70">
          {isSearching ? "Buscando..." : errorMessage || ""}
          {onClear && value ? (
            <button
              type="button"
              className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/70 hover:text-white"
              onClick={onClear}
            >
              Limpar
            </button>
          ) : null}
        </div>
      </form>
      {hasSuggestions && (
        <div className="map-search-suggestions">
          {safeSuggestions.map((item, index) => {
            const key = item.id || `${item.lat}-${item.lng}-${index}`;
            const isActive = index === activeIndex;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelectSuggestion?.(item)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm text-white/80 transition ${
                  isActive ? "bg-white/10" : "hover:bg-white/5"
                }`}
              >
                <span className="mt-1 h-2 w-2 rounded-full bg-primary/80" />
                <span>
                  <div className="font-semibold text-white">{item.concise || item.label}</div>
                  <div className="text-xs text-white/60">
                    Lat {Number(item.lat).toFixed(4)} · Lng {Number(item.lng).toFixed(4)}
                  </div>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
