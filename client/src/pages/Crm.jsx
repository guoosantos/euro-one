import React, { useEffect, useMemo, useState } from "react";

import { CoreApi } from "../lib/coreApi";
import useCrmClients from "../lib/hooks/useCrmClients";

const interestOptions = [
  { value: "", label: "Todos" },
  { value: "Baixo", label: "Baixo" },
  { value: "Médio", label: "Médio" },
  { value: "Medio", label: "Médio" },
  { value: "Alto", label: "Alto" },
];

const probabilityOptions = [
  { value: "", label: "Todas" },
  { value: "Baixa", label: "Baixa" },
  { value: "Média", label: "Média" },
  { value: "Media", label: "Média" },
  { value: "Alta", label: "Alta" },
];

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

export default function Crm() {
  const { clients, setClients, loading, error } = useCrmClients();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterInterest, setFilterInterest] = useState("");
  const [filterCloseProbability, setFilterCloseProbability] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [form, setForm] = useState({ name: "", mainContactName: "", interestLevel: "", closeProbability: "" });
  const [saving, setSaving] = useState(false);
  const [alerts, setAlerts] = useState({ contractAlerts: [], trialAlerts: [] });
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState(null);

  const filteredClients = useMemo(() => {
    return (clients || []).filter((client) => {
      if (searchTerm && !client.name?.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (filterInterest && client.interestLevel && client.interestLevel.toLowerCase() !== filterInterest.toLowerCase())
        return false;
      if (
        filterCloseProbability &&
        client.closeProbability &&
        client.closeProbability.toLowerCase() !== filterCloseProbability.toLowerCase()
      )
        return false;
      if (filterTag) {
        const tags = Array.isArray(client.tags) ? client.tags : [];
        const match = tags.some((tag) => tag.toLowerCase().includes(filterTag.toLowerCase()));
        if (!match) return false;
      }
      return true;
    });
  }, [clients, searchTerm, filterInterest, filterCloseProbability, filterTag]);

  useEffect(() => {
    let mounted = true;
    setAlertsLoading(true);
    CoreApi.listCrmAlerts({ contractWithinDays: 30, trialWithinDays: 7 })
      .then((data) => {
        if (!mounted) return;
        setAlerts({
          contractAlerts: data?.contractAlerts || [],
          trialAlerts: data?.trialAlerts || [],
        });
      })
      .catch((err) => mounted && setAlertsError(err))
      .finally(() => mounted && setAlertsLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.name) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        interestLevel: form.interestLevel || null,
        closeProbability: form.closeProbability || null,
      };
      const response = await CoreApi.createCrmClient(payload);
      const created = response?.client || response;
      if (created) {
        setClients((prev) => [...prev, created]);
        setForm({ name: "", mainContactName: "", interestLevel: "", closeProbability: "", tags: "" });
      }
    } catch (err) {
      console.error("Falha ao salvar cliente", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 text-white/80">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">CRM</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:col-span-2">
          <h2 className="mb-3 text-lg font-semibold text-white">Cadastrar cliente</h2>
          <form className="grid gap-3 md:grid-cols-2" onSubmit={handleSubmit}>
            <label className="space-y-1">
              <span className="text-sm text-white/70">Nome do cliente</span>
              <input
                className="w-full rounded-lg border border-white/10 bg-white/10 p-2 text-white"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                required
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm text-white/70">Contato principal</span>
              <input
                className="w-full rounded-lg border border-white/10 bg-white/10 p-2 text-white"
                value={form.mainContactName}
                onChange={(e) => setForm((prev) => ({ ...prev, mainContactName: e.target.value }))}
                placeholder="Nome do contato"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm text-white/70">Interesse</span>
              <select
                className="w-full rounded-lg border border-white/10 bg-white/10 p-2 text-white"
                value={form.interestLevel}
                onChange={(e) => setForm((prev) => ({ ...prev, interestLevel: e.target.value }))}
              >
                {interestOptions.map((option) => (
                  <option key={option.label} value={option.value} className="bg-slate-900">
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm text-white/70">Probabilidade de fechamento</span>
              <select
                className="w-full rounded-lg border border-white/10 bg-white/10 p-2 text-white"
                value={form.closeProbability}
                onChange={(e) => setForm((prev) => ({ ...prev, closeProbability: e.target.value }))}
              >
                {probabilityOptions.map((option) => (
                  <option key={option.label} value={option.value} className="bg-slate-900">
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <h2 className="text-lg font-semibold text-white">Alertas de contrato e teste</h2>
          {alertsLoading && <div className="text-sm text-white/60">Carregando alertas...</div>}
          {alertsError && <div className="text-sm text-red-300">Erro ao carregar alertas</div>}
          {!alertsLoading && !alertsError && (
            <div className="mt-3 space-y-3 text-sm">
              <div>
                <div className="font-semibold text-white">Contratos concorrentes (30 dias)</div>
                {alerts.contractAlerts?.length ? (
                  <ul className="mt-1 space-y-1">
                    {alerts.contractAlerts.map((client) => (
                      <li key={client.id} className="rounded-lg bg-white/5 p-2">
                        <div className="font-medium text-white">{client.name}</div>
                        <div className="text-white/70">
                          Contrato termina em {formatDate(client.competitorContractEnd)}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-white/60">Nenhum alerta de contrato.</div>
                )}
              </div>
              <div>
                <div className="font-semibold text-white">Testes (trial) (7 dias)</div>
                {alerts.trialAlerts?.length ? (
                  <ul className="mt-1 space-y-1">
                    {alerts.trialAlerts.map((client) => (
                      <li key={client.id} className="rounded-lg bg-white/5 p-2">
                        <div className="font-medium text-white">{client.name}</div>
                        <div className="text-white/70">Teste termina em {formatDate(client.trialEnd)}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-white/60">Nenhum alerta de teste.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Clientes</h2>
            {loading && <div className="text-sm text-white/60">Carregando...</div>}
            {error && <div className="text-sm text-red-300">{error.message}</div>}
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <input
              className="rounded-lg border border-white/10 bg-white/10 p-2 text-sm text-white"
              placeholder="Buscar por nome"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <select
              className="rounded-lg border border-white/10 bg-white/10 p-2 text-sm text-white"
              value={filterInterest}
              onChange={(e) => setFilterInterest(e.target.value)}
            >
              {interestOptions.map((option) => (
                <option key={option.label} value={option.value} className="bg-slate-900">
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg border border-white/10 bg-white/10 p-2 text-sm text-white"
              value={filterCloseProbability}
              onChange={(e) => setFilterCloseProbability(e.target.value)}
            >
              {probabilityOptions.map((option) => (
                <option key={option.label} value={option.value} className="bg-slate-900">
                  {option.label}
                </option>
              ))}
            </select>
            <input
              className="rounded-lg border border-white/10 bg-white/10 p-2 text-sm text-white"
              placeholder="Filtrar por tag"
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/60">
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Contato principal</th>
                <th className="px-3 py-2">Interesse</th>
                <th className="px-3 py-2">Prob. fechamento</th>
                <th className="px-3 py-2">Contrato concorrente</th>
                <th className="px-3 py-2">Teste</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((client) => {
                const mainContactName = client.mainContactName || client.primaryContact?.name || "Sem contato";
                const mainContactRole = client.mainContactRole || client.primaryContact?.role || null;
                return (
                  <tr key={client.id} className="border-b border-white/5">
                    <td className="px-3 py-2 font-semibold text-white">{client.name}</td>
                    <td className="px-3 py-2">
                      <div className="text-white">{mainContactName}</div>
                      {mainContactRole && <div className="text-xs text-white/60">{mainContactRole}</div>}
                    </td>
                    <td className="px-3 py-2 text-white/70">{client.interestLevel || "—"}</td>
                    <td className="px-3 py-2 text-white/70">{client.closeProbability || "—"}</td>
                    <td className="px-3 py-2 text-white/70">
                      {client.hasCompetitorContract ? formatDate(client.competitorContractEnd) : "—"}
                    </td>
                    <td className="px-3 py-2 text-white/70">{client.inTrial ? formatDate(client.trialEnd) : "—"}</td>
                  </tr>
                );
              })}
              {!filteredClients.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-white/60">
                    Nenhum cliente encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
