import React, { useEffect, useMemo, useState } from "react";
import { Contact2, FilePlus2, NotebookPen, Sparkles } from "lucide-react";

import Card from "../ui/Card";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Button from "../ui/Button";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import useCrmClients from "../lib/hooks/useCrmClients.js";
import useCrmContacts from "../lib/hooks/useCrmContacts.js";

const defaultForm = {
  name: "",
  segment: "",
  companySize: "media",
  city: "",
  state: "",
  website: "",
  mainContactName: "",
  mainContactRole: "",
  mainContactPhone: "",
  mainContactEmail: "",
  interestLevel: "medio",
  closeProbability: "media",
  tags: "",
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

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString();
  } catch (_error) {
    return value;
  }
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

export default function Crm() {
  const { tenantId } = useTenant();
  const { clients, loading, error, refresh, createClient, updateClient } = useCrmClients();
  const [form, setForm] = useState(defaultForm);
  const [interactionForm, setInteractionForm] = useState(defaultInteraction);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const [saving, setSaving] = useState(false);
  const [interactionSaving, setInteractionSaving] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const { contacts, loading: contactsLoading, error: contactsError, addContact } = useCrmContacts(selectedId);

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

  const contactTypeLabel = useMemo(
    () => ({
      ligacao: "Ligação",
      whatsapp: "WhatsApp",
      email: "E-mail",
      reuniao: "Reunião",
    }),
    [],
  );

  useEffect(() => {
    if (!selectedId) {
      setSelectedClient(null);
      setForm(defaultForm);
      return;
    }
    let cancelled = false;
    setDetailError(null);
    CoreApi.getCrmClient(selectedId)
      .then((response) => {
        if (cancelled) return;
        const client = response?.client || response;
        setSelectedClient(client);
        setForm({
          name: client?.name || "",
          segment: client?.segment || "",
          companySize: client?.companySize || "",
          city: client?.city || "",
          state: client?.state || "",
          website: client?.website || "",
          mainContactName: client?.mainContactName || "",
          mainContactRole: client?.mainContactRole || "",
          mainContactPhone: client?.mainContactPhone || "",
          mainContactEmail: client?.mainContactEmail || "",
          interestLevel: client?.interestLevel || "medio",
          closeProbability: client?.closeProbability || "media",
          tags: (client?.tags || []).join(", "),
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
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setDetailError(err instanceof Error ? err : new Error("Falha ao carregar cliente"));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const filteredClients = useMemo(() => clients, [clients]);

  function handleFieldChange(event) {
    const { name, value, type, checked } = event.target;
    const parsedValue = type === "checkbox" ? checked : value;
    setForm((prev) => ({ ...prev, [name]: parsedValue }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    const payload = {
      ...form,
      clientId: tenantId,
      tags: form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      competitorContractStart: form.competitorContractStart || null,
      competitorContractEnd: form.competitorContractEnd || null,
      trialStart: form.trialStart || null,
      trialEnd: form.trialEnd || null,
      trialDurationDays: form.trialDurationDays === "" ? null : Number(form.trialDurationDays),
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
    } catch (err) {
      console.error("Falha ao salvar cliente", err);
      setDetailError(err instanceof Error ? err : new Error("Falha ao salvar"));
    } finally {
      setSaving(false);
    }
  }

  async function handleInteractionSubmit(event) {
    event.preventDefault();
    if (!selectedId) return;
    setInteractionSaving(true);
    try {
      const created = await addContact(interactionForm);
      setSelectedClient((prev) => ({ ...prev, contacts: [...(prev?.contacts || []), created] }));
      setInteractionForm(defaultInteraction);
    } catch (err) {
      console.error("Falha ao registrar interação", err);
    } finally {
      setInteractionSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-white">CRM</div>
          <p className="text-sm text-white/60">Cadastre clientes, acompanhe contratos e registre interações.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setSelectedId(null)}>
            <FilePlus2 size={16} className="mr-2" /> Novo cliente
          </Button>
        </div>
      </div>

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
          {error && <div className="rounded-lg bg-red-500/20 p-3 text-red-100">{error.message}</div>}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-white/50">
                <tr className="border-b border-white/10 text-left">
                  <th className="py-2 pr-4">Cliente</th>
                  <th className="py-2 pr-4">Segmento</th>
                  <th className="py-2 pr-4">Local</th>
                  <th className="py-2 pr-4">Interesse</th>
                  <th className="py-2 pr-4">Prob. fechamento</th>
                  <th className="py-2 pr-4">Contrato</th>
                  <th className="py-2 pr-4">Teste</th>
                  <th className="py-2 pr-4">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={8} className="py-4 text-center text-white/60">
                      Carregando clientes...
                    </td>
                  </tr>
                )}
                {!loading && filteredClients.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-4 text-center text-white/60">
                      Nenhum cliente cadastrado.
                    </td>
                  </tr>
                )}
                {filteredClients.map((client) => (
                  <tr key={client.id} className="border-b border-white/5">
                    <td className="py-2 pr-4 text-white">
                      <div className="flex items-center gap-2">
                        <Contact2 size={16} className="text-white/60" />
                        <div>
                          <div className="font-semibold">{client.name}</div>
                          <div className="text-xs text-white/50">{client.primaryContact?.name || "Sem contato"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-white/70">{client.segment || "—"}</td>
                    <td className="py-2 pr-4 text-white/70">
                      {[client.city, client.state].filter(Boolean).join("/") || "—"}
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`rounded-full px-2 py-1 text-xs ${interestBadge(client.interestLevel)}`}>
                        {interestLabel[client.interestLevel] || "—"}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-white/80">{closeProbabilityLabel[client.closeProbability] || "—"}</td>
                    <td className="py-2 pr-4 text-white/70">{buildContractLabel(client)}</td>
                    <td className="py-2 pr-4 text-white/70">{buildTrialLabel(client)}</td>
                    <td className="py-2 pr-4 text-white/80">
                      <Button variant="ghost" className="px-2 py-1" onClick={() => setSelectedId(client.id)}>
                        Ver / editar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Cadastro / edição" subtitle="Detalhes comerciais e operacionais">
          {detailError && <div className="mb-3 rounded-lg bg-red-500/20 p-3 text-red-100">{detailError.message}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs text-white/60">Nome do cliente *</label>
              <Input name="name" value={form.name} onChange={handleFieldChange} required />
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
              <label className="text-xs text-white/60">Tags</label>
              <Input
                name="tags"
                value={form.tags}
                onChange={handleFieldChange}
                placeholder="logística, frota própria, grande conta"
              />
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <NotebookPen size={16} /> Operação / contrato atual
              </div>
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
                    <label className="text-xs text-white/60">Término do contrato</label>
                    <Input
                      name="competitorContractEnd"
                      type="date"
                      value={form.competitorContractEnd}
                      onChange={handleFieldChange}
                    />
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
                </div>
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Sparkles size={16} /> Período de teste
              </div>
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  name="inTrial"
                  checked={form.inTrial}
                  onChange={handleFieldChange}
                  className="h-4 w-4 rounded border-white/30 bg-transparent"
                />
                Cliente em teste
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

            <div className="flex justify-end">
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando..." : selectedId ? "Atualizar" : "Cadastrar"}
              </Button>
            </div>
          </form>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card
          title="Interações"
          subtitle={selectedId ? "Registro de contatos recentes" : "Selecione um cliente para registrar interações"}
          className="xl:col-span-2"
        >
          {!selectedId && <div className="text-sm text-white/60">Escolha um cliente na lista para visualizar interações.</div>}
          {selectedId && (
            <div className="space-y-4">
              <form onSubmit={handleInteractionSubmit} className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs text-white/60">Data</label>
                  <Input name="date" type="date" value={interactionForm.date} onChange={(e) => setInteractionForm((prev) => ({ ...prev, date: e.target.value }))} />
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
                  <label className="text-xs text-white/60">Data do follow-up</label>
                  <Input
                    name="nextStepDate"
                    type="date"
                    value={interactionForm.nextStepDate}
                    onChange={(e) => setInteractionForm((prev) => ({ ...prev, nextStepDate: e.target.value }))}
                  />
                </div>
                <div className="sm:col-span-2 flex justify-end">
                  <Button type="submit" disabled={interactionSaving}>
                    {interactionSaving ? "Registrando..." : "Registrar contato"}
                  </Button>
                </div>
              </form>

              {contactsError && <div className="rounded-lg bg-red-500/20 p-3 text-red-100">{contactsError.message}</div>}

              <div className="divide-y divide-white/5 rounded-xl border border-white/10">
                {contactsLoading && <div className="p-3 text-sm text-white/60">Carregando contatos...</div>}
                {!contactsLoading &&
                  contacts
                    .slice()
                    .reverse()
                    .map((interaction) => (
                      <div key={interaction.id} className="p-3 text-sm text-white/80">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-semibold capitalize">{contactTypeLabel[interaction.type] || interaction.type}</div>
                          <div className="text-xs text-white/50">{formatDate(interaction.date)}</div>
                        </div>
                        <div className="text-white/70">Contato: {interaction.clientContactName || "—"}</div>
                        <div className="text-white/70">Responsável: {interaction.internalUser || "—"}</div>
                        {interaction.summary && <div className="text-white/80">Resumo: {interaction.summary}</div>}
                        {interaction.nextStep && (
                          <div className="text-white/80">
                            Próximo passo: {interaction.nextStep}
                            {interaction.nextStepDate && ` até ${formatDate(interaction.nextStepDate)}`}
                          </div>
                        )}
                      </div>
                    ))}
                {!contactsLoading && contacts.length === 0 && (
                  <div className="p-3 text-sm text-white/60">Nenhum contato registrado ainda.</div>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card
          title="Status rápido"
          subtitle="Contrato, teste e perfil comercial"
          className="xl:col-span-1"
          actions={selectedClient && <span className="text-xs text-white/60">Atualizado {formatDate(selectedClient.updatedAt)}</span>}
        >
          {!selectedClient && <div className="text-sm text-white/60">Selecione um cliente para visualizar o resumo.</div>}
          {selectedClient && (
            <div className="space-y-3 text-sm text-white/80">
              <div>
                <div className="text-white/50">Nível de interesse</div>
                <div className="font-semibold">{interestLabel[selectedClient.interestLevel] || "—"}</div>
              </div>
              <div>
                <div className="text-white/50">Probabilidade de fechamento</div>
                <div className="font-semibold">{closeProbabilityLabel[selectedClient.closeProbability] || "—"}</div>
              </div>
              <div>
                <div className="text-white/50">Contrato concorrente</div>
                <div className="font-semibold">{buildContractLabel(selectedClient)}</div>
              </div>
              <div>
                <div className="text-white/50">Teste</div>
                <div className="font-semibold">{buildTrialLabel(selectedClient)}</div>
              </div>
              <div>
                <div className="text-white/50">Tags</div>
                <div className="flex flex-wrap gap-2">
                  {(selectedClient.tags || []).map((tag) => (
                    <span key={tag} className="rounded-full bg-white/10 px-2 py-1 text-xs">
                      {tag}
                    </span>
                  ))}
                  {(selectedClient.tags || []).length === 0 && <span className="text-white/60">Sem tags</span>}
                </div>
              </div>
              {selectedClient.notes && (
                <div>
                  <div className="text-white/50">Notas</div>
                  <div className="whitespace-pre-line">{selectedClient.notes}</div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
