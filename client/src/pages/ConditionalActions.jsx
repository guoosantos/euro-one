import React, { useCallback, useEffect, useMemo, useState } from "react";

import PageHeader from "../components/ui/PageHeader.jsx";
import Button from "../ui/Button.jsx";
import Input from "../ui/Input.jsx";
import Select from "../ui/Select.jsx";
import Modal from "../ui/Modal.jsx";
import DataTablePagination from "../ui/DataTablePagination.jsx";
import api from "../lib/api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import useVehicles from "../lib/hooks/useVehicles.js";
import useDevices from "../lib/hooks/useDevices.js";

const HISTORY_PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 500];

const CONDITION_TYPE_OPTIONS = [
  { value: "speed_above", label: "Velocidade acima de X" },
  { value: "geofence_enter", label: "Entrou na cerca" },
  { value: "geofence_exit", label: "Saiu da cerca" },
  { value: "target_arrive", label: "Chegou no alvo" },
  { value: "outside_route", label: "Desvio/fim fora da rota" },
  { value: "digital_input_active", label: "Entrada digital acionada" },
  { value: "ignition_state", label: "Ignição ligada/desligada" },
  { value: "no_signal_for", label: "Sem transmissão por tempo" },
  { value: "event_equals", label: "Evento específico ocorreu" },
];

const ACTION_TYPE_OPTIONS = [
  { value: "create_alert", label: "Criar alerta" },
  { value: "create_event", label: "Criar evento" },
  { value: "notify_popup", label: "Notificar (popup)" },
  { value: "send_command", label: "Enviar comando" },
  { value: "audit_log", label: "Registrar auditoria" },
];

function createEmptyCondition() {
  return {
    id: null,
    type: "speed_above",
    enabled: true,
    threshold: "80",
    durationSeconds: "0",
    geofenceId: "",
    routeId: "",
    toleranceMeters: "200",
    inputIndex: "1",
    ignitionState: "on",
    minutesWithoutSignal: "10",
    eventId: "",
  };
}

function createEmptyAction() {
  return {
    id: null,
    type: "create_alert",
    enabled: true,
    title: "",
    severity: "critical",
    category: "Segurança",
    requiresHandling: true,
    commandPayloadText: "{\n  \"type\": \"custom\",\n  \"attributes\": {\n    \"data\": \"\"\n  }\n}",
  };
}

function createEmptyForm() {
  return {
    id: null,
    name: "",
    description: "",
    active: true,
    scopeMode: "all",
    vehicleIds: [],
    deviceIds: [],
    groupIdsText: "",
    conditionOperator: "AND",
    conditions: [createEmptyCondition()],
    actions: [createEmptyAction()],
    cooldownMinutes: "5",
    priority: "5",
    maxExecutionsPerHour: "0",
  };
}

