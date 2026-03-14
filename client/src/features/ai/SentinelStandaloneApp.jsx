import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import SentinelOperationalWorkspace from "./SentinelOperationalWorkspace.jsx";
import { AI_ASSISTANT_NAME } from "./ai-config.js";
import { buildAttentionRows, buildOperationalSummary, buildPositionIndex, minutesSince, resolveVehicleDeviceIds } from "./sentinel-utils.js";
import Card from "../../ui/Card.jsx";
import Button from "../../ui/Button.jsx";

const TOKEN_STORAGE_KEY = "euro-one.session.token";
const USER_STORAGE_KEY = "euro-one.session.user";
const MIRROR_OWNER_STORAGE_KEY = "euro-one.mirror.owner-client-id";
const LEARNING_STORAGE_KEY = "euro-one:sentinel:learning:v1";
const RESIZE_EVENT_TYPE = "euro-one:sentinel:resize";
const OPEN_CHAT_EVENT_TYPE = "euro-one:sentinel:open-chat";
const APP_MODE_PARAM = "mode";

function getStoredSession() {
  try {
    const token = window.localStorage?.getItem(TOKEN_STORAGE_KEY) || null;
    const rawUser = window.localStorage?.getItem(USER_STORAGE_KEY);
    return {
      token,
      user: rawUser ? JSON.parse(rawUser) : null,
    };
  } catch (_error) {
    return { token: null, user: null };
  }
}

function getCurrentMode() {
  try {
    const mode = new URLSearchParams(window.location.search).get(APP_MODE_PARAM);
    return mode === "learning" ? "learning" : "operations";
  } catch (_error) {
    return "operations";
  }
}

function normalizeCompanyName(user) {
  return String(
    user?.client?.name ||
      user?.clientName ||
      user?.tenantName ||
      user?.attributes?.companyName ||
      user?.attributes?.tenantName ||
      "",
  )
    .trim()
    .toUpperCase();
}

function isEuroOneAdmin(user) {
  return user?.role === "admin" && normalizeCompanyName(user) === "EURO ONE";
}

function readLearningEntries() {
  try {
    const raw = window.localStorage?.getItem(LEARNING_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (_error) {
    return [];
  }
}

function writeLearningEntries(entries) {
  try {
    window.localStorage?.setItem(LEARNING_STORAGE_KEY, JSON.stringify(entries || []));
  } catch (_error) {
    // ignore
  }
}

function buildLearningContext(entries) {
  if (!Array.isArray(entries) || !entries.length) return "";
  return entries
    .map((entry, index) => {
      const category = String(entry?.category || "instrucao").trim();
      const title = String(entry?.title || `Instrucao ${index + 1}`).trim();
      const content = String(entry?.content || "").trim();
      if (!content) return null;
      return `${index + 1}. [${category}] ${title}: ${content}`;
    })
    .filter(Boolean)
    .join("\n");
}

function buildLearningQuestionFallback({ summary, entries }) {
  const questions = [];
  if (!entries.length) {
    questions.push("Quais criterios definem quando um alerta deve subir como critico?");
    questions.push("Como voce quer que o SENTINEL organize a fila operacional na tela?");
  }
  if (summary?.pendingAlerts > 0) {
    questions.push("Quando houver multiplos alertas no mesmo veiculo, qual deve ser a regra de prioridade?");
  }
  if (summary?.staleVehicles > 0) {
    questions.push("Como diferenciar comunicacao degradada de um caso realmente suspeito?");
  }
  questions.push("Existe alguma nomenclatura operacional que o SENTINEL precisa adotar nas respostas?");
  return questions.slice(0, 4).join("\n");
}

function resolveMirrorOwnerClientId(session) {
  if (session?.user?.role === "admin") return null;
  const mirrorMode = session?.user?.mirrorContextMode ?? null;
  if (mirrorMode && mirrorMode !== "target") return null;
  const sessionOwnerId = session?.user?.activeMirrorOwnerClientId ?? null;
  if (sessionOwnerId !== null && sessionOwnerId !== undefined) {
    const normalizedSessionOwnerId = String(sessionOwnerId).trim().replace(/;+$/, "");
    if (normalizedSessionOwnerId) return normalizedSessionOwnerId;
  }
  try {
    const storedOwnerId =
      window.sessionStorage?.getItem(MIRROR_OWNER_STORAGE_KEY) ||
      window.localStorage?.getItem(MIRROR_OWNER_STORAGE_KEY) ||
      null;
    return storedOwnerId ? String(storedOwnerId).trim() : null;
  } catch (_error) {
    return null;
  }
}

function getApiBaseUrl() {
  const { hostname, protocol, host } = window.location;
  if (["localhost", "127.0.0.1"].includes(hostname)) {
    return "http://localhost:3001/api";
  }
  return `${protocol}//${host}/api`;
}

function buildUrl(pathname, params) {
  const url = new URL(String(pathname || "").replace(/^\/+/, ""), `${getApiBaseUrl().replace(/\/$/, "")}/`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, item));
      return;
    }
    url.searchParams.set(key, value);
  });
  return url.toString();
}

