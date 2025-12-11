import React, { useRef } from "react";
import useOutsideClick from "../../hooks/useOutsideClick.js";

const options = [
  { key: "showMap", label: "Mostrar mapa" },
  { key: "showTable", label: "Mostrar tabela" },
];

export default function MonitoringLayoutSelector({ layoutVisibility, onToggle, onClose }) {
  const ref = useRef(null);
  useOutsideClick(ref, onClose, true);

  return (
    <div className="absolute right-0 mt-2 w-56 rounded-xl border border-white/10 bg-[#0f141c] p-3 text-sm text-white/80 shadow-2xl z-[9999]" ref={ref}>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">Layout</div>
      <div className="space-y-1">
        {options.map((option) => (
          <label
            key={option.key}
            className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1 hover:bg-white/5"
          >
            <span className="text-white/70">{option.label}</span>
            <input
              type="checkbox"
              className="accent-primary"
              checked={layoutVisibility?.[option.key] !== false}
              onChange={() => onToggle?.(option.key)}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
