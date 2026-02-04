import React from "react";
import { resolvePermissionDecision } from "../lib/permissions.js";
import { useTenant } from "../lib/tenant-context.jsx";
import Loading from "./Loading.jsx";

export default function RequirePermission({ permission, children }) {
  if (!permission) return children;
  const { tenant, user, permissionContext, permissionsReady, isGlobalAdmin } = useTenant();
  const access = resolvePermissionDecision(permission, {
    user,
    tenant,
    permissionContext,
    permissionsReady,
    isGlobalAdmin,
  });
  if (!access.ready) {
    return <Loading message="Carregando permissões..." />;
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
