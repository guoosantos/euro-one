import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import api from "../lib/api";
import { API_ROUTES } from "../lib/api-routes";
import { useTenant } from "../lib/tenant-context";
import DataTable from "../components/ui/DataTable";
import PageHeader from "../components/ui/PageHeader";
import { useGroups } from "../lib/hooks/useGroups";
import { PERMISSIONS_CATALOG } from "../lib/permissions/catalog";

const documentTypeOptions = ["CPF", "CNPJ", "CI", "RUC"];
const clientTypeOptions = ["Cliente Final", "Gerenciadora", "Seguradora"];
const cnhCategories = ["ACC", "A", "B", "C", "D", "E", "AB", "AC", "AD", "AE"];
const genderOptions = ["Masculino", "Feminino"];

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

const tabs = [
  { id: "informacoes", label: "Informações" },
  { id: "usuarios", label: "Usuários" },
  { id: "veiculos", label: "Veículos" },
  { id: "permissoes", label: "Grupo de Permissões" },
  { id: "espelhamento", label: "Espelhamento" },
];

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

export default function ClientDetailsPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { role } = useTenant();
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [activeTab, setActiveTab] = useState("informacoes");
  const [form, setForm] = useState(baseFormState);
  const [users, setUsers] = useState(EMPTY_LIST);
  const [vehicles, setVehicles] = useState(EMPTY_LIST);
  const [permissionDrawerOpen, setPermissionDrawerOpen] = useState(false);
  const [editingPermissionGroup, setEditingPermissionGroup] = useState(null);
  const [permissionGroupForm, setPermissionGroupForm] = useState({ name: "", description: "", rules: {} });
  const [mirrors, setMirrors] = useState(EMPTY_LIST);
  const [mirrorDrawerOpen, setMirrorDrawerOpen] = useState(false);
  const [editingMirror, setEditingMirror] = useState(null);
  const [mirrorForm, setMirrorForm] = useState({
    targetClientIds: [],
    vehicleIds: [],
    permissionGroupId: "",
    startAt: "",
    endAt: "",
  });
  const [clients, setClients] = useState(EMPTY_LIST);

  const isAdmin = role === "admin";

  const isCpf = form.profile.documentType === "CPF";
  const isCnpj = form.profile.documentType === "CNPJ";

  const profileName = form.profile.person?.name || form.profile.company?.legalName || client?.name || "";

  const accessSubtitle = useMemo(() => {
    if (isAdmin) {
      return "Atualize os dados cadastrais, limites e permissões vinculadas ao cliente.";
    }
    return "Gestores podem revisar os dados cadastrais e limites do próprio cliente.";
  }, [isAdmin]);

  const { groups, createGroup, updateGroup, deleteGroup } = useGroups({
    params: client?.id ? { clientId: client.id } : {},
  });

  const permissionGroups = useMemo(
    () => groups.filter((entry) => entry.attributes?.kind === "PERMISSION_GROUP"),
    [groups],
  );

  useEffect(() => {
    let isMounted = true;
    async function loadClient() {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get(`/clients/${id}`);
        const record = response?.data?.client || null;
        if (!isMounted) return;
        setClient(record);
        const attributes = record?.attributes || {};
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
        setForm({
          name: record?.name || "",
          deviceLimit: record?.deviceLimit ?? 0,
          userLimit: record?.userLimit ?? 0,
          vehicleLimit: attributes.vehicleLimit ?? 0,
          profile,
        });
      } catch (loadError) {
        if (!isMounted) return;
        console.error("Erro ao carregar cliente", loadError);
        setError(loadError);
      } finally {
        if (!isMounted) return;
        setLoading(false);
      }
    }
    loadClient();
    return () => {
      isMounted = false;
    };
  }, [id]);

  useEffect(() => {
    if (activeTab !== "usuarios" || !client?.id) return;
    let isMounted = true;
    async function loadUsers() {
      try {
        const response = await api.get(API_ROUTES.users, { params: { clientId: client.id } });
        if (!isMounted) return;
        const list = response?.data?.users || response?.data || [];
        setUsers(Array.isArray(list) ? list : EMPTY_LIST);
      } catch (loadError) {
        console.error("Erro ao carregar usuários", loadError);
        if (isMounted) setUsers(EMPTY_LIST);
      }
    }
    loadUsers();
    return () => {
      isMounted = false;
    };
  }, [activeTab, client?.id]);

  useEffect(() => {
    if (!["veiculos", "espelhamento"].includes(activeTab) || !client?.id) return;
    let isMounted = true;
    async function loadVehicles() {
      try {
        const response = await api.get(API_ROUTES.core.vehicles, { params: { clientId: client.id } });
        if (!isMounted) return;
        const list = response?.data?.vehicles || response?.data || [];
        setVehicles(Array.isArray(list) ? list : EMPTY_LIST);
      } catch (loadError) {
        console.error("Erro ao carregar veículos", loadError);
        if (isMounted) setVehicles(EMPTY_LIST);
      }
    }
    loadVehicles();
    return () => {
      isMounted = false;
    };
  }, [activeTab, client?.id]);

  useEffect(() => {
    if (activeTab !== "espelhamento" || !client?.id) return;
    let isMounted = true;
    async function loadMirrors() {
      try {
        const response = await api.get(API_ROUTES.mirrors, { params: { ownerClientId: client.id } });
        if (!isMounted) return;
        const list = response?.data?.mirrors || response?.data || [];
        setMirrors(Array.isArray(list) ? list : EMPTY_LIST);
      } catch (loadError) {
        console.error("Erro ao carregar espelhamentos", loadError);
        if (isMounted) setMirrors(EMPTY_LIST);
      }
    }
    async function loadClients() {
      try {
        const response = await api.get(API_ROUTES.clients);
        if (!isMounted) return;
        const list = response?.data?.clients || response?.data || [];
        setClients(Array.isArray(list) ? list : EMPTY_LIST);
      } catch (loadError) {
        console.error("Erro ao carregar clientes", loadError);
        if (isMounted) setClients(EMPTY_LIST);
      }
    }
    loadMirrors();
    loadClients();
    return () => {
      isMounted = false;
    };
  }, [activeTab, client?.id]);

  const handleProfileChange = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({
      ...prev,
      profile: {
        ...prev.profile,
        [field]: value,
      },
    }));
  };

  const handleProfileNestedChange = (section, field) => (event) => {
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

  const handleFormChange = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleNumberChange = (field) => (event) => {
    const value = Number(event.target.value);
    setForm((prev) => ({
      ...prev,
      [field]: Number.isNaN(value) ? 0 : value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!client?.id) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const nextAttributes = {
        ...(client.attributes || {}),
        vehicleLimit: form.vehicleLimit,
        userLimit: form.userLimit,
        clientProfile: {
          documentType: form.profile.documentType,
          documentNumber: form.profile.documentNumber,
          clientType: form.profile.clientType,
          person: form.profile.person,
          company: form.profile.company,
          contact: form.profile.contact,
        },
      };
      const payload = {
        name: form.name || profileName,
        deviceLimit: form.deviceLimit,
        userLimit: form.userLimit,
        attributes: nextAttributes,
      };
      const response = await api.put(`/clients/${client.id}`, payload);
      const updated = response?.data?.client || client;
      setClient(updated);
      setMessage("Cliente atualizado com sucesso");
    } catch (saveError) {
      console.error("Erro ao salvar cliente", saveError);
      setError(saveError);
    } finally {
      setSaving(false);
    }
  };

  const buildDefaultRules = () =>
    PERMISSIONS_CATALOG.reduce((acc, menu) => {
      acc[menu.menuKey] = menu.pages.reduce((pageAcc, page) => {
        pageAcc[page.pageKey] = page.actions.reduce((actionAcc, action) => {
          actionAcc[action] = false;
          return actionAcc;
        }, {});
        return pageAcc;
      }, {});
      return acc;
    }, {});

  const openPermissionDrawer = (group = null) => {
    setEditingPermissionGroup(group);
    setPermissionGroupForm({
      name: group?.name || "",
      description: group?.description || "",
      rules: group?.attributes?.rules || buildDefaultRules(),
    });
    setPermissionDrawerOpen(true);
  };

  const handlePermissionToggle = (menuKey, pageKey, action) => {
    setPermissionGroupForm((prev) => ({
      ...prev,
      rules: {
        ...prev.rules,
        [menuKey]: {
          ...prev.rules[menuKey],
          [pageKey]: {
            ...prev.rules[menuKey]?.[pageKey],
            [action]: !prev.rules?.[menuKey]?.[pageKey]?.[action],
          },
        },
      },
    }));
  };

  const handlePermissionSave = async (event) => {
    event.preventDefault();
    try {
      const payload = {
        name: permissionGroupForm.name,
        description: permissionGroupForm.description,
        clientId: client.id,
        attributes: {
          kind: "PERMISSION_GROUP",
          rules: permissionGroupForm.rules,
        },
      };
      if (editingPermissionGroup) {
        await updateGroup(editingPermissionGroup.id, payload);
      } else {
        await createGroup(payload);
      }
      setPermissionDrawerOpen(false);
      setEditingPermissionGroup(null);
    } catch (permissionError) {
      console.error("Erro ao salvar grupo de permissões", permissionError);
      setError(permissionError);
    }
  };

  const handlePermissionDelete = async (group) => {
    if (!window.confirm(`Remover grupo ${group.name}?`)) return;
    try {
      await deleteGroup(group.id);
    } catch (permissionError) {
      console.error("Erro ao remover grupo de permissões", permissionError);
      setError(permissionError);
    }
  };

  const openMirrorDrawer = (mirror = null) => {
    setEditingMirror(mirror);
    setMirrorForm({
      targetClientIds: mirror ? [mirror.targetClientId] : [],
      vehicleIds: mirror?.vehicleIds || [],
      permissionGroupId: mirror?.permissionGroupId || "",
      startAt: mirror?.startAt ? mirror.startAt.slice(0, 10) : "",
      endAt: mirror?.endAt ? mirror.endAt.slice(0, 10) : "",
    });
    setMirrorDrawerOpen(true);
  };

  const handleMirrorSave = async (event) => {
    event.preventDefault();
    try {
      if (editingMirror) {
        const payload = {
          targetClientId: mirrorForm.targetClientIds[0],
          vehicleIds: mirrorForm.vehicleIds,
          permissionGroupId: mirrorForm.permissionGroupId || null,
          startAt: mirrorForm.startAt || null,
          endAt: mirrorForm.endAt || null,
        };
        const response = await api.put(`/mirrors/${editingMirror.id}`, payload);
        const updated = response?.data?.mirror || editingMirror;
        setMirrors((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
      } else {
        const requests = mirrorForm.targetClientIds.map((targetClientId) => {
          const targetClient = clients.find((entry) => entry.id === targetClientId);
          const targetTypeValue = String(
            targetClient?.attributes?.clientProfile?.clientType || targetClient?.attributes?.clientType || "",
          ).toLowerCase();
          const targetType = targetTypeValue.includes("gerenciadora")
            ? "GERENCIADORA"
            : targetTypeValue.includes("seguradora")
              ? "SEGURADORA"
              : null;
          return api.post(API_ROUTES.mirrors, {
            ownerClientId: client.id,
            targetClientId,
            targetType,
            vehicleIds: mirrorForm.vehicleIds,
            permissionGroupId: mirrorForm.permissionGroupId || null,
            startAt: mirrorForm.startAt || null,
            endAt: mirrorForm.endAt || null,
          });
        });
        const results = await Promise.all(requests);
        const created = results.map((response) => response?.data?.mirror).filter(Boolean);
        if (created.length) {
          setMirrors((prev) => [...created, ...prev]);
        }
      }
      setMirrorDrawerOpen(false);
      setEditingMirror(null);
    } catch (mirrorError) {
      console.error("Erro ao salvar espelhamento", mirrorError);
      setError(mirrorError);
    }
  };

  const handleMirrorDelete = async (mirror) => {
    if (!window.confirm("Remover espelhamento?")) return;
    try {
      await api.delete(`/mirrors/${mirror.id}`);
      setMirrors((prev) => prev.filter((entry) => entry.id !== mirror.id));
    } catch (mirrorError) {
      console.error("Erro ao remover espelhamento", mirrorError);
      setError(mirrorError);
    }
  };

  return (
    <div className="space-y-6 text-white">
      <PageHeader
        title={profileName || "Detalhes do cliente"}
        subtitle={accessSubtitle}
        actions={
          <>
            <Link
              to="/clients"
              className="rounded-xl border border-border px-4 py-2 text-sm text-white/80 hover:bg-white/10"
            >
              Voltar
            </Link>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white/80 hover:bg-white/15"
            >
              Última página
            </button>
          </>
        }
      />

      {loading && (
        <div className="border border-white/10 p-6">
          <div className="h-6 w-48 animate-pulse rounded-full bg-white/10" />
          <div className="mt-4 h-4 w-72 animate-pulse rounded-full bg-white/10" />
        </div>
      )}

      {!loading && error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
          {error?.response?.data?.message || error.message}
        </div>
      )}

      {!loading && client && (
        <>
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-xl px-4 py-2 text-sm transition ${
                  activeTab === tab.id ? "bg-sky-500 text-black" : "bg-white/10 text-white hover:bg-white/15"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "informacoes" && (
            <form onSubmit={handleSubmit} className="space-y-6">
              <section className="border border-white/10 p-6">
                <div className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-3">
                    <label className="text-sm">
                      <span className="block text-xs uppercase tracking-wide text-white/60">Tipo de documento</span>
                      <select
                        value={form.profile.documentType}
                        onChange={handleProfileChange("documentType")}
                        className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                      >
                        {documentTypeOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="text-sm">
                      <span className="block text-xs uppercase tracking-wide text-white/60">Documento</span>
                      <input
                        type="text"
                        value={form.profile.documentNumber}
                        onChange={handleProfileChange("documentNumber")}
                        className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                      />
                    </label>

                    <label className="text-sm">
                      <span className="block text-xs uppercase tracking-wide text-white/60">Tipo do cliente</span>
                      <select
                        value={form.profile.clientType}
                        onChange={handleProfileChange("clientType")}
                        className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                      >
                        {clientTypeOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="text-sm">
                      <span className="block text-xs uppercase tracking-wide text-white/60">Limite de veículos</span>
                      <input
                        type="number"
                        min={0}
                        value={form.vehicleLimit}
                        onChange={handleNumberChange("vehicleLimit")}
                        className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                      />
                    </label>

                    <label className="text-sm">
                      <span className="block text-xs uppercase tracking-wide text-white/60">Limite de usuários</span>
                      <input
                        type="number"
                        min={0}
                        value={form.userLimit}
                        onChange={handleNumberChange("userLimit")}
                        className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-sm">
                      <span className="block text-xs uppercase tracking-wide text-white/60">Limite de dispositivos</span>
                      <input
                        type="number"
                        min={0}
                        value={form.deviceLimit}
                        onChange={handleNumberChange("deviceLimit")}
                        className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                      />
                    </label>

                    <label className="text-sm">
                      <span className="block text-xs uppercase tracking-wide text-white/60">Nome principal</span>
                      <input
                        type="text"
                        value={form.name}
                        onChange={handleFormChange("name")}
                        className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                      />
                    </label>
                  </div>

                  {isCpf && (
                    <div className="border-t border-white/10 pt-6">
                      <h3 className="text-sm font-semibold text-white">Pessoa física</h3>
                      <div className="mt-4 grid gap-4 md:grid-cols-3">
                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Nome completo</span>
                          <input
                            type="text"
                            value={form.profile.person.name}
                            onChange={handleProfileNestedChange("person", "name")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Data de nascimento</span>
                          <input
                            type="date"
                            value={form.profile.person.birthDate}
                            onChange={handleProfileNestedChange("person", "birthDate")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">CNH</span>
                          <input
                            type="text"
                            value={form.profile.person.cnh}
                            onChange={handleProfileNestedChange("person", "cnh")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Categoria CNH</span>
                          <select
                            value={form.profile.person.cnhCategory}
                            onChange={handleProfileNestedChange("person", "cnhCategory")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          >
                            <option value="">Selecione</option>
                            {cnhCategories.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-3">
                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Validade CNH</span>
                          <input
                            type="date"
                            value={form.profile.person.cnhExpiry}
                            onChange={handleProfileNestedChange("person", "cnhExpiry")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Sexo</span>
                          <select
                            value={form.profile.person.gender}
                            onChange={handleProfileNestedChange("person", "gender")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          >
                            <option value="">Selecione</option>
                            {genderOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">RG</span>
                          <input
                            type="text"
                            value={form.profile.person.rg}
                            onChange={handleProfileNestedChange("person", "rg")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-3">
                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Órgão expeditor</span>
                          <input
                            type="text"
                            value={form.profile.person.rgIssuer}
                            onChange={handleProfileNestedChange("person", "rgIssuer")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Data de expedição</span>
                          <input
                            type="date"
                            value={form.profile.person.rgIssuedAt}
                            onChange={handleProfileNestedChange("person", "rgIssuedAt")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Profissão</span>
                          <input
                            type="text"
                            value={form.profile.person.profession}
                            onChange={handleProfileNestedChange("person", "profession")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-3">
                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Nacionalidade</span>
                          <input
                            type="text"
                            value={form.profile.person.nationality}
                            onChange={handleProfileNestedChange("person", "nationality")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Naturalidade</span>
                          <input
                            type="text"
                            value={form.profile.person.birthPlace}
                            onChange={handleProfileNestedChange("person", "birthPlace")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Nome do pai</span>
                          <input
                            type="text"
                            value={form.profile.person.fatherName}
                            onChange={handleProfileNestedChange("person", "fatherName")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Nome da mãe</span>
                          <input
                            type="text"
                            value={form.profile.person.motherName}
                            onChange={handleProfileNestedChange("person", "motherName")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>
                      </div>
                    </div>
                  )}

                  {isCnpj && (
                    <div className="border-t border-white/10 pt-6">
                      <h3 className="text-sm font-semibold text-white">Pessoa jurídica</h3>
                      <div className="mt-4 grid gap-4 md:grid-cols-3">
                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Razão social</span>
                          <input
                            type="text"
                            value={form.profile.company.legalName}
                            onChange={handleProfileNestedChange("company", "legalName")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Inscrição estadual</span>
                          <input
                            type="text"
                            value={form.profile.company.stateRegistration}
                            onChange={handleProfileNestedChange("company", "stateRegistration")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Inscrição municipal</span>
                          <input
                            type="text"
                            value={form.profile.company.municipalRegistration}
                            onChange={handleProfileNestedChange("company", "municipalRegistration")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>
                      </div>
                    </div>
                  )}

                  <div className="border-t border-white/10 pt-6">
                    <h3 className="text-sm font-semibold text-white">Dados de contato</h3>
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">CEP</span>
                        <input
                          type="text"
                          value={form.profile.contact.cep}
                          onChange={handleProfileNestedChange("contact", "cep")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>

                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">Endereço</span>
                        <input
                          type="text"
                          value={form.profile.contact.address}
                          onChange={handleProfileNestedChange("contact", "address")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>

                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">Número</span>
                        <input
                          type="text"
                          value={form.profile.contact.number}
                          onChange={handleProfileNestedChange("contact", "number")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">Complemento</span>
                        <input
                          type="text"
                          value={form.profile.contact.complement}
                          onChange={handleProfileNestedChange("contact", "complement")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>

                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">Bairro</span>
                        <input
                          type="text"
                          value={form.profile.contact.neighborhood}
                          onChange={handleProfileNestedChange("contact", "neighborhood")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>

                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">Cidade</span>
                        <input
                          type="text"
                          value={form.profile.contact.city}
                          onChange={handleProfileNestedChange("contact", "city")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">Estado</span>
                        <input
                          type="text"
                          value={form.profile.contact.state}
                          onChange={handleProfileNestedChange("contact", "state")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>

                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">Telefone</span>
                        <input
                          type="text"
                          value={form.profile.contact.phone}
                          onChange={handleProfileNestedChange("contact", "phone")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>

                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">Celular</span>
                        <input
                          type="text"
                          value={form.profile.contact.mobile}
                          onChange={handleProfileNestedChange("contact", "mobile")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">E-mail</span>
                        <input
                          type="email"
                          value={form.profile.contact.email}
                          onChange={handleProfileNestedChange("contact", "email")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>

                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">Observações</span>
                        <input
                          type="text"
                          value={form.profile.contact.notes}
                          onChange={handleProfileNestedChange("contact", "notes")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </section>

              <div className="flex flex-wrap items-center justify-end gap-3">
                {error && (
                  <span className="text-sm text-red-300">
                    {error?.response?.data?.message || error.message}
                  </span>
                )}
                {message && <span className="text-sm text-emerald-300">{message}</span>}
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-primary px-5 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
                >
                  {saving ? "Salvando…" : "Salvar alterações"}
                </button>
              </div>
            </form>
          )}

          {activeTab === "usuarios" && (
            <section className="border border-white/10 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-white">Usuários vinculados</h2>
                  <p className="text-xs text-white/60">Gerencie operadores e gestores vinculados a este cliente.</p>
                </div>
                <Link
                  to="/users"
                  className="rounded-lg border border-border px-3 py-2 text-xs text-white/70 hover:bg-white/10"
                >
                  Gerenciar usuários
                </Link>
              </div>

              <div className="mt-4">
                <DataTable>
                  <thead className="text-left text-xs uppercase tracking-wide text-white/60">
                    <tr>
                      <th className="py-2 pr-4">Nome</th>
                      <th className="py-2 pr-4">E-mail</th>
                      <th className="py-2 pr-4">Perfil</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {users.map((userItem) => (
                      <tr key={userItem.id} className="hover:bg-white/5">
                        <td className="py-2 pr-4 text-white">{userItem.name}</td>
                        <td className="py-2 pr-4 text-white/70">{userItem.email}</td>
                        <td className="py-2 pr-4 text-white/70">{userItem.role}</td>
                      </tr>
                    ))}
                    {!users.length && (
                      <tr>
                        <td colSpan={3} className="py-4 text-center text-sm text-white/60">
                          Nenhum usuário encontrado para este cliente.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </DataTable>
              </div>
            </section>
          )}

          {activeTab === "veiculos" && (
            <section className="border border-white/10 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-white">Veículos vinculados</h2>
                  <p className="text-xs text-white/60">Lista dos veículos cadastrados neste cliente.</p>
                </div>
                <Link
                  to="/vehicles"
                  className="rounded-lg border border-border px-3 py-2 text-xs text-white/70 hover:bg-white/10"
                >
                  Ver frota completa
                </Link>
              </div>

              <div className="mt-4">
                <DataTable>
                  <thead className="text-left text-xs uppercase tracking-wide text-white/60">
                    <tr>
                      <th className="py-2 pr-4">Placa</th>
                      <th className="py-2 pr-4">Nome</th>
                      <th className="py-2 pr-4">Tipo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {vehicles.map((vehicleItem) => (
                      <tr key={vehicleItem.id} className="hover:bg-white/5">
                        <td className="py-2 pr-4 text-white">{vehicleItem.plate || "—"}</td>
                        <td className="py-2 pr-4 text-white/70">{vehicleItem.name || vehicleItem.model || "—"}</td>
                        <td className="py-2 pr-4 text-white/70">{vehicleItem.type || "—"}</td>
                      </tr>
                    ))}
                    {!vehicles.length && (
                      <tr>
                        <td colSpan={3} className="py-4 text-center text-sm text-white/60">
                          Nenhum veículo encontrado para este cliente.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </DataTable>
              </div>
            </section>
          )}

          {activeTab === "permissoes" && (
            <section className="border border-white/10 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">Grupo de permissões</h2>
                  <p className="text-xs text-white/60">
                    Configure perfis de acesso por menu e páginas (CRUD) para este cliente.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openPermissionDrawer()}
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
                >
                  Novo grupo
                </button>
              </div>
              <div className="mt-4">
                <DataTable>
                  <thead className="text-left text-xs uppercase tracking-wide text-white/60">
                    <tr>
                      <th className="py-2 pr-4">Nome</th>
                      <th className="py-2 pr-4">Descrição</th>
                      <th className="py-2 pr-4">Menus</th>
                      <th className="py-2 pr-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {permissionGroups.map((group) => (
                      <tr key={group.id} className="hover:bg-white/5">
                        <td className="py-2 pr-4 text-white">{group.name}</td>
                        <td className="py-2 pr-4 text-white/70">{group.description || "—"}</td>
                        <td className="py-2 pr-4 text-white/70">
                          {Object.keys(group.attributes?.rules || {}).length}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openPermissionDrawer(group)}
                              className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-white/5"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePermissionDelete(group)}
                              className="rounded-lg border border-red-500/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10"
                            >
                              Remover
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!permissionGroups.length && (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-sm text-white/60">
                          Nenhum grupo de permissões cadastrado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </DataTable>
              </div>
            </section>
          )}

          {activeTab === "espelhamento" && (
            <section className="border border-white/10 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">Espelhamento</h2>
                  <p className="text-xs text-white/60">
                    Compartilhe veículos com gerenciadoras de risco e seguradoras vinculadas.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openMirrorDrawer()}
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
                >
                  Novo espelhamento
                </button>
              </div>
              <div className="mt-4">
                <DataTable>
                  <thead className="text-left text-xs uppercase tracking-wide text-white/60">
                    <tr>
                      <th className="py-2 pr-4">Recebedor</th>
                      <th className="py-2 pr-4">Veículos</th>
                      <th className="py-2 pr-4">Período</th>
                      <th className="py-2 pr-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {mirrors.map((mirror) => {
                      const targetClient = clients.find((entry) => entry.id === mirror.targetClientId);
                      return (
                        <tr key={mirror.id} className="hover:bg-white/5">
                          <td className="py-2 pr-4 text-white">{targetClient?.name || "—"}</td>
                          <td className="py-2 pr-4 text-white/70">{mirror.vehicleIds?.length || 0}</td>
                          <td className="py-2 pr-4 text-white/70">
                            {mirror.startAt || "—"} • {mirror.endAt || "—"}
                          </td>
                          <td className="py-2 pr-4 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => openMirrorDrawer(mirror)}
                                className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-white/5"
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMirrorDelete(mirror)}
                                className="rounded-lg border border-red-500/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10"
                              >
                                Remover
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!mirrors.length && (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-sm text-white/60">
                          Nenhum espelhamento configurado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </DataTable>
              </div>
            </section>
          )}

          <Drawer
            open={permissionDrawerOpen}
            onClose={() => setPermissionDrawerOpen(false)}
            title={editingPermissionGroup ? "Editar grupo de permissões" : "Novo grupo de permissões"}
            description="Selecione as ações permitidas por menu e página."
          >
            <form onSubmit={handlePermissionSave} className="space-y-4">
              <label className="text-sm">
                <span className="block text-xs uppercase tracking-wide text-white/60">Nome</span>
                <input
                  type="text"
                  value={permissionGroupForm.name}
                  required
                  onChange={(event) =>
                    setPermissionGroupForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm">
                <span className="block text-xs uppercase tracking-wide text-white/60">Descrição</span>
                <input
                  type="text"
                  value={permissionGroupForm.description}
                  onChange={(event) =>
                    setPermissionGroupForm((prev) => ({ ...prev, description: event.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                />
              </label>
              <div className="space-y-4">
                {PERMISSIONS_CATALOG.map((menu) => (
                  <div key={menu.menuKey} className="rounded-xl border border-white/10 p-4">
                    <h4 className="text-sm font-semibold text-white">{menu.label}</h4>
                    <div className="mt-3 space-y-3">
                      {menu.pages.map((page) => (
                        <div key={page.pageKey} className="flex flex-col gap-2">
                          <span className="text-xs uppercase tracking-wide text-white/50">{page.label}</span>
                          <div className="flex flex-wrap gap-3 text-xs text-white/70">
                            {page.actions.map((action) => (
                              <label key={action} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={
                                    permissionGroupForm.rules?.[menu.menuKey]?.[page.pageKey]?.[action] || false
                                  }
                                  onChange={() => handlePermissionToggle(menu.menuKey, page.pageKey, action)}
                                />
                                {action}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPermissionDrawerOpen(false)}
                  className="rounded-xl border border-border px-4 py-2 text-sm text-white/70 hover:bg-white/10"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
                >
                  Salvar grupo
                </button>
              </div>
            </form>
          </Drawer>

          <Drawer
            open={mirrorDrawerOpen}
            onClose={() => setMirrorDrawerOpen(false)}
            title={editingMirror ? "Editar espelhamento" : "Novo espelhamento"}
            description="Defina veículos, recebedores, período e permissões."
          >
            <form onSubmit={handleMirrorSave} className="space-y-4">
              <label className="text-sm">
                <span className="block text-xs uppercase tracking-wide text-white/60">Recebedores</span>
                <select
                  multiple
                  value={mirrorForm.targetClientIds}
                  onChange={(event) =>
                    setMirrorForm((prev) => ({
                      ...prev,
                      targetClientIds: Array.from(event.target.selectedOptions).map((option) => option.value),
                    }))
                  }
                  className="mt-1 h-32 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                >
                  {clients
                    .filter((entry) => entry.id !== client?.id)
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs uppercase tracking-wide text-white/60">Grupo de permissões</span>
                <select
                  value={mirrorForm.permissionGroupId}
                  onChange={(event) =>
                    setMirrorForm((prev) => ({ ...prev, permissionGroupId: event.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                >
                  <option value="">Selecionar grupo</option>
                  {permissionGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm">
                  <span className="block text-xs uppercase tracking-wide text-white/60">Início</span>
                  <input
                    type="date"
                    value={mirrorForm.startAt}
                    onChange={(event) => setMirrorForm((prev) => ({ ...prev, startAt: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm">
                  <span className="block text-xs uppercase tracking-wide text-white/60">Fim</span>
                  <input
                    type="date"
                    value={mirrorForm.endAt}
                    onChange={(event) => setMirrorForm((prev) => ({ ...prev, endAt: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <div className="space-y-2">
                <span className="block text-xs uppercase tracking-wide text-white/60">Veículos</span>
                <div className="grid max-h-72 gap-2 overflow-y-auto rounded-lg border border-white/10 p-3 text-xs">
                  {vehicles.map((vehicle) => {
                    const checked = mirrorForm.vehicleIds.includes(vehicle.id);
                    return (
                      <label key={vehicle.id} className="flex items-center gap-2 text-white/70">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const nextIds = checked
                              ? mirrorForm.vehicleIds.filter((id) => id !== vehicle.id)
                              : [...mirrorForm.vehicleIds, vehicle.id];
                            setMirrorForm((prev) => ({ ...prev, vehicleIds: nextIds }));
                          }}
                        />
                        {vehicle.plate || vehicle.name || vehicle.model || "Veículo"}
                      </label>
                    );
                  })}
                  {!vehicles.length && <span className="text-white/40">Nenhum veículo encontrado.</span>}
                </div>
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setMirrorDrawerOpen(false)}
                  className="rounded-xl border border-border px-4 py-2 text-sm text-white/70 hover:bg-white/10"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
                >
                  Salvar espelhamento
                </button>
              </div>
            </form>
          </Drawer>
        </>
      )}
    </div>
  );
}
