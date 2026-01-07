import React, { useMemo, useState } from "react";
import { buildColumnDefaults } from "../../lib/column-preferences.js";

function reorder(list, fromKey, toKey) {
  const currentOrder = Array.isArray(list) ? [...list] : [];
  const fromIndex = currentOrder.indexOf(fromKey);
  const toIndex = currentOrder.indexOf(toKey);
  if (fromIndex === -1 || toIndex === -1) return currentOrder;
  const next = [...currentOrder];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export default function MonitoringColumnSelector({
  columns,
  columnPrefs,
  defaultPrefs,
  onApply,
  onRestore,
  onClose,
  restoreLabel = "Padrão Euro",
}) {
  const defaults = useMemo(() => defaultPrefs || buildColumnDefaults(columns), [columns, defaultPrefs]);

  const initialState = useMemo(
    () => ({
      visible: { ...(columnPrefs?.visible || {}) },
      order: [...(columnPrefs?.order || columns.map((col) => col.key))],
    }),
    [columnPrefs, columns],
  );

  const [working, setWorking] = useState(initialState);

  const orderedColumns = useMemo(() => {
    const ordered = working.order
      .map((key) => columns.find((col) => col.key === key))
      .filter(Boolean);
    const missing = columns.filter((col) => !working.order.includes(col.key));
    return [...ordered, ...missing];
  }, [columns, working.order]);

  const toggleVisibility = (key) => {
    setWorking((prev) => ({
      ...prev,
      visible: { ...prev.visible, [key]: prev.visible?.[key] === false },
    }));
  };

  const handleDrop = (fromKey, toKey) => {
    setWorking((prev) => ({
      ...prev,
      order: reorder(prev.order, fromKey, toKey),
    }));
  };

  const handleApply = () => {
    onApply?.({ ...working, widths: columnPrefs?.widths });
    onClose?.();
  };

  const handleRestore = () => {
    const defaultState = {
      visible: { ...(defaults?.visible || {}) },
      order: [...(defaults?.order || columns.map((col) => col.key))],
      widths: defaults?.widths,
    };
    setWorking(defaultState);
    onRestore?.();
  };

  const handleCancel = () => {
    setWorking(initialState);
    onClose?.();
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-xl max-h-[85vh] overflow-hidden rounded-2xl border border-white/10 bg-[#0f141c] p-6 text-sm text-white/80 shadow-3xl"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">Colunas visíveis</div>
            <p className="text-xs text-white/60">Arraste para reordenar, marque para exibir ou esconder.</p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="h-9 w-9 rounded-lg border border-white/10 bg-white/5 text-white/70 transition hover:border-white/30 hover:text-white"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {orderedColumns.map((column) => (
            <div
              key={column.key}
              className={`flex items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2 hover:border-white/30 ${column.fixed ? "opacity-80" : ""}`}
              draggable={!column.fixed}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const fromKey = event.dataTransfer?.getData("text/column-key") || event.currentTarget.dataset.dragKey;
                if (fromKey && fromKey !== column.key) {
                  handleDrop(fromKey, column.key);
                }
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
                checked={working.visible?.[column.key] !== false}
                disabled={column.fixed}
                onChange={() => toggleVisibility(column.key)}
              />
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            className="rounded-md border border-white/10 px-3 py-2 text-[11px] font-semibold text-white/80 hover:border-white/30"
            onClick={handleRestore}
          >
            {restoreLabel}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-white/10 px-3 py-2 text-[11px] font-semibold text-white/80 hover:border-white/30"
              onClick={handleCancel}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="rounded-md border border-primary/40 bg-primary/20 px-3 py-2 text-[11px] font-semibold text-white hover:border-primary/60"
              onClick={handleApply}
            >
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