function normalizeListPayload(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.vehicles)) return payload.vehicles;
  if (Array.isArray(payload?.devices)) return payload.devices;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  const firstArray = typeof payload === "object" ? Object.values(payload).find(Array.isArray) : null;
  return Array.isArray(firstArray) ? firstArray : [];
}

function normalizeAlertsPayload(payload) {
  if (Array.isArray(payload?.alerts)) return payload.alerts;
  return normalizeListPayload(payload);
}

function normalizeTasksPayload(payload) {
  if (Array.isArray(payload?.tasks)) return payload.tasks;
  return normalizeListPayload(payload);
}

function authHeaders() {
  const session = getStoredSession();
  const headers = new Headers({ Accept: "application/json" });
  if (session?.token) {
    headers.set("Authorization", /^Bearer /i.test(session.token) ? session.token : `Bearer ${session.token}`);
  }
  const mirrorOwnerClientId = resolveMirrorOwnerClientId(session);
  if (mirrorOwnerClientId) {
    headers.set("X-Owner-Client-Id", mirrorOwnerClientId);
    headers.set("X-Mirror-Mode", "target");
  } else {
    headers.set("X-Mirror-Mode", "self");
  }
  return headers;
}

function deriveTenantParams() {
  const session = getStoredSession();
  const mirrorOwnerClientId = resolveMirrorOwnerClientId(session);
  if (mirrorOwnerClientId) {
    return { clientId: mirrorOwnerClientId };
  }
  const user = session?.user || {};
  const tenantId = user?.tenantId ?? user?.clientId ?? null;
  return tenantId ? { clientId: tenantId } : {};
}

async function apiRequest(pathname, { method = "GET", params, payload } = {}) {
  const response = await fetch(buildUrl(pathname, params), {
    method,
    credentials: "include",
    headers: (() => {
      const headers = authHeaders();
      if (payload !== undefined && payload !== null) {
        headers.set("Content-Type", "application/json");
      }
      return headers;
    })(),
    body: payload !== undefined && payload !== null ? JSON.stringify(payload) : undefined,
  });

  let data = null;
  try {
    data = await response.clone().json();
  } catch (_error) {
    data = await response.text().catch(() => null);
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error?.message ||
      data?.error ||
      response.statusText ||
      "Falha na requisicao";
    const error = new Error(message);
    error.status = response.status;
    error.body = data;
    throw error;
  }

  return data;
}

async function listAllAccessibleVehicles(params = {}) {
  const vehicles = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const payload = await apiRequest("core/vehicles", {
      params: { ...params, accessible: true, skipPositions: true, page, pageSize: 100 },
    });
    const currentPage = normalizeListPayload(payload);
    vehicles.push(...currentPage);
    hasMore = Boolean(payload?.hasMore) && currentPage.length > 0;
    page += 1;
    if (page > 200) break;
  }

  return vehicles;
}

