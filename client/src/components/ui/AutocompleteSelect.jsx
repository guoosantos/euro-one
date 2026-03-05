import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";

const DROPDOWN_GAP = 8;
const DROPDOWN_MAX_HEIGHT = 280;
const DROPDOWN_MIN_HEIGHT = 160;

export default function AutocompleteSelect({
  label,
  placeholder = "Selecione",
  value,
  options = [],
  onChange,
  disabled = false,
  className = "",
  inputClassName = "",
  allowClear = true,
  debounceMs = 300,
  pageSize = 20,
  loadOptions,
  loadingText = "Carregando...",
  emptyText = "Nenhuma opção encontrada.",
  errorText = "Falha ao carregar opções.",
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const requestRef = useRef({ controller: null, seq: 0 });
  const [dropdownState, setDropdownState] = useState({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: DROPDOWN_MAX_HEIGHT,
    openUp: false,
  });
  const isAsync = typeof loadOptions === "function";
  const [remoteOptions, setRemoteOptions] = useState([]);
  const [remotePage, setRemotePage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const selectedOption = useMemo(
    () => options.find((option) => String(option.value) === String(value)) || null,
    [options, value],
  );

  useEffect(() => {
    if (selectedOption) {
      setSearch(selectedOption.label || "");
      return;
    }
    setSearch("");
  }, [selectedOption]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(search);
    }, debounceMs);
    return () => window.clearTimeout(handle);
  }, [debounceMs, search]);

  const filteredOptions = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    if (!term) return options;
    return options.filter((option) => {
      const haystack = [option.label, option.description, option.searchText, option.value]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [options, debouncedSearch]);

  const visibleOptions = isAsync ? remoteOptions : filteredOptions;

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target)) return;
      if (dropdownRef.current?.contains(event.target)) return;
      setIsOpen(false);
      setHighlightIndex(-1);
      if (selectedOption) setSearch(selectedOption.label || "");
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [selectedOption]);

  useEffect(() => {
    return () => {
      if (requestRef.current.controller) {
        requestRef.current.controller.abort();
      }
    };
  }, []);

  const fetchOptions = async ({ page = 1, append = false } = {}) => {
    if (!isAsync) return;
    if (requestRef.current.controller) {
      requestRef.current.controller.abort();
    }
    const controller = new AbortController();
    const seq = requestRef.current.seq + 1;
    requestRef.current = { controller, seq };
    setLoading(true);
    setLoadError("");
    try {
      const response = await loadOptions?.({
        query: debouncedSearch,
        page,
        pageSize,
        signal: controller.signal,
      });
      if (requestRef.current.seq !== seq) return;
      const nextOptions = Array.isArray(response?.options) ? response.options : [];
      setRemoteOptions((prev) => (append ? [...prev, ...nextOptions] : nextOptions));
      setHasMore(Boolean(response?.hasMore));
      setRemotePage(page);
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoadError(error?.message || errorText);
      setRemoteOptions([]);
      setHasMore(false);
    } finally {
      if (requestRef.current.seq === seq && !controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!isAsync || !isOpen) return;
    fetchOptions({ page: 1, append: false });
  }, [debouncedSearch, isAsync, isOpen]);

  const handleSelect = (option) => {
    setSearch(option.label || "");
    setIsOpen(false);
    setHighlightIndex(-1);
    onChange?.(option.value, option);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      setIsOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((prev) => {
        if (!visibleOptions.length) return -1;
        const next = prev < 0 ? 0 : prev + 1;
        return Math.min(next, visibleOptions.length - 1);
      });
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((prev) => {
        if (!visibleOptions.length) return -1;
        if (prev <= 0) return -1;
        return prev - 1;
      });
      return;
    }
    if (event.key === "Enter") {
      if (!isOpen) return;
      event.preventDefault();
      if (highlightIndex < 0) return;
      const candidate = visibleOptions[highlightIndex];
      if (candidate) handleSelect(candidate);
    }
  };

  const updateDropdownPosition = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const spaceBelow = viewportHeight - rect.bottom - DROPDOWN_GAP;
    const spaceAbove = rect.top - DROPDOWN_GAP;
    const openUp = spaceBelow < DROPDOWN_MIN_HEIGHT && spaceAbove > spaceBelow;
    const available = openUp ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(120, Math.min(DROPDOWN_MAX_HEIGHT, available));
    const left = Math.max(8, Math.min(rect.left, viewportWidth - rect.width - 8));
    const top = openUp ? rect.top - DROPDOWN_GAP : rect.bottom + DROPDOWN_GAP;

    setDropdownState({
      top,
      left,
      width: rect.width,
      maxHeight,
      openUp,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    updateDropdownPosition();
    const handleViewportChange = () => updateDropdownPosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isOpen, updateDropdownPosition]);

  const dropdown = isOpen && !disabled ? (
    <div
      ref={dropdownRef}
      className="z-[9999] rounded-lg border border-white/10 bg-[var(--sidebar)] py-1 shadow-lg"
      style={{
        position: "fixed",
        top: dropdownState.top,
        left: dropdownState.left,
        width: dropdownState.width,
        maxHeight: dropdownState.maxHeight,
        overflowY: "auto",
        transform: dropdownState.openUp ? "translateY(-100%)" : "none",
        transformOrigin: dropdownState.openUp ? "bottom left" : "top left",
      }}
    >
      {loading ? (
        <div className="px-3 py-2 text-xs text-white/50">{loadingText}</div>
      ) : loadError ? (
        <div className="px-3 py-2 text-xs text-red-200/80">{loadError}</div>
      ) : visibleOptions.length === 0 ? (
        <div className="px-3 py-2 text-xs text-white/50">{emptyText}</div>
      ) : (
        <ul className="text-sm">
          {visibleOptions.map((option, index) => (
            <li key={option.value ?? option.label ?? index}>
              <button
                type="button"
                className={`flex w-full flex-col gap-1 px-3 py-2 text-left transition hover:bg-white/5 ${
                  index === highlightIndex ? "bg-white/5" : ""
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  handleSelect(option);
                }}
              >
                <span className="text-white">{option.label}</span>
                {option.description ? (
                  <span className="text-xs text-white/50">{option.description}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {isAsync && hasMore && !loading && !loadError && (
        <button
          type="button"
          onClick={() => fetchOptions({ page: remotePage + 1, append: true })}
          className="flex w-full items-center justify-center gap-2 px-3 py-2 text-xs text-white/70 hover:bg-white/5"
        >
          Carregar mais
        </button>
      )}
    </div>
  ) : null;

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {label ? <span className="block text-xs uppercase tracking-wide text-white/60">{label}</span> : null}
      <div className="relative mt-1">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setIsOpen(true);
            setHighlightIndex(-1);
          }}
          onFocus={() => {
            setIsOpen(true);
            setHighlightIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={`w-full rounded-xl border border-white/10 bg-[var(--field-bg)] px-4 py-2 pr-10 text-sm text-white placeholder:text-white/50 hover:bg-[var(--field-bg-hover)] focus:border-white/30 focus:bg-[var(--field-bg-focus)] focus:outline-none disabled:cursor-not-allowed disabled:bg-[var(--field-bg-disabled)] disabled:opacity-70 ${inputClassName}`}
          aria-autocomplete="list"
          aria-expanded={isOpen}
          readOnly={disabled}
        />
        {allowClear && !disabled && search && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setDebouncedSearch("");
              setIsOpen(false);
              setHighlightIndex(-1);
              onChange?.("", null);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
            aria-label="Limpar seleção"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {typeof document !== "undefined" && dropdown ? createPortal(dropdown, document.body) : null}
      </div>
    </div>
  );
}
