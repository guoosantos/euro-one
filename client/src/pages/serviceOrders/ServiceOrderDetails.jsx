import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Camera } from "lucide-react";

import PageHeader from "../../components/ui/PageHeader.jsx";
import DataCard from "../../components/ui/DataCard.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import PageToast from "../../components/ui/PageToast.jsx";
import MediaViewerModal from "../../components/media/MediaViewerModal.jsx";
import VideoMediaPlayer from "../../components/media/VideoMediaPlayer.jsx";
import api from "../../lib/api.js";
import usePageToast from "../../lib/hooks/usePageToast.js";
import { usePermissionGate } from "../../lib/permissions/permission-gate.js";
import { useTenant } from "../../lib/tenant-context.jsx";
import { buildEquipmentDisplayLabel, splitEquipmentText } from "../../lib/equipment-display.js";

const STATUS_OPTIONS = [
  "SOLICITADA",
  "AGENDADA",
  "EM_DESLOCAMENTO",
  "EM_EXECUCAO",
  "AGUARDANDO_APROVACAO",
  "PENDENTE_APROVACAO_ADMIN",
  "EM_RETRABALHO",
  "REENVIADA_PARA_APROVACAO",
  "APROVADA",
  "CONCLUIDA",
  "CANCELADA",
  "REMANEJADA",
];

const QUICK_ACTIONS = [
  { label: "Marcar como AGENDADA", status: "AGENDADA" },
  { label: "Marcar como EM DESLOCAMENTO", status: "EM_DESLOCAMENTO" },
  { label: "Marcar como EM EXECUÇÃO", status: "EM_EXECUCAO" },
  { label: "Marcar como PENDENTE_APROVACAO_ADMIN", status: "PENDENTE_APROVACAO_ADMIN" },
  { label: "Marcar como EM RETRABALHO", status: "EM_RETRABALHO" },
  { label: "Cancelar OS", status: "CANCELADA", tone: "danger" },
];
const APP_TIMEZONE = "America/Sao_Paulo";

function parseApiDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  let normalized = raw;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(normalized)) {
    normalized = normalized.replace(" ", "T");
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(normalized)) {
    normalized = `${normalized}Z`;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toLocalInput(value) {
  if (!value) return "";
  const date = parseApiDate(value);
  if (!date) return "";
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = parseApiDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: APP_TIMEZONE,
  }).format(date);
}

async function resolveApiErrorMessage(error, fallbackMessage) {
  const fallback = fallbackMessage || "Falha na requisição.";
  const responseData = error?.response?.data;
  if (responseData instanceof Blob) {
    try {
      const text = await responseData.text();
      if (!text) return fallback;
      const parsed = JSON.parse(text);
      return parsed?.error?.message || parsed?.message || fallback;
    } catch (_parseError) {
      return fallback;
    }
  }
  return responseData?.error?.message || responseData?.message || error?.message || fallback;
}