async function loadOperationalBundle() {
  const tenantParams = deriveTenantParams();
  const [vehicles, positionsPayload, alertsPayload, tasksPayload] = await Promise.all([
    listAllAccessibleVehicles(tenantParams).catch(() => []),
    apiRequest("positions/last", { params: tenantParams }).catch(() => []),
    apiRequest("alerts/conjugated/pending", { params: tenantParams }).catch(() => []),
    apiRequest("core/tasks", { params: tenantParams }).catch(() => []),
  ]);

  return {
    vehicles: Array.isArray(vehicles) ? vehicles : [],
    positions: normalizeListPayload(positionsPayload),
    alerts: normalizeAlertsPayload(alertsPayload),
    tasks: normalizeTasksPayload(tasksPayload),
  };
}

function postParentMessage(type, payload = {}) {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type, ...payload }, window.location.origin);
    }
  } catch (_error) {
    // ignore
  }
}

function navigateTop(pathname) {
  try {
    if (window.top && window.top !== window) {
      window.top.location.assign(pathname);
      return;
    }
  } catch (_error) {
    // ignore
  }
  window.location.assign(pathname);
}

function useParentHeightBridge(rootRef) {
  useEffect(() => {
    if (!rootRef.current || typeof ResizeObserver === "undefined") return undefined;
    const publish = () => {
      const height = Math.max(720, Math.ceil(rootRef.current?.scrollHeight || document.body?.scrollHeight || 720));
      postParentMessage(RESIZE_EVENT_TYPE, { height });
    };
    publish();
    const observer = new ResizeObserver(() => publish());
    observer.observe(rootRef.current);
    window.addEventListener("resize", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
    };
  }, [rootRef]);
}

