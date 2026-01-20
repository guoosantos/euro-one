import React, { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Search, Pencil, Eye } from "lucide-react";

import api from "../lib/api";
import { API_ROUTES } from "../lib/api-routes";
import { useTenant } from "../lib/tenant-context";
import { usePermissionGate } from "../lib/permissions/permission-gate";
import PageHeader from "../components/ui/PageHeader";
import FilterBar from "../components/ui/FilterBar";
import DataTable from "../components/ui/DataTable";
import EmptyState from "../components/ui/EmptyState";
import SkeletonTable from "../components/ui/SkeletonTable";

const documentTypeOptions = ["CPF", "CNPJ", "Cédula de identidad", "RUC"];
const clientTypeOptions = ["Cliente Final", "Gerenciadora de Risco", "Companhias de Seguro"];
const cnhCategories = ["ACC", "A", "B", "C", "D", "E", "AB", "AC", "AD", "AE"];
const genderOptions = ["Masculino", "Feminino", "Outro"];

const defaultProfile = {
  documentType: "CPF",
  documentNumber: "",
  clientType: "Cliente Final",
  person: {
    name: "",
    birthDate: "",
    cnh: "",
    cnhCategory: "",
    cnhExpiry: "",
    gender: "",
    rg: "",
    rgIssuer: "",
    rgIssuedAt: "",
    nationality: "",
    birthPlace: "",
    profession: "",
    fatherName: "",
    motherName: "",
  },
  company: {
    legalName: "",
    stateRegistration: "",
    municipalRegistration: "",
  },
  contact: {
    cep: "",
    address: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
    phone: "",
    mobile: "",
    email: "",
    notes: "",
  },
};

const baseFormState = {
  name: "",
  deviceLimit: 0,
  userLimit: 0,
  vehicleLimit: 0,
  profile: defaultProfile,
};

const EMPTY_LIST = [];

