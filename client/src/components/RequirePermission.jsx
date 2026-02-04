import React from "react";
import { resolvePermissionDecision } from "../lib/permissions.js";
import { useTenant } from "../lib/tenant-context.jsx";
import Loading from "./Loading.jsx";

export default function RequirePermission({ permission, children }) {
  if (!permission) return children;
  const {
    tenant,
    user,
    permissionContext,
    permissionError,
    permissionLoading,
    permissionsReady,
    isGlobalAdmin,
    isReadOnly,
    logout,
    retryPermissions,
  } = useTenant();
  const access = resolvePermissionDecision(permission, {
    user,
    tenant,
    permissionContext,
    permissionsReady,
    isGlobalAdmin,
    readOnly: isReadOnly,
  });
  const handleReload = () => {
    window.location.reload();
  };

  const handleRetry = () => {
    retryPermissions?.("manual");
  };

  const handleLogout = async () => {
    try {
      await logout?.();
    } finally {
      window.location.assign("/login");
    }
  };
  if (!access.ready) {
    if (!permissionError || permissionLoading) {
      return <Loading message="Carregando permissões..." />;
    }
    return (
      <div className="flex min-h-[320px] items-center justify-center px-6 text-center text-white/80">
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="text-lg font-semibold text-white">Permissões não carregaram</div>
          <p className="text-sm text-white/70">
            Não foi possível carregar as permissões da sessão. Tente recarregar a página ou refazer o login.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/90 hover:border-white/40"
            >
              Tentar novamente
            </button>
            <button
              type="button"
              onClick={handleReload}
              className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/90 hover:border-white/40"
            >
              Recarregar
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/80 hover:border-white/40"
            >
              Sair
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!access.allowedByTenant) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white">
        <h2 className="text-lg font-semibold">Sem acesso</h2>
        <p className="mt-2 text-sm text-white/60">Este módulo não está habilitado para o cliente atual.</p>
      </div>
    );
  }
  if (!access.canShow) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white">
        <h2 className="text-lg font-semibold">Sem acesso</h2>
        <p className="mt-2 text-sm text-white/60">Você não tem permissão para visualizar este conteúdo.</p>
      </div>
    );
  }
  if (!access.hasAccess) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white">
        <h2 className="text-lg font-semibold">Sem acesso</h2>
        <p className="mt-2 text-sm text-white/60">Seu perfil não possui acesso a esta seção.</p>
      </div>
    );
  }
  if (permission.requireFull && !access.isFull) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white">
        <h2 className="text-lg font-semibold">Acesso restrito</h2>
        <p className="mt-2 text-sm text-white/60">Seu perfil não possui acesso completo para esta operação.</p>
      </div>
    );
  }
  return children;
}
