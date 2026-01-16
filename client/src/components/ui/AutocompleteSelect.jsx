import React, { useEffect, useMemo, useRef, useState } from "react";

export default function AutocompleteSelect({
  label,
  placeholder = "Selecione",
  value,
  options = [],
  onChange,
  disabled = false,
  className = "",
}) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef(null);

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

  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return options;
    return options.filter((option) => {
      const haystack = [
        option.label,
        option.description,
        option.searchText,
        option.value,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [options, search]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target)) return;
      setIsOpen(false);
      if (selectedOption) {
        setSearch(selectedOption.label || "");
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [selectedOption]);

  const handleSelect = (option) => {
    setSearch(option.label || "");
    setIsOpen(false);
    setHighlightIndex(0);
    onChange?.(option.value, option);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      setIsOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, filteredOptions.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      if (!isOpen) return;
      event.preventDefault();
      const candidate = filteredOptions[highlightIndex] || filteredOptions[0];
      if (candidate) {
        handleSelect(candidate);
      }
    }
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {label ? <span className="block text-xs uppercase tracking-wide text-white/60">{label}</span> : null}
      <div className="relative mt-1">
        <input
          type="text"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setIsOpen(true);
            setHighlightIndex(0);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          readOnly={disabled}
        />
        {isOpen && !disabled && (
          <div className="absolute z-[60] mt-2 max-h-64 w-full overflow-auto rounded-lg border border-white/10 bg-[#0f141c] py-1 shadow-lg">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-white/50">Nenhuma opção encontrada.</div>
            ) : (
              <ul className="text-sm">
                {filteredOptions.map((option, index) => (
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
          </div>
        )}
      </div>
    </div>
  );
}
