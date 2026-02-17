import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import PageHeader from "../components/ui/PageHeader.jsx";
import FilterBar from "../components/ui/FilterBar.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import SkeletonTable from "../components/ui/SkeletonTable.jsx";
import AutocompleteSelect from "../components/ui/AutocompleteSelect.jsx";

const STATUS_OPTIONS = [
  { value: "em_rota", label: "Em rota" },
  { value: "no_local", label: "No local" },
  { value: "em_execucao", label: "Em execução" },
  { value: "aguardando_validacao", label: "Aguardando validação" },
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

export default function VarLive() {
  const { tenantId, tenantScope, user, tenants } = useTenant();
  const resolvedClientId = tenantScope === "ALL" ? "" : tenantId || user?.clientId || "";
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    query: "",
    status: "",
    from: "",
    to: "",
    clientId: "",
    technician: "",
  });
  const [draftFilters, setDraftFilters] = useState({
    query: "",
    status: "",
    from: "",
    to: "",
    clientId: "",
    technician: "",
  });

  const clientOptions = useMemo(
    () => (Array.isArray(tenants) ? tenants : []).map((tenant) => ({
      id: tenant.id,
      name: tenant.name || tenant.company || tenant.id,
    })),
    [tenants],
  );

  const clientAutocompleteOptions = useMemo(
    () =>
      clientOptions.map((client) => ({
        value: String(client.id),
        label: client.name,
      })),
    [clientOptions],
  );

  const statusAutocompleteOptions = useMemo(
    () =>
      STATUS_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [],
  );

  const loadVar = async (nextFilters = filters) => {
    setLoading(true);
    try {
      const params = {
        from: nextFilters.from || undefined,
        to: nextFilters.to || undefined,
        category: "appointment",
      };
      const response = await CoreApi.listTasks(params);
      const list = Array.isArray(response?.tasks) ? response.tasks : response || [];
      setItems(list);
    } catch (error) {
      console.error("Falha ao carregar VAR", error);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = () => {
    const nextFilters = {
      ...filters,
      query: draftFilters.query,
      status: draftFilters.status,
      from: draftFilters.from,
      to: draftFilters.to,
      clientId: draftFilters.clientId,
      technician: draftFilters.technician,
    };
    setFilters(nextFilters);
    loadVar(nextFilters);
  };

  const clearFilters = () => {
    const nextFilters = {
      query: "",
      status: "",
      from: "",
      to: "",
      clientId: "",
      technician: "",
    };
    setDraftFilters(nextFilters);
    setFilters(nextFilters);
    loadVar(nextFilters);
  };

  const filtered = useMemo(() => {
    const term = filters.query.trim().toLowerCase();
    return items.filter((item) => {
      const status = String(item.status || "").toLowerCase();
      const technician = String(item.technicianName || "").toLowerCase();
      const clientName = String(item.clientName || "").toLowerCase();
      const address = String(item.address || "").toLowerCase();
      const searchable = [item.id, item.type, item.serviceReason, item.contactName]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());

      if (filters.clientId && String(item.clientId || "") !== String(filters.clientId)) return false;
      if (filters.status && status !== String(filters.status).toLowerCase()) return false;
      if (filters.technician && !technician.includes(String(filters.technician).toLowerCase())) return false;
      if (term && ![clientName, address, status, technician, ...searchable].some((value) => value.includes(term))) {
        return false;
      }
      if (!STATUS_OPTIONS.some((option) => option.value === status)) return false;
      return true;
    });
  }, [filters.clientId, filters.query, filters.status, filters.technician, items]);

  return (
    <div className="space-y-4">
      <PageHeader
        actions={
          <div className="flex items-center gap-2">
            <button
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
              onClick={loadVar}
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                Atualizar
              </span>
            </button>
          </div>
        }
      />

      <FilterBar
        left={
          <div className="flex w-full flex-wrap items-center gap-3">
            <input
              value={draftFilters.query}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, query: event.target.value }))}
              placeholder="Buscar por cliente, técnico, status"
              className="min-w-[240px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
            />
            <AutocompleteSelect
              label="Cliente"
              placeholder={resolvedClientId ? "Cliente atual" : "Buscar cliente"}
              value={draftFilters.clientId}
              options={clientAutocompleteOptions}
              onChange={(value) => setDraftFilters((prev) => ({ ...prev, clientId: value }))}
              allowClear
              className="min-w-[220px] flex-1"
            />
            <AutocompleteSelect
              label="Status"
              placeholder="Filtrar status"
              value={draftFilters.status}
              options={statusAutocompleteOptions}
              onChange={(value) => setDraftFilters((prev) => ({ ...prev, status: value }))}
              allowClear
              className="min-w-[200px] flex-1"
            />
            <input
              value={draftFilters.technician}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, technician: event.target.value }))}
              placeholder="Técnico"
              className="min-w-[200px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
            />
            <input
              type="date"
              value={draftFilters.from}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, from: event.target.value }))}
              className="min-w-[160px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            />
            <input
              type="date"
              value={draftFilters.to}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, to: event.target.value }))}
              className="min-w-[160px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            />
          </div>
        }
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={applyFilters}
              className="rounded-xl bg-sky-500 px-3 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
            >
              Aplicar
            </button>
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
            >
              Limpar
            </button>
          </div>
        }
      />

      <DataTable className="w-full" tableClassName="min-w-[1200px] w-full">
        <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
          <tr className="text-left">
            <th className="w-64 px-4 py-3">Cliente</th>
            <th className="w-52 px-4 py-3">Técnico</th>
            <th className="w-44 px-4 py-3">Status</th>
            <th className="w-64 px-4 py-3">Serviço</th>
            <th className="w-96 px-4 py-3">Endereço</th>
            <th className="w-44 px-4 py-3">Atualizado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {loading && (
            <tr>
              <td colSpan={6} className="px-4 py-6">
                <SkeletonTable rows={6} columns={6} />
              </td>
            </tr>
          )}
          {!loading && filtered.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8">
                <EmptyState
                  title="Nenhum atendimento em andamento."
                  subtitle="Quando houver atendimentos em rota ou execução eles serão listados aqui."
                />
              </td>
            </tr>
          )}
          {!loading &&
            filtered.map((item) => (
              <tr key={item.id} className="border-t border-white/10 hover:bg-white/5">
                <td className="px-4 py-3">
                  <div className="text-white/90">{item.clientName || "—"}</div>
                  <div className="text-xs text-white/50">{item.clientDocument || "—"}</div>
                </td>
                <td className="px-4 py-3 text-white/90">{item.technicianName || "—"}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80">
                    {item.status || "—"}
                  </span>
                </td>
                <td className="px-4 py-3 text-white/90">
                  <div>{item.type || "—"}</div>
                  <div className="text-xs text-white/50">{item.serviceReason || "—"}</div>
                </td>
                <td className="px-4 py-3 text-white/90">{item.address || "—"}</td>
                <td className="px-4 py-3 text-white/90">{formatDate(item.updatedAt)}</td>
              </tr>
            ))}
        </tbody>
      </DataTable>
    </div>
  );
}
