import React, { useEffect, useState } from "react";
import useEagleLoader from "../lib/hooks/useEagleLoader";

export default function Loading({ message = "Carregando...", onRetry, showRetryAfterMs = 8000 }) {
  const { register } = useEagleLoader();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const cleanup = register(message);
    return () => {
      cleanup?.();
    };
  }, [message, register]);

  useEffect(() => {
    if (!showRetryAfterMs) return undefined;
    const timer = window.setTimeout(() => setSlow(true), showRetryAfterMs);
    return () => window.clearTimeout(timer);
  }, [showRetryAfterMs]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0f17] px-6 py-10 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 text-center shadow-2xl">
        <div className="mx-auto mb-4 h-10 w-10 animate-pulse rounded-full border border-white/20 bg-white/10" />
        <p className="text-sm font-semibold">{message}</p>
        <p className="mt-2 text-xs text-white/60">
          {slow ? "Está demorando mais que o normal. Verifique sua conexão." : "Preparando o ambiente..."}
        </p>
        {slow && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {typeof onRetry === "function" && (
              <button
                type="button"
                onClick={() => onRetry?.()}
                className="rounded-lg border border-primary/50 bg-primary/20 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em]"
              >
                Tentar novamente
              </button>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-white/20 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70"
            >
              Recarregar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
