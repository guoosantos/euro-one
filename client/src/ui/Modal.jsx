import React, { useEffect, useRef } from "react";

export default function Modal({ open, title, onClose, children, footer = null, width = "max-w-5xl" }) {
  const bodyRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !bodyRef.current) return;
    const firstField = bodyRef.current.querySelector("input, select, textarea, button");
    firstField?.focus?.();
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={`relative z-50 w-full max-w-5xl ${width}`}>
        <div className="card flex max-h-[90vh] flex-col overflow-hidden">
          <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-stroke pb-3">
            <div className="h1">{title}</div>
            <button className="btn" onClick={onClose} type="button">
              Fechar
            </button>
          </div>

          <div ref={bodyRef} className="flex-1 overflow-y-auto pt-3">
            {children}
          </div>

          {footer && (
            <div className="sticky bottom-0 mt-4 flex justify-end gap-2 border-t border-stroke bg-card pt-4">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
