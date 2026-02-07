import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";

import api from "../lib/api.js";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import PageHeader from "../components/ui/PageHeader.jsx";
import FilterBar from "../components/ui/FilterBar.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import SkeletonTable from "../components/ui/SkeletonTable.jsx";
import AddressAutocomplete from "../components/AddressAutocomplete.jsx";
import AutocompleteSelect from "../components/ui/AutocompleteSelect.jsx";

const STATUS_OPTIONS = [
  { value: "pendente", label: "Pendente" },
  { value: "confirmado", label: "Confirmado" },
  { value: "em_rota", label: "Em rota" },
  { value: "no_local", label: "No local" },
  { value: "em_execucao", label: "Em execução" },
  { value: "aguardando_validacao", label: "Aguardando validação" },
  { value: "concluido", label: "Concluído" },
  { value: "remarcado", label: "Remarcado" },
  { value: "reprovado", label: "Reprovado" },
  { value: "cancelado", label: "Cancelado" },
];

const STATUS_TABS = [
  { key: "requested", label: "Agendamentos Solicitados", statuses: ["pendente", "confirmado", "remarcado"] },
  { key: "inProgress", label: "Agendamentos em Andamento", statuses: ["em_rota", "no_local", "em_execucao", "aguardando_validacao"] },
  { key: "completed", label: "Agendamento Concluído", statuses: ["concluido", "cancelado", "reprovado"] },
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
  clientName: "",
  clientDocument: "",
  contactName: "",
  contactChannel: "",
  address: "",
  referencePoint: "",
  latitude: "",
  longitude: "",
  geoFenceId: "",
  type: "Instalação",
  serviceReason: "",
  startTimeExpected: "",
  endTimeExpected: "",
  status: "pendente",
  technicianId: "",
  technicianName: "",
  assignedTeam: "",
  operation: "",
  serviceItem: "",
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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { tenantId, tenantScope, user, tenants } = useTenant();
  const resolvedClientId = tenantScope === "ALL" ? "" : tenantId || user?.clientId || "";
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
    clientId: "",
  });
  const [draftFilters, setDraftFilters] = useState({
    query: "",
    status: "",
    from: "",
    to: "",
    technician: "",
    region: "",
    clientId: "",
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusTab, setStatusTab] = useState(STATUS_TABS[0].key);
  const [form, setForm] = useState({ ...DEFAULT_FORM, clientId: resolvedClientId });
  const [autoOpenHandled, setAutoOpenHandled] = useState(false);
  const [addressValue, setAddressValue] = useState({ formattedAddress: "" });
  const [filterAddressValue, setFilterAddressValue] = useState({ formattedAddress: "" });

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

  const clientAutocompleteOptions = useMemo(
    () =>
      clientOptions.map((client) => ({
        value: String(client.id),
        label: client.name,
      })),
    [clientOptions],
  );

  const technicianAutocompleteOptions = useMemo(
    () =>
      technicianOptions.map((technician) => {
        const label = technician.name || String(technician.id);
        return {
          value: label,
          label,
          description: technician.team,
          id: technician.id,
        };
      }),
    [technicianOptions],
  );

  const loadClientOptions = useCallback(
    async ({ query, page, pageSize }) => {
      const term = String(query || "").trim().toLowerCase();
      const filtered = clientAutocompleteOptions.filter((client) =>
        client.label.toLowerCase().includes(term),
      );
      const start = (page - 1) * pageSize;
      const paged = filtered.slice(start, start + pageSize);
      return { options: paged, hasMore: start + pageSize < filtered.length };
    },
    [clientAutocompleteOptions],
  );

  const loadTechnicianOptions = useCallback(
    async ({ query, page, pageSize }) => {
      const term = String(query || "").trim().toLowerCase();
      const filtered = technicianAutocompleteOptions.filter((technician) => {
        const haystack = [technician.label, technician.description].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(term);
      });
      const start = (page - 1) * pageSize;
      const paged = filtered.slice(start, start + pageSize);
      return { options: paged, hasMore: start + pageSize < filtered.length };
    },
    [technicianAutocompleteOptions],
  );

  const loadAppointments = async (nextFilters = filters) => {
    setLoading(true);
    try {
      const params = {
        from: nextFilters.from || undefined,
        to: nextFilters.to || undefined,
        category: "appointment",
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
  }, []);

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

  const applyFilters = () => {
    const nextFilters = {
      ...filters,
      query: draftFilters.query,
      status: draftFilters.status,
      from: draftFilters.from,
      to: draftFilters.to,
      technician: draftFilters.technician,
      region: draftFilters.region,
      clientId: draftFilters.clientId,
    };
    setFilters(nextFilters);
    loadAppointments(nextFilters);
  };

  const clearFilters = () => {
    const nextFilters = {
      query: "",
      status: "",
      from: "",
      to: "",
      technician: "",
      region: "",
      clientId: "",
    };
    setDraftFilters(nextFilters);
    setFilterAddressValue({ formattedAddress: "" });
    setFilters(nextFilters);
    loadAppointments(nextFilters);
  };

  const filtered = useMemo(() => {
    const term = filters.query.trim().toLowerCase();
    const statusConfig = STATUS_TABS.find((tab) => tab.key === statusTab);
    const allowedStatuses = statusConfig?.statuses || [];
    return items.filter((item) => {
      const searchable = [
        item.id,
        item.address,
        item.type,
        item.status,
        item.clientName,
        item.clientDocument,
        item.contactName,
        item.contactChannel,
        item.serviceReason,
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      if (term && !searchable.some((value) => value.includes(term))) return false;
      if (filters.technician) {
        const technicianMatch = String(item.technicianName || "").toLowerCase();
        const teamMatch = String(item.assignedTeam || "").toLowerCase();
        const filterValue = String(filters.technician || "").toLowerCase();
        if (!technicianMatch.includes(filterValue) && !teamMatch.includes(filterValue)) {
          return false;
        }
      }
      if (filters.clientId && String(item.clientId || "") !== String(filters.clientId)) {
        return false;
      }
      if (filters.region && !String(item.address || "").toLowerCase().includes(filters.region.toLowerCase())) {
        return false;
      }
      if (allowedStatuses.length > 0 && !allowedStatuses.includes(String(item.status || ""))) {
        return false;
      }
      return true;
    });
  }, [filters.clientId, filters.query, filters.region, filters.technician, items, statusTab]);

  const extractRequestId = useCallback((task) => {
    if (!task) return "";
    if (task.serviceItem) return String(task.serviceItem);
    if (typeof task.operation === "string" && task.operation.startsWith("request:")) {
      return task.operation.replace("request:", "").trim();
    }
    return "";
  }, []);

  const openDrawer = (task = null) => {
    if (task) {
      setEditingId(task.id);
      setForm({
        ...DEFAULT_FORM,
        clientId: task.clientId || resolvedClientId || "",
        clientName: task.clientName || "",
        clientDocument: task.clientDocument || "",
        contactName: task.contactName || "",
        contactChannel: task.contactChannel || "",
        address: task.address || "",
        referencePoint: task.referencePoint || "",
        latitude: task.latitude ?? "",
        longitude: task.longitude ?? "",
        geoFenceId: task.geoFenceId || "",
        type: normalizeServiceType(task.type) || "Instalação",
        serviceReason: task.serviceReason || "",
        startTimeExpected: task.startTimeExpected ? new Date(task.startTimeExpected).toISOString().slice(0, 16) : "",
        endTimeExpected: task.endTimeExpected ? new Date(task.endTimeExpected).toISOString().slice(0, 16) : "",
        status: task.status || "pendente",
        technicianId: task.technicianId || "",
        technicianName: task.technicianName || "",
        assignedTeam: task.assignedTeam || "",
        operation: task.operation || "",
        serviceItem: task.serviceItem || "",
      });
      setAddressValue({
        formattedAddress: task.address || "",
        lat: task.latitude ?? undefined,
        lng: task.longitude ?? undefined,
        placeId: task.geoFenceId ?? undefined,
      });
    } else {
      setEditingId(null);
      setForm({ ...DEFAULT_FORM, clientId: resolvedClientId || "" });
      setAddressValue({ formattedAddress: "" });
    }
    setDrawerOpen(true);
  };

  useEffect(() => {
    if (autoOpenHandled) return;
    const openId = searchParams.get("open");
    if (!openId) {
      setAutoOpenHandled(true);
      return;
    }
    const match = items.find((item) => String(item.id) === String(openId));
    if (match) {
      openDrawer(match);
      setAutoOpenHandled(true);
    }
  }, [autoOpenHandled, items, searchParams]);

  const handleAddressChange = (value) => {
    const nextValue = value || { formattedAddress: "" };
    setAddressValue(nextValue);
    setForm((prev) => ({
      ...prev,
      address: nextValue.formattedAddress || "",
      latitude: nextValue.lat ?? "",
      longitude: nextValue.lng ?? "",
      geoFenceId: nextValue.placeId || "",
    }));
  };

  const handleFilterAddressChange = (value) => {
    const nextValue = value || { formattedAddress: "" };
    setFilterAddressValue(nextValue);
    setDraftFilters((prev) => ({ ...prev, region: nextValue.formattedAddress || "" }));
  };

  const saveAppointment = async (payloadForm) => {
    setSaving(true);
    try {
      const payload = {
        clientId: payloadForm.clientId || resolvedClientId,
        clientName: payloadForm.clientName,
        clientDocument: payloadForm.clientDocument,
        contactName: payloadForm.contactName,
        contactChannel: payloadForm.contactChannel,
        address: payloadForm.address,
        referencePoint: payloadForm.referencePoint,
        serviceReason: payloadForm.serviceReason,
        status: payloadForm.status,
        technicianId: payloadForm.technicianId,
        technicianName: payloadForm.technicianName,
        assignedTeam: payloadForm.assignedTeam,
        latitude: payloadForm.latitude !== "" ? Number(payloadForm.latitude) : null,
        longitude: payloadForm.longitude !== "" ? Number(payloadForm.longitude) : null,
        geoFenceId: payloadForm.geoFenceId || null,
        startTimeExpected: payloadForm.startTimeExpected ? new Date(payloadForm.startTimeExpected).toISOString() : null,
        endTimeExpected: payloadForm.endTimeExpected ? new Date(payloadForm.endTimeExpected).toISOString() : null,
        type: normalizeServiceType(payloadForm.type),
        category: "appointment",
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

  const updateAppointmentStatus = async (nextStatus) => {
    if (!editingId) return;
    setStatusUpdating(true);
    try {
      const now = new Date().toISOString();
      const payload = { status: nextStatus, category: "appointment" };
      if (nextStatus === "no_local") payload.arrivalTime = now;
      if (nextStatus === "em_execucao") payload.serviceStartTime = now;
      if (nextStatus === "aguardando_validacao" || nextStatus === "concluido") payload.serviceEndTime = now;
      await CoreApi.updateTask(editingId, payload);
      setForm((prev) => ({ ...prev, status: nextStatus }));
      await loadAppointments();
    } catch (error) {
      console.error("Falha ao atualizar status do agendamento", error);
      alert("Não foi possível atualizar o status do agendamento.");
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleCreateServiceOrder = () => {
    if (!editingId) return;
    const params = new URLSearchParams();
    params.set("taskId", editingId);
    if (form.clientId) params.set("clientId", String(form.clientId));
    if (form.clientName) params.set("clientName", form.clientName);
    if (form.contactName) params.set("responsibleName", form.contactName);
    if (form.contactChannel) params.set("responsiblePhone", form.contactChannel);
    if (form.address) params.set("address", form.address);
    if (form.startTimeExpected) params.set("startAt", form.startTimeExpected);
    if (form.type) params.set("type", form.type);
    if (form.technicianName) params.set("technicianName", form.technicianName);
    navigate(`/services/new?${params.toString()}`);
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

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatusTab(tab.key)}
            className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${
              statusTab === tab.key
                ? "bg-sky-500 text-black"
                : "bg-white/10 text-white/70 hover:bg-white/15"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <FilterBar
        left={
          <div className="flex w-full flex-wrap items-center gap-3">
            <input
              value={draftFilters.query}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, query: event.target.value }))}
              placeholder="Buscar por cliente, documento, motivo"
              className="min-w-[240px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
            />
            <AutocompleteSelect
              label="Cliente"
              placeholder="Buscar cliente"
              value={draftFilters.clientId}
              options={clientAutocompleteOptions}
              loadOptions={loadClientOptions}
              onChange={(value) => setDraftFilters((prev) => ({ ...prev, clientId: value }))}
              allowClear
              className="min-w-[220px] flex-1"
            />
            <AutocompleteSelect
              label="Técnico"
              placeholder={techniciansLoading ? "Carregando técnicos..." : "Buscar técnico"}
              value={draftFilters.technician}
              options={technicianAutocompleteOptions}
              loadOptions={loadTechnicianOptions}
              onChange={(value) => setDraftFilters((prev) => ({ ...prev, technician: value }))}
              allowClear
              disabled={techniciansLoading}
              className="min-w-[220px] flex-1"
            />
            <div className="min-w-[240px] flex-1">
              <span className="block text-xs uppercase tracking-wide text-white/60">Endereço</span>
              <AddressAutocomplete
                label={null}
                value={filterAddressValue}
                onChange={handleFilterAddressChange}
                placeholder="Buscar endereço"
                variant="toolbar"
                containerClassName="w-full"
                portalSuggestions
              />
            </div>
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
            <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Cliente</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <AutocompleteSelect
                label="Nome do cliente"
                placeholder="Buscar cliente"
                value={form.clientId}
                options={clientAutocompleteOptions}
                loadOptions={loadClientOptions}
                onChange={(value, option) => {
                  setForm((prev) => ({
                    ...prev,
                    clientId: value || "",
                    clientName: option?.label || prev.clientName,
                  }));
                }}
                allowClear
              />
              <input
                value={form.clientDocument}
                onChange={(event) => setForm((prev) => ({ ...prev, clientDocument: event.target.value }))}
                placeholder="CNPJ"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Contato</h3>
            <div className="grid gap-3 md:grid-cols-2">
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
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Local</h3>
            <AddressAutocomplete
              label={null}
              value={addressValue}
              onChange={handleAddressChange}
              onSelect={handleAddressChange}
              placeholder="Buscar endereço"
              variant="toolbar"
              containerClassName="w-full"
              portalSuggestions
            />
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={form.referencePoint}
                onChange={(event) => setForm((prev) => ({ ...prev, referencePoint: event.target.value }))}
                placeholder="Referência"
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Serviço</h3>
            <div className="grid gap-3 md:grid-cols-2">
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
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Datas</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-xs text-white/60">
                Data da Solicitação
                <input
                  type="datetime-local"
                  value={form.startTimeExpected}
                  onChange={(event) => setForm((prev) => ({ ...prev, startTimeExpected: event.target.value }))}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
                />
              </label>
              <label className="block text-xs text-white/60">
                Data do Serviço
                <input
                  type="datetime-local"
                  value={form.endTimeExpected}
                  onChange={(event) => setForm((prev) => ({ ...prev, endTimeExpected: event.target.value }))}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
                />
              </label>
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

          {editingId ? (
            <section className="space-y-3">
              <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Fluxo rápido</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => updateAppointmentStatus("em_rota")}
                  disabled={statusUpdating || form.status === "em_rota"}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs text-white/80 hover:border-white/30 disabled:opacity-50"
                >
                  Iniciar deslocamento
                </button>
                <button
                  type="button"
                  onClick={() => updateAppointmentStatus("no_local")}
                  disabled={statusUpdating || form.status === "no_local"}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs text-white/80 hover:border-white/30 disabled:opacity-50"
                >
                  Cheguei no local
                </button>
                <button
                  type="button"
                  onClick={() => updateAppointmentStatus("em_execucao")}
                  disabled={statusUpdating || form.status === "em_execucao"}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs text-white/80 hover:border-white/30 disabled:opacity-50"
                >
                  Iniciar execução
                </button>
                <button
                  type="button"
                  onClick={() => updateAppointmentStatus("aguardando_validacao")}
                  disabled={statusUpdating || form.status === "aguardando_validacao"}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs text-white/80 hover:border-white/30 disabled:opacity-50"
                >
                  Enviar para validação
                </button>
                <button
                  type="button"
                  onClick={() => updateAppointmentStatus("concluido")}
                  disabled={statusUpdating || form.status === "concluido"}
                  className="rounded-xl border border-emerald-400/40 px-4 py-2 text-xs text-emerald-100 hover:border-emerald-300 disabled:opacity-50"
                >
                  Concluir atendimento
                </button>
                <button
                  type="button"
                  onClick={() => updateAppointmentStatus("reprovado")}
                  disabled={statusUpdating || form.status === "reprovado"}
                  className="rounded-xl border border-red-500/40 px-4 py-2 text-xs text-red-200 hover:border-red-400 disabled:opacity-50"
                >
                  Reprovar
                </button>
              </div>
            </section>
          ) : null}

          {editingId ? (
            <section className="space-y-3">
              <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Vínculos</h3>
              <div className="flex flex-wrap items-center gap-2 text-sm text-white/80">
                <span className="rounded-lg bg-white/10 px-3 py-1 text-xs">
                  Agendamento: {editingId}
                </span>
                {extractRequestId(form) ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/service-requests?open=${extractRequestId(form)}`)}
                    className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white hover:border-white/30"
                  >
                    Ver solicitação
                  </button>
                ) : (
                  <span className="text-xs text-white/50">Solicitação não vinculada</span>
                )}
              </div>
            </section>
          ) : null}

          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Responsáveis</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <AutocompleteSelect
                label="Técnico"
                placeholder={techniciansLoading ? "Carregando técnicos..." : "Buscar técnico"}
                value={form.technicianName}
                options={technicianAutocompleteOptions}
                loadOptions={loadTechnicianOptions}
                onChange={(value, option) => {
                  setForm((prev) => ({
                    ...prev,
                    technicianId: option?.id || "",
                    technicianName: option?.label || value || "",
                    assignedTeam: option?.description || prev.assignedTeam,
                  }));
                }}
                allowClear
                disabled={techniciansLoading}
              />
              <input
                value={form.assignedTeam}
                onChange={(event) => setForm((prev) => ({ ...prev, assignedTeam: event.target.value }))}
                placeholder="Equipe"
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
              {editingId ? (
                <button
                  type="button"
                  onClick={handleCreateServiceOrder}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white hover:border-white/30"
                >
                  Criar OS
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