function SentinelStandaloneApp() {
  const containerRef = useRef(null);
  const session = useMemo(() => getStoredSession(), []);
  const isLearningMode = useMemo(() => getCurrentMode() === "learning", []);
  const canManageLearning = useMemo(() => isEuroOneAdmin(session?.user), [session]);
  const [bundle, setBundle] = useState({ vehicles: [], positions: [], alerts: [], tasks: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [briefing, setBriefing] = useState("");
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState(null);
  const [selectedRowId, setSelectedRowId] = useState(null);
  const [caseInsight, setCaseInsight] = useState("");
  const [caseInsightLoading, setCaseInsightLoading] = useState(false);
  const [caseInsightError, setCaseInsightError] = useState(null);
  const [learningEntries, setLearningEntries] = useState(() => readLearningEntries());
  const [learningForm, setLearningForm] = useState({ category: "playbook", title: "", content: "" });
  const [learningSaved, setLearningSaved] = useState("");
  const [learningQuestions, setLearningQuestions] = useState("");
  const [learningQuestionsLoading, setLearningQuestionsLoading] = useState(false);
  const [learningQuestionsError, setLearningQuestionsError] = useState(null);

  useParentHeightBridge(containerRef);

  const refreshBundle = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const next = await loadOperationalBundle();
      setBundle(next);
    } catch (error) {
      setLoadError(error?.message || "Falha ao carregar o painel operacional.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshBundle().catch(() => {});
    const timer = window.setInterval(() => refreshBundle().catch(() => {}), 30000);
    return () => window.clearInterval(timer);
  }, [refreshBundle]);

  const positionByDeviceId = useMemo(() => buildPositionIndex(bundle.positions), [bundle.positions]);
  const totalVehicles = bundle.vehicles.length;
  const onlineVehicles = useMemo(
    () =>
      bundle.vehicles.filter((vehicle) => {
        const latestPosition = resolveVehicleDeviceIds(vehicle)
          .map((id) => positionByDeviceId.get(String(id)))
          .find(Boolean);
        const stale = minutesSince(latestPosition?.fixTime || latestPosition?.deviceTime || latestPosition?.serverTime);
        return stale !== null && stale <= 15;
      }).length,
    [bundle.vehicles, positionByDeviceId],
  );
  const staleVehicles = useMemo(
    () =>
      bundle.vehicles.filter((vehicle) => {
        const latestPosition = resolveVehicleDeviceIds(vehicle)
          .map((id) => positionByDeviceId.get(String(id)))
          .find(Boolean);
        const stale = minutesSince(latestPosition?.fixTime || latestPosition?.deviceTime || latestPosition?.serverTime);
        return stale === null || stale > 60;
      }).length,
    [bundle.vehicles, positionByDeviceId],
  );
  const pendingAlerts = bundle.alerts.length;
  const openTasks = bundle.tasks.length;
  const operationalSummary = useMemo(
    () => buildOperationalSummary({ totalVehicles, onlineVehicles, pendingAlerts, openTasks, staleVehicles }),
    [openTasks, onlineVehicles, pendingAlerts, staleVehicles, totalVehicles],
  );
  const learningContext = useMemo(() => buildLearningContext(learningEntries), [learningEntries]);
  const attentionRows = useMemo(
    () => buildAttentionRows({ vehicles: bundle.vehicles, positionByDeviceId, alerts: bundle.alerts }),
    [bundle.alerts, bundle.vehicles, positionByDeviceId],
  );
  const selectedRow = useMemo(
    () => attentionRows.find((row) => String(row.vehicleId) === String(selectedRowId)) || attentionRows[0] || null,
    [attentionRows, selectedRowId],
  );

  useEffect(() => {
    if (!selectedRowId && attentionRows[0]?.vehicleId) {
      setSelectedRowId(attentionRows[0].vehicleId);
    }
  }, [attentionRows, selectedRowId]);

  useEffect(() => {
    writeLearningEntries(learningEntries);
  }, [learningEntries]);

  const generateBriefing = useCallback(async (prompt) => {
    setBriefingLoading(true);
    setBriefingError(null);
    try {
      const response = await apiRequest("ai/chat", {
        method: "POST",
        payload: {
          message: learningContext
            ? `${prompt}\n\nConsidere estas instrucoes persistidas do modo aprendizado antes de responder:\n${learningContext}`
            : prompt,
          context: {
            screen: {
              title: AI_ASSISTANT_NAME,
              routePath: "/sentinel",
            },
            summary: operationalSummary,
            learningNotes: learningContext || null,
          },
        },
      });
      setBriefing(response?.response?.text || "Sem briefing retornado.");
    } catch (error) {
      setBriefingError(error?.message || "Falha ao gerar briefing do SENTINEL.");
    } finally {
      setBriefingLoading(false);
    }
  }, [learningContext, operationalSummary]);

  const analyzeCase = useCallback(async (mode, row) => {
    if (!row?.vehicleId && !row?.plate) return;
    setCaseInsightLoading(true);
    setCaseInsightError(null);
    try {
      const response = await apiRequest(mode === "priority" ? "ai/prioritize-alert" : "ai/chat", {
        method: "POST",
        payload: {
          message:
            mode === "priority"
              ? `${learningContext ? `Considere estas instrucoes persistidas do modo aprendizado:\n${learningContext}\n\n` : ""}Qual prioridade operacional voce recomenda para este caso e por que?`
              : `${learningContext ? `Considere estas instrucoes persistidas do modo aprendizado:\n${learningContext}\n\n` : ""}Resuma a situacao deste caso, destaque alertas, risco operacional e proximos passos.`,
          context: {
            screen: {
              title: AI_ASSISTANT_NAME,
              routePath: "/sentinel",
            },
            entity: {
              entityType: "vehicle",
              entityId: row.vehicleId,
              plate: row.plate,
              label: row.name,
            },
            summary: operationalSummary,
            learningNotes: learningContext || null,
          },
        },
      });
      setCaseInsight(response?.response?.text || "Sem leitura operacional retornada.");
    } catch (error) {
      setCaseInsightError(error?.message || "Falha ao analisar o caso.");
    } finally {
      setCaseInsightLoading(false);
    }
  }, [learningContext, operationalSummary]);

  const refreshLearningQuestions = useCallback(async () => {
    setLearningQuestionsLoading(true);
    setLearningQuestionsError(null);
    try {
      const fallback = buildLearningQuestionFallback({
        summary: { pendingAlerts, staleVehicles },
        entries: learningEntries,
      });
      const response = await apiRequest("ai/chat", {
        method: "POST",
        payload: {
          message: [
            "Voce esta no modo aprendizado do SENTINEL.",
            "Gere de 3 a 5 perguntas curtas para o admin ensinar melhor regras operacionais, terminologia e layout.",
            "Use tom objetivo e faca perguntas acionaveis.",
            learningContext ? `Ja existe este conhecimento persistido:\n${learningContext}` : "Ainda nao existe conhecimento persistido.",
            `Contexto operacional atual: ${operationalSummary}.`,
            `Se faltar dado, use este fallback como referencia:\n${fallback}`,
          ].join("\n\n"),
          context: {
            screen: {
              title: `${AI_ASSISTANT_NAME} • Modo aprendizado`,
              routePath: "/sentinel/learning",
            },
            summary: operationalSummary,
            learningNotes: learningContext || null,
          },
        },
      }).catch(() => null);
      setLearningQuestions(response?.response?.text || fallback);
    } catch (error) {
      setLearningQuestionsError(error?.message || "Falha ao gerar perguntas do modo aprendizado.");
      setLearningQuestions(buildLearningQuestionFallback({ summary: { pendingAlerts, staleVehicles }, entries: learningEntries }));
    } finally {
      setLearningQuestionsLoading(false);
    }
  }, [learningContext, learningEntries, operationalSummary, pendingAlerts, staleVehicles]);

  useEffect(() => {
    if (!isLearningMode || !canManageLearning) return;
    refreshLearningQuestions().catch(() => {});
  }, [canManageLearning, isLearningMode, refreshLearningQuestions]);

  const saveLearningInstruction = useCallback(
    (event) => {
      event.preventDefault();
      const title = String(learningForm.title || "").trim();
      const content = String(learningForm.content || "").trim();
      if (!content) return;
      const nextEntry = {
        id: `${Date.now()}`,
        category: learningForm.category,
        title: title || "Instrucao operacional",
        content,
        createdAt: new Date().toISOString(),
      };
      setLearningEntries((current) => [nextEntry, ...current].slice(0, 50));
      setLearningForm((current) => ({ ...current, title: "", content: "" }));
      setLearningSaved("Instrucao salva. O SENTINEL passa a considerar isso nas proximas leituras desta sessao.");
      window.setTimeout(() => setLearningSaved(""), 3500);
      window.setTimeout(() => refreshLearningQuestions().catch(() => {}), 100);
    },
    [learningForm, refreshLearningQuestions],
  );

  if (isLearningMode) {
    return (
      <div ref={containerRef} className="sentinel-app">
        <section className="overflow-hidden rounded-[28px] border border-cyan-400/15 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_34%),linear-gradient(180deg,rgba(11,18,28,0.96),rgba(7,14,22,0.98))] p-6 shadow-[0_24px_56px_rgba(0,0,0,0.28)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200/85">Admin Euro One</div>
              <h1 className="mt-3 text-3xl font-semibold tracking-[0.02em] text-white sm:text-4xl">Modo aprendizado</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-white/70">
                Ensine prioridade, nomenclatura e formato de exibicao. O SENTINEL usa essas instrucoes nas proximas respostas
                e continua operando com supervisao humana.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="ghost" onClick={() => navigateTop("/sentinel")}>
                Voltar ao painel
              </Button>
              <Button variant="secondary" onClick={() => refreshLearningQuestions().catch(() => {})} disabled={learningQuestionsLoading}>
                {learningQuestionsLoading ? "Pensando..." : "Atualizar perguntas"}
              </Button>
            </div>
          </div>
        </section>

        {!canManageLearning ? (
          <Card title="Acesso restrito" subtitle="Este modo fica visivel apenas para admin Euro One.">
            <div className="text-sm text-white/70">Abra o painel operacional normal ou entre com um usuario admin da Euro One.</div>
          </Card>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <Card title="Ensinar o SENTINEL" subtitle="Cadastre instrucoes que orientam prioridade, terminologia, layout e tratativa operacional.">
              <form className="space-y-4" onSubmit={saveLearningInstruction}>
                <label className="block space-y-2">
                  <span className="text-xs uppercase tracking-[0.12em] text-white/45">Categoria</span>
                  <select
                    value={learningForm.category}
                    onChange={(event) => setLearningForm((current) => ({ ...current, category: event.target.value }))}
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/35"
                  >
                    <option value="playbook">Playbook operacional</option>
                    <option value="priority">Regra de prioridade</option>
                    <option value="glossary">Glossario / nomes</option>
                    <option value="layout">Como exibir</option>
                  </select>
                </label>

                <label className="block space-y-2">
                  <span className="text-xs uppercase tracking-[0.12em] text-white/45">Titulo curto</span>
                  <input
                    value={learningForm.title}
                    onChange={(event) => setLearningForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Ex.: Criticidade de alerta conjugado"
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/35"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-xs uppercase tracking-[0.12em] text-white/45">Instrucao</span>
                  <textarea
                    value={learningForm.content}
                    onChange={(event) => setLearningForm((current) => ({ ...current, content: event.target.value }))}
                    rows={7}
                    placeholder="Explique como a IA deve responder, o que significa cada coisa ou como a tela deve priorizar os casos."
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/35"
                  />
                </label>

                {learningSaved ? (
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{learningSaved}</div>
                ) : null}

                <Button type="submit" disabled={!String(learningForm.content || "").trim()}>
                  Salvar instrucao
                </Button>
              </form>
            </Card>

            <div className="flex flex-col gap-6">
              <Card title="Perguntas do SENTINEL" subtitle="A IA te pergunta o que ainda precisa aprender para melhorar a operacao.">
                <div className="rounded-2xl border border-cyan-400/15 bg-[linear-gradient(180deg,rgba(34,211,238,0.10),rgba(7,17,26,0.92))] p-4">
                  {learningQuestionsLoading ? (
                    <div className="text-sm text-cyan-100/80">O SENTINEL esta preparando as proximas perguntas...</div>
                  ) : (
                    <div className="whitespace-pre-wrap text-sm leading-7 text-white/88">
                      {learningQuestions || "Sem perguntas novas no momento."}
                    </div>
                  )}
                  {learningQuestionsError ? <div className="mt-3 text-sm text-rose-200">{learningQuestionsError}</div> : null}
                </div>
              </Card>

              <Card title="Conhecimento persistido" subtitle="Estas instrucoes passam a ser consideradas nas proximas respostas do SENTINEL neste navegador.">
                {learningEntries.length ? (
                  <div className="max-h-[34rem] space-y-3 overflow-y-auto pr-1">
                    {learningEntries.map((entry) => (
                      <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-white">{entry.title}</div>
                            <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-cyan-200/75">{entry.category}</div>
                          </div>
                          <button
                            type="button"
                            className="text-xs text-white/45 transition hover:text-white"
                            onClick={() => setLearningEntries((current) => current.filter((item) => item.id !== entry.id))}
                          >
                            Remover
                          </button>
                        </div>
                        <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-white/78">{entry.content}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-white/60">Nenhuma instrucao salva ainda.</div>
                )}
              </Card>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="sentinel-app">
      <SentinelOperationalWorkspace
        assistantName={AI_ASSISTANT_NAME}
        loading={loading}
        loadError={loadError}
        totalVehicles={totalVehicles}
        onlineVehicles={onlineVehicles}
        pendingAlerts={pendingAlerts}
        openTasks={openTasks}
        staleVehicles={staleVehicles}
        attentionRows={attentionRows}
        selectedRow={selectedRow}
        briefing={briefing}
        briefingLoading={briefingLoading}
        briefingError={briefingError}
        caseInsight={caseInsight}
        caseInsightLoading={caseInsightLoading}
        caseInsightError={caseInsightError}
        onOpenChat={() => postParentMessage(OPEN_CHAT_EVENT_TYPE)}
        onRefresh={() => refreshBundle().catch(() => {})}
        onGenerateBriefing={generateBriefing}
        onAnalyzeCase={analyzeCase}
        onSelectRow={(row) => {
          setSelectedRowId(row?.vehicleId || null);
          setCaseInsight("");
          setCaseInsightError(null);
        }}
      />
    </div>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Elemento root do SENTINEL nao encontrado");
}

createRoot(root).render(<SentinelStandaloneApp />);
