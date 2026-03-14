import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import Card from "../ui/Card.jsx";
import Button from "../ui/Button.jsx";
import { AIClient } from "../features/ai/ai-client.js";
import { AI_ASSISTANT_NAME } from "../features/ai/ai-config.js";
import { useOperationalAI } from "../features/ai/OperationalAIProvider.jsx";
import { buildOperationalSummary, buildPositionIndex, minutesSince, resolveVehicleDeviceIds } from "../features/ai/sentinel-utils.js";
import useVehicles from "../lib/hooks/useVehicles.js";
import { useLivePositions } from "../lib/hooks/useLivePositions";
import useAlerts from "../lib/hooks/useAlerts.js";
import useTasks from "../lib/hooks/useTasks.js";
import useAdminGeneralAccess from "../lib/hooks/useAdminGeneralAccess.js";

const CATEGORY_OPTIONS = [
  { value: "playbook", label: "Playbook operacional" },
  { value: "priority", label: "Regra de prioridade" },
  { value: "glossary", label: "Glossario / nomes" },
  { value: "layout", label: "Como exibir" },
];

export default function SentinelLearningPage() {
  const navigate = useNavigate();
  const { isAdminGeneral } = useAdminGeneralAccess();
  const { registerPageContext, clearPageEntity, setOpen: openOperationalPanel } = useOperationalAI();
  const { vehicles = [] } = useVehicles({ includeTelemetry: false });
  const { data: livePositions = [] } = useLivePositions();
  const { alerts = [] } = useAlerts({ params: { status: "pending" } });
  const { tasks = [] } = useTasks({ status: "open" });
  const [entries, setEntries] = useState([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesError, setEntriesError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(null);
  const [questionsText, setQuestionsText] = useState("");
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [questionsError, setQuestionsError] = useState(null);
  const [form, setForm] = useState({
    category: "playbook",
    title: "",
    content: "",
    routePath: "/sentinel",
  });

  const positionByDeviceId = useMemo(() => buildPositionIndex(livePositions), [livePositions]);
  const totalVehicles = vehicles.length;
  const onlineVehicles = useMemo(
    () =>
      vehicles.filter((vehicle) => {
        const latestPosition = resolveVehicleDeviceIds(vehicle)
          .map((id) => positionByDeviceId.get(String(id)))
          .find(Boolean);
        const stale = minutesSince(latestPosition?.fixTime || latestPosition?.deviceTime || latestPosition?.serverTime);
        return stale !== null && stale <= 15;
      }).length,
    [positionByDeviceId, vehicles],
  );
  const staleVehicles = useMemo(
    () =>
      vehicles.filter((vehicle) => {
        const latestPosition = resolveVehicleDeviceIds(vehicle)
          .map((id) => positionByDeviceId.get(String(id)))
          .find(Boolean);
        const stale = minutesSince(latestPosition?.fixTime || latestPosition?.deviceTime || latestPosition?.serverTime);
        return stale === null || stale > 60;
      }).length,
    [positionByDeviceId, vehicles],
  );
  const operationalSummary = useMemo(
    () =>
      buildOperationalSummary({
        totalVehicles,
        onlineVehicles,
        pendingAlerts: alerts.length,
        openTasks: tasks.length,
        staleVehicles,
      }),
    [alerts.length, onlineVehicles, staleVehicles, tasks.length, totalVehicles],
  );

  useEffect(() => {
    if (!isAdminGeneral) return undefined;
    registerPageContext({
      screen: {
        title: `${AI_ASSISTANT_NAME} • Modo aprendizado`,
        routePath: "/sentinel/learning",
      },
      entity: null,
      filters: null,
    });
    return () => clearPageEntity();
  }, [clearPageEntity, isAdminGeneral, registerPageContext]);

  const loadEntries = useCallback(async () => {
    setEntriesLoading(true);
    setEntriesError(null);
    try {
      const response = await AIClient.listLearningEntries({ routePath: "/sentinel" });
      setEntries(Array.isArray(response?.entries) ? response.entries : []);
    } catch (error) {
      setEntriesError(error?.message || "Falha ao carregar instrucoes do modo aprendizado.");
    } finally {
      setEntriesLoading(false);
    }
  }, []);

  const requestLearningQuestions = useCallback(async () => {
    setQuestionsLoading(true);
    setQuestionsError(null);
    try {
      const response = await AIClient.generateLearningQuestions({
        context: {
          screen: {
            title: `${AI_ASSISTANT_NAME} • Modo aprendizado`,
            routePath: "/sentinel/learning",
          },
          summary: operationalSummary,
        },
      });
      setQuestionsText(response?.response?.text || "Sem perguntas sugeridas.");
    } catch (error) {
      setQuestionsError(error?.message || "Falha ao gerar perguntas de curadoria.");
    } finally {
      setQuestionsLoading(false);
    }
  }, [operationalSummary]);

  useEffect(() => {
    if (!isAdminGeneral) return;
    loadEntries().catch(() => {});
  }, [isAdminGeneral, loadEntries]);

  useEffect(() => {
    if (!isAdminGeneral) return;
    requestLearningQuestions().catch(() => {});
  }, [isAdminGeneral, requestLearningQuestions]);

  if (!isAdminGeneral) {
    return <Navigate to="/sentinel" replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const response = await AIClient.createLearningEntry(form);
      setEntries((current) => [response?.entry, ...current].filter(Boolean));
      setForm((current) => ({ ...current, title: "", content: "" }));
      setSaveSuccess("Instrucao salva. O SENTINEL ja passa a considerar isso nas proximas respostas.");
      requestLearningQuestions().catch(() => {});
    } catch (error) {
      setSaveError(error?.message || "Falha ao salvar instrucao.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-24">
      <section className="overflow-hidden rounded-[28px] border border-cyan-400/15 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_34%),linear-gradient(180deg,rgba(11,18,28,0.96),rgba(7,14,22,0.98))] p-6 shadow-[0_24px_56px_rgba(0,0,0,0.28)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200/85">Admin Euro One</div>
            <h1 className="mt-3 text-3xl font-semibold tracking-[0.02em] text-white sm:text-4xl">Modo aprendizado</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/70">
              Ensine regras de prioridade, nomenclatura, layout e playbooks. O {AI_ASSISTANT_NAME} usa essas instrucoes
              nas proximas respostas, mas continua operando com supervisao humana e sem executar acoes criticas sozinho.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" onClick={() => openOperationalPanel(true)}>
              Abrir chat
            </Button>
            <Button variant="secondary" onClick={() => requestLearningQuestions().catch(() => {})} disabled={questionsLoading}>
              {questionsLoading ? "Pensando..." : "Atualizar perguntas"}
            </Button>
            <Button variant="ghost" onClick={() => navigate("/sentinel")}>
              Voltar ao painel
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <Card
          title="Ensinar o SENTINEL"
          subtitle="Cadastre instrucoes que vao orientar prioridade, terminologia, visual e tratativa operacional."
        >
          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.12em] text-white/45">Categoria</span>
              <select
                value={form.category}
                onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/35"
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.12em] text-white/45">Titulo curto</span>
              <input
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Ex.: Criticidade de alerta conjugado"
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/35"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.12em] text-white/45">Instrucao</span>
              <textarea
                value={form.content}
                onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
                rows={7}
                placeholder="Explique como a IA deve responder, o que significa cada coisa ou como o painel deve priorizar casos."
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/35"
              />
            </label>

            {saveError ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{saveError}</div> : null}
            {saveSuccess ? <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{saveSuccess}</div> : null}

            <Button type="submit" disabled={saving || !String(form.content || "").trim()}>
              {saving ? "Salvando..." : "Salvar instrucao"}
            </Button>
          </form>
        </Card>

        <div className="flex flex-col gap-6">
          <Card
            title="Perguntas que a IA quer validar"
            subtitle="Use isto para refinar o que ela deve perguntar, destacar e como deve organizar a tela."
          >
            {questionsText ? (
              <div className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap rounded-2xl border border-cyan-400/15 bg-[linear-gradient(180deg,rgba(34,211,238,0.10),rgba(7,17,26,0.92))] p-4 text-sm leading-7 text-white/88">
                {questionsText}
              </div>
            ) : (
              <div className="text-sm text-white/60">O {AI_ASSISTANT_NAME} ainda nao abriu perguntas de curadoria para esta tela.</div>
            )}
            {questionsError ? <div className="mt-3 text-sm text-rose-200">{questionsError}</div> : null}
          </Card>

          <Card
            title="Instrucoes ativas"
            subtitle="Estas entradas passam a compor o contexto do copiloto para o fluxo do SENTINEL."
            actions={(
              <Button variant="ghost" onClick={() => loadEntries().catch(() => {})} disabled={entriesLoading}>
                Recarregar
              </Button>
            )}
          >
            {entriesLoading ? (
              <div className="text-sm text-white/60">Carregando instrucoes...</div>
            ) : entries.length ? (
              <div className="max-h-[34rem] space-y-3 overflow-y-auto pr-1">
                {entries.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-white/45">
                      <span>{entry.category}</span>
                      {entry.routePath ? <span>{entry.routePath}</span> : null}
                    </div>
                    {entry.title ? <div className="mt-2 text-sm font-semibold text-white">{entry.title}</div> : null}
                    <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/78">{entry.content}</div>
                    <div className="mt-3 text-xs text-white/45">
                      {entry.createdBy?.name || "Admin Euro One"} • {new Date(entry.createdAt).toLocaleString("pt-BR")}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-white/60">Nenhuma instrucao cadastrada ainda.</div>
            )}
            {entriesError ? <div className="mt-3 text-sm text-rose-200">{entriesError}</div> : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
