import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import SentinelOperationalWorkspace from "./SentinelOperationalWorkspace.jsx";
import { AI_ASSISTANT_NAME } from "./ai-config.js";
import { buildAttentionRows, buildOperationalSummary, buildPositionIndex, minutesSince, resolveVehicleDeviceIds } from "./sentinel-utils.js";

const TOKEN_STORAGE_KEY = "euro-one.session.token";
const USER_STORAGE_KEY = "euro-one.session.user";
const MIRROR_OWNER_STORAGE_KEY = "euro-one.mirror.owner-client-id";
const RESIZE_EVENT_TYPE = "euro-one:sentinel:resize";
const OPEN_CHAT_EVENT_TYPE = "euro-one:sentinel:open-chat";

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

  const generateBriefing = useCallback(async (prompt) => {
    setBriefingLoading(true);
    setBriefingError(null);
    try {
      const response = await apiRequest("ai/chat", {
        method: "POST",
        payload: {
          message: prompt,
          context: {
            screen: {
              title: AI_ASSISTANT_NAME,
              routePath: "/sentinel",
            },
            summary: operationalSummary,
          },
        },
      });
      setBriefing(response?.response?.text || "Sem briefing retornado.");
    } catch (error) {
      setBriefingError(error?.message || "Falha ao gerar briefing do SENTINEL.");
    } finally {
      setBriefingLoading(false);
    }
  }, [operationalSummary]);

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
              ? "Qual prioridade operacional voce recomenda para este caso e por quê?"
              : "Resuma a situacao deste caso, destaque alertas, risco operacional e proximos passos.",
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
          },
        },
      });
      setCaseInsight(response?.response?.text || "Sem leitura operacional retornada.");
    } catch (error) {
      setCaseInsightError(error?.message || "Falha ao analisar o caso.");
    } finally {
      setCaseInsightLoading(false);
    }
  }, [operationalSummary]);

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
