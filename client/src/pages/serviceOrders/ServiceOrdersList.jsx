import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, RefreshCw } from "lucide-react";

import PageHeader from "../../components/ui/PageHeader.jsx";
import FilterBar from "../../components/ui/FilterBar.jsx";
import DataCard from "../../components/ui/DataCard.jsx";
import DataTable from "../../components/ui/DataTable.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import SkeletonTable from "../../components/ui/SkeletonTable.jsx";

const STATUS_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "SOLICITADA", label: "Solicitada" },
  { value: "AGENDADA", label: "Agendada" },
  { value: "EM_DESLOCAMENTO", label: "Em deslocamento" },
  { value: "EM_EXECUCAO", label: "Em execução" },
  { value: "AGUARDANDO_APROVACAO", label: "Aguardando aprovação" },
  { value: "CONCLUIDA", label: "Concluída" },
  { value: "CANCELADA", label: "Cancelada" },
  { value: "REMANEJADA", label: "Remanejada" },
];

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export default function ServiceOrdersList() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (q) params.set("q", q);
      if (from) params.set("from", new Date(from).toISOString());
      if (to) params.set("to", new Date(to).toISOString());

      const response = await fetch(`/api/core/service-orders?${params.toString()}`, {
        credentials: "include",
      });
      const payload = await response.json();
      setItems(payload?.items || []);
    } catch (error) {
      console.error("Falha ao buscar ordens de serviço", error);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const filtered = useMemo(() => {
    if (!q) return items;
    const term = q.toLowerCase();
    return items.filter((item) => {
      const values = [
        item.osInternalId,
        item.vehicle?.plate,
        item.vehicle?.name,
        item.responsibleName,
        item.responsiblePhone,
        item.technicianName,
        item.reason,
      ];
      return values.some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [items, q]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Serviços"
        subtitle="Solicitações, execução e aprovação das OS."
        actions={
          <>
            <Link
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
              to="/services/import"
            >
              Importar XLSX
            </Link>
            <Link
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
              to="/services/new"
            >
              Nova OS
            </Link>
          </>
        }
      />

      <DataCard>
        <FilterBar
          left={
            <>
              <input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Buscar por OS, placa, contato, técnico..."
                className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none md:w-80"
              />
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none md:w-60"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
              <input
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </>
          }
          right={
            <button
              type="button"
              onClick={fetchOrders}
              className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                Atualizar
              </span>
            </button>
          }
        />
      </DataCard>

      <DataCard className="overflow-hidden p-0">
        <DataTable>
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
            <tr className="text-left">
              <th className="px-4 py-3">OS</th>
              <th className="px-4 py-3">Placa</th>
              <th className="px-4 py-3">Responsável</th>
              <th className="px-4 py-3">Técnico</th>
              <th className="px-4 py-3">Início</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-6">
                  <SkeletonTable rows={6} columns={7} />
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8">
                  <EmptyState
                    title="Nenhuma ordem de serviço encontrada com os filtros atuais."
                    subtitle="Crie uma nova OS para iniciar o fluxo."
                    action={
                      <Link
                        className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
                        to="/services/new"
                      >
                        Criar OS
                      </Link>
                    }
                  />
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((item) => (
                <tr key={item.id} className="border-t border-white/10 hover:bg-white/5">
                  <td className="px-4 py-3 font-medium text-white">
                    {item.osInternalId || item.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3">{item.vehicle?.plate || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="text-white">{item.responsibleName || "—"}</div>
                    <div className="text-xs text-white/50">{item.responsiblePhone || ""}</div>
                  </td>
                  <td className="px-4 py-3">{item.technicianName || "—"}</td>
                  <td className="px-4 py-3">{formatDate(item.startAt)}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80">
                      {item.status || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white transition hover:border-white/30"
                      to={`/services/${item.id}`}
                      aria-label="Editar OS"
                    >
                      <Pencil className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}
          </tbody>
        </DataTable>
      </DataCard>
    </div>
  );
}
