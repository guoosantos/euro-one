import React from "react";

import { useTenant } from "../lib/tenant-context.jsx";

export function RequireTenant({ children }) {
  const { tenantId, tenants, role, loading, initialising } = useTenant();
  const hasTenant = Boolean(tenantId);
  const canProceed = hasTenant || role === "admin";

  if (loading || initialising) {
    return (
      <div className="flex min-h-[320px] items-center justify-center text-white/70">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-label="Carregando" />
      </div>
    );
  }

  if (!canProceed) {
    return (
      <div className="flex min-h-[320px] items-center justify-center px-6 text-center text-white/80">
        <div className="space-y-2">
          <div className="text-lg font-semibold text-white">Selecione um cliente para continuar</div>
          <p className="text-sm text-white/70">
            Sua sessão precisa estar vinculada a um cliente. Atualize a página ou entre em contato com um administrador.
          </p>
        </div>
      </div>
    );
  }

  if (role === "admin" && !hasTenant && tenants?.length === 0) {
    return (
      <div className="flex min-h-[320px] items-center justify-center px-6 text-center text-white/80">
        <div className="space-y-2">
          <div className="text-lg font-semibold text-white">Nenhum cliente cadastrado</div>
          <p className="text-sm text-white/70">Cadastre um cliente para acessar as funcionalidades principais.</p>
        </div>
      </div>
    );
  }

  return children;
}

export default RequireTenant;
