import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Marker, Popup, TileLayer } from "react-leaflet";
import { Camera, Globe, RefreshCw, X } from "lucide-react";

import api from "../lib/api.js";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import PageHeader from "../components/ui/PageHeader.jsx";
import FilterBar from "../components/ui/FilterBar.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import SkeletonTable from "../components/ui/SkeletonTable.jsx";
import AutocompleteSelect from "../components/ui/AutocompleteSelect.jsx";
import DataCard from "../components/ui/DataCard.jsx";
import AppMap from "../components/map/AppMap.jsx";
import "../components/map/monitoring-map.css";
import MediaViewerModal from "../components/media/MediaViewerModal.jsx";
import useVehicles, { formatVehicleLabel } from "../lib/hooks/useVehicles.js";
import { buildEquipmentDisplayLabel } from "../lib/equipment-display.js";
import { formatAddress } from "../lib/format-address.js";
import { createVehicleMarkerIcon } from "../lib/map/vehicleMarkerIcon.js";

const STATUS_OPTIONS = [
  { value: "pendente", label: "Pendente" },
  { value: "confirmado", label: "Confirmado" },
  { value: "em_rota", label: "Em rota" },
  { value: "no_local", label: "No local" },
  { value: "em_execucao", label: "Em execução" },
  { value: "aguardando_validacao", label: "Aguardando validação" },
  { value: "remarcado", label: "Remarcado" },
  { value: "solicitada", label: "Solicitada" },
  { value: "agendada", label: "Agendada" },
  { value: "em_deslocamento", label: "Em deslocamento" },
  { value: "pendente_aprovacao_admin", label: "Pendente aprovação admin" },
  { value: "em_retrabalho", label: "Em retrabalho" },
  { value: "reenviada_para_aprovacao", label: "Reenviada para aprovação" },
  { value: "aprovada", label: "Aprovada" },
  { value: "concluida", label: "Concluída" },
  { value: "cancelada", label: "Cancelada" },
  { value: "remanejada", label: "Remanejada" },
];

const TILE_URL = import.meta?.env?.VITE_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  import.meta?.env?.VITE_MAP_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const APP_TIMEZONE = "America/Sao_Paulo";
const TECHNICIAN_REFRESH_INTERVAL_MS = 5_000;
const DEFAULT_ETA_SPEED_MPS = 18.06; // ~65 km/h
const ETA_ROUTE_CACHE_TTL_MS = 120_000;
const INVALID_COORD_EPSILON = 0.0001;
const LIVE_OS_ALLOWED_STATUSES = new Set([
  "SOLICITADA",
  "AGENDADA",
  "EM_DESLOCAMENTO",
  "EM_EXECUCAO",
  "AGUARDANDO_APROVACAO",
  "EM_RETRABALHO",
  "PENDENTE_APROVACAO_ADMIN",
  "REENVIADA_PARA_APROVACAO",
  "APROVADA",
]);

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

function formatDate(value) {
  if (!value) return "—";
  const date = parseApiDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: APP_TIMEZONE,
  }).format(date);
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasValidCoordinates(latValue, lngValue) {
  const lat = Number(latValue);
  const lng = Number(lngValue);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  if (Math.abs(lat) < INVALID_COORD_EPSILON && Math.abs(lng) < INVALID_COORD_EPSILON) return false;
  return true;
}

function normalizeAddressKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function formatEtaLabel(minutesValue) {
  const minutes = Number(minutesValue);
  if (!Number.isFinite(minutes) || minutes <= 0) return "Sem ETA";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}min` : `${hours}h`;
}

function haversineDistanceMeters(aLat, aLng, bLat, bLng) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const radius = 6371000;
  const latDiff = toRadians(Number(bLat) - Number(aLat));
  const lngDiff = toRadians(Number(bLng) - Number(aLng));
  const lat1 = toRadians(Number(aLat));
  const lat2 = toRadians(Number(bLat));
  const haversine =
    Math.sin(latDiff / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(lngDiff / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(haversine));
}

function formatDistanceCompact(value) {
  const distance = Number(value);
  if (!Number.isFinite(distance)) return "—";
  if (distance < 1000) return `${Math.round(distance)} m`;
  return `${(distance / 1000).toFixed(1)} km`;
}

function estimateEtaMinutes(distanceMeters, speedMetersPerSecond) {
  const distance = Number(distanceMeters);
  if (!Number.isFinite(distance) || distance <= 0) return 0;
  const speed = Number(speedMetersPerSecond);
  const resolvedSpeed = Number.isFinite(speed) && speed > 1 ? speed : DEFAULT_ETA_SPEED_MPS;
  return Math.max(1, Math.ceil(distance / resolvedSpeed / 60));
}

function buildGoogleMapsUrl(marker) {
  const currentLat = Number(marker?.lat);
  const currentLng = Number(marker?.lng);
  const targetLat = Number(marker?.destinationLat);
  const targetLng = Number(marker?.destinationLng);
  const destinationAddress = String(marker?.destinationAddress || "").trim();
  const hasCurrent = hasValidCoordinates(currentLat, currentLng);
  const hasTarget = hasValidCoordinates(targetLat, targetLng);

  if (hasCurrent && hasTarget) {
    const origin = `${currentLat},${currentLng}`;
    const destination = `${targetLat},${targetLng}`;
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
  }

  if (hasCurrent && destinationAddress) {
    const origin = `${currentLat},${currentLng}`;
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destinationAddress)}&travelmode=driving`;
  }

  if (hasCurrent) {
    const query = `${currentLat},${currentLng}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  if (destinationAddress) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destinationAddress)}`;
  }

  return "";
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveServiceOrderId(item) {
  if (!item || typeof item !== "object") return "";
  const directId =
    item.workOrderId ||
    item.workorderId ||
    item.serviceOrderId ||
    item.serviceorderId ||
    item.osId ||
    item.osID ||
    null;
  if (directId) return String(directId);
  const token = String(item.operation || "")
    .split(/[|;,]/)
    .map((entry) => String(entry || "").trim())
    .find((entry) => entry.toLowerCase().startsWith("os:"));
  return token ? token.slice(3).trim() : "";
}

function resolveTaskStateLabel(status) {
  const normalized = normalizeStatus(status);
  const map = {
    pendente: "Pendente",
    confirmado: "Confirmado",
    em_rota: "Em deslocamento",
    no_local: "No local",
    em_execucao: "Em execução",
    aguardando_validacao: "Aguardando validação",
    remarcado: "Remarcado",
    concluido: "Concluído",
    cancelado: "Cancelado",
    reprovado: "Reprovado",
  };
  return map[normalized] || (status ? String(status) : "—");
}

