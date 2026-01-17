import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import api from "../lib/api.js";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import PageHeader from "../components/ui/PageHeader.jsx";
import FilterBar from "../components/ui/FilterBar.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import SkeletonTable from "../components/ui/SkeletonTable.jsx";
import AddressSearchInput, { useAddressSearchState } from "../components/shared/AddressSearchInput.jsx";

const STATUS_OPTIONS = [
  { value: "pendente", label: "Pendente" },
  { value: "confirmado", label: "Confirmado" },
  { value: "em_execucao", label: "Em execução" },
  { value: "concluido", label: "Concluído" },
  { value: "remarcado", label: "Remarcado" },
  { value: "cancelado", label: "Cancelado" },
];

const SERVICE_TYPE_OPTIONS = [
  "Instalação",
  "Manutenção",
  "Retirada",
  "Remanejamento",
  "Socorro",
  "Reinstalação",
];

const DEFAULT_FORM = {
  clientId: "",
  unit: "",
  operation: "",
  category: "",
  clientName: "",
  clientDocument: "",
  contractPlan: "",
  contactName: "",
  contactChannel: "",
  requesterName: "",
  requestChannel: "",
  authorizationStatus: "",
  authorizationBy: "",
  address: "",
  referencePoint: "",
  latitude: "",
  longitude: "",
  type: "Instalação",
  serviceReason: "",
  serviceItem: "",
  startTimeExpected: "",
  endTimeExpected: "",
  priority: "",
  sla: "",
  status: "pendente",
  ownerName: "",
  technicianId: "",
  technicianName: "",
  assignedTeam: "",
  slaExceptionReason: "",
  rescheduleReason: "",
  cancelReason: "",
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function normalizeServiceType(value) {
  if (!value) return "";
  const normalized = String(value).trim().toLowerCase();
  const match = SERVICE_TYPE_OPTIONS.find(
    (option) => option.toLowerCase() === normalized,
  );
  if (match) return match;
  const aliasMap = {
    instalacao: "Instalação",
    manutencao: "Manutenção",
    manutencao_preventiva: "Manutenção",
    retirada: "Retirada",
    remanejamento: "Remanejamento",
    socorro: "Socorro",
    reinstalacao: "Reinstalação",
  };
  return aliasMap[normalized] || value;
}

function Drawer({ open, onClose, title, description, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9998] flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-4xl border-l border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Detalhes do agendamento</p>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {description ? <p className="mt-1 text-sm text-white/60">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/70 hover:border-white/30 hover:text-white"
          >
            Fechar
          </button>
        </div>
        <div className="h-[calc(100vh-120px)] overflow-y-auto px-6 py-6">{children}</div>
      </div>
    </div>
  );
}

export default function Appointments() {
  const { tenantId, user, tenants } = useTenant();
  const resolvedClientId = tenantId || user?.clientId || "";
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [technicians, setTechnicians] = useState([]);
  const [techniciansLoading, setTechniciansLoading] = useState(false);
  const [filters, setFilters] = useState({
    query: "",
    status: "",
    from: "",
    to: "",
    technician: "",
    region: "",
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...DEFAULT_FORM, clientId: resolvedClientId });
  const addressSearchState = useAddressSearchState({ initialValue: "" });

  const clientOptions = useMemo(
    () => (Array.isArray(tenants) ? tenants : []).map((tenant) => ({
      id: tenant.id,
      name: tenant.name || tenant.company || tenant.id,
    })),
    [tenants],
  );

  const technicianOptions = useMemo(
    () => (Array.isArray(technicians) ? technicians : []).map((technician) => ({
      id: technician.id,
      name: technician.name || technician.fullName || technician.email || String(technician.id),
      team: technician.team || technician.group || technician.assignedTeam || "",
    })),
    [technicians],
  );

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

  useEffect(() => {
    let cancelled = false;
    const loadTechnicians = async () => {
      setTechniciansLoading(true);
      try {
        const params = resolvedClientId ? { clientId: resolvedClientId } : undefined;
        const response = await api.get("core/technicians", { params });
        const list = response?.data?.items || [];
        if (!cancelled) {
          setTechnicians(Array.isArray(list) ? list : []);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Falha ao carregar técnicos", error);
          setTechnicians([]);
        }
      } finally {
        if (!cancelled) {
          setTechniciansLoading(false);
        }
      }
    };

    loadTechnicians();
    return () => {
      cancelled = true;
    };
  }, [resolvedClientId]);

  useEffect(() => {
    setForm((prev) => ({ ...prev, clientId: resolvedClientId || prev.clientId }));
  }, [resolvedClientId]);

  const filtered = useMemo(() => {
    const term = filters.query.trim().toLowerCase();
    return items.filter((item) => {
      const searchable = [
        item.id,
        item.address,
        item.type,
        item.status,
        item.clientName,
        item.clientDocument,
        item.contactName,
        item.serviceReason,
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

  const openDrawer = (task = null) => {
    if (task) {
      setEditingId(task.id);
      setForm({
        ...DEFAULT_FORM,
        clientId: task.clientId || resolvedClientId || "",
        unit: task.unit || "",
        operation: task.operation || "",
        category: task.category || "",
        clientName: task.clientName || "",
        clientDocument: task.clientDocument || "",
        contractPlan: task.contractPlan || "",
        contactName: task.contactName || "",
        contactChannel: task.contactChannel || "",
        requesterName: task.requesterName || task.requestedBy || "",
        requestChannel: task.requestChannel || task.requestMethod || "",
        authorizationStatus: task.authorizationStatus || "",
        authorizationBy: task.authorizationBy || "",
        address: task.address || "",
        referencePoint: task.referencePoint || "",
        latitude: task.latitude ?? "",
        longitude: task.longitude ?? "",
        type: normalizeServiceType(task.type) || "Instalação",
        serviceReason: task.serviceReason || "",
        serviceItem: task.serviceItem || "",
        startTimeExpected: task.startTimeExpected ? new Date(task.startTimeExpected).toISOString().slice(0, 16) : "",
        endTimeExpected: task.endTimeExpected ? new Date(task.endTimeExpected).toISOString().slice(0, 16) : "",
        priority: task.priority || "",
        sla: task.sla || "",
        status: task.status || "pendente",
        ownerName: task.ownerName || "",
        technicianId: task.technicianId || "",
        technicianName: task.technicianName || "",
        assignedTeam: task.assignedTeam || "",
        slaExceptionReason: task.slaExceptionReason || "",
        rescheduleReason: task.rescheduleReason || "",
        cancelReason: task.cancelReason || "",
      });
      addressSearchState.setQuery(task.address || "");
    } else {
      setEditingId(null);
      setForm({ ...DEFAULT_FORM, clientId: resolvedClientId || "" });
      addressSearchState.setQuery("");
    }
    setDrawerOpen(true);
  };

  const handleSelectAddress = (option) => {
    if (!option) return;
    setForm((prev) => ({
      ...prev,
      address: option.label || option.concise || prev.address,
      latitude: option.lat ?? prev.latitude,
      longitude: option.lng ?? prev.longitude,
    }));
  };

  const saveAppointment = async (payloadForm) => {
    setSaving(true);
    try {
      const payload = {
        ...payloadForm,
        clientId: payloadForm.clientId || resolvedClientId,
        latitude: payloadForm.latitude !== "" ? Number(payloadForm.latitude) : null,
        longitude: payloadForm.longitude !== "" ? Number(payloadForm.longitude) : null,
        startTimeExpected: payloadForm.startTimeExpected ? new Date(payloadForm.startTimeExpected).toISOString() : null,
        endTimeExpected: payloadForm.endTimeExpected ? new Date(payloadForm.endTimeExpected).toISOString() : null,
        type: normalizeServiceType(payloadForm.type),
      };
      if (editingId) {
        await CoreApi.updateTask(editingId, payload);
      } else {
        await CoreApi.createTask(payload);
      }
      setDrawerOpen(false);
      await loadAppointments();
    } catch (error) {
      console.error("Falha ao salvar agendamento", error);
      alert("Não foi possível salvar o agendamento.");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    await saveAppointment(form);
  };

  const handleClientInput = (event) => {
    const value = event.target.value;
    const match = clientOptions.find((client) => client.name === value);
    setForm((prev) => ({
      ...prev,
      clientName: value,
      clientId: match?.id ?? prev.clientId,
    }));
  };

  const handleTechnicianInput = (event) => {
    const value = event.target.value;
    const match = technicianOptions.find((technician) => technician.name === value);
    setForm((prev) => ({
      ...prev,
      technicianName: value,
      technicianId: match?.id ?? prev.technicianId,
      assignedTeam: match?.team || prev.assignedTeam,
    }));
  };

  const handleCancelAppointment = async () => {
    const nextForm = { ...form, status: "cancelado" };
    setForm(nextForm);
    await saveAppointment(nextForm);
  };

  useEffect(() => {
    if (!form.clientId) return;
    const match = clientOptions.find((client) => String(client.id) === String(form.clientId));
    if (match && form.clientName !== match.name) {
      setForm((prev) => ({ ...prev, clientName: match.name }));
    }
  }, [clientOptions, form.clientId, form.clientName]);

  useEffect(() => {
    if (!form.technicianId) return;
    const match = technicianOptions.find((technician) => String(technician.id) === String(form.technicianId));
    if (match && form.technicianName !== match.name) {
      setForm((prev) => ({
        ...prev,
        technicianName: match.name,
        assignedTeam: match.team || prev.assignedTeam,
      }));
    }
  }, [form.technicianId, form.technicianName, technicianOptions]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Agendamentos"
        subtitle="Gestão operacional com janela, responsável e status por agendamento."
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
            <button
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
              onClick={() => openDrawer(null)}
            >
              Novo agendamento
            </button>
          </div>
        }
      />

      <FilterBar
        left={
          <div className="flex w-full flex-wrap items-center gap-3">
            <input
              value={filters.query}
              onChange={(event) => setFilters((prev) => ({ ...prev, query: event.target.value }))}
              placeholder="Buscar por cliente, documento, motivo"
              className="min-w-[240px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
            />
            <select
              value={filters.status}
              onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
              className="min-w-[200px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            >
              <option value="">Todos</option>
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
              className="min-w-[160px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            />
            <input
              type="date"
              value={filters.to}
              onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
              className="min-w-[160px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            />
            <input
              value={filters.technician}
              onChange={(event) => setFilters((prev) => ({ ...prev, technician: event.target.value }))}
              placeholder="Técnico / equipe"
              className="min-w-[200px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
            />
            <input
              value={filters.region}
              onChange={(event) => setFilters((prev) => ({ ...prev, region: event.target.value }))}
              placeholder="Endereço / região"
              className="min-w-[200px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
            />
          </div>
        }
      />

      <DataTable className="overflow-x-hidden" tableClassName="w-full table-fixed">
        <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
          <tr className="text-left">
            <th className="w-64 px-4 py-3">Cliente</th>
            <th className="w-44 px-4 py-3">Data</th>
            <th className="w-96 px-4 py-3">Endereço</th>
            <th className="w-56 px-4 py-3">Tipo do Serviço</th>
            <th className="w-52 px-4 py-3">Técnico</th>
            <th className="w-52 px-4 py-3">Responsável</th>
            <th className="w-36 px-4 py-3">Status</th>
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
                    <button
                      className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
                      onClick={() => openDrawer(null)}
                    >
                      Novo agendamento
                    </button>
                  }
                />
              </td>
            </tr>
          )}
          {!loading &&
            filtered.map((item) => (
              <tr
                key={item.id}
                className="border-t border-white/10 hover:bg-white/5 cursor-pointer"
                onClick={() => openDrawer(item)}
              >
                <td className="px-4 py-3">
                  <div className="text-white/90">{item.clientName || "—"}</div>
                  <div className="text-xs text-white/50">{item.clientDocument || "—"}</div>
                </td>
                <td className="px-4 py-3 text-white/90">
                  {formatDate(item.startTimeExpected || item.endTimeExpected)}
                </td>
                <td className="px-4 py-3">
                  <div className="text-white/90">{item.address || "—"}</div>
                  <div className="text-xs text-white/50">{item.referencePoint || "—"}</div>
                </td>
                <td className="px-4 py-3 text-white/90">{normalizeServiceType(item.type) || "—"}</td>
                <td className="px-4 py-3 text-white/90">{item.technicianName || "—"}</td>
                <td className="px-4 py-3 text-white/90">{item.contactName || item.ownerName || "—"}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80">
                    {item.status || "—"}
                  </span>
                </td>
              </tr>
            ))}
        </tbody>
      </DataTable>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editingId ? "Editar agendamento" : "Criar agendamento"}
        description="Preencha os dados operacionais do agendamento para equipe técnica."
      >
        <form onSubmit={handleSave} className="space-y-6">
          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Identificação</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <input
                value={form.unit}
                onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))}
                placeholder="Unidade"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
              <input
                value={form.operation}
                onChange={(event) => setForm((prev) => ({ ...prev, operation: event.target.value }))}
                placeholder="Operação"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
              <input
                value={form.category}
                onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
                placeholder="Categoria"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Cliente</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <input
                value={form.clientName}
                onChange={handleClientInput}
                placeholder="Cliente/Empresa"
                list="appointments-client-options"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
              <datalist id="appointments-client-options">
                {clientOptions.map((client) => (
                  <option key={client.id} value={client.name} />
                ))}
              </datalist>
              <input
                value={form.clientDocument}
                onChange={(event) => setForm((prev) => ({ ...prev, clientDocument: event.target.value }))}
                placeholder="Documento"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
              <input
                value={form.contractPlan}
                onChange={(event) => setForm((prev) => ({ ...prev, contractPlan: event.target.value }))}
                placeholder="Contrato/Plano"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Contato e autorização</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <input
                value={form.contactName}
                onChange={(event) => setForm((prev) => ({ ...prev, contactName: event.target.value }))}
                placeholder="Responsável local"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
              <input
                value={form.contactChannel}
                onChange={(event) => setForm((prev) => ({ ...prev, contactChannel: event.target.value }))}
                placeholder="Contato"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
              <input
                value={form.requesterName}
                onChange={(event) => setForm((prev) => ({ ...prev, requesterName: event.target.value }))}
                placeholder="Quem solicitou o serviço"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
              <input
                value={form.requestChannel}
                onChange={(event) => setForm((prev) => ({ ...prev, requestChannel: event.target.value }))}
                placeholder="Forma da solicitação"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
              <input
                value={form.authorizationBy}
                onChange={(event) => setForm((prev) => ({ ...prev, authorizationBy: event.target.value }))}
                placeholder="Autorizado por"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Local</h3>
            <AddressSearchInput
              state={addressSearchState}
              onSelect={handleSelectAddress}
              placeholder="Buscar endereço"
              variant="toolbar"
              containerClassName="w-full"
              portalSuggestions
            />
            <div className="grid gap-3 md:grid-cols-3">
              <input
                value={form.referencePoint}
                onChange={(event) => setForm((prev) => ({ ...prev, referencePoint: event.target.value }))}
                placeholder="Referência"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
              <input
                value={form.latitude}
                onChange={(event) => setForm((prev) => ({ ...prev, latitude: event.target.value }))}
                placeholder="Latitude"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
              <input
                value={form.longitude}
                onChange={(event) => setForm((prev) => ({ ...prev, longitude: event.target.value }))}
                placeholder="Longitude"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Serviço</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <select
                value={form.type}
                onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value }))}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              >
                {SERVICE_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <input
                value={form.serviceReason}
                onChange={(event) => setForm((prev) => ({ ...prev, serviceReason: event.target.value }))}
                placeholder="Motivo / descrição curta"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
              <input
                value={form.serviceItem}
                onChange={(event) => setForm((prev) => ({ ...prev, serviceItem: event.target.value }))}
                placeholder="Item atendido"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Datas</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <input
                type="datetime-local"
                value={form.startTimeExpected}
                onChange={(event) => setForm((prev) => ({ ...prev, startTimeExpected: event.target.value }))}
                placeholder="Data/Hora da Solicitação"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
              <input
                type="datetime-local"
                value={form.endTimeExpected}
                onChange={(event) => setForm((prev) => ({ ...prev, endTimeExpected: event.target.value }))}
                placeholder="Data/Hora do Serviço"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
              <input
                value={form.priority}
                onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value }))}
                placeholder="Prioridade"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
            </div>
            <select
              value={form.status}
              onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Responsável interno</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <input
                value={form.technicianName}
                onChange={handleTechnicianInput}
                placeholder={techniciansLoading ? "Carregando técnicos..." : "Buscar técnico"}
                list="appointments-technician-options"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
              <datalist id="appointments-technician-options">
                {technicianOptions.map((technician) => (
                  <option key={technician.id} value={technician.name} />
                ))}
              </datalist>
              <input
                value={form.assignedTeam}
                onChange={(event) => setForm((prev) => ({ ...prev, assignedTeam: event.target.value }))}
                placeholder="Equipe"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
              <input
                value={form.ownerName}
                onChange={(event) => setForm((prev) => ({ ...prev, ownerName: event.target.value }))}
                placeholder="Dono do agendamento"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Gestão</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <input
                value={form.slaExceptionReason}
                onChange={(event) => setForm((prev) => ({ ...prev, slaExceptionReason: event.target.value }))}
                placeholder="Motivo exceção SLA"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
              <input
                value={form.rescheduleReason}
                onChange={(event) => setForm((prev) => ({ ...prev, rescheduleReason: event.target.value }))}
                placeholder="Motivo remarcação"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
              <input
                value={form.cancelReason}
                onChange={(event) => setForm((prev) => ({ ...prev, cancelReason: event.target.value }))}
                placeholder="Motivo cancelamento"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
            </div>
          </section>

          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-[#0f141c] pt-4">
            <div className="flex flex-wrap items-center gap-2">
              {editingId ? (
                <button
                  type="button"
                  onClick={handleCancelAppointment}
                  className="rounded-xl border border-red-500/40 px-4 py-2 text-sm text-red-200 hover:border-red-400"
                  disabled={saving}
                >
                  Cancelar agendamento
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white"
              >
                Fechar
              </button>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-70"
            >
              {saving ? "Salvando…" : editingId ? "Atualizar" : "Salvar"}
            </button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
