import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export default function TenantCombobox({
  value,
  options = [],
  onChange,
  disabled = false,
  placeholder = "",
  emptyLabel = "",
  ariaLabel = "",
  toggleLabel = "",
  className = "",
}) {
  const listboxId = useId();
  const containerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);

  const normalizedValue = value ?? "";
  const selectedOption = useMemo(
    () => options.find((option) => String(option.id) === String(normalizedValue)) ?? null,
    [options, normalizedValue],
  );

  const filteredOptions = useMemo(() => {
    if (!query.trim()) return options;
    const term = query.trim().toLowerCase();
    return options.filter((option) => (option.label || "").toLowerCase().includes(term));
  }, [options, query]);

  const displayValue = open ? query : (selectedOption?.label ?? "");
  const showPlaceholder = open ? placeholder : (selectedOption ? "" : placeholder);

  const closeMenu = () => {
    setOpen(false);
    setActiveIndex(-1);
    setQuery("");
  };

  const handleSelect = (option) => {
    if (!option || option.disabled) return;
    onChange?.(option.id);
    closeMenu();
  };

  const moveActive = (delta) => {
    if (!filteredOptions.length) return;
    let nextIndex = activeIndex;
    for (let i = 0; i < filteredOptions.length; i += 1) {
      nextIndex = (nextIndex + delta + filteredOptions.length) % filteredOptions.length;
      if (!filteredOptions[nextIndex]?.disabled) {
        setActiveIndex(nextIndex);
        return;
      }
    }
  };

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target)) return;
      closeMenu();
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("pointerdown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(-1);
    }
  }, [open]);

  return (
    <div ref={containerRef} className={`relative ${className}`.trim()}>
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-label={ariaLabel || placeholder}
          value={displayValue}
          disabled={disabled}
          placeholder={showPlaceholder}
          onChange={(event) => {
            if (!open) setOpen(true);
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onFocus={() => {
            if (disabled) return;
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (!open) setOpen(true);
              moveActive(1);
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) setOpen(true);
              moveActive(-1);
            }
            if (event.key === "Enter") {
              if (!open) return;
              if (activeIndex >= 0 && filteredOptions[activeIndex]) {
                event.preventDefault();
                handleSelect(filteredOptions[activeIndex]);
              }
            }
            if (event.key === "Escape") {
              if (open) {
                event.preventDefault();
                closeMenu();
              }
            }
          }}
          className="h-10 w-full rounded-xl border border-border bg-layer px-3 pr-9 text-sm text-text placeholder:text-sub focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="button"
          aria-label={toggleLabel || ariaLabel || placeholder || "Abrir"}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            setOpen((state) => !state);
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-sub transition hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
        >
          <ChevronDown size={16} className={open ? "rotate-180 transition" : "transition"} />
        </button>
      </div>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-70 mt-2 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface shadow-soft"
        >
          {filteredOptions.length ? (
            <ul className="py-1">
              {(() => {
                const items = [];
                let lastGroup = null;
                filteredOptions.forEach((option, index) => {
                  const groupLabel = option.group || null;
                  if (groupLabel && groupLabel !== lastGroup) {
                    items.push(
                      <li key={`group-${groupLabel}`} className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-sub">
                        {groupLabel}
                      </li>,
                    );
                    lastGroup = groupLabel;
                  }
                  const isActive = index === activeIndex;
                  const isSelected = selectedOption && String(option.id) === String(selectedOption.id);
                  items.push(
                    <li key={`${option.id}-${option.label}`} role="option" aria-selected={isSelected}>
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleSelect(option)}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
                          option.disabled
                            ? "cursor-not-allowed text-sub opacity-70"
                            : "text-text hover:bg-layer"
                        } ${isActive ? "bg-layer" : ""}`.trim()}
                      >
                        <span className="flex flex-1 items-center gap-2">
                          <span className="truncate">{option.label}</span>
                          {option.helper && (
                            <span className="text-xs text-sub">{option.helper}</span>
                          )}
                        </span>
                        {isSelected && <Check size={16} className="text-primary" />}
                      </button>
                    </li>,
                  );
                });
                return items;
              })()}
            </ul>
          ) : (
            <div className="px-3 py-3 text-sm text-sub">
              {emptyLabel || "Nenhum resultado"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
