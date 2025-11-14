import React from "react";

import { useTenant } from "../lib/tenant-context";

export default function Account() {
  const { tenant, tenants, setTenantId } = useTenant();

  return (
    <div className="space-y-4">
      <section className="card">
        <div className="text-sm font-medium text-white">Tenant atual</div>
        <div className="mt-2 text-sm text-white/60">{tenant?.name}</div>
        <div className="text-xs text-white/40">Segmento: {tenant?.segment}</div>
      </section>

      <section className="card">
        <div className="text-sm font-medium text-white">Alternar cliente</div>
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
              <div className="text-xs text-white/50">{item.segment}</div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
