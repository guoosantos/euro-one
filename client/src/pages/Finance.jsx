import React, { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import { API_ROUTES } from "../lib/api-routes";
import PageHeader from "../components/ui/PageHeader.jsx";
import DataCard from "../components/ui/DataCard.jsx";
import FilterBar from "../components/ui/FilterBar.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import SkeletonTable from "../components/ui/SkeletonTable.jsx";

export default function Finance() {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    client: "",
    technician: "",
    status: "",
  });

  useEffect(() => {
    setLoading(true);
    api
      .get(API_ROUTES.finance)
      .then((response) => setSnapshot(response?.data || response))
      .catch((err) => setError(err))
      .finally(() => setLoading(false));
  }, []);

  const transactions = useMemo(() => snapshot?.transactions || snapshot?.items || [], [snapshot]);

  return (
    <div className="space-y-4 text-white/80">
      <PageHeader
        title="Financeiro"
        subtitle="Entradas, saídas e OS aprovadas."
        actions={
          <button className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15">
            Exportar
          </button>
        }
      />

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error.message}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DataCard>
          <div className="text-sm text-white/60">Situação</div>
          <div className="text-2xl font-semibold text-white">{snapshot?.status || "Em análise"}</div>
        </DataCard>
        <DataCard>
          <div className="text-sm text-white/60">Entradas do mês</div>
          <div className="text-2xl font-semibold text-white">
            {snapshot?.monthIncome
              ? `R$ ${snapshot.monthIncome.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
              : "R$ 0,00"}
          </div>
        </DataCard>
        <DataCard>
          <div className="text-sm text-white/60">Saídas do mês</div>
          <div className="text-2xl font-semibold text-white">
            {snapshot?.monthExpense
              ? `R$ ${snapshot.monthExpense.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
              : "R$ 0,00"}
          </div>
        </DataCard>
        <DataCard>
          <div className="text-sm text-white/60">Valor devido</div>
          <div className="text-2xl font-semibold text-white">
            {snapshot?.amountDue
              ? `R$ ${snapshot.amountDue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
              : "R$ 0,00"}
          </div>
        </DataCard>
      </div>

      <DataCard>
        <FilterBar
          left={
            <>
              <input
                type="date"
                value={filters.from}
                onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
              <input
                type="date"
                value={filters.to}
                onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
              <input
                value={filters.client}
                onChange={(event) => setFilters((prev) => ({ ...prev, client: event.target.value }))}
                placeholder="Cliente"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
              />
              <input
                value={filters.technician}
                onChange={(event) => setFilters((prev) => ({ ...prev, technician: event.target.value }))}
                placeholder="Técnico"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
              />
              <select
                value={filters.status}
                onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                <option value="">Status</option>
                <option value="receber">A receber</option>
                <option value="pago">Pago</option>
                <option value="pendente">Pendente</option>
              </select>
            </>
          }
        />
      </DataCard>

      <DataCard className="overflow-hidden p-0">
        <DataTable>
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
            <tr className="text-left">
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Técnico</th>
              <th className="px-4 py-3">OS</th>
              <th className="px-4 py-3">Valor</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-6">
                  <SkeletonTable rows={6} columns={8} />
                </td>
              </tr>
            )}
            {!loading && transactions.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6">
                  <EmptyState
                    title="Nenhum lançamento encontrado."
                    subtitle="Ajuste filtros ou verifique OS pendentes."
                    action={
                      <button className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15">
                        Ver OS pendentes
                      </button>
                    }
                  />
                </td>
              </tr>
            )}
            {!loading &&
              transactions.map((entry) => (
                <tr key={entry.id || `${entry.date}-${entry.amount}`} className="hover:bg-white/5">
                  <td className="px-4 py-3">{entry.date || "—"}</td>
                  <td className="px-4 py-3">{entry.type || "—"}</td>
                  <td className="px-4 py-3">{entry.clientName || "—"}</td>
                  <td className="px-4 py-3">{entry.technicianName || "—"}</td>
                  <td className="px-4 py-3">{entry.osCode || "—"}</td>
                  <td className="px-4 py-3">
                    {entry.amount
                      ? `R$ ${Number(entry.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                      : "R$ 0,00"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80">
                      {entry.status || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15">
                      Ver detalhe
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </DataTable>
      </DataCard>
    </div>
  );
}
