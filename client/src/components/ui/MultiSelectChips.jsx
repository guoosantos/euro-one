import React, { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

function matchesQuery(option, query) {
  const haystack = [option.label, option.description, option.searchText, option.value]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export default function MultiSelectChips({
  label,
  placeholder = "Buscar",
  options = [],
  values = [],
  onChange,
  disabled = false,
  emptyText = "Nenhuma opção encontrada.",
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const selectedSet = useMemo(() => new Set(values.map((value) => String(value))), [values]);
  const selectedOptions = useMemo(
    () => options.filter((option) => selectedSet.has(String(option.value))),
    [options, selectedSet],
  );

  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return options;
    return options.filter((option) => matchesQuery(option, term));
  }, [options, search]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleAdd = (value) => {
    const next = Array.from(new Set([...values, value].map(String)));
    onChange?.(next);
    setSearch("");
    setOpen(false);
  };

  const handleRemove = (value) => {
    const next = values.filter((entry) => String(entry) !== String(value));
    onChange?.(next);
  };

  return (
    <div ref={containerRef} className="space-y-2">
      {label ? <span className="block text-xs uppercase tracking-wide text-white/60">{label}</span> : null}
      <div className="relative">
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
        />
        {open && !disabled && (
          <div className="absolute z-[60] mt-2 max-h-60 w-full overflow-auto rounded-lg border border-white/10 bg-[#0f141c] py-1 shadow-lg">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-white/50">{emptyText}</div>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = selectedSet.has(String(option.value));
                return (
                  <button
                    key={option.value}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      if (isSelected) return;
                      handleAdd(option.value);
                    }}
                    className={`flex w-full flex-col gap-1 px-3 py-2 text-left transition hover:bg-white/5 ${
                      isSelected ? "opacity-50" : ""
                    }`}
                  >
                    <span className="text-sm text-white">{option.label}</span>
                    {option.description ? (
                      <span className="text-xs text-white/50">{option.description}</span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {selectedOptions.map((option) => (
          <span
            key={option.value}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/80"
          >
            {option.label}
            <button
              type="button"
              onClick={() => handleRemove(option.value)}
              className="text-white/60 hover:text-white"
              aria-label={`Remover ${option.label}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {!selectedOptions.length && <span className="text-xs text-white/40">Nenhum selecionado.</span>}
      </div>
    </div>
  );
}
