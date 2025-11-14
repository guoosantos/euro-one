import React from "react";

import { useTenant } from "../lib/tenant-context";

export default function Account() {
  const { tenant, tenants, setTenantId, user, role } = useTenant();
  const isAdmin = role === "admin";

  return (
    <div className="space-y-4">
      <section className="card space-y-2">
        <div className="text-sm font-medium text-white">Sessão atual</div>
        <div className="text-xs text-white/60">{user?.email}</div>
        <div className="text-xs text-white/40">Perfil: {role}</div>
      </section>

      <section className="card">
        <div className="text-sm font-medium text-white">Tenant ativo</div>
        <div className="mt-2 text-sm text-white/80">{tenant?.name ?? "Nenhum"}</div>
        <div className="text-xs text-white/40">Segmento: {tenant?.segment ?? "—"}</div>
      </section>

      <section className="card">
        <div className="text-sm font-medium text-white">Alternar cliente</div>
        <p className="mt-2 text-xs text-white/50">
          {isAdmin
            ? "Selecione um cliente para visualizar seus dispositivos, usuários e telemetria."
            : "Sua conta está vinculada ao cliente abaixo."
          }
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {tenants.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTenantId(item.id)}
              className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                tenant?.id === item.id ? "border-primary/40 bg-primary/10" : "border-white/10 bg-white/5 hover:bg-white/10"
              }`}
            >
              <div className="font-medium text-white">{item.name}</div>
              <div className="text-xs text-white/50">
                Limites: {item.deviceLimit ?? "∞"} dispositivos · {item.userLimit ?? "∞"} usuários
              </div>
            </button>
          ))}
          {!tenants.length && <div className="rounded-xl border border-dashed border-white/20 p-4 text-sm text-white/50">Nenhum cliente disponível.</div>}
        </div>
      </section>
    </div>
  );
}
