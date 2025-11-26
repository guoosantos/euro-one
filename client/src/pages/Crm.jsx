import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Contact2, Eye, FilePlus2, Tag as TagIcon } from "lucide-react";

import Card from "../ui/Card";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Button from "../ui/Button";
import Modal from "../ui/Modal";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import useCrmClients, { logCrmError } from "../lib/hooks/useCrmClients.js";
import useCrmContacts from "../lib/hooks/useCrmContacts.js";
import useCrmTags from "../lib/hooks/useCrmTags.js";

const defaultForm = {
  name: "",
  cnpj: "",
  segment: "",
  companySize: "media",
  relationshipType: "prospection",
  city: "",
  state: "",
  website: "",
  mainContactName: "",
  mainContactRole: "",
  mainContactPhone: "",
  mainContactEmail: "",
  interestLevel: "medio",
  closeProbability: "media",
  tags: [],
  hasCompetitorContract: false,
  competitorName: "",
  competitorContractStart: "",
  competitorContractEnd: "",
  inTrial: false,
  trialProduct: "",
  trialStart: "",
  trialDurationDays: "",
  trialEnd: "",
  notes: "",
};

const defaultInteraction = {
  date: "",
  type: "ligacao",
  internalUser: "",
  clientContactName: "",
  clientContactRole: "",
  summary: "",
  nextStep: "",
  nextStepDate: "",
};

const DEFAULT_CONTRACT_ALERT_DAYS = 30;
const DEFAULT_TRIAL_ALERT_DAYS = 7;

function normalise(text) {
  return (text || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("pt-BR");
  } catch (_error) {
    return value;
  }
}

function normaliseCnpjDigits(value) {
  return (value || "").toString().replace(/\D/g, "").slice(0, 14);
}

function formatCnpj(value) {
  const digits = normaliseCnpjDigits(value);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12)
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
}

function buildContractLabel(client) {
  if (!client?.hasCompetitorContract) return "Sem contrato concorrente";
  if (client.competitorContractEnd) return `Com contrato até ${formatDate(client.competitorContractEnd)}`;
  return "Contrato concorrente ativo";
}

function buildTrialLabel(client) {
  if (!client?.inTrial) return "Sem teste";
  const end = client?.trialEnd;
  if (end) return `Em teste até ${formatDate(end)}`;
  return "Teste em andamento";
}

function normaliseTagIds(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((tag) => (typeof tag === "string" ? tag : tag?.id)).filter(Boolean);
  if (typeof tags === "string") return tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  return [];
}

function buildFormFromClient(client) {
  return {
    name: client?.name || "",
    cnpj: formatCnpj(client?.cnpj),
    segment: client?.segment || "",
    companySize: client?.companySize || "",
    relationshipType: client?.relationshipType || "prospection",
    city: client?.city || "",
    state: client?.state || "",
    website: client?.website || "",
    mainContactName: client?.mainContactName || "",
    mainContactRole: client?.mainContactRole || "",
    mainContactPhone: client?.mainContactPhone || "",
    mainContactEmail: client?.mainContactEmail || "",
    interestLevel: client?.interestLevel || "medio",
    closeProbability: client?.closeProbability || "media",
    tags: normaliseTagIds(client?.tags),
    hasCompetitorContract: Boolean(client?.hasCompetitorContract),
    competitorName: client?.competitorName || "",
    competitorContractStart: client?.competitorContractStart ? client.competitorContractStart.slice(0, 10) : "",
    competitorContractEnd: client?.competitorContractEnd ? client.competitorContractEnd.slice(0, 10) : "",
    inTrial: Boolean(client?.inTrial),
    trialProduct: client?.trialProduct || "",
    trialStart: client?.trialStart ? client.trialStart.slice(0, 10) : "",
    trialDurationDays: client?.trialDurationDays ?? "",
    trialEnd: client?.trialEnd ? client.trialEnd.slice(0, 10) : "",
    notes: client?.notes || "",
  };
}

function TagBadge({ label, color }) {
  const style = color ? { backgroundColor: `${color}30`, color } : {};
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-xs text-white/80"
      style={style}
    >
      <TagIcon size={12} /> {label}
    </span>
  );
}