function Drawer({ open, onClose, title, description, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9998] flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-3xl border-l border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Clientes</p>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {description && <p className="text-sm text-white/60">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-white/70 transition hover:border-white/30 hover:text-white"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>
        <div className="h-[calc(100%-80px)] overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

function resolveClientDocument(client) {
  return (
    client?.attributes?.clientProfile?.documentNumber ||
    client?.attributes?.documentNumber ||
    client?.documentNumber ||
    ""
  );
}

function resolveClientEmail(client) {
  return (
    client?.attributes?.clientProfile?.contact?.email ||
    client?.email ||
    ""
  );
}

export default function Clients() {
  const { role, tenant, refreshClients } = useTenant();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [form, setForm] = useState(baseFormState);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsClient, setDetailsClient] = useState(null);
  const [detailsClientId, setDetailsClientId] = useState(null);
  const [detailsTab, setDetailsTab] = useState("Geral");
  const [detailsSearch, setDetailsSearch] = useState({ vehicles: "", users: "", mirrors: "" });
  const [detailsData, setDetailsData] = useState({
    summary: { vehiclesCount: 0, usersCount: 0, equipmentModelsSummary: [] },
    vehicles: EMPTY_LIST,
    equipments: EMPTY_LIST,
    users: EMPTY_LIST,
    mirrors: EMPTY_LIST,
  });

  const isAdmin = role === "admin";
  const isManager = role === "manager";
  const clientsPermission = usePermissionGate({ menuKey: "admin", pageKey: "clients" });

  useEffect(() => {
    if (isAdmin || isManager) {
      loadClients();
    }
  }, [isAdmin, isManager]);

  async function loadClients() {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(API_ROUTES.clients);
      const list = response?.data?.clients || response?.data || [];
      const normalized = Array.isArray(list) ? list : [];
      const filtered = isAdmin || !tenant ? normalized : normalized.filter((entry) => entry.id === tenant.id);
      setClients(filtered);
      if (detailsClientId) {
        const refreshed = filtered.find((entry) => String(entry.id) === String(detailsClientId));
        if (refreshed) {
          setDetailsClient(refreshed);
        }
      }
      if (isAdmin) {
        refreshClients();
      }
    } catch (loadError) {
      console.error("Erro ao carregar clientes", loadError);
      setError(loadError);
      setClients([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!detailsClientId) return;
    const refreshed = clients.find((entry) => String(entry.id) === String(detailsClientId));
    if (refreshed && refreshed !== detailsClient) {
      setDetailsClient(refreshed);
    }
  }, [clients, detailsClient, detailsClientId]);

  const filteredClients = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return clients;
    return clients.filter((client) => {
      const name = client?.name || "";
      const documentNumber = resolveClientDocument(client);
      const email = resolveClientEmail(client);
      return [name, documentNumber, email].some((value) => String(value || "").toLowerCase().includes(search));
    });
  }, [clients, query]);

  const tableColCount = 6;

  const isCpf = form.profile.documentType === "CPF";
  const isCnpj = form.profile.documentType === "CNPJ";

  const profileName =
    form.profile.person?.name || form.profile.company?.legalName || form.name || editingClient?.name || "";

  function buildFormState(client) {
    const attributes = client?.attributes || {};
    const storedProfile = attributes.clientProfile || {};
    const profile = {
      ...defaultProfile,
      ...storedProfile,
      person: {
        ...defaultProfile.person,
        ...(storedProfile.person || {}),
      },
      company: {
        ...defaultProfile.company,
        ...(storedProfile.company || {}),
      },
      contact: {
        ...defaultProfile.contact,
        ...(storedProfile.contact || {}),
      },
    };
    return {
      name: client?.name || "",
      deviceLimit: client?.deviceLimit ?? 0,
      userLimit: client?.userLimit ?? 0,
      vehicleLimit: attributes.vehicleLimit ?? 0,
      profile,
    };
  }

  function openCreateDrawer() {
    setEditingClient(null);
    setForm(baseFormState);
    setDrawerOpen(true);
  }

  function openEditDrawer(client) {
    setEditingClient(client);
    setForm(buildFormState(client));
    setDrawerOpen(true);
  }

  function closeDrawer() {
    if (saving) return;
    setDrawerOpen(false);
    setEditingClient(null);
    setError(null);
  }

  function handleFormChange(field) {
    return (event) => {
      const value = event.target.value;
      setForm((prev) => ({
        ...prev,
        [field]: value,
      }));
    };
  }

  function handleNumberChange(field) {
    return (event) => {
      const value = Number(event.target.value);
      setForm((prev) => ({
        ...prev,
        [field]: Number.isNaN(value) ? 0 : value,
      }));
    };
  }

  function handleProfileChange(section, field) {
    return (event) => {
      const value = event.target.value;
      setForm((prev) => ({
        ...prev,
        profile: {
          ...prev.profile,
          [section]: {
            ...prev.profile[section],
            [field]: value,
          },
        },
      }));
    };
  }

  function handleRootProfileChange(field) {
    return (event) => {
      const value = event.target.value;
      setForm((prev) => ({
        ...prev,
        profile: {
          ...prev.profile,
          [field]: value,
        },
      }));
    };
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name || profileName,
        deviceLimit: form.deviceLimit,
        userLimit: form.userLimit,
        attributes: {
          ...(editingClient?.attributes || {}),
          vehicleLimit: form.vehicleLimit,
          companyName: form.profile.company?.legalName || form.name || profileName,
          clientProfile: {
            documentType: form.profile.documentType,
            documentNumber: form.profile.documentNumber,
            clientType: form.profile.clientType,
            person: form.profile.person,
            company: form.profile.company,
            contact: form.profile.contact,
          },
        },
      };
      if (editingClient?.id) {
        await api.put(`/clients/${editingClient.id}`, payload);
      } else {
        await api.post(API_ROUTES.clients, payload);
      }
      setDrawerOpen(false);
      setEditingClient(null);
      await loadClients();
    } catch (saveError) {
      console.error("Falha ao salvar cliente", saveError);
      setError(saveError);
    } finally {
      setSaving(false);
    }
  }

  async function openDetailsDrawer(client) {
    setDetailsClient(client);
    setDetailsClientId(client?.id || null);
    setDetailsOpen(true);
    setDetailsTab("Geral");
    setDetailsSearch({ vehicles: "", users: "", mirrors: "" });
    setDetailsLoading(true);
    try {
      const response = await api.get(`/clients/${client.id}/details`);
      setDetailsData({
        summary: response?.data?.summary || { vehiclesCount: 0, usersCount: 0, equipmentModelsSummary: [] },
        vehicles: Array.isArray(response?.data?.vehicles) ? response.data.vehicles : EMPTY_LIST,
        equipments: Array.isArray(response?.data?.equipments) ? response.data.equipments : EMPTY_LIST,
        users: Array.isArray(response?.data?.users) ? response.data.users : EMPTY_LIST,
        mirrors: Array.isArray(response?.data?.mirrors) ? response.data.mirrors : EMPTY_LIST,
      });
    } catch (loadError) {
      console.error("Erro ao carregar detalhes do cliente", loadError);
      setDetailsData({
        summary: { vehiclesCount: 0, usersCount: 0, equipmentModelsSummary: [] },
        vehicles: EMPTY_LIST,
        equipments: EMPTY_LIST,
        users: EMPTY_LIST,
        mirrors: EMPTY_LIST,
      });
    } finally {
      setDetailsLoading(false);
    }
  }

  async function handleDeleteClient(client) {
    if (!client?.id) return;
    if (!window.confirm(`Excluir cliente ${client.name}?`)) return;
    try {
      await api.delete(`${API_ROUTES.clients}/${client.id}`);
      setClients((prev) => prev.filter((entry) => String(entry.id) !== String(client.id)));
      if (detailsClientId && String(detailsClientId) === String(client.id)) {
        closeDetailsDrawer();
      }
    } catch (deleteError) {
      console.error("Erro ao excluir cliente", deleteError);
      setError(deleteError);
    }
  }

  function closeDetailsDrawer() {
    setDetailsOpen(false);
    setDetailsClient(null);
    setDetailsClientId(null);
    setDetailsData({
      summary: { vehiclesCount: 0, usersCount: 0, equipmentModelsSummary: [] },
      vehicles: EMPTY_LIST,
      equipments: EMPTY_LIST,
      users: EMPTY_LIST,
      mirrors: EMPTY_LIST,
    });
  }

  const detailsVehicles = Array.isArray(detailsData.vehicles) ? detailsData.vehicles : EMPTY_LIST;
  const detailsEquipments = Array.isArray(detailsData.equipments) ? detailsData.equipments : EMPTY_LIST;
  const detailsUsers = Array.isArray(detailsData.users) ? detailsData.users : EMPTY_LIST;
  const detailsMirrors = Array.isArray(detailsData.mirrors) ? detailsData.mirrors : EMPTY_LIST;

  const filteredDetailsVehicles = useMemo(() => {
    const search = detailsSearch.vehicles.trim().toLowerCase();
    if (!search) return detailsVehicles;
    return detailsVehicles.filter((vehicle) => {
      const values = [vehicle?.name, vehicle?.plate, vehicle?.model, vehicle?.brand];
      return values.some((value) => String(value || "").toLowerCase().includes(search));
    });
  }, [detailsSearch.vehicles, detailsVehicles]);

  const filteredDetailsUsers = useMemo(() => {
    const search = detailsSearch.users.trim().toLowerCase();
    if (!search) return detailsUsers;
    return detailsUsers.filter((user) => {
      const values = [user?.name, user?.email];
      return values.some((value) => String(value || "").toLowerCase().includes(search));
    });
  }, [detailsSearch.users, detailsUsers]);

  const mirrorRows = useMemo(() => {
    const vehicleMap = new Map(detailsVehicles.map((vehicle) => [String(vehicle.id), vehicle]));
    return detailsMirrors.flatMap((mirror) => {
      const vehicleIds = Array.isArray(mirror.vehicleIds) ? mirror.vehicleIds : [];
      if (!vehicleIds.length) {
        return [
          {
            id: `${mirror.id}-empty`,
            mirror,
            vehicle: null,
            targetName: mirror.targetClientName || mirror.targetClientId || "—",
          },
        ];
      }
      return vehicleIds.map((vehicleId) => ({
        id: `${mirror.id}-${vehicleId}`,
        mirror,
        vehicle: vehicleMap.get(String(vehicleId)) || null,
        targetName: mirror.targetClientName || mirror.targetClientId || "—",
      }));
    });
  }, [detailsMirrors, detailsVehicles]);

  const filteredMirrorRows = useMemo(() => {
    const search = detailsSearch.mirrors.trim().toLowerCase();
    if (!search) return mirrorRows;
    return mirrorRows.filter((row) => {
      const vehicle = row.vehicle;
      const values = [vehicle?.name, vehicle?.plate, vehicle?.model, vehicle?.brand, row.targetName];
      return values.some((value) => String(value || "").toLowerCase().includes(search));
    });
  }, [detailsSearch.mirrors, mirrorRows]);

  if (!isAdmin && !isManager) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-white/80">
        <h2 className="text-lg font-semibold">Acesso restrito</h2>
        <p className="mt-2 text-sm opacity-70">Apenas administradores ou gestores podem visualizar clientes.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-180px)] flex-col gap-6">
      <PageHeader
        overline="Central de clientes"
        title="Clientes"
        subtitle="Cadastre, acompanhe limites e gerencie as informações dos clientes."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadClients}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="h-4 w-4" /> Atualizar
              </span>
            </button>
            <button
              type="button"
              onClick={openCreateDrawer}
              disabled={!isAdmin}
              title={!isAdmin ? "Apenas administradores podem criar clientes" : undefined}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-sky-500/60"
            >
              <span className="inline-flex items-center gap-2">
                <Plus className="h-4 w-4" /> Novo cliente
              </span>
            </button>
          </div>
        }
      />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error?.response?.data?.message || error.message}
        </div>
      )}

      <FilterBar
        left={
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
            <input
              placeholder="Buscar por nome, documento ou e-mail"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
            />
          </div>
        }
      />

      <div className="flex-1 overflow-hidden">
        <DataTable tableClassName="text-white/80">
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
            <tr>
              <th className="px-4 py-3 text-left">Cliente</th>
              <th className="px-4 py-3 text-left">CNPJ/Documento</th>
              <th className="px-4 py-3 text-left">Veículos</th>
              <th className="px-4 py-3 text-left">Equipamentos</th>
              <th className="px-4 py-3 text-left">Espelhamento</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {loading && (
              <tr>
                <td colSpan={tableColCount} className="px-4 py-6">
                  <SkeletonTable rows={6} columns={tableColCount} />
                </td>
              </tr>
            )}
            {!loading && filteredClients.length === 0 && (
              <tr>
                <td colSpan={tableColCount} className="px-4 py-6">
                  <EmptyState
                    title="Nenhum cliente encontrado"
                    subtitle="Cadastre um novo cliente ou ajuste os filtros para visualizar mais resultados."
                  />
                </td>
              </tr>
            )}
            {!loading &&
              filteredClients.map((client) => (
                <tr key={client.id} className="hover:bg-white/5">
                  <td className="px-4 py-4">
                    <div className="font-semibold text-white">{client.name || "—"}</div>
                    <div className="text-xs text-white/60">{resolveClientEmail(client) || "Sem e-mail"}</div>
                  </td>
                  <td className="px-4 py-4 text-white/70">{resolveClientDocument(client) || "—"}</td>
                  <td className="px-4 py-4 text-white/80">{client.vehiclesCount ?? 0}</td>
                  <td className="px-4 py-4 text-white/80">
                    Vinculados: {client.equipmentsLinkedCount ?? 0} | Disponíveis: {client.equipmentsAvailableCount ?? 0}
                  </td>
                  <td className="px-4 py-4 text-white/80">{client.mirroredVehiclesCount ?? 0}</td>
                  <td className="px-4 py-4 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEditDrawer(client)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white transition hover:border-white/30"
                        aria-label="Editar cliente"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openDetailsDrawer(client)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white transition hover:border-white/30"
                        aria-label="Detalhes do cliente"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      {clientsPermission.isFull && (
                        <button
                          type="button"
                          onClick={() => handleDeleteClient(client)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-500/40 text-red-300 transition hover:bg-red-500/10"
                          aria-label="Excluir cliente"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </DataTable>
      </div>

      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        title={editingClient ? "Editar cliente" : "Novo cliente"}
        description={
          editingClient
            ? "Atualize os dados principais e limites do cliente."
            : "Cadastre um novo cliente com seus dados completos."
        }
      >
        <form className="space-y-6" onSubmit={handleSave}>
          <section className="space-y-4 border-b border-white/10 pb-6">
            <h3 className="text-sm font-semibold text-white/80">Identificação</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm text-white/70">
                <span className="block text-xs uppercase tracking-wide text-white/50">Tipo do cliente</span>
                <select
                  value={form.profile.clientType}
                  onChange={handleRootProfileChange("clientType")}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                >
                  {clientTypeOptions.map((option) => (
                    <option key={option} value={option} className="bg-[#0f141c]">
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-white/70">
                <span className="block text-xs uppercase tracking-wide text-white/50">Tipo de documento</span>
                <select
                  value={form.profile.documentType}
                  onChange={handleRootProfileChange("documentType")}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                >
                  {documentTypeOptions.map((option) => (
                    <option key={option} value={option} className="bg-[#0f141c]">
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-white/70">
                <span className="block text-xs uppercase tracking-wide text-white/50">Documento</span>
                <input
                  type="text"
                  value={form.profile.documentNumber}
                  onChange={handleRootProfileChange("documentNumber")}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                />
              </label>
              <label className="text-sm text-white/70">
                <span className="block text-xs uppercase tracking-wide text-white/50">Nome</span>
                <input
                  type="text"
                  value={form.name}
                  onChange={handleFormChange("name")}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                />
              </label>
            </div>
          </section>

          {isCpf && (
            <section className="space-y-4 border-b border-white/10 pb-6">
              <h3 className="text-sm font-semibold text-white/80">Pessoa física</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm text-white/70">
                  <span className="block text-xs uppercase tracking-wide text-white/50">Nome completo</span>
                  <input
                    type="text"
                    value={form.profile.person.name}
                    onChange={handleProfileChange("person", "name")}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  />
                </label>
                <label className="text-sm text-white/70">
                  <span className="block text-xs uppercase tracking-wide text-white/50">Nascimento</span>
                  <input
                    type="date"
                    value={form.profile.person.birthDate}
                    onChange={handleProfileChange("person", "birthDate")}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  />
                </label>
                <label className="text-sm text-white/70">
                  <span className="block text-xs uppercase tracking-wide text-white/50">RG</span>
                  <input
                    type="text"
                    value={form.profile.person.rg}
                    onChange={handleProfileChange("person", "rg")}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  />
                </label>
                <label className="text-sm text-white/70">
                  <span className="block text-xs uppercase tracking-wide text-white/50">Órgão emissor</span>
                  <input
                    type="text"
                    value={form.profile.person.rgIssuer}
                    onChange={handleProfileChange("person", "rgIssuer")}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  />
                </label>
                <label className="text-sm text-white/70">
                  <span className="block text-xs uppercase tracking-wide text-white/50">Data de emissão</span>
                  <input
                    type="date"
                    value={form.profile.person.rgIssuedAt}
                    onChange={handleProfileChange("person", "rgIssuedAt")}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  />
                </label>
                <label className="text-sm text-white/70">
                  <span className="block text-xs uppercase tracking-wide text-white/50">CNH</span>
                  <input
                    type="text"
                    value={form.profile.person.cnh}
                    onChange={handleProfileChange("person", "cnh")}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  />
                </label>
                <label className="text-sm text-white/70">
                  <span className="block text-xs uppercase tracking-wide text-white/50">Categoria</span>
                  <select
                    value={form.profile.person.cnhCategory}
                    onChange={handleProfileChange("person", "cnhCategory")}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  >
                    <option value="" className="bg-[#0f141c]">
                      Selecione
                    </option>
                    {cnhCategories.map((option) => (
                      <option key={option} value={option} className="bg-[#0f141c]">
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-white/70">
                  <span className="block text-xs uppercase tracking-wide text-white/50">Validade</span>
                  <input
                    type="date"
                    value={form.profile.person.cnhExpiry}
                    onChange={handleProfileChange("person", "cnhExpiry")}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  />
                </label>
                <label className="text-sm text-white/70">
                  <span className="block text-xs uppercase tracking-wide text-white/50">Sexo</span>
                  <select
                    value={form.profile.person.gender}
                    onChange={handleProfileChange("person", "gender")}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  >
                    <option value="" className="bg-[#0f141c]">
                      Selecione
                    </option>
                    {genderOptions.map((option) => (
                      <option key={option} value={option} className="bg-[#0f141c]">
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>
          )}

          {isCnpj && (
            <section className="space-y-4 border-b border-white/10 pb-6">
              <h3 className="text-sm font-semibold text-white/80">Pessoa jurídica</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm text-white/70">
                  <span className="block text-xs uppercase tracking-wide text-white/50">Razão social</span>
                  <input
                    type="text"
                    value={form.profile.company.legalName}
                    onChange={handleProfileChange("company", "legalName")}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  />
                </label>
                <label className="text-sm text-white/70">
                  <span className="block text-xs uppercase tracking-wide text-white/50">Inscrição estadual</span>
                  <input
                    type="text"
                    value={form.profile.company.stateRegistration}
                    onChange={handleProfileChange("company", "stateRegistration")}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  />
                </label>
                <label className="text-sm text-white/70">
                  <span className="block text-xs uppercase tracking-wide text-white/50">Inscrição municipal</span>
                  <input
                    type="text"
                    value={form.profile.company.municipalRegistration}
                    onChange={handleProfileChange("company", "municipalRegistration")}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  />
                </label>
              </div>
            </section>
          )}

          <section className="space-y-4 border-b border-white/10 pb-6">
            <h3 className="text-sm font-semibold text-white/80">Contato</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm text-white/70">
                <span className="block text-xs uppercase tracking-wide text-white/50">CEP</span>
                <input
                  type="text"
                  value={form.profile.contact.cep}
                  onChange={handleProfileChange("contact", "cep")}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                />
              </label>
              <label className="text-sm text-white/70">
                <span className="block text-xs uppercase tracking-wide text-white/50">Endereço</span>
                <input
                  type="text"
                  value={form.profile.contact.address}
                  onChange={handleProfileChange("contact", "address")}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                />
              </label>
              <label className="text-sm text-white/70">
                <span className="block text-xs uppercase tracking-wide text-white/50">Número</span>
                <input
                  type="text"
                  value={form.profile.contact.number}
                  onChange={handleProfileChange("contact", "number")}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                />
              </label>
              <label className="text-sm text-white/70">
                <span className="block text-xs uppercase tracking-wide text-white/50">Complemento</span>
                <input
                  type="text"
                  value={form.profile.contact.complement}
                  onChange={handleProfileChange("contact", "complement")}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                />
              </label>
              <label className="text-sm text-white/70">
                <span className="block text-xs uppercase tracking-wide text-white/50">Bairro</span>
                <input
                  type="text"
                  value={form.profile.contact.neighborhood}
                  onChange={handleProfileChange("contact", "neighborhood")}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                />
              </label>
              <label className="text-sm text-white/70">
                <span className="block text-xs uppercase tracking-wide text-white/50">Cidade</span>
                <input
                  type="text"
                  value={form.profile.contact.city}
                  onChange={handleProfileChange("contact", "city")}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                />
              </label>
              <label className="text-sm text-white/70">
                <span className="block text-xs uppercase tracking-wide text-white/50">Estado</span>
                <input
                  type="text"
                  value={form.profile.contact.state}
                  onChange={handleProfileChange("contact", "state")}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                />
              </label>
              <label className="text-sm text-white/70">
                <span className="block text-xs uppercase tracking-wide text-white/50">Telefone</span>
                <input
                  type="text"
                  value={form.profile.contact.phone}
                  onChange={handleProfileChange("contact", "phone")}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                />
              </label>
              <label className="text-sm text-white/70">
                <span className="block text-xs uppercase tracking-wide text-white/50">Celular</span>
                <input
                  type="text"
                  value={form.profile.contact.mobile}
                  onChange={handleProfileChange("contact", "mobile")}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                />
              </label>
              <label className="text-sm text-white/70">
                <span className="block text-xs uppercase tracking-wide text-white/50">E-mail</span>
                <input
                  type="email"
                  value={form.profile.contact.email}
                  onChange={handleProfileChange("contact", "email")}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                />
              </label>
            </div>
          </section>

          <section className="space-y-4 border-b border-white/10 pb-6">
            <h3 className="text-sm font-semibold text-white/80">Limites</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="text-sm text-white/70">
                <span className="block text-xs uppercase tracking-wide text-white/50">Limite de veículos</span>
                <input
                  type="number"
                  min={0}
                  value={form.vehicleLimit}
                  onChange={handleNumberChange("vehicleLimit")}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                />
              </label>
              <label className="text-sm text-white/70">
                <span className="block text-xs uppercase tracking-wide text-white/50">Limite de usuários</span>
                <input
                  type="number"
                  min={0}
                  value={form.userLimit}
                  onChange={handleNumberChange("userLimit")}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                />
              </label>
              <label className="text-sm text-white/70">
                <span className="block text-xs uppercase tracking-wide text-white/50">Limite de equipamentos</span>
                <input
                  type="number"
                  min={0}
                  value={form.deviceLimit}
                  onChange={handleNumberChange("deviceLimit")}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                />
              </label>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-white/80">Observações</h3>
            <textarea
              rows={4}
              value={form.profile.contact.notes}
              onChange={handleProfileChange("contact", "notes")}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              placeholder="Observações adicionais sobre o cliente"
            />
          </section>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={closeDrawer}
              className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/80 transition hover:border-white/30"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-sky-500/60"
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      </Drawer>

      <Drawer
        open={detailsOpen}
        onClose={closeDetailsDrawer}
        title={`Detalhes - ${detailsClient?.name || "Cliente"}`}
        description="Visão geral e informações vinculadas ao cliente."
      >
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {["Geral", "Veículos", "Equipamentos", "Usuários", "Espelhamento"].map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setDetailsTab(tab)}
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  detailsTab === tab
                    ? "border-sky-400 bg-sky-500/20 text-sky-200"
                    : "border-white/10 bg-white/5 text-white/70 hover:border-white/30"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {detailsLoading && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-white/60">
              Carregando detalhes…
            </div>
          )}

          {!detailsLoading && detailsTab === "Geral" && (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-white/50">Veículos</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{detailsData.summary?.vehiclesCount ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-white/50">Usuários</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{detailsData.summary?.usersCount ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-white/50">Equipamentos</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{detailsEquipments.length}</p>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-white/80">Modelos de equipamentos</h4>
                <DataTable>
                  <thead className="text-xs uppercase tracking-wide text-white/50">
                    <tr>
                      <th className="px-3 py-2 text-left">Modelo</th>
                      <th className="px-3 py-2 text-right">Quantidade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {(detailsData.summary?.equipmentModelsSummary || []).map((model) => (
                      <tr key={model.model}>
                        <td className="px-3 py-2 text-white/80">{model.model}</td>
                        <td className="px-3 py-2 text-right text-white/70">{model.count}</td>
                      </tr>
                    ))}
                    {(!detailsData.summary?.equipmentModelsSummary ||
                      detailsData.summary.equipmentModelsSummary.length === 0) && (
                      <tr>
                        <td colSpan={2} className="px-3 py-3 text-center text-sm text-white/60">
                          Nenhum equipamento cadastrado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </DataTable>
              </div>
            </div>
          )}

          {!detailsLoading && detailsTab === "Veículos" && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                <input
                  placeholder="Buscar veículo"
                  value={detailsSearch.vehicles}
                  onChange={(event) =>
                    setDetailsSearch((prev) => ({
                      ...prev,
                      vehicles: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
              </div>
              <DataTable>
                <thead className="text-xs uppercase tracking-wide text-white/50">
                  <tr>
                    <th className="px-3 py-2 text-left">Veículo</th>
                    <th className="px-3 py-2 text-left">Placa</th>
                    <th className="px-3 py-2 text-left">Modelo</th>
                    <th className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {filteredDetailsVehicles.map((vehicle) => (
                    <tr key={vehicle.id}>
                      <td className="px-3 py-2 text-white/80">{vehicle.name || vehicle.brand || "—"}</td>
                      <td className="px-3 py-2 text-white/70">{vehicle.plate || "—"}</td>
                      <td className="px-3 py-2 text-white/70">{vehicle.model || "—"}</td>
                      <td className="px-3 py-2 text-white/70">{vehicle.status || "—"}</td>
                    </tr>
                  ))}
                  {filteredDetailsVehicles.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-sm text-white/60">
                        Nenhum veículo encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </DataTable>
            </div>
          )}

          {!detailsLoading && detailsTab === "Equipamentos" && (
            <div className="space-y-4">
              <DataTable>
                <thead className="text-xs uppercase tracking-wide text-white/50">
                  <tr>
                    <th className="px-3 py-2 text-left">Equipamento</th>
                    <th className="px-3 py-2 text-left">Modelo</th>
                    <th className="px-3 py-2 text-left">Veículo</th>
                    <th className="px-3 py-2 text-left">Identificador</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {detailsEquipments.map((equipment) => (
                    <tr key={equipment.id}>
                      <td className="px-3 py-2 text-white/80">{equipment.name || "—"}</td>
                      <td className="px-3 py-2 text-white/70">{equipment.model || "—"}</td>
                      <td className="px-3 py-2 text-white/70">{equipment.vehicleLabel || "—"}</td>
                      <td className="px-3 py-2 text-white/70">{equipment.uniqueId || "—"}</td>
                    </tr>
                  ))}
                  {detailsEquipments.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-sm text-white/60">
                        Nenhum equipamento encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </DataTable>
            </div>
          )}

          {!detailsLoading && detailsTab === "Usuários" && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                <input
                  placeholder="Buscar usuário"
                  value={detailsSearch.users}
                  onChange={(event) =>
                    setDetailsSearch((prev) => ({
                      ...prev,
                      users: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
              </div>
              <DataTable>
                <thead className="text-xs uppercase tracking-wide text-white/50">
                  <tr>
                    <th className="px-3 py-2 text-left">Nome</th>
                    <th className="px-3 py-2 text-left">E-mail</th>
                    <th className="px-3 py-2 text-left">Cargo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {filteredDetailsUsers.map((user) => (
                    <tr key={user.id}>
                      <td className="px-3 py-2 text-white/80">{user.name || "—"}</td>
                      <td className="px-3 py-2 text-white/70">{user.email || "—"}</td>
                      <td className="px-3 py-2 text-white/70">{user.role || "—"}</td>
                    </tr>
                  ))}
                  {filteredDetailsUsers.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-center text-sm text-white/60">
                        Nenhum usuário encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </DataTable>
            </div>
          )}

          {!detailsLoading && detailsTab === "Espelhamento" && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                <input
                  placeholder="Buscar veículo espelhado"
                  value={detailsSearch.mirrors}
                  onChange={(event) =>
                    setDetailsSearch((prev) => ({
                      ...prev,
                      mirrors: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
              </div>
              <DataTable>
                <thead className="text-xs uppercase tracking-wide text-white/50">
                  <tr>
                    <th className="px-3 py-2 text-left">Veículo</th>
                    <th className="px-3 py-2 text-left">Destino</th>
                    <th className="px-3 py-2 text-left">Período</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {filteredMirrorRows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 text-white/80">
                        {row.vehicle
                          ? `${row.vehicle.name || row.vehicle.model || "Veículo"} → ${row.targetName}`
                          : `Veículo → ${row.targetName}`}
                      </td>
                      <td className="px-3 py-2 text-white/70">{row.targetName}</td>
                      <td className="px-3 py-2 text-white/70">
                        {row.mirror?.startAt || row.mirror?.endAt
                          ? `${row.mirror?.startAt || "—"} até ${row.mirror?.endAt || "—"}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                  {filteredMirrorRows.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-center text-sm text-white/60">
                        Nenhum espelhamento encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </DataTable>
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );
}