function resolveOsStateLabel(status) {
  const normalized = String(status || "").trim().toUpperCase();
  const map = {
    SOLICITADA: "Solicitada",
    AGENDADA: "Agendada",
    EM_DESLOCAMENTO: "Em deslocamento",
    EM_EXECUCAO: "Em execução",
    AGUARDANDO_APROVACAO: "Aguardando aprovação",
    PENDENTE_APROVACAO_ADMIN: "Aguardando aprovação",
    EM_RETRABALHO: "Em retrabalho",
    REENVIADA_PARA_APROVACAO: "Reenviada para aprovação",
    APROVADA: "Aprovada",
    CONCLUIDA: "Concluída",
    CANCELADA: "Cancelada",
    REMANEJADA: "Remanejada",
  };
  return map[normalized] || (status ? String(status) : "—");
}

function resolveTechnicianState(task, serviceOrder) {
  if (serviceOrder?.status) {
    return resolveOsStateLabel(serviceOrder.status);
  }
  return resolveTaskStateLabel(task?.status);
}

function asReadableAddress(value) {
  const text = formatAddress(value);
  return text === "—" ? "" : text;
}

function resolveDestinationLocation(task, serviceOrder) {
  const workflow = serviceOrder?.signatures?.workflow;
  const workflowLat = toNumber(workflow?.serviceAddress?.lat);
  const workflowLng = toNumber(workflow?.serviceAddress?.lng);
  const workflowAddress = asReadableAddress(workflow?.serviceAddress);
  if (hasValidCoordinates(workflowLat, workflowLng)) {
    return {
      lat: workflowLat,
      lng: workflowLng,
      address: workflowAddress || asReadableAddress(serviceOrder?.address),
    };
  }

  const taskLat = toNumber(task?.latitude);
  const taskLng = toNumber(task?.longitude);
  const taskAddress = asReadableAddress(task?.address);
  if (hasValidCoordinates(taskLat, taskLng)) {
    return {
      lat: taskLat,
      lng: taskLng,
      address: taskAddress || asReadableAddress(serviceOrder?.address),
    };
  }

  const serviceAddressLat = toNumber(serviceOrder?.address?.lat ?? serviceOrder?.address?.latitude);
  const serviceAddressLng = toNumber(serviceOrder?.address?.lng ?? serviceOrder?.address?.longitude);
  const serviceAddress = asReadableAddress(serviceOrder?.address);
  if (hasValidCoordinates(serviceAddressLat, serviceAddressLng)) {
    return {
      lat: serviceAddressLat,
      lng: serviceAddressLng,
      address: serviceAddress,
    };
  }

  return {
    lat: null,
    lng: null,
    address: workflowAddress || taskAddress || serviceAddress,
  };
}

function buildAuditAddressSummary(item) {
  const serviceAddress = asReadableAddress(item?.serviceOrder?.address || item?.address);
  const startAddress = asReadableAddress(item?.serviceOrder?.addressStart);
  const returnAddress = asReadableAddress(item?.serviceOrder?.addressReturn);
  const parts = [];
  if (serviceAddress) parts.push(`Serviço: ${serviceAddress}`);
  if (startAddress) parts.push(`Partida: ${startAddress}`);
  if (returnAddress) parts.push(`Volta: ${returnAddress}`);
  return parts.length ? parts.join(" • ") : "—";
}

function resolveMapLocation(task, serviceOrder) {
  const workflow = serviceOrder?.signatures?.workflow;
  const liveLat = toNumber(workflow?.liveLocation?.lat);
  const liveLng = toNumber(workflow?.liveLocation?.lng);
  if (liveLat !== null && liveLng !== null) {
    return {
      lat: liveLat,
      lng: liveLng,
      source: "GPS em tempo real",
      capturedAt: workflow?.liveLocation?.capturedAt || serviceOrder?.updatedAt || null,
      speed: toNumber(workflow?.liveLocation?.speed),
      formattedAddress: workflow?.liveLocation?.formattedAddress || workflow?.liveLocation?.address || "",
    };
  }

  const serviceLat = toNumber(workflow?.serviceAddress?.lat);
  const serviceLng = toNumber(workflow?.serviceAddress?.lng);
  if (serviceLat !== null && serviceLng !== null) {
    return {
      lat: serviceLat,
      lng: serviceLng,
      source: "GPS no endereço do serviço",
      capturedAt: workflow?.serviceAddress?.capturedAt || serviceOrder?.updatedAt || null,
      speed: null,
      formattedAddress: workflow?.serviceAddress?.formattedAddress || workflow?.serviceAddress?.address || "",
    };
  }

  const arrivalLat = toNumber(workflow?.arrival?.lat);
  const arrivalLng = toNumber(workflow?.arrival?.lng);
  if (arrivalLat !== null && arrivalLng !== null) {
    return {
      lat: arrivalLat,
      lng: arrivalLng,
      source: "GPS chegada final",
      capturedAt: workflow?.arrival?.validatedAt || serviceOrder?.updatedAt || null,
      speed: null,
      formattedAddress: workflow?.arrival?.formattedAddress || workflow?.arrival?.address || "",
    };
  }

  const taskLat = toNumber(task?.latitude);
  const taskLng = toNumber(task?.longitude);
  if (taskLat !== null && taskLng !== null) {
    return {
      lat: taskLat,
      lng: taskLng,
      source: "Local da tarefa",
      capturedAt: task?.updatedAt || task?.createdAt || null,
      speed: null,
      formattedAddress: "",
    };
  }

  return null;
}

