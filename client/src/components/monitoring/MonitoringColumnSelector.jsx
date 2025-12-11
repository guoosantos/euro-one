import React, { useRef } from "react";
import useOutsideClick from "../../hooks/useOutsideClick.js";

export default function MonitoringColumnSelector({
  columns,
  visibleState,
  onToggle,
  onReorder,
  onRestore,
  onClose,
}) {
  const containerRef = useRef(null);
  useOutsideClick(containerRef, onClose, true);

  return (
    <div
      ref={containerRef}
      className="absolute right-0 mt-2 w-64 rounded-xl border border-white/10 bg-[#0f141c] p-3 text-sm text-white/80 shadow-2xl z-[9999]"
    >
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">Colunas</div>
      <div className="space-y-1">
        {columns.map((column) => (
          <div
            key={column.key}
            className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-white/5 ${
              column.fixed ? "opacity-80" : ""
            }`}
            draggable={!column.fixed}
            onDragStart={() => !column.fixed && onReorder?.(column.key, column.key)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const fromKey = event.dataTransfer?.getData("text/column-key") || event.currentTarget.dataset.dragKey;
              if (fromKey && fromKey !== column.key) {
                onReorder?.(fromKey, column.key);
              }
            }}
            onDragEnd={() => {
              if (onClose) onClose();
            }}
            data-drag-key={column.key}
            onDragStartCapture={(event) => {
              if (column.fixed) return;
              event.dataTransfer?.setData("text/column-key", column.key);
            }}
          >
            <div className="flex items-center gap-2">
              {!column.fixed ? <span className="text-xs text-white/50">☰</span> : null}
              <span className="text-white/70">{column.label}</span>
            </div>
            <input
              type="checkbox"
              className="accent-primary"
              checked={visibleState?.[column.key] !== false}
              disabled={column.fixed}
              onChange={() => onToggle?.(column.key)}
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-3 w-full rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold text-white/80 hover:border-white/30"
        onClick={onRestore}
      >
        Restaurar padrão
      </button>
    </div>
  );
}
