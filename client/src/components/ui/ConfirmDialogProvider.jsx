import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import useOverlayActivity from "../../lib/hooks/useOverlayActivity.js";
import useApiMutation from "../../lib/hooks/useApiMutation.js";

const ConfirmDialogContext = createContext({
  confirmDelete: async () => false,
});

function resolveErrorMessage(error) {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error?.message ||
    error?.message ||
    "Não foi possível concluir a exclusão."
  );
}

export function ConfirmDialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const { mutate, loading, error, resetError } = useApiMutation();
  const resolverRef = useRef(null);

  const confirmDelete = useCallback((options = {}) => {
    setDialog({
      title: options.title || "Confirmar exclusão",
      message: options.message || "Tem certeza que deseja excluir este item?",
      confirmLabel: options.confirmLabel || "Excluir",
      onConfirm: options.onConfirm,
    });
    resetError();
    return new Promise((resolve) => {
      resolverRef.current = resolve;
    });
  }, [resetError]);

  const closeDialog = useCallback((result) => {
    setDialog(null);
    resetError();
    if (resolverRef.current) {
      resolverRef.current(result);
      resolverRef.current = null;
    }
  }, [resetError]);

  const handleConfirm = useCallback(async () => {
    if (!dialog?.onConfirm) {
      closeDialog(true);
      return;
    }
    try {
      await mutate(dialog.onConfirm);
      closeDialog(true);
    } catch {
      // erro já capturado pelo hook
    }
  }, [closeDialog, dialog, mutate]);

  const errorMessage = error ? resolveErrorMessage(error) : null;

  useOverlayActivity(Boolean(dialog));

  const value = useMemo(() => ({ confirmDelete }), [confirmDelete]);

  return (
    <ConfirmDialogContext.Provider value={value}>
      {children}
      {dialog ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal max-w-md">
            <div className="title">{dialog.title}</div>
            <p className="mt-2 text-sm text-white/70">{dialog.message}</p>
            {errorMessage ? (
              <div className="mt-3 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {errorMessage}
              </div>
            ) : null}
            <div className="footer">
              <button type="button" className="btn" onClick={() => closeDialog(false)} disabled={loading}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={handleConfirm}
                disabled={loading}
              >
                {loading ? "Excluindo..." : dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  return useContext(ConfirmDialogContext);
}

export default ConfirmDialogProvider;