function resolveMediaSource(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function isSameDayAtTimezone(dateValue, timeZone) {
  const parsed = parseApiDate(dateValue);
  if (!parsed) return false;
  const nowText = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const dateText = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
  return nowText === dateText;
}

function buildChecklistAuditRows(serviceOrder) {
  const list = Array.isArray(serviceOrder?.checklistItems) ? serviceOrder.checklistItems : [];
  return list.map((entry, index) => {
    const titleBase = entry?.item || `Checklist ${index + 1}`;
    const beforeMedia = resolveMediaSource(entry?.beforePhoto)
      ? [{ key: `check-before-${index}`, title: `${titleBase} - Antes`, type: "image", src: entry.beforePhoto, status: "READY" }]
      : [];
    const afterMedia = resolveMediaSource(entry?.afterPhoto)
      ? [{ key: `check-after-${index}`, title: `${titleBase} - Depois`, type: "image", src: entry.afterPhoto, status: "READY" }]
      : [];
    return {
      id: String(entry?.item || `check-${index + 1}`),
      label: titleBase,
      beforeMedia,
      afterMedia,
    };
  });
}

function buildEquipmentAuditRows(serviceOrder) {
  const list = Array.isArray(serviceOrder?.equipmentsData) ? serviceOrder.equipmentsData : [];
  return list.map((entry, index) => {
    const label = buildEquipmentDisplayLabel(entry, index);
    const initialPhoto = resolveMediaSource(entry?.startPhoto || entry?.beforePhoto || entry?.photo)
      ? [
          {
            key: `equipment-start-${index}`,
            title: `${label} - Foto inicial`,
            type: "image",
            src: entry?.startPhoto || entry?.beforePhoto || entry?.photo,
            status: "READY",
          },
        ]
      : [];
    const installedPhoto = resolveMediaSource(entry?.installationPhoto || entry?.installedPhoto || entry?.afterPhoto)
      ? [
          {
            key: `equipment-installed-${index}`,
            title: `${label} - Instalado`,
            type: "image",
            src: entry?.installationPhoto || entry?.installedPhoto || entry?.afterPhoto,
            status: "READY",
          },
        ]
      : [];
    const installationVideoSource = resolveMediaSource(entry?.installationVideo || entry?.installedVideo || entry?.video);
    const installationVideo = installationVideoSource
      ? [
          {
            key: `equipment-video-${index}`,
            title: `${label} - Vídeo da instalação`,
            type: "video",
            src: installationVideoSource,
            status: entry?.installationVideoStatus || entry?.videoStatus || "READY",
          },
        ]
      : [];
    return {
      id: String(entry?.equipmentId || entry?.id || `equipment-${index + 1}`),
      label,
      initialPhoto,
      installedPhoto,
      installationVideo,
    };
  });
}

function shouldShowItemInVarLive(item) {
  const serviceOrderStatus = String(item?.serviceOrder?.status || "").trim().toUpperCase();
  if (serviceOrderStatus) {
    if (!LIVE_OS_ALLOWED_STATUSES.has(serviceOrderStatus)) return false;
    const referenceDate =
      item?.serviceOrder?.updatedAt ||
      item?.serviceOrder?.createdAt ||
      item?.serviceOrder?.startAt ||
      item?.startTimeExpected ||
      item?.updatedAt ||
      item?.createdAt ||
      null;
    return isSameDayAtTimezone(referenceDate, APP_TIMEZONE);
  }

  const taskStatus = normalizeStatus(item?.status);
  if (!STATUS_OPTIONS.some((option) => option.value === taskStatus)) return false;
  const taskDate = item?.updatedAt || item?.createdAt || item?.startTimeExpected || null;
  return isSameDayAtTimezone(taskDate, APP_TIMEZONE);
}

function shouldShowTechnicianOnMap(item) {
  const serviceOrderStatus = String(item?.serviceOrder?.status || "").trim().toUpperCase();
  if (serviceOrderStatus) {
    if (serviceOrderStatus !== "EM_EXECUCAO") return false;
    const referenceDate =
      item?.serviceOrder?.updatedAt ||
      item?.serviceOrder?.createdAt ||
      item?.serviceOrder?.startAt ||
      item?.updatedAt ||
      item?.createdAt ||
      null;
    return isSameDayAtTimezone(referenceDate, APP_TIMEZONE);
  }

  return normalizeStatus(item?.status) === "em_execucao";
}

export default function VarLive() {
  const navigate = useNavigate();
  const { tenantId, tenantScope, user, tenants } = useTenant();
  const resolvedClientId = tenantScope === "ALL" ? "" : tenantId || user?.clientId || "";
  const isTechnician = user?.role === "technician";
  const { vehicles } = useVehicles({
    includeUnlinked: true,
    includeTelemetry: false,
  });

  const [items, setItems] = useState([]);
  const [serviceOrdersById, setServiceOrdersById] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState("services");
  const [filters, setFilters] = useState({
    status: "",
    clientId: "",
    vehicleId: "",
    technician: "",
  });
  const [draftFilters, setDraftFilters] = useState({
    status: "",
    clientId: "",
    vehicleId: "",
    technician: "",
  });
  const geocodeCacheRef = useRef(new Map());
  const destinationGeocodeCacheRef = useRef(new Map());
  const destinationGeocodePendingRef = useRef(new Set());
  const routeEtaCacheRef = useRef(new Map());
  const routeEtaPendingRef = useRef(new Set());
  const loadRequestRef = useRef(0);
  const [auditModalOrder, setAuditModalOrder] = useState(null);
  const [auditViewerItems, setAuditViewerItems] = useState([]);
  const [auditViewerIndex, setAuditViewerIndex] = useState(0);
  const [addressByCoord, setAddressByCoord] = useState({});
  const [destinationCoordsByKey, setDestinationCoordsByKey] = useState({});
  const [routeEtaByPair, setRouteEtaByPair] = useState({});

  const clientOptions = useMemo(
    () =>
      (Array.isArray(tenants) ? tenants : []).map((tenant) => ({
        id: tenant.id,
        name: tenant.name || tenant.company || tenant.id,
      })),
    [tenants],
  );

  const clientAutocompleteOptions = useMemo(
    () =>
      clientOptions.map((client) => ({
        value: String(client.id),
        label: client.name,
      })),
    [clientOptions],
  );

  const statusAutocompleteOptions = useMemo(
    () =>
      STATUS_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [],
  );

  const vehicleAutocompleteOptions = useMemo(
    () =>
      (Array.isArray(vehicles) ? vehicles : []).map((vehicle) => ({
        value: String(vehicle.id),
        label: formatVehicleLabel(vehicle),
        description: vehicle.plate || vehicle.name || "",
      })),
    [vehicles],
  );

  const loadVehicleOptions = useCallback(
    async ({ query, page, pageSize }) => {
      const term = String(query || "").trim().toLowerCase();
      const filtered = vehicleAutocompleteOptions.filter((vehicle) =>
        [vehicle.label, vehicle.description, vehicle.value]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term),
      );
      const start = (page - 1) * pageSize;
      const paged = filtered.slice(start, start + pageSize);
      return { options: paged, hasMore: start + pageSize < filtered.length };
    },
    [vehicleAutocompleteOptions],
  );

  const loadVar = useCallback(
    async (nextFilters = filters) => {
      const requestId = Date.now() + Math.random();
      loadRequestRef.current = requestId;
      setLoading(true);
      let list = [];
      let effectiveClientId;
      try {
        effectiveClientId = isTechnician
          ? nextFilters.clientId || undefined
          : nextFilters.clientId || resolvedClientId || undefined;
        const params = {
          category: "appointment",
          clientId: effectiveClientId,
          vehicleId: nextFilters.vehicleId || undefined,
        };
        const response = await CoreApi.listTasks(params);
        list = Array.isArray(response?.tasks) ? response.tasks : Array.isArray(response) ? response : [];
        if (loadRequestRef.current !== requestId) return;
        setItems(list);
      } catch (error) {
        if (loadRequestRef.current !== requestId) return;
        console.error("Falha ao carregar VAR", error);
        setItems([]);
        setServiceOrdersById({});
        return;
      } finally {
        if (loadRequestRef.current === requestId) {
          setLoading(false);
        }
      }

      const serviceOrderIds = Array.from(new Set(list.map((entry) => resolveServiceOrderId(entry)).filter(Boolean)));
      if (!serviceOrderIds.length) {
        if (loadRequestRef.current === requestId) {
          setServiceOrdersById({});
        }
        return;
      }

      try {
        const params = {
          ...(effectiveClientId ? { clientId: effectiveClientId } : {}),
          ids: serviceOrderIds.join(","),
        };
        const serviceOrderResponse = await api.get("core/service-orders", { params });
        if (loadRequestRef.current !== requestId) return;
        const serviceOrders = Array.isArray(serviceOrderResponse?.data?.items) ? serviceOrderResponse.data.items : [];
        const nextMap = serviceOrders.reduce((acc, order) => {
          const id = String(order?.id || "").trim();
          if (!id) return acc;
          acc[id] = order;
          return acc;
        }, {});
        setServiceOrdersById(nextMap);
      } catch (error) {
        if (loadRequestRef.current !== requestId) return;
        console.warn("Falha ao carregar OS vinculadas do VAR", error);
        setServiceOrdersById((prev) => {
          const fallback = {};
          serviceOrderIds.forEach((id) => {
            const key = String(id);
            if (prev[key]) fallback[key] = prev[key];
          });
          return fallback;
        });
      }
    },
    [filters, isTechnician, resolvedClientId],
  );

  useEffect(() => {
    loadVar();
  }, [loadVar]);

  useEffect(() => {
    if (!isTechnician) return undefined;
    const timer = window.setInterval(() => {
      loadVar(filters);
    }, TECHNICIAN_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [filters, isTechnician, loadVar]);

  const applyFilters = () => {
    const nextFilters = {
      ...filters,
      status: draftFilters.status,
      clientId: draftFilters.clientId,
      vehicleId: draftFilters.vehicleId,
      technician: draftFilters.technician,
    };
    setFilters(nextFilters);
  };

  const clearFilters = () => {
    const nextFilters = {
      status: "",
      clientId: "",
      vehicleId: "",
      technician: "",
    };
    setDraftFilters(nextFilters);
    setFilters(nextFilters);
  };

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const taskStatus = normalizeStatus(item.status);
      const serviceOrderStatus = normalizeStatus(item.serviceOrder?.status);
      const resolvedStatus = normalizeStatus(resolveTechnicianState(item, item.serviceOrder));
      const technician = String(item.technicianName || "").toLowerCase();
      const vehicleId = String(item.vehicleId || item.serviceOrder?.vehicleId || "").trim();

      if (filters.clientId && String(item.clientId || "") !== String(filters.clientId)) return false;
      if (filters.vehicleId && vehicleId !== String(filters.vehicleId)) return false;
      if (filters.status) {
        const target = normalizeStatus(filters.status);
        if (target && ![taskStatus, serviceOrderStatus, resolvedStatus].includes(target)) return false;
      }
      if (filters.technician && !technician.includes(String(filters.technician).toLowerCase())) return false;
      if (isTechnician) {
        if (String(item.category || "").toLowerCase() !== "appointment") return false;
      }
      if (!isTechnician) {
        const hasKnownStatus = STATUS_OPTIONS.some((option) => option.value === taskStatus);
        const hasLinkedServiceOrder = Boolean(resolveServiceOrderId(item));
        if (!hasKnownStatus && !hasLinkedServiceOrder) return false;
      }
      return true;
    });
  }, [filters.clientId, filters.status, filters.technician, filters.vehicleId, isTechnician, items]);

  const enrichedItems = useMemo(
    () =>
      filtered.map((item) => {
        const serviceOrderId = resolveServiceOrderId(item);
        const serviceOrder = serviceOrderId ? serviceOrdersById[String(serviceOrderId)] || null : null;
        return {
          ...item,
          serviceOrderId,
          serviceOrder,
          technicianState: resolveTechnicianState(item, serviceOrder),
        };
      }),
    [filtered, serviceOrdersById],
  );

  const liveItems = useMemo(() => enrichedItems.filter((entry) => shouldShowItemInVarLive(entry)), [enrichedItems]);
  const mapItems = useMemo(() => enrichedItems.filter((entry) => shouldShowTechnicianOnMap(entry)), [enrichedItems]);

  const openAuditModal = useCallback(
    async (serviceOrder, serviceOrderId = "") => {
      const resolvedId = String(serviceOrderId || serviceOrder?.id || "").trim();
      if (!serviceOrder && !resolvedId) return;
      if (resolvedId) {
        try {
          const response = await api.get(`core/service-orders/${resolvedId}`);
          const freshServiceOrder = response?.data?.item || null;
          if (freshServiceOrder) {
            setAuditModalOrder(freshServiceOrder);
            return;
          }
        } catch (_error) {
          // fallback para o item já carregado na lista.
        }
      }
      if (serviceOrder) {
        setAuditModalOrder(serviceOrder);
      }
    },
    [],
  );

  const handleOpenServiceDetails = useCallback(
    (serviceOrderId, { execute = false } = {}) => {
      if (!serviceOrderId) return;
      navigate(execute ? `/services/${serviceOrderId}/execute` : `/services/${serviceOrderId}`);
    },
    [navigate],
  );

  const openAuditViewer = (items) => {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return;
    setAuditViewerItems(list);
    setAuditViewerIndex(0);
  };

  const mapMarkers = useMemo(
    () => {
      const markers = mapItems
        .map((item) => {
          const location = resolveMapLocation(item, item.serviceOrder);
          if (!location || !hasValidCoordinates(location.lat, location.lng)) return null;

          const destination = resolveDestinationLocation(item, item.serviceOrder);
          const destinationAddress = String(destination?.address || asReadableAddress(item.serviceOrder?.address || item.address) || "").trim();
          const destinationAddressKey = normalizeAddressKey(destinationAddress);
          const destinationFromSourceValid = hasValidCoordinates(destination?.lat, destination?.lng);

          let destinationLat = destinationFromSourceValid ? Number(destination.lat) : null;
          let destinationLng = destinationFromSourceValid ? Number(destination.lng) : null;
          if ((!destinationFromSourceValid || !hasValidCoordinates(destinationLat, destinationLng)) && destinationAddressKey) {
            const geocoded = destinationCoordsByKey[destinationAddressKey];
            if (hasValidCoordinates(geocoded?.lat, geocoded?.lng)) {
              destinationLat = Number(geocoded.lat);
              destinationLng = Number(geocoded.lng);
            }
          }

          const hasDestination = hasValidCoordinates(destinationLat, destinationLng);
          const coordKey = `${Number(location.lat).toFixed(5)},${Number(location.lng).toFixed(5)}`;
          const routeOriginKey = `${Number(location.lat).toFixed(4)},${Number(location.lng).toFixed(4)}`;
          const routeDestinationKey = hasDestination ? `${Number(destinationLat).toFixed(4)},${Number(destinationLng).toFixed(4)}` : "";
          const routePairKey = routeOriginKey && routeDestinationKey ? `${routeOriginKey}|${routeDestinationKey}` : "";
          const routeEta = routePairKey ? routeEtaByPair[routePairKey] : null;
          const fallbackDistance = hasDestination
            ? haversineDistanceMeters(location.lat, location.lng, destinationLat, destinationLng)
            : null;
          const distanceMeters = Number.isFinite(routeEta?.distanceMeters) ? Number(routeEta.distanceMeters) : fallbackDistance;
          const etaMinutesFromRoute =
            Number.isFinite(routeEta?.durationSeconds) && Number(routeEta.durationSeconds) > 0
              ? Math.max(1, Math.ceil(Number(routeEta.durationSeconds) / 60))
              : null;
          const etaMinutes = etaMinutesFromRoute ?? (Number.isFinite(distanceMeters) ? estimateEtaMinutes(distanceMeters, location.speed) : null);
          const etaLabel = !Number.isFinite(distanceMeters) ? "Sem ETA" : distanceMeters < 80 ? "Chegou" : formatEtaLabel(etaMinutes);

          return {
            id: String(item.id),
            technicianKey: String(item.technicianId || item.technicianName || item.id).toLowerCase(),
            lat: location.lat,
            lng: location.lng,
            coordKey,
            locationSource: location.source,
            locationCapturedAt: location.capturedAt,
            locationAddress: location.formattedAddress || "",
            technicianName: item.technicianName || "—",
            technicianState: item.technicianState,
            clientName: item.clientName || "—",
            serviceAddress: formatAddress(item.serviceOrder?.address || item.address),
            serviceOrderId: item.serviceOrderId || "",
            serviceLabel: item.serviceOrder?.type || item.type || "—",
            etaMinutes,
            etaLabel,
            etaDistanceMeters: distanceMeters,
            destinationAddress,
            destinationAddressKey,
            destinationLat: hasDestination ? destinationLat : null,
            destinationLng: hasDestination ? destinationLng : null,
            routePairKey,
            updatedAt: item.serviceOrder?.updatedAt || item.updatedAt || item.createdAt || null,
          };
        })
        .filter(Boolean)
        .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));

      const byTechnician = new Map();
      markers.forEach((marker) => {
        if (!byTechnician.has(marker.technicianKey)) {
          byTechnician.set(marker.technicianKey, marker);
        }
      });
      return Array.from(byTechnician.values());
    },
    [destinationCoordsByKey, mapItems, routeEtaByPair],
  );

  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    const uniqueByAddressKey = new Map();
    mapMarkers.forEach((marker) => {
      const key = marker?.destinationAddressKey;
      if (!key) return;
      if (hasValidCoordinates(marker?.destinationLat, marker?.destinationLng)) return;
      const cachedCoords = destinationCoordsByKey[key];
      if (hasValidCoordinates(cachedCoords?.lat, cachedCoords?.lng)) return;
      if (destinationGeocodePendingRef.current.has(key)) return;
      const cachedAttempt = destinationGeocodeCacheRef.current.get(key);
      if (cachedAttempt && now - Number(cachedAttempt.updatedAt || 0) < ETA_ROUTE_CACHE_TTL_MS) return;
      if (!uniqueByAddressKey.has(key)) {
        uniqueByAddressKey.set(key, {
          key,
          address: marker.destinationAddress,
        });
      }
    });

    const pending = Array.from(uniqueByAddressKey.values()).slice(0, 8);
    if (!pending.length) return undefined;

    const run = async () => {
      const updates = {};
      await Promise.all(
        pending.map(async (entry) => {
          destinationGeocodePendingRef.current.add(entry.key);
          try {
            const response = await api.get("geocode/search", {
              params: { q: entry.address, limit: 1 },
            });
            const top = Array.isArray(response?.data?.data) ? response.data.data[0] : null;
            const lat = Number(top?.lat);
            const lng = Number(top?.lng);
            const hasCoords = hasValidCoordinates(lat, lng);
            const payload = {
              lat: hasCoords ? lat : null,
              lng: hasCoords ? lng : null,
              updatedAt: Date.now(),
            };
            destinationGeocodeCacheRef.current.set(entry.key, payload);
            if (hasCoords) updates[entry.key] = payload;
          } catch (_error) {
            destinationGeocodeCacheRef.current.set(entry.key, {
              lat: null,
              lng: null,
              updatedAt: Date.now(),
            });
          } finally {
            destinationGeocodePendingRef.current.delete(entry.key);
          }
        }),
      );
      if (!cancelled && Object.keys(updates).length) {
        setDestinationCoordsByKey((prev) => ({ ...prev, ...updates }));
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [destinationCoordsByKey, mapMarkers]);

  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    const uniqueByPairKey = new Map();
    mapMarkers
      .filter((marker) => marker?.routePairKey && hasValidCoordinates(marker?.destinationLat, marker?.destinationLng))
      .forEach((marker) => {
        if (routeEtaPendingRef.current.has(marker.routePairKey)) return;
        const stateCache = routeEtaByPair[marker.routePairKey];
        const refCache = routeEtaCacheRef.current.get(marker.routePairKey);
        const cached = stateCache || refCache;
        if (cached && now - Number(cached.updatedAt || 0) < ETA_ROUTE_CACHE_TTL_MS) return;
        if (!uniqueByPairKey.has(marker.routePairKey)) {
          uniqueByPairKey.set(marker.routePairKey, marker);
        }
      });
    const pending = Array.from(uniqueByPairKey.values()).slice(0, 8);
    if (!pending.length) return undefined;

    const run = async () => {
      const updates = {};
      await Promise.all(
        pending.map(async (marker) => {
          routeEtaPendingRef.current.add(marker.routePairKey);
          try {
            const response = await api.post("map-route", {
              points: [
                { lat: marker.lat, lng: marker.lng },
                { lat: marker.destinationLat, lng: marker.destinationLng },
              ],
              profile: "driving",
              cacheKey: marker.routePairKey,
            });
            const routeDistance = Number(response?.data?.distance);
            const routeDuration = Number(response?.data?.duration);
            const fallbackDistance = haversineDistanceMeters(marker.lat, marker.lng, marker.destinationLat, marker.destinationLng);
            const payload = {
              distanceMeters: Number.isFinite(routeDistance) && routeDistance > 0 ? routeDistance : fallbackDistance,
              durationSeconds: Number.isFinite(routeDuration) && routeDuration > 0 ? routeDuration : null,
              updatedAt: Date.now(),
            };
            routeEtaCacheRef.current.set(marker.routePairKey, payload);
            updates[marker.routePairKey] = payload;
          } catch (_error) {
            const fallbackDistance = haversineDistanceMeters(marker.lat, marker.lng, marker.destinationLat, marker.destinationLng);
            const payload = {
              distanceMeters: Number.isFinite(fallbackDistance) ? fallbackDistance : null,
              durationSeconds: null,
              updatedAt: Date.now(),
            };
            routeEtaCacheRef.current.set(marker.routePairKey, payload);
            updates[marker.routePairKey] = payload;
          } finally {
            routeEtaPendingRef.current.delete(marker.routePairKey);
          }
        }),
      );
      if (!cancelled && Object.keys(updates).length) {
        setRouteEtaByPair((prev) => ({ ...prev, ...updates }));
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [mapMarkers, routeEtaByPair]);

  useEffect(() => {
    let cancelled = false;
    const pending = mapMarkers
      .slice(0, 20)
      .filter((marker) => marker?.coordKey && !addressByCoord[marker.coordKey] && !geocodeCacheRef.current.has(marker.coordKey));
    if (!pending.length) return undefined;

    const run = async () => {
      const updates = {};
      await Promise.all(
        pending.map(async (marker) => {
          try {
            const response = await api.get("geocode/lookup", {
              params: { lat: marker.lat, lng: marker.lng },
            });
            const resolvedAddress =
              response?.data?.shortAddress ||
              response?.data?.formattedAddress ||
              response?.data?.address ||
              "";
            geocodeCacheRef.current.set(marker.coordKey, resolvedAddress);
            if (resolvedAddress) updates[marker.coordKey] = resolvedAddress;
          } catch (_error) {
            geocodeCacheRef.current.set(marker.coordKey, "");
          }
        }),
      );
      if (!cancelled && Object.keys(updates).length) {
        setAddressByCoord((prev) => ({ ...prev, ...updates }));
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [addressByCoord, mapMarkers]);

  const mapCenter = useMemo(() => {
    if (!mapMarkers.length) return [-19.9167, -43.9345];
    const sample = mapMarkers.slice(0, Math.min(mapMarkers.length, 20));
    const total = sample.reduce(
      (acc, marker) => ({ lat: acc.lat + marker.lat, lng: acc.lng + marker.lng }),
      { lat: 0, lng: 0 },
    );
    return [total.lat / sample.length, total.lng / sample.length];
  }, [mapMarkers]);
  const adminColSpan = 7;
  const technicianColSpan = 6;
  const checklistAuditRows = useMemo(() => buildChecklistAuditRows(auditModalOrder), [auditModalOrder]);
  const equipmentAuditRows = useMemo(() => buildEquipmentAuditRows(auditModalOrder), [auditModalOrder]);

  return (
    <div className="space-y-4">
      <PageHeader
        actions={
          <div className="flex items-center gap-2">
            <button
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
              onClick={() => loadVar()}
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                Atualizar
              </span>
            </button>
          </div>
        }
      />

      {!isTechnician && (
        <div className="inline-flex rounded-xl border border-white/10 bg-black/30 p-1">
          <button
            type="button"
            onClick={() => setActiveView("services")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
              activeView === "services" ? "bg-sky-500 text-black" : "text-white/70 hover:bg-white/10"
            }`}
          >
            Serviços
          </button>
          <button
            type="button"
            onClick={() => setActiveView("map")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
              activeView === "map" ? "bg-sky-500 text-black" : "text-white/70 hover:bg-white/10"
            }`}
          >
            Mapa
          </button>
        </div>
      )}

      <FilterBar
        left={
          <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <AutocompleteSelect
              label="Cliente"
              placeholder={resolvedClientId && !isTechnician ? "Cliente atual" : "Buscar cliente"}
              value={draftFilters.clientId}
              options={clientAutocompleteOptions}
              onChange={(value) => setDraftFilters((prev) => ({ ...prev, clientId: value }))}
              allowClear
              className="w-full"
              disabled={Boolean(resolvedClientId && !isTechnician)}
            />
            <AutocompleteSelect
              label="Veículo"
              placeholder="Buscar veículo"
              value={draftFilters.vehicleId}
              options={vehicleAutocompleteOptions}
              loadOptions={loadVehicleOptions}
              onChange={(value) => setDraftFilters((prev) => ({ ...prev, vehicleId: value }))}
              allowClear
              className="w-full"
            />
            <AutocompleteSelect
              label="Status"
              placeholder="Filtrar status"
              value={draftFilters.status}
              options={statusAutocompleteOptions}
              onChange={(value) => setDraftFilters((prev) => ({ ...prev, status: value }))}
              allowClear
              className="w-full"
            />
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-white/60">Técnico</span>
              <input
                value={draftFilters.technician}
                onChange={(event) => setDraftFilters((prev) => ({ ...prev, technician: event.target.value }))}
                placeholder="Nome do técnico"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
              />
            </label>
          </div>
        }
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={applyFilters}
              className="rounded-xl bg-sky-500 px-3 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
            >
              Aplicar
            </button>
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
            >
              Limpar
            </button>
          </div>
        }
      />

      {!isTechnician && activeView === "map" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <DataCard className="h-[560px] overflow-hidden p-0">
            {mapMarkers.length ? (
              <AppMap center={mapCenter} zoom={10} className="h-full w-full" invalidateKey={mapMarkers.length}>
                <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
                {mapMarkers.map((marker) => (
                  <Marker
                    key={marker.id}
                    position={[marker.lat, marker.lng]}
                    icon={
                      createVehicleMarkerIcon({
                        iconType: "person",
                        label: marker.technicianName || "",
                        color: "#38bdf8",
                        accentColor: "rgba(56,189,248,0.45)",
                      }) || undefined
                    }
                  >
                    <Popup>
                      {(() => {
                        const technicianAddress =
                          addressByCoord[marker.coordKey] || geocodeCacheRef.current.get(marker.coordKey) || marker.locationAddress || "";
                        const googleMapsUrl = buildGoogleMapsUrl(marker);
                        return (
                      <div className="space-y-1 text-xs text-slate-800">
                        <div className="text-sm font-semibold text-slate-900">{marker.technicianName}</div>
                        <div>Estado: {marker.technicianState}</div>
                        <div>Cliente: {marker.clientName}</div>
                        <div>Serviço: {marker.serviceLabel}</div>
                        <div>Endereço serviço: {marker.serviceAddress || "—"}</div>
                        <div>
                          Local atual:{" "}
                          {technicianAddress || "Localizando endereço..."}
                        </div>
                        <div>
                          Previsão chegada: {marker.etaLabel}
                          {Number.isFinite(marker.etaDistanceMeters) ? ` (${formatDistanceCompact(marker.etaDistanceMeters)})` : ""}
                        </div>
                        <div>Fonte: {marker.locationSource}</div>
                        <div>Atualizado: {formatDate(marker.locationCapturedAt || marker.updatedAt)}</div>
                        <div className="mt-2 flex items-center gap-2">
                          {marker.serviceOrderId ? (
                            <button
                              type="button"
                              onClick={() => handleOpenServiceDetails(marker.serviceOrderId)}
                              className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-slate-700"
                            >
                              Abrir OS
                            </button>
                          ) : null}
                          {googleMapsUrl ? (
                            <button
                              type="button"
                              onClick={() => window.open(googleMapsUrl, "_blank", "noopener,noreferrer")}
                              className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-sky-500"
                              title="Abrir rota no Google Maps"
                            >
                              <Globe className="h-3.5 w-3.5" />
                              Mapa
                            </button>
                          ) : null}
                        </div>
                      </div>
                        );
                      })()}
                    </Popup>
                  </Marker>
                ))}
              </AppMap>
            ) : (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  title="Sem localização disponível"
                  subtitle="Quando os técnicos iniciarem o serviço com GPS liberado, os pontos aparecem aqui."
                />
              </div>
            )}
          </DataCard>

          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Técnicos com localização</h2>
            {mapMarkers.length ? (
              <div className="space-y-2">
                {mapMarkers.map((marker) => (
                  (() => {
                    const technicianAddress =
                      addressByCoord[marker.coordKey] || geocodeCacheRef.current.get(marker.coordKey) || marker.locationAddress || "";
                    const googleMapsUrl = buildGoogleMapsUrl(marker);
                    return (
                      <div key={`grid-${marker.id}`} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/75">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-semibold text-white">{marker.technicianName}</div>
                          <div className="text-[11px] text-white/60">{marker.technicianState}</div>
                        </div>
                        <div className="mt-1">{marker.clientName}</div>
                        <div className="mt-1 text-white/70">Serviço: {marker.serviceAddress || "—"}</div>
                        <div className="mt-1 text-white/60">Técnico: {technicianAddress || "Localizando endereço..."}</div>
                        <div className="mt-1 text-white/50">
                          Previsão: {marker.etaLabel}
                          {Number.isFinite(marker.etaDistanceMeters) ? ` (${formatDistanceCompact(marker.etaDistanceMeters)})` : ""}
                        </div>
                        <div className="mt-1 text-white/50">{formatDate(marker.locationCapturedAt || marker.updatedAt)}</div>
                        <div className="mt-2 flex items-center gap-2">
                          {marker.serviceOrderId ? (
                            <button
                              type="button"
                              onClick={() => handleOpenServiceDetails(marker.serviceOrderId)}
                              className="rounded-lg bg-white/10 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-white/15"
                            >
                              Abrir OS
                            </button>
                          ) : null}
                          {googleMapsUrl ? (
                            <button
                              type="button"
                              onClick={() => window.open(googleMapsUrl, "_blank", "noopener,noreferrer")}
                              className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-sky-500"
                              title="Abrir rota no Google Maps"
                            >
                              <Globe className="h-3.5 w-3.5" />
                              Mapa
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })()
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-4 text-sm text-white/60">
                Nenhum técnico com coordenadas no momento.
              </div>
            )}
          </DataCard>
        </div>
      ) : (
        <DataTable className="w-full" tableClassName="min-w-[1100px] w-full">
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
            {isTechnician ? (
              <tr className="text-left">
                <th className="e-hide-mobile w-64 px-4 py-3 sm:table-cell">Cliente</th>
                <th className="w-64 px-4 py-3">Serviço</th>
                <th className="e-hide-mobile w-96 px-4 py-3 md:table-cell">Endereço</th>
                <th className="e-hide-mobile w-44 px-4 py-3 sm:table-cell">Horário</th>
                <th className="w-44 px-4 py-3">Status</th>
                <th className="w-44 px-4 py-3 text-right">Ação</th>
              </tr>
            ) : (
              <tr className="text-left">
                <th className="e-hide-mobile w-64 px-4 py-3 sm:table-cell">Cliente</th>
                <th className="w-52 px-4 py-3">Técnico</th>
                <th className="e-hide-mobile w-52 px-4 py-3 md:table-cell">Estado técnico</th>
                <th className="w-64 px-4 py-3">Serviço</th>
                <th className="e-hide-mobile w-[360px] px-4 py-3 md:table-cell">Endereço</th>
                <th className="e-hide-mobile w-44 px-4 py-3 sm:table-cell">Atualizado</th>
                <th className="w-44 px-4 py-3 text-right">Ações</th>
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-white/10">
            {loading && (
              <tr>
                <td colSpan={isTechnician ? technicianColSpan : adminColSpan} className="px-4 py-6">
                  <SkeletonTable rows={6} columns={isTechnician ? technicianColSpan : adminColSpan} />
                </td>
              </tr>
            )}
            {!loading && liveItems.length === 0 && (
              <tr>
                <td colSpan={isTechnician ? technicianColSpan : adminColSpan} className="px-4 py-8">
                  <EmptyState
                    title="Nenhum atendimento em andamento."
                    subtitle="Quando houver atendimentos em rota ou execução eles serão listados aqui."
                  />
                </td>
              </tr>
            )}
            {!loading &&
              liveItems.map((item) => (
                (() => {
                  const technicianAddress = formatAddress(item.address);
                  const adminAddressSummary = buildAuditAddressSummary(item);
                  return (
                    <tr key={item.id} className="border-t border-white/10 hover:bg-white/5">
                      {isTechnician ? (
                        <>
                          <td className="e-hide-mobile px-4 py-3 sm:table-cell">
                            <div className="text-white/90">{item.clientName || "—"}</div>
                            <div className="text-xs text-white/50">{item.clientDocument || "—"}</div>
                          </td>
                          <td className="px-4 py-3 text-white/90">
                            <div>{item.type || "—"}</div>
                            <div className="text-xs text-white/50">{item.serviceReason || "—"}</div>
                          </td>
                          <td className="e-hide-mobile px-4 py-3 text-white/90 md:table-cell">
                            <div className="max-w-[360px] truncate" title={technicianAddress}>
                              {technicianAddress}
                            </div>
                          </td>
                          <td className="e-hide-mobile px-4 py-3 text-white/90 sm:table-cell">{formatDate(item.startTimeExpected || item.endTimeExpected)}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80">{resolveTaskStateLabel(item.status)}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {item.serviceOrderId ? (
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => openAuditModal(item.serviceOrder, item.serviceOrderId)}
                                  disabled={!item.serviceOrder}
                                  className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                                  title={item.serviceOrder ? "Auditar evidências" : "OS sem dados de evidências"}
                                >
                                  <Camera className="h-3.5 w-3.5" />
                                  Evidências
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleOpenServiceDetails(item.serviceOrderId, { execute: true })}
                                  className="rounded-xl bg-sky-500 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-sky-400"
                                >
                                  Iniciar Serviço
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-white/50">Sem OS vinculada</span>
                            )}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="e-hide-mobile px-4 py-3 sm:table-cell">
                            <div className="text-white/90">{item.clientName || "—"}</div>
                            <div className="text-xs text-white/50">{item.clientDocument || "—"}</div>
                          </td>
                          <td className="px-4 py-3 text-white/90">{item.technicianName || "—"}</td>
                          <td className="e-hide-mobile px-4 py-3 md:table-cell">
                            <span className="inline-flex rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80">{item.technicianState}</span>
                          </td>
                          <td className="px-4 py-3 text-white/90">
                            <div>{item.serviceOrder?.type || item.type || "—"}</div>
                            <div className="text-xs text-white/50">{item.serviceReason || item.serviceOrder?.reason || "—"}</div>
                          </td>
                          <td className="e-hide-mobile px-4 py-3 text-white/90 md:table-cell">
                            <div className="max-w-[340px] truncate" title={adminAddressSummary}>
                              {adminAddressSummary}
                            </div>
                          </td>
                          <td className="e-hide-mobile px-4 py-3 text-white/90 sm:table-cell">{formatDate(item.serviceOrder?.updatedAt || item.updatedAt)}</td>
                          <td className="px-4 py-3 text-right">
                            {item.serviceOrderId ? (
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => openAuditModal(item.serviceOrder, item.serviceOrderId)}
                                  disabled={!item.serviceOrder}
                                  className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                                  title={item.serviceOrder ? "Auditar evidências" : "OS sem dados de evidências"}
                                >
                                  <Camera className="h-3.5 w-3.5" />
                                  Evidências
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleOpenServiceDetails(item.serviceOrderId)}
                                  className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/15"
                                >
                                  Ver detalhes
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-white/50">Sem OS vinculada</span>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })()
              ))}
          </tbody>
        </DataTable>
      )}

      {auditModalOrder && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setAuditModalOrder(null)}>
          <div
            className="modal !max-w-[96vw] !w-[1150px] !max-h-[92vh] overflow-y-auto border border-white/20 bg-[#0a1220]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-white">
                  Auditoria VAR: OS {auditModalOrder?.osInternalId || auditModalOrder?.id || "—"}
                </div>
                <div className="mt-1 text-xs text-white/60">
                  {auditModalOrder?.clientName || "—"} • {auditModalOrder?.technicianName || "—"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAuditModalOrder(null)}
                className="rounded-lg bg-white/10 p-2 text-white transition hover:bg-white/20"
                aria-label="Fechar auditoria"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-white/70">Checklist Antes/Depois</h3>
                {checklistAuditRows.length ? (
                  <div className="overflow-hidden rounded-xl border border-white/10">
                    <table className="min-w-full text-left text-xs text-white/75">
                      <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-white/60">
                        <tr>
                          <th className="px-3 py-2">Item</th>
                          <th className="px-3 py-2 text-center">Antes</th>
                          <th className="px-3 py-2 text-center">Depois</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {checklistAuditRows.map((row) => {
                          const hasBefore = row.beforeMedia.length > 0;
                          const hasAfter = row.afterMedia.length > 0;
                          return (
                            <tr key={row.id}>
                              <td className="px-3 py-2 text-white">{row.label}</td>
                              <td className="px-3 py-2 text-center">
                                <button
                                  type="button"
                                  disabled={!hasBefore}
                                  onClick={() => openAuditViewer(row.beforeMedia)}
                                  className="rounded-lg p-1.5 text-white transition enabled:bg-white/10 enabled:hover:bg-white/20 disabled:opacity-35"
                                  title={hasBefore ? "Abrir mídia Antes" : "Sem mídia"}
                                >
                                  <Camera className="h-4 w-4" />
                                </button>
                              </td>
                              <td className="px-3 py-2 text-center">
                                <button
                                  type="button"
                                  disabled={!hasAfter}
                                  onClick={() => openAuditViewer(row.afterMedia)}
                                  className="rounded-lg p-1.5 text-white transition enabled:bg-white/10 enabled:hover:bg-white/20 disabled:opacity-35"
                                  title={hasAfter ? "Abrir mídia Depois" : "Sem mídia"}
                                >
                                  <Camera className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-4 text-sm text-white/60">
                    Nenhum item de checklist encontrado.
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-white/70">Equipamentos</h3>
                {equipmentAuditRows.length ? (
                  <div className="overflow-hidden rounded-xl border border-white/10">
                    <table className="min-w-full text-left text-xs text-white/75">
                      <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-white/60">
                        <tr>
                          <th className="px-3 py-2">Equipamento</th>
                          <th className="px-3 py-2 text-center">Inicial</th>
                          <th className="px-3 py-2 text-center">Instalado</th>
                          <th className="px-3 py-2 text-center">Vídeo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {equipmentAuditRows.map((row) => {
                          const hasInitial = row.initialPhoto.length > 0;
                          const hasInstalled = row.installedPhoto.length > 0;
                          const hasVideo = row.installationVideo.length > 0;
                          return (
                            <tr key={row.id}>
                              <td className="px-3 py-2 text-white">{row.label}</td>
                              <td className="px-3 py-2 text-center">
                                <button
                                  type="button"
                                  disabled={!hasInitial}
                                  onClick={() => openAuditViewer(row.initialPhoto)}
                                  className="rounded-lg p-1.5 text-white transition enabled:bg-white/10 enabled:hover:bg-white/20 disabled:opacity-35"
                                  title={hasInitial ? "Abrir foto inicial" : "Sem mídia"}
                                >
                                  <Camera className="h-4 w-4" />
                                </button>
                              </td>
                              <td className="px-3 py-2 text-center">
                                <button
                                  type="button"
                                  disabled={!hasInstalled}
                                  onClick={() => openAuditViewer(row.installedPhoto)}
                                  className="rounded-lg p-1.5 text-white transition enabled:bg-white/10 enabled:hover:bg-white/20 disabled:opacity-35"
                                  title={hasInstalled ? "Abrir foto instalado" : "Sem mídia"}
                                >
                                  <Camera className="h-4 w-4" />
                                </button>
                              </td>
                              <td className="px-3 py-2 text-center">
                                <button
                                  type="button"
                                  disabled={!hasVideo}
                                  onClick={() => openAuditViewer(row.installationVideo)}
                                  className="rounded-lg p-1.5 text-white transition enabled:bg-white/10 enabled:hover:bg-white/20 disabled:opacity-35"
                                  title={hasVideo ? "Abrir vídeo" : "Sem mídia"}
                                >
                                  <Camera className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-4 text-sm text-white/60">
                    Nenhum equipamento encontrado.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <MediaViewerModal
        open={auditViewerItems.length > 0}
        items={auditViewerItems}
        index={auditViewerIndex}
        onChangeIndex={setAuditViewerIndex}
        onClose={() => {
          setAuditViewerItems([]);
          setAuditViewerIndex(0);
        }}
      />
    </div>
  );
}