function normalizeStatusValue(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeStatusTimelineEntries(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const status = normalizeStatusValue(entry.status);
      const at = entry.at || entry.updatedAt || entry.createdAt || null;
      if (!status || !at) return null;
      return {
        status,
        at,
        source: String(entry.source || "").trim() || null,
        by: String(entry.by || entry.userId || entry.userName || "").trim() || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
}

function buildStatusDateMap(item, workflow) {
  const map = new Map();
  const setDate = (status, value) => {
    const normalizedStatus = normalizeStatusValue(status);
    if (!normalizedStatus || !value) return;
    const parsedDate = parseApiDate(value);
    if (!parsedDate) return;
    const parsed = parsedDate.getTime();
    const prevValue = map.get(normalizedStatus);
    const prevParsedDate = prevValue ? parseApiDate(prevValue) : null;
    const prevParsed = prevParsedDate ? prevParsedDate.getTime() : null;
    if (!prevParsed || parsed >= prevParsed) {
      map.set(normalizedStatus, new Date(parsed).toISOString());
    }
  };

  normalizeStatusTimelineEntries(workflow?.statusTimeline).forEach((entry) => {
    setDate(entry.status, entry.at);
  });
  setDate("SOLICITADA", item?.createdAt);
  setDate("AGENDADA", item?.startAt);
  setDate("EM_DESLOCAMENTO", workflow?.startAddress?.capturedAt);
  setDate("EM_EXECUCAO", workflow?.serviceAddress?.capturedAt || item?.startAt);
  if (workflow?.finalizationRequestedAt) {
    setDate("AGUARDANDO_APROVACAO", workflow.finalizationRequestedAt);
    setDate("PENDENTE_APROVACAO_ADMIN", workflow.finalizationRequestedAt);
    setDate("REENVIADA_PARA_APROVACAO", workflow.finalizationRequestedAt);
  }
  if (workflow?.adminReview?.reviewedAt) {
    const decision = normalizeStatusValue(workflow?.adminReview?.decision);
    if (decision === "REWORK_REQUIRED") {
      setDate("EM_RETRABALHO", workflow.adminReview.reviewedAt);
    }
    if (decision === "APPROVED") {
      setDate("APROVADA", workflow?.approvedAt || workflow.adminReview.reviewedAt);
      setDate("CONCLUIDA", workflow?.approvedAt || workflow.adminReview.reviewedAt);
    }
  }
  setDate("CONCLUIDA", item?.endAt);
  setDate(item?.status, item?.updatedAt);
  return map;
}

function toMediaSource(value) {
  if (!value || typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text;
}

function buildMediaItems(item) {
  const medias = [];
  const addMedia = ({
    key,
    title,
    type,
    src,
    status = "READY",
    origin = "OTHER",
    phase = "GENERAL",
    targetType = "OS",
    targetId = null,
  }) => {
    const source = toMediaSource(src);
    if (!source) return;
    medias.push({ key, title, type, src: source, status, origin, phase, targetType, targetId });
  };

  const equipments = Array.isArray(item?.equipmentsData) ? item.equipmentsData : [];
  equipments.forEach((equipment, index) => {
    const label = buildEquipmentDisplayLabel(equipment, index);
    const equipmentId = equipment?.equipmentId || equipment?.id || `equipment-${index + 1}`;
    addMedia({
      key: `eq-start-${index}`,
      title: `${label} • Foto inicial`,
      type: "image",
      src: equipment?.startPhoto || equipment?.beforePhoto || equipment?.photo,
      origin: "EQUIPMENT_INITIAL",
      phase: "BEFORE",
      targetType: "EQUIPMENT",
      targetId: equipmentId,
    });
    addMedia({
      key: `eq-installed-${index}`,
      title: `${label} • Instalado`,
      type: "image",
      src: equipment?.installationPhoto || equipment?.installedPhoto || equipment?.afterPhoto,
      origin: "EQUIPMENT_INSTALLED",
      phase: "AFTER",
      targetType: "EQUIPMENT",
      targetId: equipmentId,
    });
    addMedia({
      key: `eq-video-${index}`,
      title: `${label} • Vídeo`,
      type: "video",
      src: equipment?.installationVideo || equipment?.installedVideo || equipment?.video,
      status: equipment?.installationVideoStatus || equipment?.videoStatus || "READY",
      origin: "EQUIPMENT_VIDEO",
      phase: "AFTER",
      targetType: "EQUIPMENT",
      targetId: equipmentId,
    });
  });

  const checklist = Array.isArray(item?.checklistItems) ? item.checklistItems : [];
  checklist.forEach((entry, index) => {
    const checklistItem = entry?.item || `Checklist ${index + 1}`;
    addMedia({
      key: `check-before-${index}`,
      title: `${checklistItem} • Antes`,
      type: "image",
      src: entry?.beforePhoto,
      origin: "CHECKLIST_BEFORE",
      phase: "BEFORE",
      targetType: "CHECKLIST_ITEM",
      targetId: checklistItem,
    });
    addMedia({
      key: `check-after-${index}`,
      title: `${checklistItem} • Depois`,
      type: "image",
      src: entry?.afterPhoto,
      origin: "CHECKLIST_AFTER",
      phase: "AFTER",
      targetType: "CHECKLIST_ITEM",
      targetId: checklistItem,
    });
  });

  const dedupedBySource = new Map();
  medias.forEach((entry) => {
    if (!dedupedBySource.has(entry.src)) {
      dedupedBySource.set(entry.src, entry);
    }
  });
  return Array.from(dedupedBySource.values());
}

function mapPayload(formState) {
  return {
    osInternalId: formState.osInternalId,
    vehiclePlate: formState.vehiclePlate,
    clientName: formState.clientName,
    type: formState.type,
    status: formState.status,
    startAt: formState.startAt ? new Date(formState.startAt).toISOString() : null,
    endAt: formState.endAt ? new Date(formState.endAt).toISOString() : null,
    technicianName: formState.technicianName,
    responsibleName: formState.responsibleName,
    responsiblePhone: formState.responsiblePhone,
    address: formState.address,
    reason: formState.reason,
    notes: formState.notes,
    equipmentsText: formState.equipmentsText,
    serial: formState.serial,
    externalRef: formState.externalRef,
    km: formState.km,
  };
}

function normalizeWorkflow(signatures) {
  if (!signatures || typeof signatures !== "object" || Array.isArray(signatures)) return {};
  const workflow = signatures.workflow;
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) return {};
  return workflow;
}

function formatServiceTypeTag(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "SEM TIPO";
  return normalized.replace(/_/g, " ").toUpperCase();
}

function buildReviewTargets(item) {
  const targets = [];
  (Array.isArray(item?.equipmentsData) ? item.equipmentsData : []).forEach((equipment, index) => {
    const id = equipment?.equipmentId || equipment?.id || `equipment-${index + 1}`;
    const label = buildEquipmentDisplayLabel(equipment, index);
    targets.push({ targetType: "EQUIPMENT", targetId: String(id), label: `Equipamento: ${label}` });
  });

  (Array.isArray(item?.checklistItems) ? item.checklistItems : []).forEach((checkEntry, index) => {
    const id = checkEntry?.item || `checklist-${index + 1}`;
    targets.push({ targetType: "CHECKLIST", targetId: String(id), label: `Checklist: ${id}` });
  });

  targets.push({ targetType: "VIDEO", targetId: "installation-video", label: "Vídeo da instalação" });
  targets.push({ targetType: "SIGNATURE", targetId: "technician-signature", label: "Assinatura técnico" });
  targets.push({ targetType: "SIGNATURE", targetId: "client-signature", label: "Assinatura cliente" });
  targets.push({ targetType: "KM", targetId: "km-total", label: "KM total" });
  targets.push({ targetType: "ARRIVAL", targetId: "arrival-check", label: "Validação de chegada GPS" });
  return targets;
}

function resolveBindingLabel(status) {
  const normalized = String(status || "").trim().toUpperCase();
  const map = {
    LINKED: "Vinculado",
    NOT_LINKED: "Não vinculado",
    MISSING_IDENTIFIER: "Sem identificador",
    NOT_FOUND: "Não encontrado",
    CLIENT_MISMATCH: "Cliente divergente",
  };
  return map[normalized] || "Não verificado";
}

export default function ServiceOrderDetails() {
  const { id } = useParams();
  const { tenantId, tenantScope, user } = useTenant();
  const permission = usePermissionGate({ menuKey: "fleet", pageKey: "services", subKey: "service-orders" });
  const canEdit = permission.isFull;
  const resolvedClientId = tenantScope === "ALL" ? null : (tenantId || user?.clientId || null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [item, setItem] = useState(null);
  const [form, setForm] = useState(null);
  const [showActions, setShowActions] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reworkTargetId, setReworkTargetId] = useState("");
  const [reworkReason, setReworkReason] = useState("");
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [mediaViewerOpen, setMediaViewerOpen] = useState(false);
  const [mediaCatalog, setMediaCatalog] = useState([]);
  const [mediaViewerItems, setMediaViewerItems] = useState([]);
  const { toast, showToast } = usePageToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = resolvedClientId ? { clientId: resolvedClientId } : undefined;
      const orderResponse = await api.get(`core/service-orders/${id}`, { params });
      const collectedMedia = [];
      let cursor = null;
      for (let page = 0; page < 20; page += 1) {
        const mediaResponse = await api
          .get(`core/service-orders/${id}/media`, {
            params: { ...(params || {}), pageSize: 300, ...(cursor ? { cursor } : {}) },
          })
          .catch(() => null);
        const pageItems = mediaResponse?.data?.items;
        if (!Array.isArray(pageItems) || pageItems.length === 0) break;
        collectedMedia.push(...pageItems);
        if (!mediaResponse?.data?.hasMore || !mediaResponse?.data?.nextCursor) break;
        cursor = mediaResponse.data.nextCursor;
      }
      const dedupedMedia = Array.from(
        new Map(
          collectedMedia.map((entry) => [
            `${entry?.origin || ""}|${entry?.phase || ""}|${entry?.targetType || ""}|${entry?.targetId || ""}|${entry?.src || ""}`,
            entry,
          ]),
        ).values(),
      );
      setItem(orderResponse?.data?.item || null);
      setMediaCatalog(dedupedMedia);
    } catch (error) {
      console.error("Falha ao carregar OS", error);
      setItem(null);
      setMediaCatalog([]);
    } finally {
      setLoading(false);
    }
  }, [id, resolvedClientId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!item) return;
    setForm({
      osInternalId: item.osInternalId || "",
      vehiclePlate: item.vehicle?.plate || "",
      clientName: item.clientName || "",
      type: item.type || "",
      status: item.status || "",
      startAt: toLocalInput(item.startAt),
      endAt: toLocalInput(item.endAt),
      technicianName: item.technicianName || "",
      responsibleName: item.responsibleName || "",
      responsiblePhone: item.responsiblePhone || "",
      address: item.address || "",
      reason: item.reason || "",
      notes: item.notes || "",
      equipmentsText: item.equipmentsText || "",
      serial: item.serial || "",
      externalRef: item.externalRef || "",
      km: item.km ?? "",
    });
  }, [item]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const save = async (overrides = null) => {
    if (!form) return;
    setSaving(true);
    try {
      const nextForm = { ...form, ...overrides };
      const payload = {
        ...mapPayload(nextForm),
        ...(resolvedClientId ? { clientId: resolvedClientId } : {}),
      };
      const response = await api.patch(`core/service-orders/${id}`, payload);
      if (!response?.data?.ok) {
        throw new Error(response?.data?.error || "Falha ao atualizar OS");
      }
      setItem(response.data.item);
      const resolvedStatus = response?.data?.item?.status || nextForm.status;
      if (resolvedStatus === "CONCLUIDA" && response?.data?.equipmentsLinked !== undefined) {
        showToast("Equipamentos vinculados ao veículo automaticamente.", "success");
      }
    } catch (error) {
      console.error("Falha ao atualizar OS", error);
      showToast("Falha ao atualizar OS.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPdf = async () => {
    try {
      const response = await api.get(`core/service-orders/${id}/pdf`, {
        responseType: "blob",
        params: resolvedClientId ? { clientId: resolvedClientId } : undefined,
      });
      if (!response?.data) {
        throw new Error("Falha ao gerar PDF");
      }
      const blob = response.data;
      const url = window.URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => window.URL.revokeObjectURL(url), 5000);
      showToast("PDF gerado com sucesso.", "success");
    } catch (error) {
      console.error("Falha ao exportar PDF", error);
      const message = await resolveApiErrorMessage(error, "Não foi possível exportar o PDF agora.");
      showToast(message, "error");
    }
  };

  const headline = useMemo(() => {
    if (!item) return "";
    return item.osInternalId || item.id.slice(0, 8);
  }, [item]);

  const checklistItems = useMemo(() => {
    if (!Array.isArray(item?.checklistItems)) return [];
    return item.checklistItems;
  }, [item]);

  const equipmentLines = useMemo(() => {
    const list = Array.isArray(item?.equipmentsData) ? item.equipmentsData : [];
    if (list.length) {
      return list
        .map((entry, index) => {
          const equipmentLabel = buildEquipmentDisplayLabel(entry, index);
          if (!equipmentLabel) return null;
          if (entry?.installLocation) {
            return `${equipmentLabel} • ${entry.installLocation}`;
          }
          return String(equipmentLabel);
        })
        .filter(Boolean);
    }
    return splitEquipmentText(form?.equipmentsText || "");
  }, [form?.equipmentsText, item?.equipmentsData]);

  const workflow = useMemo(() => normalizeWorkflow(item?.signatures), [item?.signatures]);
  const statusDateMap = useMemo(() => buildStatusDateMap(item, workflow), [item, workflow]);
  const timelineMetaByStatus = useMemo(() => {
    const map = new Map();
    normalizeStatusTimelineEntries(workflow?.statusTimeline).forEach((entry) => {
      map.set(normalizeStatusValue(entry.status), entry);
    });
    return map;
  }, [workflow?.statusTimeline]);
  const fallbackMediaItems = useMemo(() => buildMediaItems(item), [item]);
  const mediaItems = useMemo(() => (mediaCatalog.length ? mediaCatalog : fallbackMediaItems), [fallbackMediaItems, mediaCatalog]);
  const equipmentBindingSummary = item?.equipmentBindingSummary || null;
  const equipmentBindingRows = useMemo(() => {
    const currentVehicleId = String(item?.vehicle?.id || item?.vehicleId || "").trim();
    const currentVehiclePlate = String(item?.vehicle?.plate || "").trim();
    const currentVehicleName = String(item?.vehicle?.name || "").trim();
    return (Array.isArray(item?.equipmentsData) ? item.equipmentsData : []).map((equipment, index) => {
      const linkedVehicleId = equipment?.linkedVehicleId || null;
      const normalizedLinkedVehicleId = String(linkedVehicleId || "").trim();
      const linkedVehicleLabel =
        normalizedLinkedVehicleId && currentVehicleId && normalizedLinkedVehicleId === currentVehicleId
          ? currentVehiclePlate || currentVehicleName || normalizedLinkedVehicleId
          : normalizedLinkedVehicleId || "—";
      return {
        key: `${equipment?.equipmentId || equipment?.id || index}`,
        equipmentId:
          equipment?.equipmentId ||
          equipment?.id ||
          `equipment-${index + 1}`,
        label: buildEquipmentDisplayLabel(equipment, index),
        bindingStatus: equipment?.bindingStatus || "NOT_VERIFIED",
        linkedVehicleId,
        linkedVehicleLabel,
        bindingError: equipment?.bindingError || null,
      };
    });
  }, [item?.equipmentsData, item?.vehicle?.id, item?.vehicle?.name, item?.vehicle?.plate, item?.vehicleId]);
  const reviewTargets = useMemo(() => buildReviewTargets(item), [item]);
  const isAwaitingAdminReview = useMemo(
    () => ["AGUARDANDO_APROVACAO", "PENDENTE_APROVACAO_ADMIN", "REENVIADA_PARA_APROVACAO"].includes(item?.status),
    [item?.status],
  );

  const submitAdminReview = async ({ approve }) => {
    if (!item?.id || reviewBusy) return;
    if (!approve) {
      if (!reworkTargetId) {
        showToast("Selecione o item para retrabalho.", "warning");
        return;
      }
      if (!reworkReason.trim()) {
        showToast("Informe o motivo do retrabalho.", "warning");
        return;
      }
    }

    const selectedTarget = reviewTargets.find((entry) => `${entry.targetType}:${entry.targetId}` === reworkTargetId);
    const payloadItems = reviewTargets.map((entry) => {
      const decision =
        !approve && selectedTarget && selectedTarget.targetType === entry.targetType && selectedTarget.targetId === entry.targetId
          ? "REWORK_REQUIRED"
          : "APPROVED";
      return {
        targetType: entry.targetType,
        targetId: entry.targetId,
        decision,
        reason: decision === "REWORK_REQUIRED" ? reworkReason.trim() : null,
      };
    });

    setReviewBusy(true);
    try {
      const payload = {
        decision: approve ? "APPROVE" : "REWORK",
        items: payloadItems,
        ...(resolvedClientId ? { clientId: resolvedClientId } : {}),
      };
      const response = await api.post(`core/service-orders/${item.id}/admin-review`, payload);
      if (!response?.data?.ok) {
        throw new Error(response?.data?.error?.message || "Falha ao revisar OS.");
      }
      setItem(response.data.item || item);
      setReworkReason("");
      setReworkTargetId("");
      showToast(approve ? "OS aprovada e concluída." : "OS devolvida para retrabalho.", "success");
    } catch (error) {
      const details = error?.response?.data?.error?.details;
      if (Array.isArray(details) && details.length) {
        const detailLines = details.map((entry) => entry?.message || entry?.label || entry?.equipmentId || "Erro de vínculo");
        showToast(`Falha ao revisar OS: ${detailLines.join(" | ")}`, "error");
      } else {
        showToast(error?.response?.data?.error?.message || error?.message || "Falha ao revisar OS.", "error");
      }
    } finally {
      setReviewBusy(false);
    }
  };

  const openMediaViewer = (index) => {
    if (!mediaItems.length) return;
    setMediaViewerItems(mediaItems);
    setActiveMediaIndex(index);
    setMediaViewerOpen(true);
  };
  const openScopedMediaViewer = (items, index = 0) => {
    if (!Array.isArray(items) || items.length === 0) return;
    setMediaViewerItems(items);
    setActiveMediaIndex(index);
    setMediaViewerOpen(true);
  };
  const resolveEquipmentMediaItems = useCallback(
    (equipmentKey) =>
      mediaItems.filter(
        (entry) =>
          String(entry?.targetType || "").toUpperCase() === "EQUIPMENT" &&
          String(entry?.targetId || "").trim().toLowerCase() === String(equipmentKey || "").trim().toLowerCase(),
      ),
    [mediaItems],
  );
  const resolveChecklistMediaItems = useCallback(
    (checklistLabel, phase) =>
      mediaItems.filter(
        (entry) =>
          String(entry?.targetType || "").toUpperCase() === "CHECKLIST_ITEM" &&
          String(entry?.targetId || "").trim().toLowerCase() === String(checklistLabel || "").trim().toLowerCase() &&
          (!phase || String(entry?.phase || "").toUpperCase() === String(phase).toUpperCase()),
      ),
    [mediaItems],
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <DataCard className="animate-pulse">
          <div className="h-6 w-48 rounded-full bg-white/10" />
          <div className="mt-3 h-4 w-64 rounded-full bg-white/10" />
        </DataCard>
      </div>
    );
  }

  if (!item || !form) {
    return (
      <DataCard>
        <EmptyState title="OS não encontrada." subtitle="Verifique o código e tente novamente." />
      </DataCard>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>OS {headline}</span>
            <span className="rounded-xl bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.1em] text-white/80">
              {item.status || "—"}
            </span>
            <span className="rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-3 py-1 text-xs uppercase tracking-[0.1em] text-emerald-100">
              {formatServiceTypeTag(item.type)}
            </span>
          </span>
        }
        subtitle={`Placa ${item.vehicle?.plate || "—"} • Cliente ${item.clientName || "—"} • Técnico ${
          item.technicianName || "—"
        }`}
        actions={
          <>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
            >
              Exportar PDF
            </button>
            <Link
              className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
              to={`/services/${item.id}/execute`}
            >
              Executar (técnico)
            </Link>
            <button
              type="button"
              onClick={() => setShowActions((prev) => !prev)}
              className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
            >
              Agendar / Remanejar / Cancelar
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => submitAdminReview({ approve: true })}
                disabled={!isAwaitingAdminReview || reviewBusy}
                className="rounded-xl bg-sky-500 px-3 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-50"
              >
                {reviewBusy ? "Processando..." : "Aprovar OS"}
              </button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Timeline</h2>
            <div className="space-y-2 text-sm text-white/70">
              {STATUS_OPTIONS.map((status) => (
                <div key={status} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white">{status}</span>
                    <span className="text-xs text-white/50">{formatDateTime(statusDateMap.get(normalizeStatusValue(status)))}</span>
                  </div>
                  {timelineMetaByStatus.get(normalizeStatusValue(status))?.source && (
                    <div className="mt-1 text-[11px] text-white/40">
                      Origem: {timelineMetaByStatus.get(normalizeStatusValue(status))?.source}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </DataCard>

          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Vínculo de equipamentos</h2>
            {equipmentBindingRows.length ? (
              <div className="space-y-3">
                <div className="text-xs text-white/60">
                  Vinculados: {equipmentBindingSummary?.linkedCount ?? 0} de {equipmentBindingSummary?.total ?? equipmentBindingRows.length}
                </div>
                <div className="overflow-hidden rounded-xl border border-white/10">
                  <table className="min-w-full text-left text-xs text-white/70">
                    <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-white/60">
                      <tr>
                        <th className="px-3 py-2">Equipamento</th>
                        <th className="px-3 py-2">Status vínculo</th>
                        <th className="px-3 py-2">Veículo vinculado</th>
                        <th className="px-3 py-2">Mídias</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {equipmentBindingRows.map((entry) => {
                        const equipmentMedia = resolveEquipmentMediaItems(entry.equipmentId);
                        return (
                          <tr key={entry.key}>
                            <td className="px-3 py-2 text-white">{entry.label}</td>
                            <td className="px-3 py-2">
                              <span
                                className={`inline-flex rounded-md px-2 py-1 text-[11px] ${
                                  String(entry.bindingStatus).toUpperCase() === "LINKED"
                                    ? "bg-emerald-500/20 text-emerald-200"
                                    : "bg-amber-500/20 text-amber-100"
                                }`}
                                title={entry.bindingError || undefined}
                              >
                                {resolveBindingLabel(entry.bindingStatus)}
                              </span>
                            </td>
                            <td className="px-3 py-2" title={entry.linkedVehicleId || undefined}>
                              {entry.linkedVehicleLabel}
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => openScopedMediaViewer(equipmentMedia)}
                                disabled={!equipmentMedia.length}
                                className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/80 hover:border-white/35 disabled:cursor-not-allowed disabled:opacity-40"
                                title={
                                  equipmentMedia.length
                                    ? `Abrir mídias do equipamento (${equipmentMedia.length})`
                                    : "Sem mídia para este equipamento"
                                }
                              >
                                <Camera className="h-3.5 w-3.5" />
                                {equipmentMedia.length}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-4 text-sm text-white/60">
                Nenhum equipamento registrado na OS.
              </div>
            )}
          </DataCard>

          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Checklist</h2>
            {checklistItems.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-white/10">
                <table className="min-w-full text-left text-xs text-white/70">
                  <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-white/60">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2">Antes</th>
                      <th className="px-3 py-2">Depois</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {checklistItems.map((entry, index) => {
                      const rowKey = entry.item || `checklist-${index + 1}`;
                      const beforeMedia = resolveChecklistMediaItems(entry.item, "BEFORE");
                      const afterMedia = resolveChecklistMediaItems(entry.item, "AFTER");
                      return (
                        <tr key={rowKey}>
                          <td className="px-3 py-2 text-white">{entry.item}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span>{entry.before || "—"}</span>
                              <button
                                type="button"
                                onClick={() => openScopedMediaViewer(beforeMedia)}
                                disabled={!beforeMedia.length}
                                className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/80 hover:border-white/35 disabled:cursor-not-allowed disabled:opacity-40"
                                title={
                                  beforeMedia.length
                                    ? `Abrir mídias Antes (${beforeMedia.length})`
                                    : "Sem mídia Antes para este item"
                                }
                              >
                                <Camera className="h-3.5 w-3.5" />
                                {beforeMedia.length}
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span>{entry.after || "—"}</span>
                              <button
                                type="button"
                                onClick={() => openScopedMediaViewer(afterMedia)}
                                disabled={!afterMedia.length}
                                className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/80 hover:border-white/35 disabled:cursor-not-allowed disabled:opacity-40"
                                title={
                                  afterMedia.length
                                    ? `Abrir mídias Depois (${afterMedia.length})`
                                    : "Sem mídia Depois para este item"
                                }
                              >
                                <Camera className="h-3.5 w-3.5" />
                                {afterMedia.length}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-white/60">
                {form.notes ? form.notes : "Nenhum checklist registrado até o momento."}
              </div>
            )}
          </DataCard>

          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Mídias</h2>
            {mediaItems.length ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {mediaItems.map((media, index) => (
                  <button
                    type="button"
                    key={media.key || media.id || `${media.src}-${index}`}
                    onClick={() => openMediaViewer(index)}
                    className="rounded-xl border border-white/10 bg-black/30 p-2 text-left transition hover:border-white/25 hover:bg-black/40"
                  >
                    {media.type === "video" ? (
                      <VideoMediaPlayer
                        src={media.src}
                        title={media.title}
                        status={media.status}
                        controls={false}
                        className="aspect-video w-full"
                      />
                    ) : (
                      <img src={media.src} alt={media.title} className="aspect-video w-full rounded-lg border border-white/10 object-cover" />
                    )}
                    <div className="mt-2 text-xs text-white/70">{media.title}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-4 text-sm text-white/60">
                Nenhuma mídia registrada até o momento.
              </div>
            )}
          </DataCard>

          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Assinaturas</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <div className="text-xs uppercase tracking-wide text-white/60">Técnico</div>
                {item?.signatures?.technician ? (
                  <img
                    src={item.signatures.technician}
                    alt="Assinatura do técnico"
                    className="mt-2 h-36 w-full rounded-lg border border-white/10 object-contain bg-black/40"
                  />
                ) : (
                  <div className="mt-2 rounded-lg border border-white/10 px-3 py-6 text-center text-sm text-white/60">
                    Sem assinatura
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <div className="text-xs uppercase tracking-wide text-white/60">Cliente</div>
                {item?.signatures?.client ? (
                  <img
                    src={item.signatures.client}
                    alt="Assinatura do cliente"
                    className="mt-2 h-36 w-full rounded-lg border border-white/10 object-contain bg-black/40"
                  />
                ) : (
                  <div className="mt-2 rounded-lg border border-white/10 px-3 py-6 text-center text-sm text-white/60">
                    Sem assinatura
                  </div>
                )}
              </div>
            </div>
          </DataCard>

          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Aprovação admin / retrabalho</h2>
            <div className="text-xs text-white/60">
              Decisão atual: {workflow?.adminReview?.decision || "Aguardando revisão"} • Ciclo{" "}
              {workflow?.adminReview?.cycle || 0}
            </div>
            <label className="block text-xs text-white/60">
              Item para retrabalho
              <select
                value={reworkTargetId}
                onChange={(event) => setReworkTargetId(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                <option value="">Selecione o item</option>
                {reviewTargets.map((target) => (
                  <option key={`${target.targetType}:${target.targetId}`} value={`${target.targetType}:${target.targetId}`}>
                    {target.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-white/60">
              Motivo do retrabalho
              <textarea
                value={reworkReason}
                onChange={(event) => setReworkReason(event.target.value)}
                className="mt-2 min-h-[90px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                placeholder="Explique o que deve ser corrigido."
              />
            </label>
            <button
              type="button"
              onClick={() => submitAdminReview({ approve: false })}
              disabled={!isAwaitingAdminReview || reviewBusy}
              className="w-full rounded-xl border border-amber-300/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 transition hover:bg-amber-500/20 disabled:opacity-50"
            >
              Enviar para retrabalho
            </button>
            {Array.isArray(workflow?.rework?.tasks) && workflow.rework.tasks.length > 0 && (
              <div className="space-y-2">
                {workflow.rework.tasks.map((task) => (
                  <div
                    key={task.taskId || `${task.targetType}-${task.targetId}`}
                    className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/70"
                  >
                    <div>{task.reason}</div>
                    <div className="mt-1 text-white/50">Status: {task.status || "OPEN"}</div>
                    {task.resolutionNote && <div className="mt-1 text-white/60">Resolução: {task.resolutionNote}</div>}
                  </div>
                ))}
              </div>
            )}
          </DataCard>
        </div>

        <div className="space-y-4">
          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Dados do serviço</h2>
            <label className="block text-xs text-white/60">
              Status
              <select
                value={form.status}
                onChange={(event) => handleChange("status", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                disabled={!canEdit}
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-white/60">
              Endereço
              <input
                value={form.address}
                onChange={(event) => handleChange("address", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                disabled={!canEdit}
              />
            </label>
            <label className="block text-xs text-white/60">
              Contato
              <input
                value={form.responsibleName}
                onChange={(event) => handleChange("responsibleName", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                disabled={!canEdit}
              />
            </label>
            <label className="block text-xs text-white/60">
              Telefone
              <input
                value={form.responsiblePhone}
                onChange={(event) => handleChange("responsiblePhone", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                disabled={!canEdit}
              />
            </label>
            {canEdit && (
              <button
                type="button"
                onClick={() => save()}
                disabled={saving}
                className="w-full rounded-xl bg-sky-500 px-3 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-60"
              >
                {saving ? "Salvando..." : "Salvar alterações"}
              </button>
            )}
          </DataCard>

          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Endereços da OS</h2>
            <div className="space-y-2 text-sm text-white/75">
              <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-white/50">1. Partida do técnico</div>
                <div className="mt-1 text-white">{item.addressStart || workflow?.startAddress?.formattedAddress || "—"}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-white/50">2. Endereço do serviço</div>
                <div className="mt-1 text-white">{item.address || workflow?.serviceAddress?.formattedAddress || "—"}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-white/50">3. Endereço de volta</div>
                <div className="mt-1 text-white">{item.addressReturn || workflow?.arrival?.destinationAddress || "—"}</div>
              </div>
            </div>
          </DataCard>

          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Veículo</h2>
            <div className="text-sm text-white/70">
              <div className="font-semibold text-white">{form.vehiclePlate || item.vehicle?.plate || "—"}</div>
              <div className="text-xs text-white/50">{item.vehicle?.name || item.vehicle?.model || "—"}</div>
              {item.vehicle?.id && (
                <Link className="mt-2 inline-flex text-xs text-sky-300" to={`/vehicles/${item.vehicle?.id}`}>
                  Ver veículo
                </Link>
              )}
            </div>
          </DataCard>

          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Equipamentos vinculados</h2>
            {equipmentLines.length ? (
              <ul className="space-y-2 text-sm text-white/70">
                {equipmentLines.map((line, index) => (
                  <li key={`eq-${index}`} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Nenhum equipamento informado." />
            )}
          </DataCard>

          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">KM</h2>
            <input
              value={form.km}
              onChange={(event) => handleChange("km", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              placeholder="KM total"
              disabled={!canEdit}
            />
          </DataCard>

          {showActions && canEdit && (
            <DataCard className="space-y-3">
              <h2 className="text-sm font-semibold text-white">Ações rápidas</h2>
              <div className="flex flex-col gap-2">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.status}
                    type="button"
                    className={`rounded-xl px-3 py-2 text-sm transition ${
                      action.tone === "danger"
                        ? "bg-red-500/10 text-red-200 hover:bg-red-500/20"
                        : "bg-white/10 text-white hover:bg-white/15"
                    }`}
                    onClick={() => save({ status: action.status })}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </DataCard>
          )}
        </div>
      </div>

      <MediaViewerModal
        open={mediaViewerOpen}
        items={mediaViewerItems}
        index={activeMediaIndex}
        onChangeIndex={setActiveMediaIndex}
        onClose={() => {
          setMediaViewerOpen(false);
          setMediaViewerItems([]);
        }}
      />
      <PageToast toast={toast} />
    </div>
  );
}
