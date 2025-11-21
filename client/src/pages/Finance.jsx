import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { API_ROUTES } from "../lib/api-routes";

export default function Finance() {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get(API_ROUTES.finance)
      .then((response) => setSnapshot(response?.data || response))
      .catch((err) => setError(err));
  }, []);

  return (
    <div className="space-y-4 text-white/80">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <h1 className="text-xl font-semibold">Financeiro</h1>
        {error && <span className="text-sm text-red-300">{error.message}</span>}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-sm text-white/60">Situação</div>
          <div className="text-2xl font-semibold text-white">{snapshot?.status || "Em análise"}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-sm text-white/60">Veículos faturáveis</div>
          <div className="text-2xl font-semibold text-white">{snapshot?.billableVehicles ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-sm text-white/60">Valor devido</div>
          <div className="text-2xl font-semibold text-white">
            {snapshot?.amountDue ? `R$ ${snapshot.amountDue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "R$ 0,00"}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-sm text-white/60">Próxima fatura</div>
          <div className="text-2xl font-semibold text-white">{snapshot?.nextBilling || "15/12/2024"}</div>
        </div>
      </div>
    </div>
  );
}
