import React, { useEffect, useMemo, useState } from "react";
import { Pencil, RefreshCw } from "lucide-react";
import api from "../lib/api";
import PageHeader from "../components/ui/PageHeader.jsx";
import DataCard from "../components/ui/DataCard.jsx";
import FilterBar from "../components/ui/FilterBar.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import SkeletonTable from "../components/ui/SkeletonTable.jsx";

export default function Finance() {
  const [summary, setSummary] = useState(null);
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    client: "",
    technician: "",
    type: "",
  });

  const loadFinance = async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryResponse, entriesResponse] = await Promise.all([
        api.get("finance/summary"),
        api.get("finance/entries"),
      ]);
      setSummary(summaryResponse?.data || summaryResponse);
      setEntries(entriesResponse?.data?.items || entriesResponse?.items || []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFinance();
  }, []);

  const transactions = useMemo(() => {
    const term = filters.client.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filters.type && entry.type !== filters.type) return false;
      if (filters.technician && !String(entry.technicianName || "").toLowerCase().includes(filters.technician.toLowerCase())) {
        return false;
      }
      if (term && !String(entry.clientName || "").toLowerCase().includes(term)) return false;
      return true;
    });
  }, [entries, filters]);

  return (
    <div className="space-y-4 text-white/80">
      <PageHeader
        title="Financeiro"
        subtitle="Entradas, saídas e OS aprovadas."
        actions={
          <div className="flex items-center gap-2">
            <button
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
              onClick={loadFinance}
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                Atualizar
              </span>
            </button>
            <button className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15">
              Exportar
            </button>
          </div>
        }
      />

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error.message}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DataCard>
          <div className="text-sm text-white/60">Entradas</div>
          <div className="text-2xl font-semibold text-white">
            {summary?.income
              ? `R$ ${summary.income.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
              : "R$ 0,00"}
          </div>
        </DataCard>
        <DataCard>
          <div className="text-sm text-white/60">Saídas</div>
          <div className="text-2xl font-semibold text-white">
            {summary?.expense
              ? `R$ ${summary.expense.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
              : "R$ 0,00"}
          </div>
        </DataCard>
        <DataCard>
          <div className="text-sm text-white/60">Saldo</div>
          <div className="text-2xl font-semibold text-white">
            {summary?.balance
              ? `R$ ${summary.balance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
              : "R$ 0,00"}
          </div>
        </DataCard>
        <DataCard>
          <div className="text-sm text-white/60">Lançamentos</div>
          <div className="text-2xl font-semibold text-white">{transactions.length}</div>
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
                value={filters.type}
                onChange={(event) => setFilters((prev) => ({ ...prev, type: event.target.value }))}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                <option value="">Tipo</option>
                <option value="Entrada">Entrada</option>
                <option value="Saída">Saída</option>
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
              <th className="px-4 py-3">Método</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {loading && (
              <tr>
                <td colSpan={9} className="px-4 py-6">
                  <SkeletonTable rows={6} columns={9} />
                </td>
              </tr>
            )}
            {!loading && transactions.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6">
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
                  <td className="px-4 py-3">{entry.method || "—"}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80">
                      {entry.status || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white transition hover:border-white/30"
                      aria-label="Editar lançamento"
                    >
                      <Pencil className="h-4 w-4" />
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
