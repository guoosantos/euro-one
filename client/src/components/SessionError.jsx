import React from "react";
import { useTenant } from "../lib/tenant-context";

export default function SessionError({ error }) {
  const { logout } = useTenant();
  const message =
    error?.message ||
    "Não foi possível carregar o contexto da sessão. Tente novamente.";

  const handleReload = () => {
    window.location.reload();
  };

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      window.location.assign("/login");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950/40 px-6 py-10">
      <div className="w-full max-w-xl rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-red-100 shadow-lg">
        <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-red-200/70">
          Sessão
        </div>
        <div className="mt-2 text-xl font-semibold">Falha ao carregar a sessão</div>
        <div className="mt-2 text-sm text-red-100/80">{message}</div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleReload}
            className="rounded-lg border border-red-300/40 bg-red-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-red-100 hover:border-red-300/70"
          >
            Recarregar
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg border border-red-300/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-red-100/90 hover:border-red-300/70"
          >
            Sair
          </button>
        </div>
        <div className="mt-3 text-[11px] text-red-200/70">
          Se o problema persistir, informe o suporte com o horário do erro.
        </div>
      </div>
    </div>
  );
}
