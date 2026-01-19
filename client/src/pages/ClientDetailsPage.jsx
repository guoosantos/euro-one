import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import api from "../lib/api";
import { API_ROUTES } from "../lib/api-routes";
import { useTenant } from "../lib/tenant-context";
import DataTable from "../components/ui/DataTable";
import PageHeader from "../components/ui/PageHeader";

const documentTypeOptions = ["CPF", "CNPJ", "Cédula de identidad", "RUC"];
const clientTypeOptions = ["Cliente Final", "Gerenciadora de Risco", "Companhia de Seguro"];
const cnhCategories = ["ACC", "A", "B", "C", "D", "E", "AB", "AC", "AD", "AE"];
const genderOptions = ["Masculino", "Feminino"];

const defaultProfile = {
  documentType: "CPF",
  document: "",
  name: "",
  clientType: "Cliente Final",
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
  legalName: "",
  stateRegistration: "",
  municipalRegistration: "",
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

  const isAdmin = role === "admin";

  const isCpf = form.profile.documentType === "CPF";
  const isCnpj = form.profile.documentType === "CNPJ";

  const profileName = form.profile.name || client?.name || "";

  const accessSubtitle = useMemo(() => {
    if (isAdmin) {
      return "Atualize os dados cadastrais, limites e permissões vinculadas ao cliente.";
    }
    return "Gestores podem revisar os dados cadastrais e limites do próprio cliente.";
  }, [isAdmin]);

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
        const profile = {
          ...defaultProfile,
          ...(attributes.clientProfile || {}),
          name: attributes.clientProfile?.name || record?.name || "",
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
    if (activeTab !== "veiculos" || !client?.id) return;
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
        clientProfile: {
          ...form.profile,
          name: form.profile.name || form.name,
        },
      };
      const payload = {
        name: form.name || form.profile.name || profileName,
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
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
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
              <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
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
                        value={form.profile.document}
                        onChange={handleProfileChange("document")}
                        className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                      />
                    </label>

                    <label className="text-sm">
                      <span className="block text-xs uppercase tracking-wide text-white/60">Nome</span>
                      <input
                        type="text"
                        value={form.profile.name}
                        onChange={handleProfileChange("name")}
                        className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        required
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
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
                          <span className="block text-xs uppercase tracking-wide text-white/60">Data de nascimento</span>
                          <input
                            type="date"
                            value={form.profile.birthDate}
                            onChange={handleProfileChange("birthDate")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">CNH</span>
                          <input
                            type="text"
                            value={form.profile.cnh}
                            onChange={handleProfileChange("cnh")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Categoria CNH</span>
                          <select
                            value={form.profile.cnhCategory}
                            onChange={handleProfileChange("cnhCategory")}
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
                            value={form.profile.cnhExpiry}
                            onChange={handleProfileChange("cnhExpiry")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Sexo</span>
                          <select
                            value={form.profile.gender}
                            onChange={handleProfileChange("gender")}
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
                            value={form.profile.rg}
                            onChange={handleProfileChange("rg")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-3">
                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Órgão expeditor</span>
                          <input
                            type="text"
                            value={form.profile.rgIssuer}
                            onChange={handleProfileChange("rgIssuer")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Data de expedição</span>
                          <input
                            type="date"
                            value={form.profile.rgIssuedAt}
                            onChange={handleProfileChange("rgIssuedAt")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Profissão</span>
                          <input
                            type="text"
                            value={form.profile.profession}
                            onChange={handleProfileChange("profession")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-3">
                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Nacionalidade</span>
                          <input
                            type="text"
                            value={form.profile.nationality}
                            onChange={handleProfileChange("nationality")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Naturalidade</span>
                          <input
                            type="text"
                            value={form.profile.birthPlace}
                            onChange={handleProfileChange("birthPlace")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Nome do pai</span>
                          <input
                            type="text"
                            value={form.profile.fatherName}
                            onChange={handleProfileChange("fatherName")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Nome da mãe</span>
                          <input
                            type="text"
                            value={form.profile.motherName}
                            onChange={handleProfileChange("motherName")}
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
                            value={form.profile.legalName}
                            onChange={handleProfileChange("legalName")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Inscrição estadual</span>
                          <input
                            type="text"
                            value={form.profile.stateRegistration}
                            onChange={handleProfileChange("stateRegistration")}
                            className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-white/60">Inscrição municipal</span>
                          <input
                            type="text"
                            value={form.profile.municipalRegistration}
                            onChange={handleProfileChange("municipalRegistration")}
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
                          value={form.profile.cep}
                          onChange={handleProfileChange("cep")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>

                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">Endereço</span>
                        <input
                          type="text"
                          value={form.profile.address}
                          onChange={handleProfileChange("address")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>

                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">Número</span>
                        <input
                          type="text"
                          value={form.profile.number}
                          onChange={handleProfileChange("number")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">Complemento</span>
                        <input
                          type="text"
                          value={form.profile.complement}
                          onChange={handleProfileChange("complement")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>

                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">Bairro</span>
                        <input
                          type="text"
                          value={form.profile.neighborhood}
                          onChange={handleProfileChange("neighborhood")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>

                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">Cidade</span>
                        <input
                          type="text"
                          value={form.profile.city}
                          onChange={handleProfileChange("city")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">Estado</span>
                        <input
                          type="text"
                          value={form.profile.state}
                          onChange={handleProfileChange("state")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>

                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">Telefone</span>
                        <input
                          type="text"
                          value={form.profile.phone}
                          onChange={handleProfileChange("phone")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>

                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">Celular</span>
                        <input
                          type="text"
                          value={form.profile.mobile}
                          onChange={handleProfileChange("mobile")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">E-mail</span>
                        <input
                          type="email"
                          value={form.profile.email}
                          onChange={handleProfileChange("email")}
                          className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm"
                        />
                      </label>

                      <label className="text-sm">
                        <span className="block text-xs uppercase tracking-wide text-white/60">Observações</span>
                        <input
                          type="text"
                          value={form.profile.notes}
                          onChange={handleProfileChange("notes")}
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
            <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
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
            <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
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
            <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div>
                <h2 className="text-sm font-semibold text-white">Grupo de permissões</h2>
                <p className="text-xs text-white/60">
                  Configure perfis de acesso por menu e páginas (CRUD) para este cliente.
                </p>
              </div>
              <div className="mt-4 rounded-xl border border-dashed border-white/15 p-6 text-center text-sm text-white/60">
                Nenhum grupo de permissões cadastrado.
              </div>
            </section>
          )}

          {activeTab === "espelhamento" && (
            <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div>
                <h2 className="text-sm font-semibold text-white">Espelhamento</h2>
                <p className="text-xs text-white/60">
                  Compartilhe veículos com gerenciadoras de risco e seguradoras vinculadas.
                </p>
              </div>
              <div className="mt-4 rounded-xl border border-dashed border-white/15 p-6 text-center text-sm text-white/60">
                Nenhum espelhamento configurado.
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
