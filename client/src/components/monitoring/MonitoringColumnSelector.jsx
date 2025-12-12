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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        ref={containerRef}
        className="w-full max-w-xl max-h-[85vh] overflow-hidden rounded-2xl border border-white/10 bg-[#0f141c] p-6 text-sm text-white/80 shadow-3xl"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">Colunas visíveis</div>
            <p className="text-xs text-white/60">Arraste para reordenar e marque para exibir ou esconder.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-lg border border-white/10 bg-white/5 text-white/70 transition hover:border-white/30 hover:text-white"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {columns.map((column) => (
            <div
              key={column.key}
              className={`flex items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2 hover:border-white/30 ${column.fixed ? "opacity-80" : ""}`}
              draggable={!column.fixed}
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
              <div className="flex items-center gap-3 text-sm text-white/80">
                {!column.fixed ? <span className="text-xs text-white/50">☰</span> : null}
                <span className="text-white/80">{column.label}</span>
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

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-white/10 px-3 py-2 text-[11px] font-semibold text-white/80 hover:border-white/30"
            onClick={onRestore}
          >
            Restaurar padrão
          </button>
          <button
            type="button"
            className="rounded-md border border-primary/40 bg-primary/20 px-3 py-2 text-[11px] font-semibold text-white hover:border-primary/60"
            onClick={onClose}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
