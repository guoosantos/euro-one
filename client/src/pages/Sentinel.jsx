import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import Button from "../ui/Button.jsx";
import { useOperationalAI } from "../features/ai/OperationalAIProvider.jsx";
import { AIClient } from "../features/ai/ai-client.js";
import { AI_ASSISTANT_NAME } from "../features/ai/ai-config.js";
import SentinelOperationalWorkspace from "../features/ai/SentinelOperationalWorkspace.jsx";
import { buildAttentionRows, buildOperationalSummary, buildPositionIndex, minutesSince, resolveVehicleDeviceIds } from "../features/ai/sentinel-utils.js";
import useVehicles from "../lib/hooks/useVehicles.js";
import { useLivePositions } from "../lib/hooks/useLivePositions";
import useAlerts from "../lib/hooks/useAlerts.js";
import useTasks from "../lib/hooks/useTasks.js";
import useAdminGeneralAccess from "../lib/hooks/useAdminGeneralAccess.js";

export default function SentinelPage() {
  const navigate = useNavigate();
  const { isAdminGeneral } = useAdminGeneralAccess();
  const { vehicles = [], loading: vehiclesLoading } = useVehicles({ includeTelemetry: false });
  const { data: livePositions = [], loading: positionsLoading } = useLivePositions();
  const { alerts = [], loading: alertsLoading } = useAlerts({ params: { status: "pending" } });
  const { tasks = [], loading: tasksLoading } = useTasks({ status: "open" });
  const { registerPageContext, clearPageEntity, setOpen: openOperationalPanel } = useOperationalAI();
  const [briefing, setBriefing] = useState("");
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState(null);
  const [selectedRowId, setSelectedRowId] = useState(null);
  const [caseInsight, setCaseInsight] = useState("");
  const [caseInsightLoading, setCaseInsightLoading] = useState(false);
  const [caseInsightError, setCaseInsightError] = useState(null);

  const loading = vehiclesLoading || positionsLoading || alertsLoading || tasksLoading;
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
  const pendingAlerts = alerts.length;
  const openTasks = tasks.length;
  const operationalSummary = useMemo(
    () => buildOperationalSummary({ totalVehicles, onlineVehicles, pendingAlerts, openTasks, staleVehicles }),
    [openTasks, onlineVehicles, pendingAlerts, staleVehicles, totalVehicles],
  );
  const attentionRows = useMemo(
    () => buildAttentionRows({ vehicles, positionByDeviceId, alerts }),
    [alerts, positionByDeviceId, vehicles],
  );
  const selectedRow = useMemo(
    () => attentionRows.find((row) => String(row.vehicleId) === String(selectedRowId)) || attentionRows[0] || null,
    [attentionRows, selectedRowId],
  );

  useEffect(() => {
    registerPageContext({
      screen: {
        title: AI_ASSISTANT_NAME,
        routePath: "/sentinel",
      },
      entity: selectedRow
        ? {
            entityType: "vehicle",
            entityId: selectedRow.vehicleId,
            plate: selectedRow.plate,
            label: selectedRow.name,
          }
        : null,
      filters: {
        totalVehicles,
        onlineVehicles,
        pendingAlerts,
        openTasks,
      },
    });
  }, [openTasks, onlineVehicles, pendingAlerts, registerPageContext, selectedRow, totalVehicles]);

  useEffect(() => () => clearPageEntity(), [clearPageEntity]);

  useEffect(() => {
    if (!selectedRowId && attentionRows[0]?.vehicleId) {
      setSelectedRowId(attentionRows[0].vehicleId);
    }
  }, [attentionRows, selectedRowId]);

  const generateBriefing = async (prompt) => {
    setBriefingLoading(true);
    setBriefingError(null);
    try {
      const response = await AIClient.chat({
        message: prompt,
        context: {
          screen: {
            title: AI_ASSISTANT_NAME,
            routePath: "/sentinel",
          },
          summary: operationalSummary,
        },
      });
      setBriefing(response?.response?.text || "Sem briefing retornado.");
    } catch (error) {
      setBriefingError(error?.message || "Falha ao gerar briefing do SENTINEL.");
    } finally {
      setBriefingLoading(false);
    }
  };

  const analyzeCase = async (mode, row) => {
    if (!row?.vehicleId && !row?.plate) return;
    setCaseInsightLoading(true);
    setCaseInsightError(null);
    try {
      const payload = {
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
      };
      const response = mode === "priority"
        ? await AIClient.prioritizeAlert(payload)
        : await AIClient.chat(payload);
      setCaseInsight(response?.response?.text || "Sem leitura operacional retornada.");
    } catch (error) {
      setCaseInsightError(error?.message || "Falha ao analisar o caso.");
    } finally {
      setCaseInsightLoading(false);
    }
  };

  return (
    <SentinelOperationalWorkspace
      assistantName={AI_ASSISTANT_NAME}
      loading={loading}
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
      onOpenChat={() => openOperationalPanel(true)}
      onRefresh={() => {
        navigate(0);
      }}
      onGenerateBriefing={generateBriefing}
      onAnalyzeCase={analyzeCase}
      onSelectRow={(row) => {
        setSelectedRowId(row?.vehicleId || null);
        setCaseInsight("");
        setCaseInsightError(null);
      }}
      onOpenMonitoring={(row) => navigate(`/monitoring?vehicleId=${row.vehicleId}`)}
      learningAction={isAdminGeneral ? (
        <Button variant="ghost" onClick={() => navigate("/sentinel/learning")}>
          Modo aprendizado
        </Button>
      ) : null}
    />
  );
}

