import React from "react";
import { usePermissionGate } from "../lib/permissions/permission-gate.js";

export default function RequirePermission({ permission, children }) {
  if (!permission) return children;
  const { canShow, hasAccess, isFull, loading } = usePermissionGate(permission);
  if (loading) return null;
  if (!canShow) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white">
        <h2 className="text-lg font-semibold">Sem acesso</h2>
        <p className="mt-2 text-sm text-white/60">Você não tem permissão para visualizar este conteúdo.</p>
      </div>
    );
  }
  if (!hasAccess) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white">
        <h2 className="text-lg font-semibold">Sem acesso</h2>
        <p className="mt-2 text-sm text-white/60">Seu perfil não possui acesso a esta seção.</p>
      </div>
    );
  }
  if (permission.requireFull && !isFull) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white">
        <h2 className="text-lg font-semibold">Acesso restrito</h2>
        <p className="mt-2 text-sm text-white/60">Seu perfil não possui acesso completo para esta operação.</p>
      </div>
    );
  }
  return children;
}