export default function Crm() {
  const { tenantId, hasAdminAccess } = useTenant();
  const navigate = useNavigate();
  const { section } = useParams();
  const resolvedTab = ["clients", "tags", "interactions", "alerts"].includes(section) ? section : "clients";
  const [clientViewScope, setClientViewScope] = useState(hasAdminAccess ? "all" : "mine");
  const [alertViewScope, setAlertViewScope] = useState(hasAdminAccess ? "all" : "mine");
  const [interactionViewScope, setInteractionViewScope] = useState(hasAdminAccess ? "all" : "mine");
  const listParams = useMemo(() => {
    if (!hasAdminAccess) return { view: "mine" };
    if (clientViewScope === "mine") return { view: "mine" };
    return null;
  }, [hasAdminAccess, clientViewScope]);
  const { clients, loading, error, refresh, createClient, updateClient } = useCrmClients(listParams);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [interactionForm, setInteractionForm] = useState(defaultInteraction);
  const [selectedClient, setSelectedClient] = useState(null);
  const [saving, setSaving] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [interactionSaving, setInteractionSaving] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterInterest, setFilterInterest] = useState("");
  const [filterCloseProbability, setFilterCloseProbability] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [filterRelationship, setFilterRelationship] = useState("");
  const [alerts, setAlerts] = useState({ contractAlerts: [], contractExpired: [], trialAlerts: [], trialExpired: [] });
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState(null);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("");
  const [activeInteraction, setActiveInteraction] = useState(null);
  const [cnpjError, setCnpjError] = useState(null);
  const contactListParams = useMemo(() => {
    if (!hasAdminAccess) return { view: "mine" };
    if (interactionViewScope === "mine") return { view: "mine" };
    return null;
  }, [hasAdminAccess, interactionViewScope]);
  const { contacts, loading: contactsLoading, error: contactsError, addContact, refresh: refreshContacts } =
    useCrmContacts(selectedId, contactListParams);
  const { tags: tagCatalog, loading: tagsLoading, error: tagsError, refresh: refreshTags, createTag, deleteTag } =
    useCrmTags();

  const interestBadge = useMemo(() => {
    const map = {
      baixo: "bg-amber-500/20 text-amber-200",
      medio: "bg-blue-500/20 text-blue-100",
      alto: "bg-emerald-500/20 text-emerald-100",
    };
    return (level) => map[level] || "bg-white/10 text-white";
  }, []);

  const interestLabel = useMemo(
    () => ({
      baixo: "Baixo",
      medio: "Médio",
      alto: "Alto",
    }),
    [],
  );

  const closeProbabilityLabel = useMemo(
    () => ({
      baixa: "Baixa",
      media: "Média",
      alta: "Alta",
    }),
    [],
  );

  const relationshipLabel = useMemo(
    () => ({
      prospection: "Prospecção",
      customer: "Cliente da Euro",
      supplier: "Fornecedor",
    }),
    [],
  );

  const relationshipFilters = useMemo(
    () => [
      { value: "", label: "Todos" },
      { value: "customer", label: relationshipLabel.customer },
      { value: "supplier", label: relationshipLabel.supplier },
      { value: "prospection", label: relationshipLabel.prospection },
    ],
    [relationshipLabel.customer, relationshipLabel.prospection, relationshipLabel.supplier],
  );

  const relationshipBadgeStyle = useMemo(
    () => ({
      prospection: "bg-amber-500/20 text-amber-100",
      customer: "bg-emerald-500/20 text-emerald-100",
      supplier: "bg-blue-500/20 text-blue-100",
    }),
    [],
  );

  const contactTypeLabel = useMemo(
    () => ({
      ligacao: "Ligação",
      whatsapp: "WhatsApp",
      email: "E-mail",
      reuniao: "Reunião",
    }),
    [],
  );

  const tagsById = useMemo(
    () => Object.fromEntries(tagCatalog.map((tag) => [tag.id, tag])),
    [tagCatalog],
  );

  const loadAlerts = useCallback(() => {
    let cancelled = false;
    setAlertsLoading(true);
    setAlertsError(null);
    const alertView = !hasAdminAccess ? "mine" : alertViewScope === "mine" ? "mine" : undefined;
    CoreApi.listCrmAlerts({
      contractWithinDays: DEFAULT_CONTRACT_ALERT_DAYS,
      trialWithinDays: DEFAULT_TRIAL_ALERT_DAYS,
      view: alertView,
    })
      .then((response) => {
        if (cancelled) return;
        setAlerts({
          contractAlerts: response?.contractAlerts || [],
          contractExpired: response?.contractExpired || [],
          trialAlerts: response?.trialAlerts || [],
          trialExpired: response?.trialExpired || [],
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setAlertsError(err instanceof Error ? err : new Error("Falha ao carregar alertas"));
      })
      .finally(() => {
        if (cancelled) return;
        setAlertsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId, hasAdminAccess, alertViewScope]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedClient(null);
      setForm(defaultForm);
      setInteractionForm(defaultInteraction);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }

    const next = clients.find((client) => client.id === selectedId) || null;
    if (next) {
      if (!selectedClient || selectedClient.id !== next.id || selectedClient.updatedAt !== next.updatedAt) {
        setSelectedClient(next);
        setForm(buildFormFromClient(next));
      }
      setDetailError(null);
      setDetailLoading(false);
      return;
    }

    let cancelled = false;
    setDetailError(null);
    setDetailLoading(true);
    CoreApi.getCrmClient(selectedId)
      .then((response) => {
        if (cancelled) return;
        const client = response?.client || response;
        if (!client) return;
        setSelectedClient(client);
        setForm(buildFormFromClient(client));
      })
      .catch((err) => {
        if (cancelled) return;
        logCrmError(err, "getCrmClient");
        setDetailError(new Error("Não foi possível carregar os detalhes deste cliente. Tente novamente."));
      })
      .finally(() => {
        if (cancelled) return;
        setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clients, selectedId]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (selectedId) {
      setInteractionForm((prev) => ({ ...defaultInteraction, date: prev.date || today }));
    } else {
      setInteractionForm(defaultInteraction);
    }
  }, [selectedId]);

  useEffect(() => {
    const cancel = loadAlerts();
    return cancel;
  }, [loadAlerts]);

  useEffect(() => {
    if (!section) {
      navigate("/crm/clients", { replace: true });
    }
  }, [navigate, section]);

  useEffect(() => {
    const scope = hasAdminAccess ? "all" : "mine";
    setClientViewScope(scope);
    setAlertViewScope(scope);
    setInteractionViewScope(scope);
  }, [hasAdminAccess]);

  useEffect(() => {
    setActiveInteraction(null);
  }, [selectedId]);

  const filteredClients = useMemo(
    () =>
      clients.filter((client) => {
        const name = normalise(client?.name);
        const contact = normalise(client?.mainContactName || client?.primaryContact?.name);
        const segment = normalise(client?.segment);
        const city = normalise(client?.city);
        const state = normalise(client?.state);

        if (searchTerm) {
          const query = normalise(searchTerm);
          const matchesText =
            name.includes(query) ||
            contact.includes(query) ||
            segment.includes(query) ||
            city.includes(query) ||
            state.includes(query);
          if (!matchesText) return false;
        }

        if (filterInterest && client?.interestLevel && normalise(client.interestLevel) !== normalise(filterInterest)) {
          return false;
        }

        if (
          filterCloseProbability &&
          client?.closeProbability &&
          normalise(client.closeProbability) !== normalise(filterCloseProbability)
        ) {
          return false;
        }

        if (filterTag) {
          const tags = normaliseTagIds(client?.tags);
          const normalisedFilter = normalise(filterTag);
          const hasTag = tags.some((tagId) => {
            if (!tagId) return false;
            if (tagId === filterTag) return true;
            const tagName = tagsById[tagId]?.name;
            if (tagName) return normalise(tagName) === normalisedFilter;
            return normalise(tagId) === normalisedFilter;
          });
          if (!hasTag) return false;
        }

        if (filterRelationship && (client.relationshipType || "prospection") !== filterRelationship) {
          return false;
        }

        return true;
      }),
    [clients, searchTerm, filterInterest, filterCloseProbability, filterTag, tagsById, filterRelationship],
  );

  const sortedContacts = useMemo(() => {
    const list = Array.isArray(contacts) ? [...contacts] : [];
    return list.sort((a, b) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime());
  }, [contacts]);

  function handleFieldChange(event) {
    const { name, value, type, checked } = event.target;
    if (name === "cnpj") {
      const digits = normaliseCnpjDigits(value);
      setForm((prev) => ({ ...prev, cnpj: formatCnpj(digits) }));
      setCnpjError(null);
      return;
    }
    const parsedValue = type === "checkbox" ? checked : value;
    setForm((prev) => ({ ...prev, [name]: parsedValue }));
  }

  function handleSelectClient(id) {
    setSelectedId(id || null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving) return;
    setDetailError(null);
    setCnpjError(null);
    setSaving(true);
    const payload = {
      ...form,
      clientId: tenantId,
      cnpj: normaliseCnpjDigits(form.cnpj) || null,
      tags: form.tags,
      competitorContractStart: form.competitorContractStart || null,
      competitorContractEnd: form.competitorContractEnd || null,
      trialStart: form.trialStart || null,
      trialEnd: form.trialEnd || null,
      trialDurationDays: form.trialDurationDays === "" ? null : Number(form.trialDurationDays),
      relationshipType: form.relationshipType || "prospection",
    };

    try {
      if (selectedId) {
        const updated = await updateClient(selectedId, payload);
        setSelectedClient(updated);
      } else {
        const created = await createClient(payload);
        setSelectedId(created?.id);
        setSelectedClient(created);
      }
      refresh();
      closeFormModal();
    } catch (err) {
      const duplicateCnpjError =
        err?.response?.status === 409 &&
        (err?.response?.data?.code === "DUPLICATE_CNPJ" ||
          err?.response?.data?.message?.toLowerCase?.().includes("cnpj") ||
          err?.message?.toLowerCase?.().includes("cnpj"));

      if (duplicateCnpjError) {
        setCnpjError("Já existe um cliente com este CNPJ cadastrado no CRM. Busque na lista antes de criar outro.");
        return;
      }
      logCrmError(err, "saveClient");
      setDetailError(new Error("Erro ao salvar cliente. Verifique sua conexão ou tente novamente."));
      return;
    } finally {
      setSaving(false);
    }
  }

  function openNewClientModal() {
    setSelectedId(null);
    setSelectedClient(null);
    setForm(defaultForm);
    setDetailError(null);
    setCnpjError(null);
    setIsFormOpen(true);
  }

  function openEditClient(id) {
    setSelectedId(id);
    setDetailError(null);
    setCnpjError(null);
    setIsFormOpen(true);
  }

  function closeFormModal() {
    setIsFormOpen(false);
    setDetailError(null);
    setCnpjError(null);
  }

  async function handleInteractionSubmit(event) {
    event.preventDefault();
    if (!selectedId) return;
    setInteractionSaving(true);
    try {
      const created = await addContact(interactionForm);
      setSelectedClient((prev) => ({ ...prev, contacts: [...(prev?.contacts || []), created] }));
      setInteractionForm((prev) => ({ ...defaultInteraction, date: prev.date || "" }));
      refreshContacts();
    } catch (err) {
      logCrmError(err, "createInteraction");
    } finally {
      setInteractionSaving(false);
    }
  }

  async function handleCreateTag(event) {
    event.preventDefault();
    if (!newTagName.trim()) return;
    try {
      const created = await createTag({ name: newTagName.trim(), color: newTagColor || undefined });
      setNewTagName("");
      setNewTagColor("");
      setForm((prev) => ({ ...prev, tags: Array.from(new Set([...(prev.tags || []), created.id])) }));
    } catch (err) {
      logCrmError(err, "createCrmTag");
    }
  }

  function toggleTagSelection(tagId) {
    setForm((prev) => {
      const current = new Set(prev.tags || []);
      if (current.has(tagId)) {
        current.delete(tagId);
      } else {
        current.add(tagId);
      }
      return { ...prev, tags: Array.from(current) };
    });
  }

  function resolveTagLabel(tagIdOrName) {
    if (!tagIdOrName) return null;
    return tagsById[tagIdOrName] || null;
  }

  const interactionsTitle = selectedClient
    ? `Interações – ${selectedClient.name}`
    : "Interações – selecione um cliente";

  const quickStatusLabel = selectedClient ? selectedClient.name : "Nenhum cliente selecionado";

  const cnpjInputClass = cnpjError ? "border-red-500/60 focus:ring-red-500/30" : "";

  const tabs = [
    { id: "clients", label: "Clientes" },
    { id: "tags", label: "Tags" },
    { id: "interactions", label: "Interações" },
    { id: "alerts", label: "Alertas" },
  ];

  const activeTabLabel = useMemo(
    () => tabs.find((tab) => tab.id === resolvedTab)?.label || "Clientes",
    [resolvedTab],
  );

  function handleTabChange(tabId) {
    if (tabId === "clients") {
      navigate("/crm/clients");
      return;
    }
    navigate(`/crm/${tabId}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-white">CRM</div>
          <p className="text-sm text-white/60">Cadastre clientes, acompanhe contratos e registre interações.</p>
        </div>
        <div className="flex gap-2" />
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-white/5 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              resolvedTab === tab.id ? "bg-primary text-primary-foreground" : "text-white/70 hover:bg-white/10"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between text-sm text-white/70">
        <div className="font-semibold text-white">{activeTabLabel}</div>
        <div className="text-xs uppercase tracking-wide text-white/50">CRM</div>
      </div>

      {resolvedTab === "clients" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card
            title="Clientes"
            subtitle="Pipeline com principais dados comerciais"
            className="xl:col-span-2"
            actions={
            <span className="text-xs text-white/60">
              {loading ? "Carregando..." : `${filteredClients.length} clientes`}
            </span>
          }
        >
          {error && (
            <div className="mb-4 flex flex-col gap-3 rounded-lg bg-red-500/20 p-3 text-red-100">
              <div>Não foi possível carregar a lista de clientes. Tente novamente mais tarde.</div>
              <div>
                <Button variant="outline" size="sm" onClick={refresh}>
                  Tentar novamente
                </Button>
              </div>
            </div>
          )}
          <div className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-5 xl:grid-cols-6">
            <div className="space-y-1">
              <div className="text-xs text-white/60">Buscar por nome</div>
              <Input
                placeholder="Digite o nome do cliente"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-white/60">Nível de interesse</div>
              <Select value={filterInterest} onChange={(event) => setFilterInterest(event.target.value)}>
                <option value="">Todos</option>
                <option value="baixo">Baixo</option>
                <option value="medio">Médio</option>
                <option value="alto">Alto</option>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-white/60">Probabilidade de fechamento</div>
              <Select
                value={filterCloseProbability}
                onChange={(event) => setFilterCloseProbability(event.target.value)}
              >
                <option value="">Todas</option>
                <option value="baixa">Baixa</option>
                <option value="media">Média</option>
                <option value="alta">Alta</option>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-white/60">Filtrar por tag</div>
              <Select value={filterTag} onChange={(event) => setFilterTag(event.target.value)}>
                <option value="">Todas</option>
                {tagCatalog.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-white/60">Relação</div>
              <div className="flex flex-wrap gap-2">
                {relationshipFilters.map((option) => (
                  <button
                    key={option.value || "all"}
                    type="button"
                    onClick={() => setFilterRelationship(option.value)}
                    className={`rounded-full px-3 py-1 text-xs transition ${
                      filterRelationship === option.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-white/5 text-white/70 hover:bg-white/10"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {hasAdminAccess && (
              <div className="space-y-1">
                <div className="text-xs text-white/60">Ver</div>
                <Select value={clientViewScope} onChange={(event) => setClientViewScope(event.target.value)}>
                  <option value="all">Todos os clientes</option>
                  <option value="mine">Somente os meus</option>
                </Select>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-white/50">
                <tr className="border-b border-white/10 text-left">
                  <th className="py-2 pr-4">Cliente</th>
                  <th className="py-2 pr-4">CNPJ</th>
                  <th className="py-2 pr-4">Segmento</th>
                  <th className="py-2 pr-4">Local</th>
                  <th className="py-2 pr-4">Relação</th>
                  <th className="py-2 pr-4">Interesse</th>
                  <th className="py-2 pr-4">Prob. fechamento</th>
                  <th className="py-2 pr-4">Tags</th>
                  <th className="py-2 pr-4">Contrato</th>
                  <th className="py-2 pr-4">Teste</th>
                  <th className="py-2 pr-4">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={11} className="py-4 text-center text-white/60">
                      Carregando clientes...
                    </td>
                  </tr>
                )}
                {!loading && filteredClients.length === 0 && (
                  <tr>
                    <td colSpan={11} className="py-4 text-center text-white/60">
                      Nenhum cliente cadastrado.
                    </td>
                  </tr>
                )}
                {filteredClients.map((client) => {
                  const isSelected = selectedId === client.id;
                  return (
                    <tr
                      key={client.id}
                      className={`border-b border-white/5 cursor-pointer transition hover:bg-white/5 ${
                        isSelected ? "bg-primary/5 border-l-4 border-primary" : ""
                      }`}
                      onClick={() => handleSelectClient(client.id)}
                    >
                      <td className="py-2 pr-4 text-white">
                        <div className="flex items-center gap-2">
                          <Contact2 size={16} className="text-white/60" />
                          <div>
                            <div className="font-semibold">{client.name}</div>
                            <div className="text-xs text-white/50">
                              {client.mainContactName || client.primaryContact?.name || "Sem contato"}
                            </div>
                            {(client.mainContactRole || client.primaryContact?.role) && (
                              <div className="text-[11px] text-white/40">
                                {client.mainContactRole || client.primaryContact?.role}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-white/70">{formatCnpj(client.cnpj) || "—"}</td>
                      <td className="py-2 pr-4 text-white/70">{client.segment || "—"}</td>
                      <td className="py-2 pr-4 text-white/70">
                        {[client.city, client.state].filter(Boolean).join("/") || "—"}
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          className={`rounded-full px-2 py-1 text-xs ${relationshipBadgeStyle[client.relationshipType] || "bg-white/10 text-white"}`}
                        >
                          {relationshipLabel[client.relationshipType] || "Prospecção"}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`rounded-full px-2 py-1 text-xs ${interestBadge(client.interestLevel)}`}>
                          {interestLabel[client.interestLevel] || "—"}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-white/80">{closeProbabilityLabel[client.closeProbability] || "—"}</td>
                      <td className="py-2 pr-4 text-white/80 space-y-1">
                        {normaliseTagIds(client.tags).length === 0 && <span className="text-white/40">—</span>}
                        {normaliseTagIds(client.tags).map((tagId) => {
                          const tag = resolveTagLabel(tagId);
                          if (!tag) return null;
                          return <TagBadge key={tagId} label={tag.name} color={tag.color} />;
                        })}
                      </td>
                      <td className="py-2 pr-4 text-white/70">{buildContractLabel(client)}</td>
                      <td className="py-2 pr-4 text-white/70">{buildTrialLabel(client)}</td>
                      <td className="py-2 pr-4 text-white/80">
                        <Button
                          variant="ghost"
                          className="px-2 py-1"
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditClient(client.id);
                          }}
                        >
                          Ver / editar
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </Card>

        <div className="space-y-4">
          <Card title="Cadastro / edição" subtitle="Atalhos rápidos">
            <div className="space-y-4">
              <Button onClick={openNewClientModal}>
                <FilePlus2 size={16} className="mr-2" /> Novo cliente
              </Button>

              <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-white">{quickStatusLabel}</div>
                  {selectedClient && <span className="rounded-full bg-primary/20 px-2 py-1 text-xs text-primary-foreground">Selecionado</span>}
                </div>
                {selectedClient ? (
                  <>
                    <div className="text-white/60">{selectedClient.segment || "Segmento não informado"}</div>
                    <div className="text-white/70">Contato: {selectedClient.mainContactName || "—"}</div>
                    <div className="text-white/70">CNPJ: {formatCnpj(selectedClient.cnpj) || "—"}</div>
                    <div className="text-white/70">Relação: {relationshipLabel[selectedClient.relationshipType] || "Prospecção"}</div>
                    <div className="text-white/70">{buildContractLabel(selectedClient)}</div>
                    <div className="text-white/70">{buildTrialLabel(selectedClient)}</div>
                    <div className="flex flex-wrap gap-2">
                      {normaliseTagIds(selectedClient.tags).map((tagId) => {
                        const tag = resolveTagLabel(tagId);
                        if (!tag) return null;
                        return <TagBadge key={tagId} label={tag.name} color={tag.color} />;
                      })}
                    </div>
                    <div>
                      <Button variant="ghost" className="px-2 py-1" onClick={() => openEditClient(selectedClient.id)}>
                        Editar cliente
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="text-white/60">Selecione um cliente na lista para visualizar detalhes.</div>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
      )}

      {resolvedTab === "tags" && (
        <div className="grid gap-4">
          <Card title="Catálogo de tags" subtitle="Organize as etiquetas do CRM">
            {tagsError && (
              <div className="mb-2 rounded-lg bg-red-500/20 p-2 text-xs text-red-100">{tagsError.message}</div>
            )}
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {tagsLoading && <span className="text-xs text-white/60">Carregando tags...</span>}
                {!tagsLoading && tagCatalog.length === 0 && <span className="text-xs text-white/60">Nenhuma tag cadastrada.</span>}
                {tagCatalog.map((tag) => (
                  <span
                    key={tag.id}
                    className="group inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-xs text-white/80"
                    style={tag.color ? { backgroundColor: `${tag.color}30`, color: tag.color } : {}}
                  >
                    <TagIcon size={12} /> {tag.name}
                    <button
                      type="button"
                      className="hidden text-white/60 transition hover:text-red-300 group-hover:inline"
                      onClick={() => deleteTag(tag.id)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <form onSubmit={handleCreateTag} className="grid grid-cols-[1fr_100px_auto] items-center gap-2 text-sm">
                <Input
                  placeholder="Nova tag"
                  value={newTagName}
                  onChange={(event) => setNewTagName(event.target.value)}
                  required
                />
                <Input
                  type="color"
                  title="Cor"
                  value={newTagColor}
                  onChange={(event) => setNewTagColor(event.target.value)}
                />
                <Button type="submit" size="sm">
                  Adicionar
                </Button>
              </form>
              <Button variant="ghost" size="sm" onClick={refreshTags}>
                Atualizar catálogo
              </Button>
            </div>
          </Card>
        </div>
      )}

      {resolvedTab === "interactions" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card title={interactionsTitle} subtitle="Registro de contatos recentes" className="xl:col-span-2">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="text-xs text-white/60">Cliente</div>
              <Select
                value={selectedId || ""}
                onChange={(event) => handleSelectClient(event.target.value)}
                className="min-w-[220px]"
              >
                <option value="">Selecione um cliente</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="ghost" onClick={() => handleTabChange("clients")}>
                Ir para Clientes
              </Button>
              {hasAdminAccess ? (
                <Select
                  value={interactionViewScope}
                  onChange={(event) => setInteractionViewScope(event.target.value)}
                  className="w-44"
                >
                  <option value="all">Todas as interações</option>
                  <option value="mine">Minhas interações</option>
                </Select>
              ) : (
                <span className="text-xs text-white/60">Mostrando apenas interações que registrei</span>
              )}
            </div>
            {selectedClient && (
              <div className="mb-4 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/80">
                <div className="flex flex-wrap items-center justify-between gap-2 text-white">
                  <div className="font-semibold">{selectedClient.name}</div>
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${
                      relationshipBadgeStyle[selectedClient.relationshipType] || "bg-white/10 text-white"
                    }`}
                  >
                    {relationshipLabel[selectedClient.relationshipType] || "Prospecção"}
                  </span>
                </div>
                <div className="mt-1 text-white/60">CNPJ: {formatCnpj(selectedClient.cnpj) || "—"}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {normaliseTagIds(selectedClient.tags).map((tagId) => {
                    const tag = resolveTagLabel(tagId);
                    if (!tag) return null;
                    return <TagBadge key={tagId} label={tag.name} color={tag.color} />;
                  })}
                  {normaliseTagIds(selectedClient.tags).length === 0 && (
                    <span className="text-xs text-white/50">Sem tags</span>
                  )}
                </div>
              </div>
            )}
            {!selectedId && <div className="text-sm text-white/60">Escolha um cliente para registrar ou revisar interações.</div>}
            {selectedId && (
              <div className="space-y-4">
              <form onSubmit={handleInteractionSubmit} className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs text-white/60">Data</label>
                  <Input
                    name="date"
                    type="date"
                    value={interactionForm.date}
                    onChange={(e) => setInteractionForm((prev) => ({ ...prev, date: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-white/60">Tipo</label>
                  <Select
                    name="type"
                    value={interactionForm.type}
                    onChange={(e) => setInteractionForm((prev) => ({ ...prev, type: e.target.value }))}
                  >
                    <option value="ligacao">Ligação</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="email">E-mail</option>
                    <option value="reuniao">Reunião</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-white/60">Responsável interno</label>
                  <Input
                    name="internalUser"
                    value={interactionForm.internalUser}
                    onChange={(e) => setInteractionForm((prev) => ({ ...prev, internalUser: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-white/60">Contato do cliente</label>
                  <Input
                    name="clientContactName"
                    value={interactionForm.clientContactName}
                    onChange={(e) => setInteractionForm((prev) => ({ ...prev, clientContactName: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-white/60">Cargo</label>
                  <Input
                    name="clientContactRole"
                    value={interactionForm.clientContactRole}
                    onChange={(e) => setInteractionForm((prev) => ({ ...prev, clientContactRole: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-white/60">Resumo</label>
                  <Input
                    name="summary"
                    value={interactionForm.summary}
                    onChange={(e) => setInteractionForm((prev) => ({ ...prev, summary: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-white/60">Próximo passo</label>
                  <Input
                    name="nextStep"
                    value={interactionForm.nextStep}
                    onChange={(e) => setInteractionForm((prev) => ({ ...prev, nextStep: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-white/60">Data follow-up</label>
                  <Input
                    name="nextStepDate"
                    type="date"
                    value={interactionForm.nextStepDate}
                    onChange={(e) => setInteractionForm((prev) => ({ ...prev, nextStepDate: e.target.value }))}
                  />
                </div>
                <div className="md:col-span-2 flex justify-end">
                  <Button type="submit" disabled={interactionSaving}>
                    {interactionSaving ? "Registrando..." : "Registrar contato"}
                  </Button>
                </div>
              </form>

              {contactsError && (
                <div className="rounded-lg bg-red-500/20 p-3 text-sm text-red-100">{contactsError.message}</div>
              )}

              <div className="rounded-xl border border-white/10 bg-white/5">
                <div className="border-b border-white/10 px-3 py-2 text-xs uppercase tracking-wide text-white/60">
                  Histórico de interações
                </div>
                {contactsLoading && (
                  <div className="p-4 text-sm text-white/60">Carregando contatos...</div>
                )}
                {!contactsLoading && sortedContacts.length === 0 && (
                  <div className="p-4 text-sm text-white/60">Nenhum contato registrado ainda.</div>
                )}
                {sortedContacts.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="text-white/50">
                        <tr className="border-b border-white/10 text-left">
                          <th className="py-2 px-3">Data</th>
                          <th className="py-2 px-3">Tipo</th>
                          <th className="py-2 px-3">Responsável</th>
                          <th className="py-2 px-3">Contato do cliente</th>
                          <th className="py-2 px-3">Resumo</th>
                          <th className="py-2 px-3">Próximo passo</th>
                          <th className="py-2 px-3">Follow-up</th>
                          <th className="py-2 px-3 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedContacts.map((contact) => (
                          <tr
                            key={contact.id}
                            className="border-b border-white/5 cursor-pointer transition hover:bg-white/5"
                            onClick={() => setActiveInteraction(contact)}
                          >
                            <td className="py-2 px-3 text-white/80 align-top">{formatDate(contact.date || contact.createdAt)}</td>
                            <td className="py-2 px-3 text-white/80 align-top">{contactTypeLabel[contact.type] || contact.type}</td>
                            <td className="py-2 px-3 text-white/80 align-top">{contact.internalUser || "—"}</td>
                            <td className="py-2 px-3 text-white/80 align-top">
                              <div>{contact.clientContactName || "—"}</div>
                              <div className="text-xs text-white/50">{contact.clientContactRole || ""}</div>
                            </td>
                            <td className="py-2 px-3 text-white/80 align-top">
                              <p
                                className="max-h-14 overflow-hidden text-ellipsis break-words text-sm leading-snug"
                                style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}
                              >
                                {contact.summary || "—"}
                              </p>
                            </td>
                            <td className="py-2 px-3 text-white/80 align-top">{contact.nextStep || "—"}</td>
                            <td className="py-2 px-3 text-white/80 align-top">{formatDate(contact.nextStepDate)}</td>
                            <td className="py-2 px-3 text-right align-top">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="inline-flex items-center gap-1"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setActiveInteraction(contact);
                                }}
                              >
                                <Eye size={14} /> Ver detalhes
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
          </Card>
        </div>
      )}

      {resolvedTab === "alerts" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card
            title="Alertas de contrato e teste"
            subtitle="Resumo visual de contratos concorrentes e trials"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                {hasAdminAccess ? (
                  <Select
                    value={alertViewScope}
                    onChange={(event) => setAlertViewScope(event.target.value)}
                    className="w-44"
                  >
                    <option value="all">Todos os clientes</option>
                    <option value="mine">Somente os meus</option>
                  </Select>
                ) : (
                  <span className="text-xs text-white/60">Mostrando apenas meus alertas</span>
                )}
                <Button size="sm" variant="ghost" onClick={loadAlerts}>
                  Atualizar alertas
                </Button>
              </div>
            }
          >
            {alertsLoading && <div className="text-sm text-white/60">Carregando alertas...</div>}
            {alertsError && <div className="rounded-lg bg-red-500/20 p-3 text-red-100">{alertsError.message}</div>}
            {!alertsLoading && !alertsError &&
              alerts.contractAlerts.length === 0 &&
              alerts.trialAlerts.length === 0 &&
              alerts.contractExpired.length === 0 &&
              alerts.trialExpired.length === 0 && (
                <div className="text-sm text-white/60">Nenhum alerta no momento.</div>
              )}

            {!alertsError && (
              <div className="space-y-4 text-sm text-white/80">
                <AlertGroup
                  title={`Contratos concorrentes vencendo em até ${DEFAULT_CONTRACT_ALERT_DAYS} dias`}
                  items={alerts.contractAlerts}
                  tone="warning"
                  typeLabel="Contrato concorrente"
                  relationshipLabel={relationshipLabel}
                  relationshipBadgeStyle={relationshipBadgeStyle}
                  renderDescription={(client) =>
                    `Contrato com ${client.competitorName || "concorrente"} termina em ${formatDate(
                      client.competitorContractEnd,
                    )}.`
                  }
                />
                <AlertGroup
                  title="Contratos concorrentes vencendo hoje / vencidos"
                  items={alerts.contractExpired}
                  tone="danger"
                  typeLabel="Contrato concorrente"
                  relationshipLabel={relationshipLabel}
                  relationshipBadgeStyle={relationshipBadgeStyle}
                  renderDescription={(client) =>
                    `Contrato com ${client.competitorName || "concorrente"} venceu em ${formatDate(
                      client.competitorContractEnd,
                    )}.`
                  }
                />
                <AlertGroup
                  title={`Testes (trial) terminando em até ${DEFAULT_TRIAL_ALERT_DAYS} dias`}
                  items={alerts.trialAlerts}
                  tone="info"
                  typeLabel="Teste (trial)"
                  relationshipLabel={relationshipLabel}
                  relationshipBadgeStyle={relationshipBadgeStyle}
                  renderDescription={(client) => `Teste termina em ${formatDate(client.trialEnd)}.`}
                />
                <AlertGroup
                  title="Testes já encerrados"
                  items={alerts.trialExpired}
                  tone="muted"
                  typeLabel="Teste (trial)"
                  relationshipLabel={relationshipLabel}
                  relationshipBadgeStyle={relationshipBadgeStyle}
                  renderDescription={(client) => `Teste finalizado em ${formatDate(client.trialEnd)}.`}
                />
              </div>
            )}
          </Card>
        </div>
      )}

      <InteractionDetailsModal
        interaction={activeInteraction}
        onClose={() => setActiveInteraction(null)}
        contactTypeLabel={contactTypeLabel}
      />

      <Modal
        open={isFormOpen}
        onClose={closeFormModal}
        title={selectedId ? "Editar cliente" : "Novo cliente"}
        width="max-w-5xl"
      >
        {detailError && (
          <div className="mb-3 rounded-lg bg-red-500/20 p-3 text-red-100">{detailError.message}</div>
        )}
        {detailLoading && (
          <div className="mb-3 rounded-lg bg-white/5 p-3 text-sm text-white/80">Carregando cliente...</div>
        )}
        <form onSubmit={handleSubmit} className="flex max-h-[70vh] flex-col gap-4">
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="space-y-2">
              <label className="text-xs text-white/60">Nome do cliente *</label>
              <Input name="name" value={form.name} onChange={handleFieldChange} required />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-white/60">CNPJ *</label>
              <Input
                name="cnpj"
                value={form.cnpj}
                onChange={handleFieldChange}
                placeholder="00.000.000/0000-00"
                className={cnpjInputClass}
                required
              />
              {cnpjError && <div className="text-xs text-red-300">{cnpjError}</div>}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs text-white/60">Segmento</label>
                <Input name="segment" value={form.segment} onChange={handleFieldChange} />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-white/60">Tamanho</label>
                <Select name="companySize" value={form.companySize} onChange={handleFieldChange}>
                  <option value="micro">Micro</option>
                  <option value="pequena">Pequena</option>
                  <option value="media">Média</option>
                  <option value="grande">Grande</option>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-white/60">Cidade</label>
                <Input name="city" value={form.city} onChange={handleFieldChange} />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-white/60">Estado</label>
                <Input name="state" value={form.state} onChange={handleFieldChange} />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-white/60">Site / redes sociais</label>
              <Input name="website" value={form.website} onChange={handleFieldChange} />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-white/60">Relação com a Euro</label>
              <Select name="relationshipType" value={form.relationshipType} onChange={handleFieldChange}>
                <option value="prospection">Prospecção</option>
                <option value="customer">Cliente da Euro</option>
                <option value="supplier">Fornecedor</option>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs text-white/60">Contato principal</label>
                <Input name="mainContactName" value={form.mainContactName} onChange={handleFieldChange} />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-white/60">Cargo</label>
                <Input name="mainContactRole" value={form.mainContactRole} onChange={handleFieldChange} />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-white/60">Telefone / WhatsApp</label>
                <Input name="mainContactPhone" value={form.mainContactPhone} onChange={handleFieldChange} />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-white/60">E-mail</label>
                <Input name="mainContactEmail" type="email" value={form.mainContactEmail} onChange={handleFieldChange} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs text-white/60">Nível de interesse</label>
                <Select name="interestLevel" value={form.interestLevel} onChange={handleFieldChange}>
                  <option value="baixo">Baixo</option>
                  <option value="medio">Médio</option>
                  <option value="alto">Alto</option>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-white/60">Probabilidade de fechamento</label>
                <Select name="closeProbability" value={form.closeProbability} onChange={handleFieldChange}>
                  <option value="baixa">Baixa</option>
                  <option value="media">Média</option>
                  <option value="alta">Alta</option>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-white/60">
                <label className="text-xs text-white/60">Tags</label>
                <button
                  type="button"
                  className="text-[11px] text-primary underline"
                  onClick={() => setForm((prev) => ({ ...prev, tags: [] }))}
                >
                  Limpar tags
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {tagCatalog.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTagSelection(tag.id)}
                    className={`rounded-full px-3 py-1 text-xs transition ${
                      form.tags.includes(tag.id)
                        ? "bg-primary text-primary-foreground"
                        : "bg-white/10 text-white hover:bg-white/20"
                    }`}
                    style={
                      form.tags.includes(tag.id) || !tag.color
                        ? undefined
                        : { backgroundColor: `${tag.color}30`, color: tag.color }
                    }
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Input
                  placeholder="Adicionar tag rápida"
                  value={newTagName}
                  onChange={(event) => setNewTagName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleCreateTag(event);
                    }
                  }}
                />
                <Button type="button" onClick={handleCreateTag} size="sm">
                  Nova tag
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  name="hasCompetitorContract"
                  checked={form.hasCompetitorContract}
                  onChange={handleFieldChange}
                  className="h-4 w-4 rounded border-white/30 bg-transparent"
                />
                Possui contrato com concorrente
              </label>
              {form.hasCompetitorContract && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs text-white/60">Concorrente</label>
                    <Input name="competitorName" value={form.competitorName} onChange={handleFieldChange} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-white/60">Início do contrato</label>
                    <Input
                      name="competitorContractStart"
                      type="date"
                      value={form.competitorContractStart}
                      onChange={handleFieldChange}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-white/60">Término do contrato</label>
                    <Input
                      name="competitorContractEnd"
                      type="date"
                      value={form.competitorContractEnd}
                      onChange={handleFieldChange}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  name="inTrial"
                  checked={form.inTrial}
                  onChange={handleFieldChange}
                  className="h-4 w-4 rounded border-white/30 bg-transparent"
                />
                Está em teste (trial)
              </label>
              {form.inTrial && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs text-white/60">Produto/serviço</label>
                    <Input name="trialProduct" value={form.trialProduct} onChange={handleFieldChange} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-white/60">Início do teste</label>
                    <Input name="trialStart" type="date" value={form.trialStart} onChange={handleFieldChange} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-white/60">Duração (dias)</label>
                    <Input
                      name="trialDurationDays"
                      type="number"
                      min="0"
                      value={form.trialDurationDays}
                      onChange={handleFieldChange}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-white/60">Término previsto</label>
                    <Input name="trialEnd" type="date" value={form.trialEnd} onChange={handleFieldChange} />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs text-white/60">Notas internas</label>
              <Input name="notes" value={form.notes} onChange={handleFieldChange} placeholder="Observações gerais" />
            </div>
          </div>

          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-white/10 bg-card pt-3">
            <Button variant="ghost" type="button" onClick={closeFormModal}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : selectedId ? "Atualizar" : "Cadastrar"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function AlertGroup({
  title,
  items,
  renderDescription,
  tone = "info",
  typeLabel,
  relationshipLabel,
  relationshipBadgeStyle,
}) {
  if (!items || items.length === 0) return null;
  const toneStyles = {
    warning: "border-amber-500/40 bg-amber-500/10",
    danger: "border-red-500/40 bg-red-500/10",
    info: "border-sky-500/40 bg-sky-500/10",
    muted: "border-white/10 bg-white/5",
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-white/70">
        <AlertTriangle size={16} className="text-white/50" /> {title}
      </div>
      <div className="space-y-2">
        {items.map((client) => (
          <div key={client.id} className={`rounded-lg border p-3 ${toneStyles[tone] || toneStyles.info}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-white">{client.name}</div>
              <div className="flex flex-wrap gap-2 text-xs">
                {(client.alertType || typeLabel) && (
                  <span className="rounded-full bg-white/10 px-2 py-1 text-white/80">
                    {client.alertType || typeLabel}
                  </span>
                )}
                {relationshipLabel && (
                  <span
                    className={`rounded-full px-2 py-1 ${
                      relationshipBadgeStyle?.[client.relationshipType] || "bg-white/10 text-white"
                    }`}
                  >
                    {relationshipLabel[client.relationshipType] || relationshipLabel.prospection || "Prospecção"}
                  </span>
                )}
              </div>
            </div>
            <div className="text-white/70">{renderDescription(client)}</div>
            {relationshipLabel && (
              <div className="text-xs text-white/60">
                Relação: {relationshipLabel[client.relationshipType] || relationshipLabel.prospection || "Prospecção"}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function InteractionDetailsModal({ interaction, onClose, contactTypeLabel }) {
  return (
    <Modal open={Boolean(interaction)} onClose={onClose} title="Detalhes da interação" width="max-w-2xl">
      {interaction && (
        <div className="space-y-4 text-white/80">
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailItem label="Data" value={formatDate(interaction.date || interaction.createdAt)} />
            <DetailItem label="Tipo" value={contactTypeLabel[interaction.type] || interaction.type || "—"} />
            <DetailItem label="Responsável interno" value={interaction.internalUser || "—"} />
            <DetailItem
              label="Contato do cliente"
              value={interaction.clientContactName || "—"}
              helper={interaction.clientContactRole}
            />
            <DetailItem label="Próximo passo" value={interaction.nextStep || "—"} />
            <DetailItem label="Data de follow-up" value={formatDate(interaction.nextStepDate)} />
          </div>

          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-white/50">Resumo</div>
            <p className="whitespace-pre-wrap break-words text-white">{interaction.summary || "—"}</p>
          </div>

          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              Fechar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function DetailItem({ label, value, helper }) {
  return (
    <div className="space-y-1">
      <div className="text-xs uppercase tracking-wide text-white/50">{label}</div>
      <div className="text-sm text-white">{value || "—"}</div>
      {helper ? <div className="text-xs text-white/60">{helper}</div> : null}
    </div>
  );
}
