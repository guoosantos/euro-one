import React, { useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Pencil, RefreshCw, XCircle } from "lucide-react";

import { CoreApi } from "../lib/coreApi.js";
import PageHeader from "../components/ui/PageHeader.jsx";
import DataCard from "../components/ui/DataCard.jsx";
import FilterBar from "../components/ui/FilterBar.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import SkeletonTable from "../components/ui/SkeletonTable.jsx";

const STATUS_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "pendente", label: "Pendente" },
  { value: "confirmado", label: "Confirmado" },
  { value: "remarcado", label: "Remarcado" },
  { value: "cancelado", label: "Cancelado" },
  { value: "concluido", label: "Concluído" },
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

export default function Appointments() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    query: "",
    status: "",
    from: "",
    to: "",
    technician: "",
    region: "",
  });

  const loadAppointments = async () => {
    setLoading(true);
    try {
      const params = {
        status: filters.status || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
      };
      const response = await CoreApi.listTasks(params);
      setItems(Array.isArray(response?.tasks) ? response.tasks : response || []);
    } catch (error) {
      console.error("Falha ao carregar agendamentos", error);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAppointments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status]);

  const filtered = useMemo(() => {
    const term = filters.query.trim().toLowerCase();
    return items.filter((item) => {
      const searchable = [
        item.id,
        item.address,
        item.type,
        item.status,
        item.vehicleId,
        item.driverId,
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      if (term && !searchable.some((value) => value.includes(term))) return false;
      if (filters.technician && !String(item.technicianName || "").toLowerCase().includes(filters.technician.toLowerCase())) {
        return false;
      }
      if (filters.region && !String(item.address || "").toLowerCase().includes(filters.region.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [filters.query, filters.region, filters.technician, items]);

  const updateStatus = async (taskId, status) => {
    if (!taskId) return;
    try {
      await CoreApi.updateTask(taskId, { status });
      await loadAppointments();
    } catch (error) {
      console.error("Falha ao atualizar agendamento", error);
      alert("Não foi possível atualizar o agendamento.");
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Agendamentos"
        subtitle="Janela de atendimento, confirmação, remarcar e lembretes."
        actions={
          <div className="flex items-center gap-2">
            <button
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
              onClick={loadAppointments}
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                Atualizar
              </span>
            </button>
            <button className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400">
              Novo agendamento
            </button>
          </div>
        }
      />

      <DataCard>
        <FilterBar
          left={
            <>
              <input
                value={filters.query}
                onChange={(event) => setFilters((prev) => ({ ...prev, query: event.target.value }))}
                placeholder="Buscar por OS, endereço, técnico"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none md:w-80"
              />
              <select
                value={filters.status}
                onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none md:w-56"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
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
                value={filters.technician}
                onChange={(event) => setFilters((prev) => ({ ...prev, technician: event.target.value }))}
                placeholder="Técnico"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
              />
              <input
                value={filters.region}
                onChange={(event) => setFilters((prev) => ({ ...prev, region: event.target.value }))}
                placeholder="Região/Cidade"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
              />
            </>
          }
        />
      </DataCard>

      <DataCard className="overflow-hidden p-0">
        <DataTable>
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
            <tr className="text-left">
              <th className="px-4 py-3">Agendamento</th>
              <th className="px-4 py-3">Janela</th>
              <th className="px-4 py-3">Endereço</th>
              <th className="px-4 py-3">Técnico</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Lembretes</th>
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
                    title="Nenhum agendamento encontrado."
                    subtitle="Crie um novo agendamento para iniciar o atendimento."
                    action={
                      <button className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400">
                        Novo agendamento
                      </button>
                    }
                  />
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((item) => (
                <tr key={item.id} className="border-t border-white/10 hover:bg-white/5">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{item.id?.slice(0, 8) || "—"}</div>
                    <div className="text-xs text-white/50">Tipo: {item.type || "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-white/90">{formatDate(item.startTimeExpected)}</div>
                    <div className="text-xs text-white/50">até {formatDate(item.endTimeExpected)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-white/90">{item.address || "—"}</div>
                    <div className="text-xs text-white/50">{item.region || "Cidade/UF"}</div>
                  </td>
                  <td className="px-4 py-3">{item.technicianName || item.driverId || "—"}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80">
                      {item.status || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-xs text-white/60">
                      <CalendarClock className="h-4 w-4" />
                      SMS · WhatsApp · E-mail
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateStatus(item.id, "confirmado")}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-emerald-400/40 text-emerald-200 hover:border-emerald-300"
                        aria-label="Confirmar"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => updateStatus(item.id, "remarcado")}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white hover:border-white/40"
                        aria-label="Remarcar"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => updateStatus(item.id, "cancelado")}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-400/40 text-red-200 hover:border-red-300"
                        aria-label="Cancelar"
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </DataTable>
      </DataCard>
    </div>
  );
}