function parseNumberString(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function toCommaList(text = "") {
  return String(text || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function serializeConditions(draftList = []) {
  return {
    operator: draftList.operator || "AND",
    items: draftList.items || [],
  };
}

function conditionDraftFromModel(condition = {}) {
  const params = condition?.params && typeof condition.params === "object" ? condition.params : {};
  return {
    id: condition?.id || null,
    type: condition?.type || "speed_above",
    enabled: condition?.enabled !== false,
    threshold: String(params?.threshold ?? params?.value ?? 80),
    durationSeconds: String(params?.durationSeconds ?? params?.seconds ?? params?.duration ?? 0),
    geofenceId: String(params?.geofenceId ?? params?.targetId ?? params?.id ?? ""),
    routeId: String(params?.routeId ?? ""),
    toleranceMeters: String(params?.toleranceMeters ?? params?.tolerance ?? 200),
    inputIndex: String(params?.input ?? params?.index ?? 1),
    ignitionState: String(params?.state ?? params?.value ?? "on"),
    minutesWithoutSignal: String(params?.minutes ?? params?.value ?? 10),
    eventId: String(params?.eventId ?? params?.eventType ?? params?.value ?? ""),
  };
}

function actionDraftFromModel(action = {}) {
  const params = action?.params && typeof action.params === "object" ? action.params : {};
  return {
    id: action?.id || null,
    type: action?.type || "create_alert",
    enabled: action?.enabled !== false,
    title: String(params?.title ?? params?.label ?? ""),
    severity: String(params?.severity ?? "critical"),
    category: String(params?.category ?? "Segurança"),
    requiresHandling: params?.requiresHandling !== false,
    commandPayloadText: JSON.stringify(params?.payload || { type: "custom", attributes: { data: "" } }, null, 2),
  };
}

function buildConditionParams(condition) {
  const type = String(condition?.type || "").toLowerCase();
  if (type === "speed_above") {
    return {
      threshold: parseNumberString(condition.threshold, 80),
      durationSeconds: Math.max(0, parseNumberString(condition.durationSeconds, 0)),
    };
  }
  if (type === "geofence_enter" || type === "geofence_exit" || type === "target_arrive") {
    return { geofenceId: condition.geofenceId || null };
  }
  if (type === "outside_route") {
    return {
      routeId: condition.routeId || null,
      toleranceMeters: Math.max(0, parseNumberString(condition.toleranceMeters, 200)),
    };
  }
  if (type === "digital_input_active") {
    return {
      input: Math.max(1, parseNumberString(condition.inputIndex, 1)),
      active: true,
    };
  }
  if (type === "ignition_state") {
    return {
      state: condition.ignitionState === "off" ? false : true,
    };
  }
  if (type === "no_signal_for") {
    return {
      minutes: Math.max(0, parseNumberString(condition.minutesWithoutSignal, 10)),
    };
  }
  if (type === "event_equals") {
    return {
      eventId: condition.eventId || null,
    };
  }
  return {};
}

function buildActionParams(action) {
  const type = String(action?.type || "").toLowerCase();
  if (type === "send_command") {
    try {
      const payload = JSON.parse(action.commandPayloadText || "{}");
      return { payload };
    } catch (_error) {
      return {
        payload: {
          type: "custom",
          attributes: { data: "" },
        },
      };
    }
  }
  return {
    title: action.title || null,
    severity: action.severity || "critical",
    category: action.category || "Segurança",
    requiresHandling: Boolean(action.requiresHandling),
  };
}

function buildRulePayloadFromForm(form) {
  const conditions = Array.isArray(form.conditions) ? form.conditions : [];
  const actions = Array.isArray(form.actions) ? form.actions : [];
  return {
    name: form.name?.trim() || "",
    description: form.description?.trim() || "",
    active: Boolean(form.active),
    scope: {
      mode: form.scopeMode || "all",
      vehicleIds: form.scopeMode === "vehicles" ? form.vehicleIds : [],
      deviceIds: form.scopeMode === "devices" ? form.deviceIds : [],
      groupIds: form.scopeMode === "groups" ? toCommaList(form.groupIdsText) : [],
    },
    conditions: serializeConditions({
      operator: form.conditionOperator || "AND",
      items: conditions.map((condition) => ({
        id: condition.id || undefined,
        type: condition.type,
        enabled: condition.enabled !== false,
        params: buildConditionParams(condition),
      })),
    }),
    actions: actions.map((action) => ({
      id: action.id || undefined,
      type: action.type,
      enabled: action.enabled !== false,
      params: buildActionParams(action),
    })),
    settings: {
      cooldownMinutes: Math.max(0, parseNumberString(form.cooldownMinutes, 5)),
      priority: Math.max(1, parseNumberString(form.priority, 5)),
      maxExecutionsPerHour: Math.max(0, parseNumberString(form.maxExecutionsPerHour, 0)),
    },
  };
}

function mapRuleToForm(rule) {
  return {
    id: rule?.id || null,
    name: rule?.name || "",
    description: rule?.description || "",
    active: rule?.active !== false,
    scopeMode: rule?.scope?.mode || "all",
    vehicleIds: Array.isArray(rule?.scope?.vehicleIds) ? rule.scope.vehicleIds.map(String) : [],
    deviceIds: Array.isArray(rule?.scope?.deviceIds) ? rule.scope.deviceIds.map(String) : [],
    groupIdsText: Array.isArray(rule?.scope?.groupIds) ? rule.scope.groupIds.join(", ") : "",
    conditionOperator: rule?.conditions?.operator || "AND",
    conditions: (Array.isArray(rule?.conditions?.items) ? rule.conditions.items : []).map(conditionDraftFromModel),
    actions: (Array.isArray(rule?.actions) ? rule.actions : []).map(actionDraftFromModel),
    cooldownMinutes: String(rule?.settings?.cooldownMinutes ?? 5),
    priority: String(rule?.settings?.priority ?? 5),
    maxExecutionsPerHour: String(rule?.settings?.maxExecutionsPerHour ?? 0),
  };
}

function renderConditionSummary(conditionSummary) {
  if (!conditionSummary || !Array.isArray(conditionSummary.items)) return "—";
  const matched = conditionSummary.items
    .filter((item) => item?.matched)
    .map((item) => item?.type)
    .filter(Boolean);
  if (!matched.length) return "Nenhuma condição";
  return matched.join(", ");
}

function renderActionSummary(actionResults) {
  if (!Array.isArray(actionResults) || !actionResults.length) return "—";
  return actionResults
    .map((item) => `${item?.type || "ação"} (${item?.status || "executed"})`)
    .join(" | ");
}

export default function ConditionalActions() {
  const [activeTab, setActiveTab] = useState("rules");
  const [rules, setRules] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(50);
  const [historyMeta, setHistoryMeta] = useState(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyVehicleId, setHistoryVehicleId] = useState("");
  const [historyFrom, setHistoryFrom] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [historyTo, setHistoryTo] = useState(() => new Date().toISOString().slice(0, 16));

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [form, setForm] = useState(createEmptyForm());

  const { vehicleOptions } = useVehicles({ includeTelemetry: false, includeUnlinked: true });
  const { devices } = useDevices({ withPositions: false });

  const deviceOptions = useMemo(
    () =>
      (Array.isArray(devices) ? devices : []).map((device) => ({
        value: String(device?.traccarId ?? device?.id),
        label: String(device?.name || device?.uniqueId || device?.id),
      })),
    [devices],
  );

  const fetchRules = useCallback(async () => {
    setRulesLoading(true);
    setRulesError(null);
    try {
      const response = await api.get(API_ROUTES.conditionalActions.rules, {
        params: {
          search: search.trim() || undefined,
          status: statusFilter || undefined,
        },
      });
      const list = Array.isArray(response?.data?.data) ? response.data.data : [];
      setRules(list);
    } catch (error) {
      setRules([]);
      setRulesError(error instanceof Error ? error : new Error("Não foi possível carregar regras."));
    } finally {
      setRulesLoading(false);
    }
  }, [search, statusFilter]);

  const fetchHistory = useCallback(async (page = historyPage, pageSize = historyPageSize) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await api.get(API_ROUTES.conditionalActions.history, {
        params: {
          from: historyFrom ? new Date(historyFrom).toISOString() : undefined,
          to: historyTo ? new Date(historyTo).toISOString() : undefined,
          search: historySearch.trim() || undefined,
          vehicleId: historyVehicleId || undefined,
          page,
          limit: pageSize,
        },
      });
      const list = Array.isArray(response?.data?.data) ? response.data.data : [];
      setHistoryRows(list);
      setHistoryMeta({
        page: response?.data?.page ?? page,
        pageSize: response?.data?.pageSize ?? pageSize,
        totalItems: response?.data?.total ?? list.length,
        totalPages: response?.data?.totalPages ?? 1,
      });
    } catch (error) {
      setHistoryRows([]);
      setHistoryMeta(null);
      setHistoryError(error instanceof Error ? error : new Error("Não foi possível carregar histórico."));
    } finally {
      setHistoryLoading(false);
    }
  }, [historyFrom, historyPage, historyPageSize, historySearch, historyTo, historyVehicleId]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  useEffect(() => {
    if (activeTab !== "history") return;
    fetchHistory(historyPage, historyPageSize);
  }, [activeTab, fetchHistory, historyPage, historyPageSize]);

  const openCreateModal = () => {
    setForm(createEmptyForm());
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (rule) => {
    setForm(mapRuleToForm(rule));
    setFormError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setFormError(null);
  };

  const saveRule = async () => {
    if (!form.name.trim()) {
      setFormError("Nome da regra é obrigatório.");
      return;
    }
    if (!form.conditions.length) {
      setFormError("A regra precisa de ao menos uma condição.");
      return;
    }
    if (!form.actions.length) {
      setFormError("A regra precisa de ao menos uma ação.");
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const payload = buildRulePayloadFromForm(form);
      if (form.id) {
        await api.put(API_ROUTES.conditionalActions.ruleById(form.id), payload);
      } else {
        await api.post(API_ROUTES.conditionalActions.rules, payload);
      }
      setModalOpen(false);
      fetchRules();
    } catch (error) {
      setFormError(error?.message || "Não foi possível salvar a regra.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleRule = async (rule) => {
    try {
      await api.patch(API_ROUTES.conditionalActions.toggle(rule.id), { active: !rule.active });
      fetchRules();
    } catch (_error) {
      // no-op
    }
  };

  const handleDuplicateRule = async (rule) => {
    try {
      await api.post(API_ROUTES.conditionalActions.duplicate(rule.id), {});
      fetchRules();
    } catch (_error) {
      // no-op
    }
  };

  const handleDeleteRule = async (rule) => {
    const confirmed = window.confirm(`Excluir a regra "${rule?.name || "sem nome"}"?`);
    if (!confirmed) return;
    try {
      await api.delete(API_ROUTES.conditionalActions.ruleById(rule.id));
      fetchRules();
    } catch (_error) {
      // no-op
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-72px)] w-full flex-col gap-5">
      <PageHeader
        title="Ação Condicional"
        subtitle="Automação IF/THEN por veículo/equipamento com histórico e auditoria."
        actions={
          <>
            <Button type="button" onClick={fetchRules} variant="outline">
              Atualizar
            </Button>
            <Button type="button" onClick={openCreateModal}>
              Criar nova regra
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab("rules")}
          className={`rounded-xl border px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
            activeTab === "rules" ? "border-primary/50 bg-primary/20 text-white" : "border-white/10 text-white/65"
          }`}
        >
          Regras
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("history")}
          className={`rounded-xl border px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
            activeTab === "history" ? "border-primary/50 bg-primary/20 text-white" : "border-white/10 text-white/65"
          }`}
        >
          Histórico
        </button>
      </div>

      {activeTab === "rules" && (
        <section className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <Input
              label="Buscar regra"
              placeholder="Nome ou descrição"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Select label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">Todos</option>
              <option value="active">Ativas</option>
              <option value="inactive">Inativas</option>
            </Select>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-white/10">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-full border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-white/10 bg-[#0f141c] text-[11px] uppercase tracking-[0.12em] text-white/60">
                  <tr>
                    <th className="px-3 py-2">Nome</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Condição principal</th>
                    <th className="px-3 py-2">Ação principal</th>
                    <th className="px-3 py-2">Escopo</th>
                    <th className="px-3 py-2">Criado em</th>
                    <th className="px-3 py-2">Última execução</th>
                    <th className="px-3 py-2">Criado por</th>
                    <th className="px-3 py-2">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40 text-xs">
                  {rulesLoading && (
                    <tr>
                      <td colSpan={9} className="px-3 py-4 text-center text-white/70">
                        Carregando regras...
                      </td>
                    </tr>
                  )}
                  {!rulesLoading && rulesError && (
                    <tr>
                      <td colSpan={9} className="px-3 py-4 text-center text-red-300">
                        {rulesError.message}
                      </td>
                    </tr>
                  )}
                  {!rulesLoading && !rulesError && rules.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-4 text-center text-white/70">
                        Nenhuma regra cadastrada.
                      </td>
                    </tr>
                  )}
                  {rules.map((rule) => (
                    <tr key={rule.id} className="hover:bg-white/5">
                      <td className="px-3 py-2 text-white/85">{rule.name || "—"}</td>
                      <td className="px-3 py-2 text-white/70">{rule.active ? "Ativa" : "Inativa"}</td>
                      <td className="px-3 py-2 text-white/70">{rule.conditions?.items?.[0]?.type || "—"}</td>
                      <td className="px-3 py-2 text-white/70">{rule.actions?.[0]?.type || "—"}</td>
                      <td className="px-3 py-2 text-white/70">{rule.scope?.mode || "all"}</td>
                      <td className="px-3 py-2 text-white/70">
                        {rule.createdAt ? new Date(rule.createdAt).toLocaleString("pt-BR") : "—"}
                      </td>
                      <td className="px-3 py-2 text-white/70">
                        {rule.lastExecutedAt ? new Date(rule.lastExecutedAt).toLocaleString("pt-BR") : "—"}
                      </td>
                      <td className="px-3 py-2 text-white/70">{rule.createdByName || rule.createdBy || "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          <Button type="button" size="xs" variant="outline" onClick={() => openEditModal(rule)}>
                            Editar
                          </Button>
                          <Button type="button" size="xs" variant="outline" onClick={() => handleToggleRule(rule)}>
                            {rule.active ? "Desativar" : "Ativar"}
                          </Button>
                          <Button type="button" size="xs" variant="outline" onClick={() => handleDuplicateRule(rule)}>
                            Duplicar
                          </Button>
                          <Button type="button" size="xs" variant="danger" onClick={() => handleDeleteRule(rule)}>
                            Excluir
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {activeTab === "history" && (
        <section className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <Input
              label="Filtro"
              placeholder="Regra, evento ou status"
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
            />
            <Select
              label="Veículo"
              value={historyVehicleId}
              onChange={(event) => setHistoryVehicleId(event.target.value)}
            >
              <option value="">Todos</option>
              {vehicleOptions.map((vehicle) => (
                <option key={vehicle.value} value={String(vehicle.value)}>
                  {vehicle.label}
                </option>
              ))}
            </Select>
            <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
              De
              <input
                type="datetime-local"
                value={historyFrom}
                onChange={(event) => setHistoryFrom(event.target.value)}
                className="mt-2 rounded-xl border border-stroke bg-card/60 px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
              Até
              <input
                type="datetime-local"
                value={historyTo}
                onChange={(event) => setHistoryTo(event.target.value)}
                className="mt-2 rounded-xl border border-stroke bg-card/60 px-3 py-2 text-sm"
              />
            </label>
            <div className="flex items-end">
              <Button type="button" onClick={() => { setHistoryPage(1); fetchHistory(1, historyPageSize); }}>
                Aplicar filtros
              </Button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-white/10">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-full border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-white/10 bg-[#0f141c] text-[11px] uppercase tracking-[0.12em] text-white/60">
                  <tr>
                    <th className="px-3 py-2">Data/Hora</th>
                    <th className="px-3 py-2">Regra</th>
                    <th className="px-3 py-2">Veículo/equipamento</th>
                    <th className="px-3 py-2">Condição satisfeita</th>
                    <th className="px-3 py-2">Ação executada</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Criador</th>
                    <th className="px-3 py-2">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40 text-xs">
                  {historyLoading && (
                    <tr>
                      <td colSpan={8} className="px-3 py-4 text-center text-white/70">
                        Carregando histórico...
                      </td>
                    </tr>
                  )}
                  {!historyLoading && historyError && (
                    <tr>
                      <td colSpan={8} className="px-3 py-4 text-center text-red-300">
                        {historyError.message}
                      </td>
                    </tr>
                  )}
                  {!historyLoading && !historyError && historyRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-4 text-center text-white/70">
                        Nenhum registro para os filtros selecionados.
                      </td>
                    </tr>
                  )}
                  {historyRows.map((entry) => (
                    <tr key={entry.id} className="hover:bg-white/5">
                      <td className="px-3 py-2 text-white/80">
                        {entry.triggeredAt ? new Date(entry.triggeredAt).toLocaleString("pt-BR") : "—"}
                      </td>
                      <td className="px-3 py-2 text-white/80">{entry.ruleName || "—"}</td>
                      <td className="px-3 py-2 text-white/70">{entry.vehicleId || entry.deviceId || "—"}</td>
                      <td className="px-3 py-2 text-white/70">{renderConditionSummary(entry.conditionSummary)}</td>
                      <td className="px-3 py-2 text-white/70">{renderActionSummary(entry.actionResults)}</td>
                      <td className="px-3 py-2 text-white/70">{entry.status || "—"}</td>
                      <td className="px-3 py-2 text-white/70">{entry.createdByName || entry.createdBy || "—"}</td>
                      <td className="px-3 py-2 text-white/70">{entry.ipAddress || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <DataTablePagination
              className="mt-auto"
              pageSize={historyPageSize}
              pageSizeOptions={HISTORY_PAGE_SIZE_OPTIONS}
              onPageSizeChange={(value) => {
                const next = Number(value) || 50;
                setHistoryPageSize(next);
                setHistoryPage(1);
                fetchHistory(1, next);
              }}
              currentPage={historyMeta?.page ?? historyPage}
              totalPages={historyMeta?.totalPages ?? 1}
              totalItems={historyMeta?.totalItems ?? historyRows.length}
              onPageChange={(next) => setHistoryPage(next)}
              disabled={historyLoading}
            />
          </div>
        </section>
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={form.id ? "Editar Regra Condicional" : "Nova Regra Condicional"}
        width="max-w-6xl"
        footer={(
          <>
            <Button type="button" variant="outline" onClick={closeModal} disabled={saving}>
              Cancelar
            </Button>
            <Button type="button" onClick={saveRule} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </>
        )}
      >
        <div className="space-y-5">
          {formError && <div className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{formError}</div>}

          <section className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/60">A) Identificação</p>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Nome da regra *"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ex.: Bloquear em desvio crítico"
              />
              <Select
                label="Status"
                value={form.active ? "active" : "inactive"}
                onChange={(event) => setForm((current) => ({ ...current, active: event.target.value === "active" }))}
              >
                <option value="active">Ativa</option>
                <option value="inactive">Inativa</option>
              </Select>
            </div>
            <Input
              label="Descrição"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Resumo opcional da regra"
              className="mt-3"
            />
          </section>

          <section className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/60">B) Escopo</p>
            <div className="grid gap-3 md:grid-cols-2">
              <Select
                label="Aplicar em"
                value={form.scopeMode}
                onChange={(event) => setForm((current) => ({ ...current, scopeMode: event.target.value }))}
              >
                <option value="all">Todos</option>
                <option value="vehicles">Veículos selecionados</option>
                <option value="devices">Equipamentos selecionados</option>
                <option value="groups">Grupo/Frota</option>
              </Select>
              {form.scopeMode === "groups" && (
                <Input
                  label="IDs de grupo (separados por vírgula)"
                  value={form.groupIdsText}
                  onChange={(event) => setForm((current) => ({ ...current, groupIdsText: event.target.value }))}
                  placeholder="grupo-1, grupo-2"
                />
              )}
            </div>

            {form.scopeMode === "vehicles" && (
              <div className="mt-3">
                <label className="text-xs uppercase tracking-wide text-white/60">Veículos</label>
                <select
                  multiple
                  value={form.vehicleIds}
                  onChange={(event) => {
                    const next = Array.from(event.target.selectedOptions).map((item) => item.value);
                    setForm((current) => ({ ...current, vehicleIds: next }));
                  }}
                  className="mt-2 h-36 w-full rounded-xl border border-stroke bg-card/60 px-3 py-2 text-sm"
                >
                  {vehicleOptions.map((vehicle) => (
                    <option key={vehicle.value} value={String(vehicle.value)}>
                      {vehicle.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {form.scopeMode === "devices" && (
              <div className="mt-3">
                <label className="text-xs uppercase tracking-wide text-white/60">Equipamentos</label>
                <select
                  multiple
                  value={form.deviceIds}
                  onChange={(event) => {
                    const next = Array.from(event.target.selectedOptions).map((item) => item.value);
                    setForm((current) => ({ ...current, deviceIds: next }));
                  }}
                  className="mt-2 h-36 w-full rounded-xl border border-stroke bg-card/60 px-3 py-2 text-sm"
                >
                  {deviceOptions.map((device) => (
                    <option key={device.value} value={String(device.value)}>
                      {device.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/60">C) Condições (IF)</p>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setForm((current) => ({ ...current, conditions: [...current.conditions, createEmptyCondition()] }))}
              >
                Adicionar condição
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-[220px_220px]">
              <Select
                label="Operador"
                value={form.conditionOperator}
                onChange={(event) => setForm((current) => ({ ...current, conditionOperator: event.target.value }))}
              >
                <option value="AND">AND (todas)</option>
                <option value="OR">OR (qualquer)</option>
              </Select>
            </div>

            <div className="mt-3 space-y-3">
              {form.conditions.map((condition, index) => (
                <div key={`${condition.id || "new"}-${index}`} className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-white/70">Condição #{index + 1}</p>
                    <button
                      type="button"
                      className="text-xs text-red-200/90 hover:text-red-200"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          conditions: current.conditions.filter((_item, itemIndex) => itemIndex !== index),
                        }))
                      }
                    >
                      Remover
                    </button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-4">
                    <Select
                      label="Tipo"
                      value={condition.type}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          conditions: current.conditions.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, type: event.target.value } : item
                          ),
                        }))
                      }
                    >
                      {CONDITION_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>

                    {condition.type === "speed_above" && (
                      <>
                        <Input
                          label="Limite (km/h)"
                          value={condition.threshold}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              conditions: current.conditions.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, threshold: event.target.value } : item
                              ),
                            }))
                          }
                        />
                        <Input
                          label="Persistência (s)"
                          value={condition.durationSeconds}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              conditions: current.conditions.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, durationSeconds: event.target.value } : item
                              ),
                            }))
                          }
                        />
                      </>
                    )}

                    {(condition.type === "geofence_enter" || condition.type === "geofence_exit" || condition.type === "target_arrive") && (
                      <Input
                        label="ID da cerca/alvo"
                        value={condition.geofenceId}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            conditions: current.conditions.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, geofenceId: event.target.value } : item
                            ),
                          }))
                        }
                      />
                    )}

                    {condition.type === "outside_route" && (
                      <>
                        <Input
                          label="ID da rota"
                          value={condition.routeId}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              conditions: current.conditions.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, routeId: event.target.value } : item
                              ),
                            }))
                          }
                        />
                        <Input
                          label="Tolerância (m)"
                          value={condition.toleranceMeters}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              conditions: current.conditions.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, toleranceMeters: event.target.value } : item
                              ),
                            }))
                          }
                        />
                      </>
                    )}

                    {condition.type === "digital_input_active" && (
                      <Input
                        label="Entrada digital"
                        value={condition.inputIndex}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            conditions: current.conditions.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, inputIndex: event.target.value } : item
                            ),
                          }))
                        }
                      />
                    )}

                    {condition.type === "ignition_state" && (
                      <Select
                        label="Estado da ignição"
                        value={condition.ignitionState}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            conditions: current.conditions.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, ignitionState: event.target.value } : item
                            ),
                          }))
                        }
                      >
                        <option value="on">Ligada</option>
                        <option value="off">Desligada</option>
                      </Select>
                    )}

                    {condition.type === "no_signal_for" && (
                      <Input
                        label="Sem sinal por (min)"
                        value={condition.minutesWithoutSignal}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            conditions: current.conditions.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, minutesWithoutSignal: event.target.value } : item
                            ),
                          }))
                        }
                      />
                    )}

                    {condition.type === "event_equals" && (
                      <Input
                        label="ID/Tipo do evento"
                        value={condition.eventId}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            conditions: current.conditions.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, eventId: event.target.value } : item
                            ),
                          }))
                        }
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/60">D) Ações (THEN)</p>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setForm((current) => ({ ...current, actions: [...current.actions, createEmptyAction()] }))}
              >
                Adicionar ação
              </Button>
            </div>

            <div className="space-y-3">
              {form.actions.map((action, index) => (
                <div key={`${action.id || "new"}-${index}`} className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-white/70">Ação #{index + 1}</p>
                    <button
                      type="button"
                      className="text-xs text-red-200/90 hover:text-red-200"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          actions: current.actions.filter((_item, itemIndex) => itemIndex !== index),
                        }))
                      }
                    >
                      Remover
                    </button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-4">
                    <Select
                      label="Tipo"
                      value={action.type}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          actions: current.actions.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, type: event.target.value } : item
                          ),
                        }))
                      }
                    >
                      {ACTION_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>

                    {action.type !== "send_command" && (
                      <>
                        <Input
                          label="Título do alerta/evento"
                          value={action.title}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              actions: current.actions.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, title: event.target.value } : item
                              ),
                            }))
                          }
                        />
                        <Select
                          label="Severidade"
                          value={action.severity}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              actions: current.actions.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, severity: event.target.value } : item
                              ),
                            }))
                          }
                        >
                          <option value="critical">Crítica</option>
                          <option value="warning">Alerta</option>
                          <option value="info">Informativa</option>
                        </Select>
                        <Input
                          label="Categoria"
                          value={action.category}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              actions: current.actions.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, category: event.target.value } : item
                              ),
                            }))
                          }
                        />
                      </>
                    )}
                  </div>

                  {action.type !== "send_command" && (
                    <label className="mt-3 inline-flex items-center gap-2 text-xs text-white/70">
                      <input
                        type="checkbox"
                        checked={Boolean(action.requiresHandling)}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            actions: current.actions.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, requiresHandling: event.target.checked } : item
                            ),
                          }))
                        }
                      />
                      Requer tratativa
                    </label>
                  )}

                  {action.type === "send_command" && (
                    <label className="mt-3 flex flex-col text-xs uppercase tracking-wide text-white/60">
                      Payload JSON do comando
                      <textarea
                        value={action.commandPayloadText}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            actions: current.actions.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, commandPayloadText: event.target.value } : item
                            ),
                          }))
                        }
                        rows={7}
                        className="mt-2 rounded-xl border border-stroke bg-card/60 px-3 py-2 text-xs font-mono"
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/60">E) Regras de execução</p>
            <div className="grid gap-3 md:grid-cols-3">
              <Input
                label="Cooldown (min)"
                value={form.cooldownMinutes}
                onChange={(event) => setForm((current) => ({ ...current, cooldownMinutes: event.target.value }))}
              />
              <Input
                label="Prioridade"
                value={form.priority}
                onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
              />
              <Input
                label="Máx execuções/hora (0 = sem limite)"
                value={form.maxExecutionsPerHour}
                onChange={(event) => setForm((current) => ({ ...current, maxExecutionsPerHour: event.target.value }))}
              />
            </div>
          </section>
        </div>
      </Modal>
    </div>
  );
}

