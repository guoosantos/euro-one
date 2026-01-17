import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";

import Input from "../../ui/Input.jsx";

function buildSuggestionLines(item) {
  if (!item) return { title: "", subtitle: "" };
  const title = item.concise || item.label || item.address || "";
  const candidates = [item.label, item.address, item.subtitle, item.description].filter(Boolean);
  const subtitle = candidates.find((value) => value !== title) || "";
  return { title, subtitle };
}

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
  variant = "map",
  portalSuggestions = false,
}) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isFocused, setIsFocused] = useState(false);
  const [portalStyle, setPortalStyle] = useState(null);
  const containerRef = useRef(null);
  const safeSuggestions = useMemo(() => (Array.isArray(suggestions) ? suggestions : []), [suggestions]);
  const trimmedValue = String(value ?? "").trim();
  const hasSuggestions = safeSuggestions.length > 0;
  const showSuggestions = isFocused && Boolean(trimmedValue) && hasSuggestions;
  const showClearButton = Boolean(onClear) && Boolean(trimmedValue);
  const isToolbar = variant === "toolbar";

  useEffect(() => {
    setActiveIndex(-1);
  }, [value, safeSuggestions.length]);

  useEffect(() => {
    if (!portalSuggestions || !showSuggestions) {
      setPortalStyle(null);
      return;
    }

    const updatePosition = () => {
      const element = containerRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      setPortalStyle({
        position: "fixed",
        top: rect.bottom + 8,
        left: rect.left,
        width: rect.width,
        zIndex: 1400,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [portalSuggestions, showSuggestions]);

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
        setIsFocused(false);
      } else if (onSubmit) {
        event.preventDefault();
        onSubmit();
      }
    }
  };

  const suggestionList = showSuggestions ? (
    <div
      className={isToolbar ? "map-search-suggestions left-0 w-full" : "map-search-suggestions"}
      style={portalSuggestions ? portalStyle : undefined}
    >
      <ul className="max-h-64 overflow-auto text-xs text-white/80">
        {safeSuggestions.map((item, index) => {
          const key = item.id || `${item.lat}-${item.lng}-${index}`;
          const isActive = index === activeIndex;
          const { title, subtitle } = buildSuggestionLines(item);
          return (
            <li
              key={key}
              className={`flex cursor-pointer items-start gap-2 px-3 py-2 text-left transition ${
                isActive ? "bg-white/10" : "hover:bg-white/5"
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSelectSuggestion?.(item);
                setIsFocused(false);
              }}
            >
              <span className="mt-1 h-2 w-2 rounded-full bg-primary/80" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-white">{title}</span>
                {subtitle ? (
                  <span className="truncate text-[10px] text-white/60">{subtitle}</span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  ) : null;

  if (isToolbar) {
    return (
      <div
        ref={containerRef}
        className={`relative flex min-w-[240px] max-w-xl flex-1 items-center gap-2 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2.5 shadow-inner ${
          containerClassName
        }`}
      >
        <div className="pointer-events-none flex items-center justify-center text-white/40">
          <Search size={16} />
        </div>
        <input
          type="text"
          value={value}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onChange={onChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="ml-2 w-full bg-transparent pr-10 text-xs text-white placeholder-white/40 focus:outline-none"
        />

        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-2 text-white/40">
          {isSearching ? (
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
              <X size={14} />
            </button>
          ) : null}
        </div>

        {portalSuggestions && suggestionList ? createPortal(suggestionList, document.body) : suggestionList}

        {errorMessage ? (
          <div className="absolute -bottom-5 left-0 text-[10px] text-amber-300/80">{errorMessage}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative ${floating ? "floating-search" : ""} ${containerClassName}`.trim()}
    >
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
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          icon={Search}
          className="map-search-input pr-12"
          onKeyDown={handleKeyDown}
        />
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2 text-xs text-white/70">
          {isSearching ? "Buscando..." : errorMessage || ""}
          {showClearButton ? (
            <button
              type="button"
              className="text-white/70 transition hover:text-white"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onClear?.()}
              aria-label="Limpar busca"
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
      </form>
      {portalSuggestions && suggestionList ? createPortal(suggestionList, document.body) : suggestionList}
    </div>
  );
}
