import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { Clock3, Download, Link2, MapPin, Pencil, Plus, RefreshCw, Search, Trash2, Unlink, Wifi, X } from "lucide-react";
import { latLngBounds } from "leaflet";
import "leaflet/dist/leaflet.css";

import Button from "../ui/Button";
import Modal from "../ui/Modal";
import Input from "../ui/Input";
import Select from "../ui/Select";
import AutocompleteSelect from "../components/ui/AutocompleteSelect.jsx";
import PageHeader from "../components/ui/PageHeader.jsx";
import FilterBar from "../components/ui/FilterBar.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import SkeletonTable from "../components/ui/SkeletonTable.jsx";
import DataTablePagination from "../ui/DataTablePagination.jsx";
import { CoreApi, normaliseListPayload } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { useConfirmDialog } from "../components/ui/ConfirmDialogProvider.jsx";
import { useLivePositions } from "../lib/hooks/useLivePositions.js";
import useTraccarDevices from "../lib/hooks/useTraccarDevices.js";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";
import useMapLifecycle from "../lib/map/useMapLifecycle.js";
import { formatAddress } from "../lib/format-address.js";

const PAGE_SIZE_OPTIONS = [5, 20, 50, 100, 500, 1000, 5000];

function parsePositionTime(position) {
  if (!position) return null;
  const time = Date.parse(
    position.fixTime ?? position.deviceTime ?? position.serverTime ?? position.timestamp ?? position.time ?? 0,
  );
  return Number.isNaN(time) ? null : time;
}

function formatDate(value) {
  const parsed = Date.parse(value || 0);
  if (!value || Number.isNaN(parsed)) return null;
  return new Date(parsed).toLocaleString();
}

function formatPositionTimestamps(position) {
  if (!position) return "—";
  const parts = [];
  const gpsTime = formatDate(position.fixTime);
  if (gpsTime) parts.push(`GPS: ${gpsTime}`);
  const deviceTime = formatDate(position.deviceTime);
  if (deviceTime && deviceTime !== gpsTime) parts.push(`Dispositivo: ${deviceTime}`);
  const serverTime = formatDate(position.serverTime);
  if (serverTime && serverTime !== gpsTime && serverTime !== deviceTime) parts.push(`Servidor: ${serverTime}`);
  const eventTime = formatDate(position.eventTime || position.eventtime);
  if (eventTime) parts.push(`Evento: ${eventTime}`);
  const timestampTime = formatDate(position.timestamp);
  if (!parts.length && timestampTime) parts.push(`Timestamp: ${timestampTime}`);
  return parts.length ? parts.join(" · ") : "—";
}

function DeviceRow({
  device,
  traccarDevice,
  model,
  vehicle,
  position,
  status,
  warrantyLabel,
  onMap,
  onLink,
  onUnlink,
  onNavigateToMonitoring,
  onEdit,
  onDelete,
  positionLabel,
  lastCommunication,
}) {
  const imei = device.uniqueId || traccarDevice?.uniqueId || "—";
  const internalCode = device?.attributes?.internalCode || device?.internalCode || "—";
  const modelLabel = model?.name || device?.modelName || "—";
  const modelDetail = model?.version || model?.protocol || device?.modelProtocol || "";
  return (
    <tr className="hover:bg-white/5">
      <td className="px-3 py-3">
        <div className="font-semibold text-white">{imei}</div>
        <div className="text-xs text-white/50">ID interno {internalCode}</div>
      </td>
      <td className="px-3 py-3">
        <div className="text-white">{modelLabel}</div>
        <div className="text-xs text-white/50">{modelDetail}</div>
      </td>
      <td className="px-3 py-3">
        <StatusPill meta={status} />
      </td>
      <td className="px-3 py-3">
        <div className="text-white">{lastCommunication}</div>
      </td>
      <td className="px-3 py-3">
        <div
          className="text-xs text-white/70 leading-snug break-words"
          title={positionLabel || ""}
        >
          {positionLabel}
        </div>
      </td>
      <td className="px-3 py-3">
        {vehicle ? (
          <button
            type="button"
            onClick={onNavigateToMonitoring}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white hover:border-primary"
          >
            <Link2 className="h-3 w-3" />
            <div className="text-left">
              <div className="font-medium">{vehicle.plate || vehicle.name || "Veículo"}</div>
              <div className="text-[11px] text-white/60">{vehicle.clientName || "Vinculado"}</div>
            </div>
          </button>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
            <X className="h-3 w-3" />
            <span>Não vinculado</span>
            <button
              type="button"
              onClick={onLink}
              className="ml-2 rounded-md border border-primary/50 bg-primary/10 px-2 py-1 text-[11px] font-medium text-white"
            >
              Vincular
            </button>
          </div>
        )}
      </td>
      <td className="px-3 py-3 text-white/70">{warrantyLabel}</td>
      <td className="px-3 py-3 text-right">
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white hover:border-white/30"
            onClick={onEdit}
            aria-label="Editar equipamento"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {vehicle && (
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white hover:border-white/30"
              onClick={onUnlink}
              aria-label="Desvincular"
            >
              <Unlink className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white hover:border-white/30"
            onClick={onMap}
            aria-label="Ver no mapa"
          >
            <MapPin className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-400/30 text-red-200 hover:border-red-300"
            onClick={onDelete}
            aria-label="Remover"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function StatusPill({ meta }) {
  if (!meta) return <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/70">—</span>;
  const tone =
    meta.tone === "success"
      ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-50"
      : meta.tone === "warning"
      ? "bg-amber-500/20 border-amber-500/40 text-amber-50"
      : "bg-white/10 border-white/20 text-white/80";
  const Icon = meta.icon || Wifi;
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${tone}`}>
      <Icon className="h-3.5 w-3.5" />
      {meta.label}
    </span>
  );
}

function Drawer({ open, onClose, title, description, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9998] flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-3xl border-l border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Detalhes do equipamento</p>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {description && <p className="text-sm text-white/60">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-white/70 transition hover:border-white/30 hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="h-[calc(100%-80px)] overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

export default function Devices() {
  const { tenantId, user } = useTenant();
  const location = useLocation();
  const navigate = useNavigate();
  const { positions } = useLivePositions();
  const { byId: traccarById, byUniqueId: traccarByUniqueId, loading: traccarLoading } = useTraccarDevices();
  const [devices, setDevices] = useState([]);
  const [models, setModels] = useState([]);
  const [chips, setChips] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingDevice, setSavingDevice] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [showDeviceDrawer, setShowDeviceDrawer] = useState(false);
  const [conflictDevice, setConflictDevice] = useState(null);
  const [linkTarget, setLinkTarget] = useState(null);
  const [linkVehicleId, setLinkVehicleId] = useState("");
  const [linkQuery, setLinkQuery] = useState("");
  const { confirmDelete } = useConfirmDialog();
  const [filters, setFilters] = useState({
    status: "all",
    link: "all",
    model: "",
  });
  const [modelDraft, setModelDraft] = useState("");
  const resolvedClientId = tenantId || user?.clientId || null;
  const [syncing, setSyncing] = useState(false);
  const [drawerTab, setDrawerTab] = useState("geral");
  const [initializedFromSearch, setInitializedFromSearch] = useState(false);
  const [creatingVehicle, setCreatingVehicle] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({ plate: "", name: "" });

  const [deviceForm, setDeviceForm] = useState({
    name: "",
    uniqueId: "",
    modelId: "",
    internalCode: "",
    gprsCommunication: true,
    condition: "",
    chipId: "",
    vehicleId: "",
    productionDate: "",
    installationDate: "",
    warrantyOrigin: "production",
    warrantyDays: "",
    warrantyEndDate: "",
  });
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [bulkRows, setBulkRows] = useState([{ imei: "", internalCode: "", gprsCommunication: null }]);
  const [bulkGprsDefault, setBulkGprsDefault] = useState(true);
  const [bulkModelId, setBulkModelId] = useState("");
  const [bulkImeiPrefix, setBulkImeiPrefix] = useState("");
  const [bulkImeiStart, setBulkImeiStart] = useState("");
  const [bulkImeiEnd, setBulkImeiEnd] = useState("");
  const [savingBulk, setSavingBulk] = useState(false);
  const [mapTarget, setMapTarget] = useState(null);
  const mapRef = useRef(null);
  const { onMapReady } = useMapLifecycle({ mapRef });
  const toastTimeoutRef = useRef(null);
  const [toast, setToast] = useState(null);
  const conflictMatch = useMemo(() => {
    if (!conflictDevice?.uniqueId) return null;
    return devices.find(
      (item) =>
        (conflictDevice.deviceId && String(item.id) === String(conflictDevice.deviceId)) ||
        (item.uniqueId &&
          String(item.uniqueId).toLowerCase() === String(conflictDevice.uniqueId).toLowerCase()),
    );
  }, [conflictDevice, devices]);

  const positionMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(positions) ? positions : []).forEach((position) => {
      const key = toDeviceKey(position?.deviceId ?? position?.device_id ?? position?.deviceID ?? position?.deviceid);
      if (!key) return;
      const time = parsePositionTime(position);
      const existing = map.get(key);
      if (!existing || (time !== null && (existing.parsedTime === undefined || time > existing.parsedTime))) {
        map.set(key, { ...position, parsedTime: time });
      }
    });
    return map;
  }, [positions]);

  useEffect(() => () => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
  }, []);

  function showToast(message, type = "info") {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 4000);
  }

  const deviceKey = (device) => toDeviceKey(device?.traccarId ?? device?.id ?? device?.internalId ?? device?.uniqueId);

  const traccarDeviceFor = (device) => {
    const byIdMatch = device?.traccarId != null ? traccarById.get(String(device.traccarId)) : null;
    if (byIdMatch) return byIdMatch;
    if (device?.uniqueId) return traccarByUniqueId.get(String(device.uniqueId)) || null;
    return null;
  };

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const clientId = tenantId || user?.clientId;
      const vehiclesParams = clientId ? { clientId } : {};
      vehiclesParams.accessible = true;
      vehiclesParams.includeUnlinked = true;
      const [deviceResult, modelResult, chipResult, vehicleResult] = await Promise.allSettled([
        CoreApi.listDevices(clientId ? { clientId } : undefined),
        CoreApi.models(clientId ? { clientId, includeGlobal: true } : undefined),
        CoreApi.listChips(clientId ? { clientId } : undefined),
        CoreApi.listVehicles(vehiclesParams),
      ]);

      if (deviceResult.status === "fulfilled") {
        setDevices(normaliseListPayload(deviceResult.value));
      } else {
        throw deviceResult.reason || new Error("Falha ao carregar equipamentos");
      }

      const warnings = [];

      if (modelResult.status === "fulfilled") {
        setModels(normaliseListPayload(modelResult.value));
      } else {
        setModels([]);
        warnings.push("modelos");
      }

      if (chipResult.status === "fulfilled") {
        setChips(normaliseListPayload(chipResult.value));
      } else {
        setChips([]);
        warnings.push("chips");
      }

      if (vehicleResult.status === "fulfilled") {
        setVehicles(normaliseListPayload(vehicleResult.value));
      } else {
        setVehicles([]);
        warnings.push("veículos");
      }

      if (warnings.length) {
        showToast(`Algumas listas não carregaram: ${warnings.join(", ")}.`, "warning");
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : new Error("Falha ao carregar dados"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (resolvedClientId || user) {
      load();
    }
  }, [resolvedClientId, user]);

  useEffect(() => {
    setFilters({ status: "all", link: "all", model: "" });
    setQuery("");
    setLinkTarget(null);
    setLinkVehicleId("");
    setLinkQuery("");
    setMapTarget(null);
    setShowDeviceDrawer(false);
    setInitializedFromSearch(false);
  }, [resolvedClientId]);

  useEffect(() => {
    if (initializedFromSearch) return;
    const params = new URLSearchParams(location.search);
    const linkParam = params.get("link");
    if (linkParam && ["all", "linked", "unlinked"].includes(linkParam)) {
      setFilters((current) => ({ ...current, link: linkParam }));
      setInitializedFromSearch(true);
    } else if (!initializedFromSearch) {
      setInitializedFromSearch(true);
    }
  }, [initializedFromSearch, location.search]);

  useEffect(() => {
    if (!initializedFromSearch) return;
    const params = new URLSearchParams(location.search);
    if (filters.link === "all") {
      params.delete("link");
    } else {
      params.set("link", filters.link);
    }
    const nextSearch = params.toString() ? `?${params.toString()}` : "";
    if (nextSearch !== location.search) {
      navigate({ search: nextSearch }, { replace: true });
    }
  }, [filters.link, initializedFromSearch, location.search, navigate]);

  useEffect(() => {
    const map = mapRef.current;
    const target = mapTarget?.position;
    if (!map || !target) return undefined;
    const lat = Number(target.latitude ?? target.lat ?? target.latitute);
    const lng = Number(target.longitude ?? target.lon ?? target.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
    let rafId = null;
    let isActive = true;

    const canInteract = () => {
      if (!map || !map._loaded || !map._mapPane) return false;
      const container = map.getContainer?.();
      if (!container || container.isConnected === false) return false;
      const rect = container.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      return true;
    };

    const run = () => {
      if (!isActive || !canInteract()) return;
      const bounds = latLngBounds([[lat, lng]]);
      map.fitBounds(bounds.pad(0.02), { maxZoom: 16 });
      rafId = requestAnimationFrame(() => {
        if (!isActive || !canInteract()) return;
        map.invalidateSize({ pan: false });
      });
    };

    if (map.whenReady && !map._loaded) {
      map.whenReady(run);
    } else {
      run();
    }

    return () => {
      isActive = false;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [mapTarget]);

  useEffect(() => {
    if (linkTarget?.vehicleId) {
      setLinkVehicleId(linkTarget.vehicleId);
    }
  }, [linkTarget]);

  useEffect(() => {
    if (!conflictDevice || conflictDevice.deviceId || !conflictMatch?.id) return;
    setConflictDevice((current) => {
      if (!current || current.deviceId) return current;
      return { ...current, deviceId: conflictMatch.id };
    });
  }, [conflictDevice, conflictMatch]);

  useEffect(() => {
    const origin = deviceForm.warrantyOrigin || "production";
    const start = origin === "installation" ? deviceForm.installationDate : deviceForm.productionDate;
    const days = Number(deviceForm.warrantyDays);
    if (!start || !Number.isFinite(days) || days <= 0) {
      if (deviceForm.warrantyEndDate) {
        setDeviceForm((current) => ({ ...current, warrantyEndDate: "" }));
      }
      return;
    }
    const parsed = new Date(start);
    if (Number.isNaN(parsed.getTime())) return;
    const next = new Date(parsed);
    next.setDate(next.getDate() + days);
    const nextValue = next.toISOString().slice(0, 10);
    if (deviceForm.warrantyEndDate !== nextValue) {
      setDeviceForm((current) => ({ ...current, warrantyEndDate: nextValue }));
    }
  }, [
    deviceForm.installationDate,
    deviceForm.productionDate,
    deviceForm.warrantyDays,
    deviceForm.warrantyEndDate,
    deviceForm.warrantyOrigin,
  ]);

  const modeloById = useMemo(() => {
    const map = new Map();
    models.forEach((model) => {
      if (model?.id || model?.id === 0) {
        map.set(String(model.id), model);
      }
    });
    return map;
  }, [models]);
  const modelOptions = useMemo(
    () =>
    models.map((model) => ({
      value: String(model.id),
      label: model.name || model.model || model.id,
      description: model.brand || model.vendor || model.protocol || "",
      searchText: `${model.name || ""} ${model.brand || ""} ${model.protocol || ""}`.trim(),
      data: model,
    })),
    [models],
  );
  const loadModelOptions = useCallback(
    async ({ query, page, pageSize }) => {
      const response = await CoreApi.searchModels({
        clientId: resolvedClientId || undefined,
        includeGlobal: true,
        query,
        page,
        pageSize,
      });
      const list = response?.models || response?.data || [];
      const options = list.map((model) => ({
        value: String(model.id),
        label: model.name || model.model || model.id,
        description: model.brand || model.vendor || model.protocol || "",
        searchText: `${model.name || ""} ${model.brand || ""} ${model.protocol || ""}`.trim(),
        data: model,
      }));
      return { options, hasMore: Boolean(response?.hasMore) };
    },
    [resolvedClientId],
  );

  const chipOptions = useMemo(() => {
    return chips.map((chip) => ({
      value: chip.id,
      label: chip.iccid || chip.phone || chip.device?.uniqueId || chip.id,
      description: chip.carrier || chip.provider || "",
      data: chip,
    }));
  }, [chips]);
  const chipById = useMemo(() => {
    const map = new Map();
    chips.forEach((chip) => {
      if (chip?.id) map.set(chip.id, chip);
    });
    return map;
  }, [chips]);

  const vehicleOptions = useMemo(() => {
    return vehicles.map((vehicle) => ({
      value: vehicle.id,
      label: vehicle.name || vehicle.plate || vehicle.id,
      description: vehicle.plate || "",
      data: vehicle,
    }));
  }, [vehicles]);
  const vehicleById = useMemo(() => {
    const map = new Map();
    vehicles.forEach((vehicle) => {
      if (vehicle?.id) map.set(vehicle.id, vehicle);
    });
    return map;
  }, [vehicles]);
  const loadChipOptions = useCallback(
    async ({ query, page, pageSize }) => {
      const response = await CoreApi.searchChips({
        clientId: resolvedClientId || undefined,
        query,
        page,
        pageSize,
      });
      const list = response?.chips || response?.data || [];
      const options = list.map((chip) => ({
        value: chip.id,
        label: chip.iccid || chip.phone || chip.device?.uniqueId || chip.id,
        description: chip.carrier || chip.provider || "",
        data: chip,
      }));
      return { options, hasMore: Boolean(response?.hasMore) };
    },
    [resolvedClientId],
  );
  const loadVehicleOptions = useCallback(
    async ({ query, page, pageSize }) => {
      const response = await CoreApi.searchVehicles({
        clientId: resolvedClientId || undefined,
        query,
        page,
        pageSize,
        includeUnlinked: true,
      });
      const list = response?.vehicles || response?.data || [];
      const options = list.map((vehicle) => ({
        value: vehicle.id,
        label: `${vehicle.plate || vehicle.name || vehicle.id}${vehicle.clientName ? ` · ${vehicle.clientName}` : ""}`,
        description: vehicle.type || "",
        data: vehicle,
      }));
      return { options, hasMore: Boolean(response?.hasMore) };
    },
    [resolvedClientId],
  );

  const latestPositionByDevice = useMemo(() => {
    const map = new Map();
    devices.forEach((device) => {
      const key = deviceKey(device);
      if (!key) return;
      const pos = positionMap.get(key);
      if (pos) {
        map.set(key, pos);
      }
    });
    return map;
  }, [devices, positionMap]);


  function relativeTimeFromNow(timestamp) {
    if (!timestamp) return null;
    const diff = Date.now() - timestamp;
    if (diff < 60 * 1000) return "agora";
    const minutes = Math.round(diff / (60 * 1000));
    if (minutes < 60) return `há ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `há ${hours} h`;
    const days = Math.round(hours / 24);
    return `há ${days} d`;
  }

  function formatPositionSummary(position) {
    if (!position) return "—";
    const address = position.address || position.attributes?.address;
    if (address) return formatAddress(address);
    const lat = Number(position.latitude ?? position.lat ?? position.latitute);
    const lon = Number(position.longitude ?? position.lon ?? position.lng);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    }
    return "—";
  }

  function formatWarranty(device) {
    const attrs = device?.attributes || {};
    let warrantyEnd = attrs.warrantyEndDate || attrs.warrantyUntil || attrs.warrantyDate || null;
    if (!warrantyEnd) {
      const origin = attrs.warrantyOrigin || "production";
      const start =
        origin === "installation"
          ? attrs.installationDate || attrs.warrantyStartDate || null
          : attrs.productionDate || attrs.warrantyStartDate || null;
      const days = Number(attrs.warrantyDays);
      if (start && Number.isFinite(days) && days > 0) {
        const parsed = new Date(start);
        if (!Number.isNaN(parsed.getTime())) {
          const computed = new Date(parsed);
          computed.setDate(computed.getDate() + days);
          warrantyEnd = computed.toISOString().slice(0, 10);
        }
      }
    }
    if (!warrantyEnd) return "—";
    const parsed = new Date(warrantyEnd);
    if (Number.isNaN(parsed.getTime())) return String(warrantyEnd);
    return parsed.toLocaleDateString("pt-BR");
  }

  function latestTelemetry(device) {
    const key = deviceKey(device);
    const position = latestPositionByDevice.get(key);
    const traccarDevice = traccarDeviceFor(device);
    const positionTime = position?.parsedTime || null;
    const statusTime = parseTimestamp(traccarDevice?.lastUpdate || traccarDevice?.lastCommunication);
    const deviceTime = parseTimestamp(device.lastCommunication || device.lastUpdate);
    const latestTime = Math.max(positionTime || 0, statusTime || 0, deviceTime || 0);
    return { position, latestTime: latestTime || null, traccarDevice };
  }

  function statusMeta(device) {
    const key = deviceKey(device);
    const position = latestPositionByDevice.get(key);
    const traccarDevice = traccarDeviceFor(device);
    const positionTime = position?.parsedTime || null;
    const statusTime = parseTimestamp(traccarDevice?.lastUpdate || traccarDevice?.lastCommunication);
    const deviceTime = parseTimestamp(device.lastCommunication || device.lastUpdate);
    const latestTime = Math.max(positionTime || 0, statusTime || 0, deviceTime || 0);
    if (!latestTime) {
      return { code: ">24h", label: "Sem comunicação", tone: "muted", icon: Clock3 };
    }
    const diff = Date.now() - latestTime;
    const hours = diff / (1000 * 60 * 60);
    if (hours <= 0.083) {
      return { code: "online", label: "Online", tone: "success", icon: Wifi };
    }
    if (hours <= 1) {
      return { code: "offline", label: "Offline", tone: "warning", icon: SignalMedium };
    }
    if (hours <= 6) {
      return { code: "1-6h", label: "Sem transmissão 1–6h", tone: "warning", icon: Clock3 };
    }
    if (hours <= 24) {
      return { code: "6-24h", label: "Sem transmissão 6–24h", tone: "muted", icon: Clock3 };
    }
    return { code: ">24h", label: ">24h sem transmissão", tone: "muted", icon: Clock3 };
  }

  const filteredDevices = useMemo(() => {
    const term = query.trim().toLowerCase();
    return devices.filter((device) => {
      const chip = chipById.get(device.chipId) || device.chip;
      const vehicle = vehicleById.get(device.vehicleId) || device.vehicle;
      const deviceModelId = device.modelId || device.attributes?.modelId;
      const model = deviceModelId ? modeloById.get(String(deviceModelId)) : null;

      if (term) {
        const haystack = [
          device.name,
          device.uniqueId,
          device.imei,
          device.attributes?.internalCode,
          chip?.iccid,
          chip?.phone,
          vehicle?.plate,
          vehicle?.name,
          device.modelName,
          model?.name,
        ]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase());
        const matches = haystack.some((value) => value.includes(term));
        if (!matches) return false;
      }

      if (filters.link === "linked" && !device.vehicleId && !device.vehicle) return false;
      if (filters.link === "unlinked" && (device.vehicleId || device.vehicle)) return false;

    if (filters.model && String(deviceModelId || "") !== String(filters.model)) return false;

      if (filters.status !== "all") {
        const meta = statusMeta(device);
        if (meta.code !== filters.status) return false;
      }

      return true;
    });
  }, [chipById, devices, filters.link, filters.model, filters.status, modeloById, query, vehicleById]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters.link, filters.model, filters.status, query]);

  const effectivePageSize = pageSize === "all" ? filteredDevices.length || 1 : Number(pageSize);
  const totalPages =
    pageSize === "all" ? 1 : Math.max(1, Math.ceil(filteredDevices.length / Math.max(effectivePageSize, 1)));
  const resolvedPage = Math.min(currentPage, totalPages);
  const paginatedDevices = useMemo(() => {
    if (pageSize === "all") return filteredDevices;
    const start = (resolvedPage - 1) * effectivePageSize;
    return filteredDevices.slice(start, start + effectivePageSize);
  }, [effectivePageSize, filteredDevices, pageSize, resolvedPage]);

  const bulkValidation = useMemo(() => {
    const normalizedRows = bulkRows.map((row) => ({
      imei: String(row.imei || "").trim(),
      internalCode: String(row.internalCode || "").trim(),
    }));
    const imeiCounts = new Map();
    const codeCounts = new Map();
    normalizedRows.forEach((row) => {
      if (row.imei) {
        const key = row.imei.toLowerCase();
        imeiCounts.set(key, (imeiCounts.get(key) || 0) + 1);
      }
      if (row.internalCode) {
        const key = row.internalCode.toLowerCase();
        codeCounts.set(key, (codeCounts.get(key) || 0) + 1);
      }
    });

    const existingImeis = new Set(
      devices
        .map((device) => (device.uniqueId ? String(device.uniqueId).toLowerCase() : null))
        .filter(Boolean),
    );
    const existingInternalCodes = new Set(
      devices
        .map((device) => (device.attributes?.internalCode ? String(device.attributes.internalCode).toLowerCase() : null))
        .filter(Boolean),
    );

    const rowErrors = normalizedRows.map((row) => {
      const errors = [];
      if (!bulkModelId) {
        errors.push("Selecione o modelo do lote.");
      }
      if (!row.imei) {
        errors.push("Informe o IMEI.");
      } else {
        if (!/^\d{8}$/.test(row.imei)) {
          errors.push("IMEI deve ter 8 dígitos.");
        }
        const key = row.imei.toLowerCase();
        if ((imeiCounts.get(key) || 0) > 1) errors.push("IMEI duplicado na lista.");
        if (existingImeis.has(key)) errors.push("IMEI já cadastrado.");
      }

      if (!row.internalCode) {
        errors.push("Informe o código interno.");
      } else {
        const key = row.internalCode.toLowerCase();
        if ((codeCounts.get(key) || 0) > 1) errors.push("Código interno duplicado na lista.");
        if (existingInternalCodes.has(key)) errors.push("Código interno já cadastrado.");
      }

      return errors;
    });

    return {
      rowErrors,
      hasErrors: rowErrors.some((errors) => errors.length > 0),
    };
  }, [bulkModelId, bulkRows, devices]);

  useEffect(() => {
    setModelDraft(filters.model || "");
  }, [filters.model]);


  function parseTimestamp(value) {
    if (!value) return null;
    const ts = Date.parse(value);
    return Number.isNaN(ts) ? null : ts;
  }

  function getStatus(device) {
    return statusMeta(device);
  }


  function formatPosition(device) {
    const key = deviceKey(device);
    const position = latestPositionByDevice.get(key);
    return formatPositionSummary(position);
  }


  function formatSpeed(device) {
    const key = deviceKey(device);
    const position = latestPositionByDevice.get(key);

    if (!position?.speed) return "0 km/h";
    const speedKmh = Number(position.speed) * 1.852 || Number(position.speed);
    if (!Number.isFinite(speedKmh)) return "—";
    return `${speedKmh.toFixed(1)} km/h`;
  }


  function formatLastCommunication(device) {
    const { latestTime } = latestTelemetry(device);
    if (!latestTime) return "—";
    const relative = relativeTimeFromNow(latestTime);
    return `${new Date(latestTime).toLocaleString()}${relative ? ` · ${relative}` : ""}`;
  }

  function formatBattery(device) {
    const key = deviceKey(device);
    const position = latestPositionByDevice.get(key);
    if (!position) return "—";
    const attrs = position.attributes || {};
    const battery = attrs.batteryLevel ?? attrs.battery ?? attrs.power ?? attrs.charge;
    if (battery === null || battery === undefined) return "—";
    const numericBattery = Number(battery);
    if (Number.isFinite(numericBattery)) {
      const bounded = Math.max(0, Math.min(100, numericBattery));
      return `${bounded.toFixed(0)}%`;
    }
    return String(battery);
  }

  function formatIgnition(device) {
    const key = deviceKey(device);
    const position = latestPositionByDevice.get(key);
    const attrs = position?.attributes || {};
    if (typeof attrs.ignition === "boolean") {
      return attrs.ignition ? "Ignição ON" : "Ignição OFF";
    }
    return null;

  }

  function formatIoSummary(attrs, prefix) {
    if (!attrs) return "—";
    const entries = Object.entries(attrs).filter(([key]) => key.toLowerCase().startsWith(prefix));
    if (!entries.length) return "—";
    return entries
      .map(([key, value]) => {
        const normalized = typeof value === "boolean" ? (value ? "On" : "Off") : value;
        return `${key.replace(prefix, prefix.toUpperCase())}: ${normalized}`;
      })
      .join(" · ");
  }

  function formatInputs(device) {
    const key = deviceKey(device);
    const position = latestPositionByDevice.get(key);
    const attrs = position?.attributes || {};
    return formatIoSummary(attrs, "input");
  }

  function formatOutputs(device) {
    const key = deviceKey(device);
    const position = latestPositionByDevice.get(key);
    const attrs = position?.attributes || {};
    return formatIoSummary(attrs, "output");
  }

  function formatVehicleVoltage(device) {
    const key = deviceKey(device);
    const position = latestPositionByDevice.get(key);
    const attrs = position?.attributes || {};
    const voltage = attrs.vehicleVoltage ?? attrs.voltage ?? attrs.power ?? attrs.batteryVoltage;
    if (voltage === null || voltage === undefined) return "—";
    const numeric = Number(voltage);
    if (Number.isFinite(numeric)) {
      return `${numeric.toFixed(1)} V`;
    }
    return String(voltage);
  }

  function resetDeviceForm() {
    setDeviceForm({
      name: "",
      uniqueId: "",
      modelId: "",
      internalCode: "",
      gprsCommunication: true,
      condition: "",
      chipId: "",
      vehicleId: "",
      productionDate: "",
      installationDate: "",
      warrantyOrigin: "production",
      warrantyDays: "",
      warrantyEndDate: "",
    });
    setEditingId(null);
  }

  async function handleSaveDevice(event) {
    event.preventDefault();
    if (!deviceForm.uniqueId.trim()) {
      showToast("Informe o IMEI / uniqueId", "error");
      return;
    }
    const warrantyOrigin = deviceForm.warrantyOrigin || "production";
    const hasWarrantyDates = Boolean(deviceForm.productionDate || deviceForm.installationDate);
    const warrantyDaysValue = deviceForm.warrantyDays === "" ? null : Number(deviceForm.warrantyDays);
    const startDate =
      warrantyOrigin === "installation" ? deviceForm.installationDate : deviceForm.productionDate;
    if (hasWarrantyDates && (!Number.isFinite(warrantyDaysValue) || warrantyDaysValue <= 0)) {
      showToast("Informe os dias de garantia para calcular o fim da garantia.", "error");
      return;
    }
    if (Number.isFinite(warrantyDaysValue) && warrantyDaysValue > 0 && !startDate) {
      showToast("Informe a data base para calcular a garantia.", "error");
      return;
    }
    if (Number.isFinite(warrantyDaysValue) && warrantyDaysValue > 0 && !deviceForm.warrantyEndDate) {
      showToast("Data fim da garantia não pode ficar vazia.", "error");
      return;
    }
    const currentDevice = editingId ? devices.find((item) => String(item.id) === String(editingId)) : null;
    const clientId = tenantId || user?.clientId || currentDevice?.clientId || "";
    if (!clientId) {
      showToast("Selecione um cliente para salvar o equipamento", "error");
      return;
    }
    setSavingDevice(true);
    try {
      const warrantyPayload = {};
      if (deviceForm.productionDate) warrantyPayload.productionDate = deviceForm.productionDate;
      if (deviceForm.installationDate) warrantyPayload.installationDate = deviceForm.installationDate;
      if (deviceForm.warrantyOrigin) warrantyPayload.warrantyOrigin = deviceForm.warrantyOrigin;
      if (deviceForm.warrantyDays !== "") warrantyPayload.warrantyDays = Number(deviceForm.warrantyDays) || 0;
      if (deviceForm.warrantyEndDate) warrantyPayload.warrantyEndDate = deviceForm.warrantyEndDate;
      if (deviceForm.internalCode) warrantyPayload.internalCode = deviceForm.internalCode;
      if (deviceForm.condition) warrantyPayload.condition = deviceForm.condition;
      warrantyPayload.gprsCommunication = Boolean(deviceForm.gprsCommunication);
      const payload = {
        name: deviceForm.name?.trim() || undefined,
        uniqueId: deviceForm.uniqueId.trim(),
        modelId: deviceForm.modelId || undefined,
        chipId: deviceForm.chipId || undefined,
        vehicleId: deviceForm.vehicleId || undefined,
        gprsCommunication: deviceForm.gprsCommunication,
        condition: deviceForm.condition || undefined,
        internalCode: deviceForm.internalCode || undefined,
        clientId,
        attributes: Object.keys(warrantyPayload).length ? warrantyPayload : undefined,
      };
      if (editingId) {
        await CoreApi.updateDevice(editingId, payload);
        showToast("Equipamento atualizado com sucesso", "success");
      } else {
        const response = await CoreApi.createDevice(payload);
        const upserted = response?.device && response?.upserted;
        if (upserted) {
          showToast("Equipamento já existia e foi sincronizado com sucesso.", "success");
        } else {
          showToast("Equipamento criado com sucesso", "success");
        }
      }
      await load();
      resetDeviceForm();
      setShowDeviceDrawer(false);
      setDrawerTab("geral");
    } catch (requestError) {
      const isConflict = requestError?.response?.status === 409;
      const code = requestError?.response?.data?.code;
      if (isConflict && code === "DEVICE_ALREADY_EXISTS") {
        const uniqueId = deviceForm.uniqueId.trim();
        const existingId = requestError?.response?.data?.details?.deviceId || null;
        const match = devices.find(
          (item) =>
            item.id === existingId ||
            (item.uniqueId && uniqueId && String(item.uniqueId).toLowerCase() === uniqueId.toLowerCase()),
        );
        setShowDeviceDrawer(false);
        setConflictDevice({
          uniqueId,
          deviceId: match?.id || existingId || null,
          message: requestError?.message || "Equipamento já existe no Euro One",
        });
        return;
      }

      showToast(requestError?.message || "Falha ao salvar equipamento", "error");
    } finally {
      setSavingDevice(false);
    }
  }

  function resolveInternalCodeSequence(code) {
    if (!code) return null;
    const match = String(code).trim().match(/-(\d+)$/);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  function resolveModelPrefix(model) {
    const rawPrefix = model?.prefix ?? model?.internalPrefix ?? model?.codePrefix ?? null;
    if (rawPrefix === null || rawPrefix === undefined) return null;
    if (typeof rawPrefix === "number" && Number.isFinite(rawPrefix)) {
      return String(rawPrefix).padStart(2, "0");
    }
    const normalized = String(rawPrefix).trim();
    return normalized || null;
  }

  function resolveNextInternalCode(prefix, rows = []) {
    if (!prefix) return "";
    const sequences = [];
    devices.forEach((device) => {
      const code = device.attributes?.internalCode || device.internalCode;
      const seq = resolveInternalCodeSequence(code);
      if (seq !== null) sequences.push(seq);
    });
    rows.forEach((row) => {
      const seq = resolveInternalCodeSequence(row.internalCode);
      if (seq !== null) sequences.push(seq);
    });
    const max = sequences.length ? Math.max(...sequences) : 0;
    return `${prefix}-${max + 1}`;
  }

  function handleBulkRowChange(index, key, value) {
    setBulkRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)),
    );
  }

  function handleAddBulkRow() {
    setBulkRows((current) => {
      const model = bulkModelId ? modeloById.get(bulkModelId) : null;
      const prefix = resolveModelPrefix(model);
      const internalCode = resolveNextInternalCode(prefix, current);
      return [...current, { imei: "", internalCode, gprsCommunication: null }];
    });
  }

  function handleRemoveBulkRow(index) {
    setBulkRows((current) => {
      const next = current.filter((_, rowIndex) => rowIndex !== index);
      return next.length ? next : [{ imei: "", internalCode: "", gprsCommunication: null }];
    });
  }

  function handleGenerateBulkCodes() {
    const imeiPrefix = String(bulkImeiPrefix || "").trim();
    const start = Number(bulkImeiStart);
    const end = Number(bulkImeiEnd);
    const model = bulkModelId ? modeloById.get(bulkModelId) : null;
    const internalPrefix = resolveModelPrefix(model);

    if (!bulkModelId) {
      showToast("Selecione um modelo para o lote.", "error");
      return;
    }
    if (!internalPrefix) {
      showToast("O modelo selecionado não possui prefixo para gerar ID.", "error");
      return;
    }
    if (!imeiPrefix || !/^\d+$/.test(imeiPrefix)) {
      showToast("Informe um prefixo numérico para gerar IMEIs.", "error");
      return;
    }
    if (imeiPrefix.length >= 8) {
      showToast("Prefixo do IMEI deve ter até 7 dígitos.", "error");
      return;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0 || start > end) {
      showToast("Informe um intervalo válido para gerar IMEIs.", "error");
      return;
    }
    const suffixLength = 8 - imeiPrefix.length;
    const baseSequence = resolveInternalCodeSequence(resolveNextInternalCode(internalPrefix)) || 1;
    const nextRows = [];
    let sequence = baseSequence;
    for (let current = start; current <= end; current += 1) {
      const imeiSuffix = String(current).padStart(suffixLength, "0");
      nextRows.push({
        imei: `${imeiPrefix}${imeiSuffix}`,
        internalCode: `${internalPrefix}-${sequence}`,
      });
      sequence += 1;
    }
    setBulkRows(
      nextRows.length
        ? nextRows.map((row) => ({ ...row, gprsCommunication: null }))
        : [{ imei: "", internalCode: "", gprsCommunication: null }],
    );
  }

  function resolveBulkGprsCommunication(row) {
    if (typeof row?.gprsCommunication === "boolean") return row.gprsCommunication;
    return bulkGprsDefault;
  }

  async function handleSaveBulkDevices() {
    if (!bulkRows.length) {
      showToast("Adicione itens antes de salvar em massa.", "error");
      return;
    }
    if (bulkValidation.hasErrors) {
      showToast("Corrija os erros antes de salvar em massa.", "error");
      return;
    }
    if (!bulkModelId) {
      showToast("Selecione um modelo para o cadastro em massa.", "error");
      return;
    }
    const clientId = tenantId || user?.clientId || "";
    if (!clientId) {
      showToast("Selecione um cliente para salvar os equipamentos", "error");
      return;
    }
    setSavingBulk(true);
    try {
      for (const row of bulkRows) {
        const uniqueId = String(row.imei || "").trim();
        if (!uniqueId) continue;
        const gprsCommunication = resolveBulkGprsCommunication(row);
        await CoreApi.createDevice({
          uniqueId,
          modelId: bulkModelId,
          clientId,
          gprsCommunication,
          attributes: { gprsCommunication },
        });
      }
      await load();
      setBulkRows([{ imei: "", internalCode: "", gprsCommunication: null }]);
      setBulkModelId("");
      setBulkImeiPrefix("");
      setBulkImeiStart("");
      setBulkImeiEnd("");
      showToast("Equipamentos cadastrados em massa", "success");
    } catch (requestError) {
      showToast(requestError?.message || "Falha ao cadastrar equipamentos em massa", "error");
    } finally {
      setSavingBulk(false);
    }
  }

  async function handleDeleteDevice(id) {
    if (!id) return;
    const clientId = tenantId || user?.clientId || "";
    if (!clientId) {
      showToast("Selecione um cliente para remover o equipamento", "error");
      return;
    }
    await confirmDelete({
      title: "Remover equipamento",
      message: "Remover este equipamento? Esta ação não pode ser desfeita.",
      confirmLabel: "Remover",
      onConfirm: async () => {
        await CoreApi.deleteDevice(id, { clientId });
        await load();
        showToast("Equipamento removido", "success");
      },
    });
  }

  async function handleDeleteConflictDevice() {
    if (!conflictDevice?.deviceId) return;
    const clientId = tenantId || user?.clientId || "";
    if (!clientId) {
      showToast("Selecione um cliente para remover o equipamento", "error");
      return;
    }
    await confirmDelete({
      title: "Remover equipamento",
      message: "Remover este equipamento? Esta ação não pode ser desfeita.",
      confirmLabel: "Remover",
      onConfirm: async () => {
        await CoreApi.deleteDevice(conflictDevice.deviceId, { clientId });
        await load();
        resetDeviceForm();
        setConflictDevice(null);
        showToast("Equipamento removido", "success");
      },
    });
  }

  function openEditDevice(device) {
    const installationDate = device.attributes?.installationDate || device.attributes?.warrantyStartDate || "";
    const warrantyOrigin = device.attributes?.warrantyOrigin || "production";
    setEditingId(device.id);
    setDeviceForm({
      name: device.name || "",
      uniqueId: device.uniqueId || "",
      modelId: device.modelId || device.attributes?.modelId ? String(device.modelId || device.attributes?.modelId) : "",
      internalCode: device.attributes?.internalCode || "",
      gprsCommunication: device.attributes?.gprsCommunication !== false,
      condition: device.attributes?.condition || "",
      chipId: device.chipId || "",
      vehicleId: device.vehicleId || "",
      productionDate: device.attributes?.productionDate || "",
      installationDate,
      warrantyOrigin,
      warrantyDays: device.attributes?.warrantyDays ?? "",
      warrantyEndDate: device.attributes?.warrantyEndDate || "",
    });
    setDrawerTab("geral");
    setShowDeviceDrawer(true);
  }

  function handleGoToExistingDevice() {
    if (!conflictDevice) return;
    const match = devices.find(
      (item) =>
        item.id === conflictDevice.deviceId ||
        (item.uniqueId && conflictDevice.uniqueId &&
          String(item.uniqueId).toLowerCase() === conflictDevice.uniqueId.toLowerCase()),
    );
    if (match) {
      openEditDevice(match);
    } else {
      void load();
    }
    setConflictDevice(null);
  }

  const linkVehicleOptions = useMemo(() => {
    const search = linkQuery.trim().toLowerCase();
    const filteredVehicles = vehicles.filter((vehicle) => {
      if (tenantId) return String(vehicle.clientId) === String(tenantId);
      if (linkTarget?.clientId) return String(vehicle.clientId) === String(linkTarget.clientId);
      return true;
    });
    const list = filteredVehicles.map((vehicle) => ({
      value: vehicle.id,
      label: `${vehicle.plate || vehicle.name || vehicle.id}${vehicle.clientName ? ` · ${vehicle.clientName}` : ""}`,
      plate: vehicle.plate || "",
      name: vehicle.name || "",
    }));
    if (!search) return list;
    return list.filter(
      (vehicle) =>
        vehicle.plate.toLowerCase().includes(search) ||
        vehicle.name.toLowerCase().includes(search) ||
        vehicle.label.toLowerCase().includes(search),
    );
  }, [linkQuery, linkTarget?.clientId, tenantId, vehicles]);

  async function handleLinkToVehicle(event) {
    event.preventDefault();
    if (!linkVehicleId) return;
    const targetDevice =
      linkTarget ||
      devices.find((item) => item.id === editingId) ||
      devices.find((item) => item.uniqueId === deviceForm.uniqueId);
    if (!targetDevice) {
      showToast("Selecione um equipamento para vincular", "error");
      return;
    }
    try {
      const vehicle = vehicles.find((item) => String(item.id) === String(linkVehicleId));
      const targetClientId = vehicle?.clientId || targetDevice?.clientId || tenantId || user?.clientId || "";
      if (!targetClientId) {
        showToast("Selecione um cliente antes de vincular", "error");
        return;
      }
      if (vehicle?.clientId && targetDevice?.clientId && String(vehicle.clientId) !== String(targetDevice.clientId)) {
        showToast("Equipamento e veículo pertencem a clientes diferentes", "error");
        return;
      }
      if (Object.prototype.hasOwnProperty.call(deviceForm, "chipId")) {
        await CoreApi.updateDevice(targetDevice.id, {
          chipId: deviceForm.chipId || null,
          clientId: targetClientId,
        });
      }
      await CoreApi.linkDeviceToVehicle(linkVehicleId, targetDevice.id, { clientId: targetClientId });
      await load();
      setLinkTarget(null);
      setLinkVehicleId("");
      setLinkQuery("");
      showToast("Equipamento vinculado ao veículo com sucesso", "success");
    } catch (requestError) {
      showToast(requestError?.message || "Falha ao vincular equipamento", "error");
    }
  }

  async function handleCreateVehicle(event) {
    event.preventDefault();
    if (!vehicleForm.plate.trim() && !vehicleForm.name.trim()) {
      showToast("Informe placa ou nome do veículo", "error");
      return;
    }
    try {
      const clientId = tenantId || user?.clientId || linkTarget?.clientId || null;
      if (!clientId) {
        showToast("Selecione um cliente para criar veículo", "error");
        return;
      }
      setCreatingVehicle(true);
      const payload = {
        plate: vehicleForm.plate.trim() || undefined,
        name: vehicleForm.name.trim() || undefined,
        clientId,
      };
      const created = await CoreApi.createVehicle(payload);
      await load();
      if (created?.id) {
        setLinkVehicleId(created.id);
      }
      showToast("Veículo criado", "success");
    } catch (requestError) {
      showToast(requestError?.message || "Falha ao criar veículo", "error");
    } finally {
      setCreatingVehicle(false);
    }
  }

  async function handleUnlinkFromVehicle(device) {
    if (!device?.vehicleId) return;
    try {
      const vehicle = vehicles.find((item) => String(item.id) === String(device.vehicleId)) || device.vehicle;
      const targetClientId = vehicle?.clientId || device?.clientId || tenantId || user?.clientId || "";
      if (!targetClientId) {
        showToast("Selecione um cliente antes de desvincular", "error");
        return;
      }
      await CoreApi.unlinkDeviceFromVehicle(device.vehicleId, device.id, { clientId: targetClientId });
      await load();
      showToast("Equipamento desvinculado do veículo", "success");
    } catch (requestError) {
      showToast(requestError?.message || "Falha ao desvincular equipamento", "error");
    }
  }

  async function handleUnlinkChip(device) {
    if (!device?.chipId) return;
    await confirmDelete({
      title: "Desvincular chip",
      message: "Desvincular chip deste equipamento?",
      confirmLabel: "Desvincular",
      onConfirm: async () => {
        const clientId = device?.clientId || tenantId || user?.clientId || "";
        if (!clientId) {
          showToast("Selecione um cliente antes de desvincular", "error");
          return;
        }
        await CoreApi.updateDevice(device.id, { chipId: "", clientId });
        await load();
        showToast("Chip desvinculado do equipamento", "success");
      },
    });
  }

  async function handleSyncDevices() {
    const clientId = tenantId || user?.clientId || null;
    setSyncing(true);
    try {
      await CoreApi.syncDevicesFromTraccar(clientId ? { clientId } : undefined);
      await load();
      showToast("Sincronização com o Traccar iniciada", "success");
    } catch (requestError) {
      showToast(requestError?.message || "Falha ao sincronizar com o Traccar", "error");
    } finally {
      setSyncing(false);
    }
  }

  function handleExportCsv() {
    if (!filteredDevices.length) return;
    const headers = [
      "Nome",
      "IMEI",
      "Status",
      "Última comunicação",
      "Última posição",
      "Veículo",
      "Chip",
      "Modelo",
      "Bateria",
      "Ignição",
    ];
    const rows = filteredDevices.map((device) => {
      const meta = statusMeta(device);
      const chip = chipById.get(device.chipId) || device.chip;
      const vehicle = vehicleById.get(device.vehicleId) || device.vehicle;
      const deviceModelId = device.modelId || device.attributes?.modelId;
      const model = deviceModelId ? modeloById.get(String(deviceModelId)) || {} : {};
      return [
        device.name || "",
        device.uniqueId || "",
        meta.label,
        formatLastCommunication(device),
        formatPosition(device),
        vehicle?.plate || vehicle?.name || "",
        chip?.iccid || chip?.phone || "",
        model?.name || device.modelName || "",
        formatBattery(device),
        formatIgnition(device) || "",
      ]
        .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
        .join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "equipamentos.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleNavigateToMonitoring(device) {
    const focusDeviceId = device?.traccarId || device?.deviceId || device?.id || device?.uniqueId || null;
    if (!focusDeviceId) return;
    navigate("/monitoring", { state: { focusDeviceId } });
  }

  const tableColCount = 8;

  const toastClassName =
    "fixed right-4 top-4 z-50 rounded-lg border px-4 py-3 text-sm shadow-lg " +
    (toast?.type === "error"
      ? "border-red-500/40 bg-red-500/20 text-red-50"
      : toast?.type === "warning"
      ? "border-amber-500/40 bg-amber-500/20 text-amber-50"
      : "border-emerald-500/40 bg-emerald-500/20 text-emerald-50");

  return (
    <div className="flex min-h-[calc(100vh-180px)] flex-col gap-6">
      {toast && <div className={toastClassName}>{toast.message}</div>}

      <PageHeader
        overline="Central de equipamentos"
        title="Equipamentos"
        subtitle="Gestão, vínculo e status dos equipamentos."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSyncDevices}
              disabled={syncing}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15 disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                {syncing ? "Atualizando…" : "Atualizar"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                resetDeviceForm();
                setEditingId(null);
                setDrawerTab("geral");
                setShowDeviceDrawer(true);
              }}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
            >
              <span className="inline-flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Novo equipamento
              </span>
            </button>
          </div>
        }
      />

      <FilterBar
        left={
          <div className="flex w-full flex-wrap items-center gap-3">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por nome, IMEI, placa"
                className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
              />
            </div>
            <select
              value={filters.link}
              onChange={(event) => setFilters((current) => ({ ...current, link: event.target.value }))}
              className="min-w-[200px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            >
              <option value="all">Vínculo: Todos</option>
              <option value="linked">Vínculo: Vinculado</option>
              <option value="unlinked">Vínculo: Sem vínculo</option>
            </select>
            <select
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
              className="min-w-[200px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            >
              <option value="all">Status: Todos</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
              <option value="1-6h">Sem transmissão 1–6h</option>
              <option value="6-24h">Sem transmissão 6–24h</option>
              <option value=">24h">&gt;24h</option>
            </select>
            <div className="min-w-[240px] flex-1">
              <AutocompleteSelect
                value={modelDraft}
                onChange={(nextValue) => setModelDraft(String(nextValue || ""))}
                placeholder="Buscar modelo"
                options={modelOptions}
                loadOptions={loadModelOptions}
              />
            </div>
            <button
              type="button"
              onClick={() => setFilters((current) => ({ ...current, model: modelDraft }))}
              disabled={modelDraft === filters.model}
              className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/15 disabled:opacity-60"
            >
              Aplicar
            </button>
          </div>
        }
        right={
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/60">
              {filteredDevices.length} de {devices.length} equipamentos
            </span>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!filteredDevices.length}
              className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15 disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-2">
                <Download className="h-4 w-4" />
                Exportar CSV
              </span>
            </button>
          </div>
        }
      />

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error.message}</div>
      )}

      <div className="flex flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <DataTable className="flex-1 min-h-0 overflow-auto border border-white/10" tableClassName="text-white/80 table-auto w-full">
            <thead className="sticky top-0 bg-white/5 text-xs uppercase tracking-wide text-white/60 backdrop-blur">
              <tr>
                <th className="px-3 py-3 text-left">ID / IMEI</th>
                <th className="px-3 py-3 text-left">Modelo</th>
                <th className="px-3 py-3 text-left">Status</th>
                <th className="px-3 py-3 text-left">Última comunicação</th>
                <th className="px-3 py-3 text-left">Última posição</th>
                <th className="px-3 py-3 text-left">Vínculo</th>
                <th className="px-3 py-3 text-left">Garantia</th>
                <th className="px-3 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {(loading || traccarLoading) && (
                <tr>
                  <td colSpan={tableColCount} className="px-4 py-6">
                    <SkeletonTable rows={6} columns={tableColCount} />
                  </td>
                </tr>
              )}
              {!loading && !traccarLoading && filteredDevices.length === 0 && (
                <tr>
                  <td colSpan={tableColCount} className="px-4 py-8">
                    <EmptyState
                      title="Nenhum equipamento encontrado com os filtros atuais."
                      subtitle="Ajuste filtros ou cadastre um novo equipamento."
                      action={
                        <div className="flex flex-wrap justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setFilters({ status: "all", link: "all", model: "" });
                              setQuery("");
                            }}
                            className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
                          >
                            <span className="inline-flex items-center gap-2">
                              <RefreshCw className="h-4 w-4" />
                              Limpar filtros
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              resetDeviceForm();
                              setEditingId(null);
                              setDrawerTab("geral");
                              setShowDeviceDrawer(true);
                            }}
                            className="rounded-xl bg-sky-500 px-3 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
                          >
                            <span className="inline-flex items-center gap-2">
                              <Plus className="h-4 w-4" />
                              Cadastrar equipamento
                            </span>
                          </button>
                        </div>
                      }
                    />
                  </td>
                </tr>
              )}
              {!loading &&
                !traccarLoading &&
                paginatedDevices.map((device) => {
                  const deviceModelId = device.modelId || device.attributes?.modelId || null;
                  const modelo = deviceModelId ? modeloById.get(String(deviceModelId)) || null : null;
                  const vehicle = vehicleById.get(device.vehicleId) || device.vehicle;
                  const position = latestPositionByDevice.get(deviceKey(device));
                  const meta = statusMeta(device);
                  const traccarDevice = traccarDeviceFor(device);
                  const warrantyLabel = formatWarranty(device);
                  return (
                    <DeviceRow
                      key={device.internalId || device.id || device.uniqueId}
                      device={device}
                      traccarDevice={traccarDevice}
                      model={modelo}
                      vehicle={vehicle}
                      position={position}
                      status={meta}
                      warrantyLabel={warrantyLabel}
                      onMap={() => position && setMapTarget({ device, position })}
                      onLink={() => {
                        setLinkTarget(device);
                        setLinkVehicleId(device.vehicleId || "");
                      }}
                      onUnlink={() => handleUnlinkFromVehicle(device)}
                      onNavigateToMonitoring={() => handleNavigateToMonitoring(device)}
                      onEdit={() => openEditDevice(device)}
                      onDelete={() => handleDeleteDevice(device.id)}
                      positionLabel={formatPositionSummary(position)}
                      lastCommunication={formatLastCommunication(device)}
                    />
                  );
                })}
            </tbody>
          </DataTable>
          <DataTablePagination
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSizeChange={(value) => {
              setPageSize(value === "all" ? "all" : Number(value));
              setCurrentPage(1);
            }}
            currentPage={resolvedPage}
            totalPages={totalPages}
            totalItems={filteredDevices.length}
            onPageChange={(nextPage) => setCurrentPage(nextPage)}
          />
        </div>
      </div>

      <Drawer
        open={showDeviceDrawer}
        onClose={() => setShowDeviceDrawer(false)}
        title={editingId ? "Editar equipamento" : "Novo equipamento"}
        description="Edite dados gerais, vínculos e telemetria em um layout lateral."
      >
        <div className="flex gap-2 overflow-x-auto pb-2 text-[11px] uppercase tracking-[0.1em] text-white/60">
          {["geral", "vinculos", "telemetria", "garantia", "massa", "acoes"].map((key) => (
            <button
              key={key}
              onClick={() => setDrawerTab(key)}
              className={`rounded-md px-3 py-2 transition ${drawerTab === key ? "bg-primary/20 text-white border border-primary/40" : "border border-transparent hover:border-white/20"}`}
            >
              {key === "geral" && "Geral"}
              {key === "vinculos" && "Vínculos"}
              {key === "telemetria" && "Telemetria"}
              {key === "garantia" && "Garantia"}
              {key === "massa" && "Massa"}
              {key === "acoes" && "Ações"}
            </button>
          ))}
        </div>

        {drawerTab === "geral" && (
          <form onSubmit={handleSaveDevice} className="grid gap-4 md:grid-cols-2">
            <Input
              label="Nome (opcional)"
              value={deviceForm.name}
              onChange={(event) => setDeviceForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Ex.: Rastreador Van 12"
            />
            <Input
              label="IMEI / uniqueId *"
              required
              value={deviceForm.uniqueId}
              onChange={(event) => setDeviceForm((current) => ({ ...current, uniqueId: event.target.value }))}
              placeholder="Ex.: 866512345678901"
            />
            <Input
              label="Código interno (gerado automaticamente)"
              value={deviceForm.internalCode}
              onChange={(event) => setDeviceForm((current) => ({ ...current, internalCode: event.target.value }))}
              placeholder="Gerado automaticamente"
              disabled
            />
            <div className="md:col-span-2">
              <label className="text-xs uppercase tracking-[0.1em] text-white/60">Modelo</label>
              <AutocompleteSelect
                value={deviceForm.modelId}
                onChange={(nextValue, option) => {
                  setDeviceForm((current) => ({ ...current, modelId: String(nextValue || "") }));
                }}
                placeholder="Buscar modelo"
                options={modelOptions}
                loadOptions={loadModelOptions}
              />
            </div>
            {deviceForm.modelId ? (
              <div className="md:col-span-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
                <div className="text-[11px] uppercase tracking-[0.1em] text-white/50">Dados do modelo</div>
                <div className="mt-2 grid gap-3 text-sm md:grid-cols-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.1em] text-white/50">Fabricante</div>
                    <div className="text-white">{modeloById.get(deviceForm.modelId)?.brand || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.1em] text-white/50">Protocolo</div>
                    <div className="text-white">{modeloById.get(deviceForm.modelId)?.protocol || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.1em] text-white/50">Portas</div>
                    <div className="text-white">
                      {Array.isArray(modeloById.get(deviceForm.modelId)?.ports)
                        ? modeloById.get(deviceForm.modelId)?.ports?.length
                        : "—"}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            <Select
              label="Comunicação GPRS"
              value={deviceForm.gprsCommunication ? "true" : "false"}
              onChange={(event) =>
                setDeviceForm((current) => ({
                  ...current,
                  gprsCommunication: event.target.value === "true",
                }))
              }
            >
              <option value="true">Sim</option>
              <option value="false">Não</option>
            </Select>
            <Select
              label="Condição"
              value={deviceForm.condition}
              onChange={(event) => setDeviceForm((current) => ({ ...current, condition: event.target.value }))}
            >
              <option value="">— Selecione —</option>
              <option value="novo">Novo</option>
              <option value="usado_funcionando">Usado Funcionando</option>
              <option value="usado_defeito">Usado Defeito</option>
            </Select>
            <div className="md:col-span-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowDeviceDrawer(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={savingDevice}>
                {savingDevice ? "Salvando…" : editingId ? "Atualizar" : "Salvar"}
              </Button>
            </div>
          </form>
        )}

        {drawerTab === "vinculos" && (
          <form onSubmit={handleLinkToVehicle} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.1em] text-white/60">Selecionar chip</label>
                <AutocompleteSelect
                  value={deviceForm.chipId}
                  onChange={(nextValue) => setDeviceForm((current) => ({ ...current, chipId: String(nextValue || "") }))}
                  placeholder="Buscar chip"
                  options={chipOptions}
                  loadOptions={loadChipOptions}
                />
              </div>
              <div className="md:col-span-2 space-y-2">
                <label className="text-xs uppercase tracking-[0.1em] text-white/60">Selecionar veículo</label>
                <AutocompleteSelect
                  value={linkVehicleId}
                  onChange={(nextValue) => setLinkVehicleId(String(nextValue || ""))}
                  placeholder="Buscar veículo"
                  options={vehicleOptions}
                  loadOptions={loadVehicleOptions}
                />
                {linkVehicleId && (
                  <div className="text-xs text-white/60">
                    Tipo do veículo: {vehicleById.get(linkVehicleId)?.type || "—"}
                  </div>
                )}
              </div>
            </div>
            <div className="grid gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.1em] text-white/60">Criar veículo rápido</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  label="Placa"
                  value={vehicleForm.plate}
                  onChange={(event) => setVehicleForm((current) => ({ ...current, plate: event.target.value }))}
                  placeholder="ABC1D23"
                />
                <Input
                  label="Nome / Descrição"
                  value={vehicleForm.name}
                  onChange={(event) => setVehicleForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Frota / apelido"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" onClick={handleCreateVehicle} disabled={creatingVehicle}>
                  {creatingVehicle ? "Criando…" : "Criar veículo"}
                </Button>
              </div>
            </div>
            <div className="flex justify-between gap-2">
              <div />
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setShowDeviceDrawer(false)}>
                  Fechar
                </Button>
                <Button type="submit" disabled={!linkVehicleId}>
                  Vincular
                </Button>
              </div>
            </div>
          </form>
        )}

        {drawerTab === "telemetria" && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-[0.1em] text-white/50">IMEI</div>
                <div className="text-sm text-white">{deviceForm.uniqueId || "—"}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.1em] text-white/50">Última transmissão</div>
                <div className="text-sm text-white">{formatLastCommunication(deviceForm)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.1em] text-white/50">Ignição</div>
                <div className="text-sm text-white">{formatIgnition(deviceForm) || "—"}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.1em] text-white/50">Status</div>
                <div className="mt-1">
                  <StatusPill meta={statusMeta(deviceForm)} />
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.1em] text-white/50">Entradas</div>
                <div className="text-sm text-white">{formatInputs(deviceForm)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.1em] text-white/50">Saídas</div>
                <div className="text-sm text-white">{formatOutputs(deviceForm)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.1em] text-white/50">Tensão do veículo</div>
                <div className="text-sm text-white">{formatVehicleVoltage(deviceForm)}</div>
              </div>
            </div>
          </div>
        )}

        {drawerTab === "garantia" && (
          <form onSubmit={handleSaveDevice} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Data de produção"
                type="date"
                value={deviceForm.productionDate}
                onChange={(event) => setDeviceForm((current) => ({ ...current, productionDate: event.target.value }))}
              />
              <Input
                label="Data de instalação"
                type="date"
                value={deviceForm.installationDate}
                onChange={(event) => setDeviceForm((current) => ({ ...current, installationDate: event.target.value }))}
                required
              />
              <Input
                label="Dias de garantia"
                type="number"
                min="0"
                value={deviceForm.warrantyDays}
                onChange={(event) => setDeviceForm((current) => ({ ...current, warrantyDays: event.target.value }))}
              />
              <Input
                label="Data do fim da garantia"
                type="date"
                value={deviceForm.warrantyEndDate}
                onChange={(event) => setDeviceForm((current) => ({ ...current, warrantyEndDate: event.target.value }))}
                disabled
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowDeviceDrawer(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={savingDevice}>
                {savingDevice ? "Salvando…" : "Salvar garantia"}
              </Button>
            </div>
          </form>
        )}

        {drawerTab === "massa" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
              <div className="text-xs uppercase tracking-[0.1em] text-white/50">Gerar IMEIs em lote</div>
              <p className="mt-1 text-xs text-white/60">
                Selecione o modelo e informe prefixo e intervalo para gerar IMEIs com 8 dígitos.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-xs uppercase tracking-[0.1em] text-white/60">
                  Modelo do lote
                  <AutocompleteSelect
                    value={bulkModelId}
                    onChange={(nextValue) => setBulkModelId(String(nextValue || ""))}
                    placeholder="Buscar modelo"
                    options={modelOptions}
                    loadOptions={loadModelOptions}
                    className="mt-2"
                  />
                </label>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <Input
                  label="Prefixo do IMEI"
                  value={bulkImeiPrefix}
                  onChange={(event) => setBulkImeiPrefix(event.target.value)}
                  placeholder="Ex.: 25300"
                />
                <Input
                  label="Início"
                  type="number"
                  min="1"
                  value={bulkImeiStart}
                  onChange={(event) => setBulkImeiStart(event.target.value)}
                  placeholder="1"
                />
                <Input
                  label="Fim"
                  type="number"
                  min="1"
                  value={bulkImeiEnd}
                  onChange={(event) => setBulkImeiEnd(event.target.value)}
                  placeholder="100"
                />
                <div className="flex items-end">
                  <Button type="button" onClick={handleGenerateBulkCodes} className="w-full">
                    Gerar lista
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs uppercase tracking-[0.1em] text-white/50">Cadastro em massa</div>
                  <p className="text-xs text-white/60">Preencha IMEI e acompanhe o ID automático.</p>
                </div>
                <Button type="button" variant="ghost" onClick={handleAddBulkRow}>
                  Adicionar linha
                </Button>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-xs uppercase tracking-[0.1em] text-white/60">
                  Tem comunicação (GPRS) — padrão do lote
                  <Select
                    value={bulkGprsDefault ? "yes" : "no"}
                    onChange={(event) => setBulkGprsDefault(event.target.value === "yes")}
                    className="mt-2 w-full bg-layer text-xs"
                  >
                    <option value="yes">Sim</option>
                    <option value="no">Não</option>
                  </Select>
                </label>
              </div>

              <div className="mt-3 space-y-3">
                {bulkRows.map((row, index) => {
                  const errors = bulkValidation.rowErrors[index] || [];
                  return (
                    <div key={`bulk-row-${index}`} className="rounded-lg border border-white/10 bg-black/30 p-3">
                      <div className="grid gap-3 md:grid-cols-[1.1fr_1fr_1fr_auto]">
                        <Input
                          label={`IMEI #${index + 1}`}
                          value={row.imei}
                          onChange={(event) => handleBulkRowChange(index, "imei", event.target.value)}
                          placeholder="Digite o IMEI"
                        />
                        <Input
                          label="Código interno (auto)"
                          value={row.internalCode}
                          placeholder="Gerado automaticamente"
                          disabled
                        />
                        <label className="text-xs uppercase tracking-[0.1em] text-white/60">
                          Comunicação GPRS
                          <Select
                            value={
                              typeof row.gprsCommunication === "boolean"
                                ? row.gprsCommunication
                                  ? "yes"
                                  : "no"
                                : "default"
                            }
                            onChange={(event) => {
                              const value = event.target.value;
                              handleBulkRowChange(
                                index,
                                "gprsCommunication",
                                value === "default" ? null : value === "yes",
                              );
                            }}
                            className="mt-2 w-full bg-layer text-xs"
                          >
                            <option value="default">
                              Padrão ({bulkGprsDefault ? "Sim" : "Não"})
                            </option>
                            <option value="yes">Sim</option>
                            <option value="no">Não</option>
                          </Select>
                        </label>
                        <div className="flex items-end">
                          <Button type="button" variant="ghost" onClick={() => handleRemoveBulkRow(index)}>
                            Remover
                          </Button>
                        </div>
                      </div>
                      {errors.length > 0 && (
                        <ul className="mt-2 space-y-1 text-xs text-red-200/90">
                          {errors.map((message) => (
                            <li key={`${index}-${message}`}>{message}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-white/50">
                  {bulkRows.length} itens prontos para cadastro
                </span>
                <Button type="button" onClick={handleSaveBulkDevices} disabled={savingBulk || bulkValidation.hasErrors}>
                  {savingBulk ? "Salvando..." : "Salvar em massa"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {drawerTab === "acoes" && (
          <div className="space-y-3">
            <Button
              variant="ghost"
              className="inline-flex items-center gap-2"
              onClick={() => {
                const device = devices.find((item) => String(item.id) === String(editingId));
                if (device) handleUnlinkFromVehicle(device);
              }}
              disabled={!editingId}
            >
              <Unlink className="h-4 w-4" />
              Desvincular veículo
            </Button>
            <Button
              variant="ghost"
              className="inline-flex items-center gap-2"
              onClick={() => {
                const device = devices.find((item) => String(item.id) === String(editingId));
                if (device) handleUnlinkChip(device);
              }}
              disabled={!editingId}
            >
              <Unlink className="h-4 w-4" />
              Desvincular chip
            </Button>
            <Button
              variant="ghost"
              className="inline-flex items-center gap-2 text-red-200 hover:text-white"
              onClick={() => handleDeleteDevice(editingId)}
              disabled={!editingId}
            >
              <Trash2 className="h-4 w-4" />
              Remover equipamento
            </Button>
          </div>
        )}
      </Drawer>

      <Drawer
        open={Boolean(linkTarget)}
        onClose={() => {
          setLinkTarget(null);
          setLinkVehicleId("");
          setLinkQuery("");
        }}
        title={linkTarget?.name || linkTarget?.uniqueId || "Vincular equipamento"}
        description={
          linkTarget?.vehicle?.plate
            ? `Equipamento já vinculado a ${linkTarget.vehicle.plate}. Selecione outro veículo para atualizar.`
            : "Escolha um veículo para vincular ao equipamento."
        }
      >
        <form onSubmit={handleLinkToVehicle} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.1em] text-white/60">Selecionar veículo</label>
            <AutocompleteSelect
              value={linkVehicleId}
              onChange={(nextValue) => setLinkVehicleId(String(nextValue || ""))}
              placeholder="Buscar veículo"
              options={vehicleOptions}
              loadOptions={loadVehicleOptions}
            />
            {linkVehicleId && (
              <div className="text-xs text-white/60">
                Tipo do veículo: {vehicleById.get(linkVehicleId)?.type || "—"}
              </div>
            )}
          </div>
          <div className="grid gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.1em] text-white/60">Criar veículo rápido</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Placa"
                value={vehicleForm.plate}
                onChange={(event) => setVehicleForm((current) => ({ ...current, plate: event.target.value }))}
                placeholder="ABC1D23"
              />
              <Input
                label="Nome / Descrição"
                value={vehicleForm.name}
                onChange={(event) => setVehicleForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Frota / apelido"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={handleCreateVehicle} disabled={creatingVehicle}>
                {creatingVehicle ? "Criando…" : "Criar veículo"}
              </Button>
            </div>
          </div>
          <div className="flex justify-between gap-2">
            <div />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setLinkTarget(null);
                  setLinkVehicleId("");
                  setLinkQuery("");
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={!linkVehicleId}>
                Vincular
              </Button>
            </div>
          </div>
        </form>
      </Drawer>

      <Modal
        open={Boolean(conflictDevice)}
        onClose={() => setConflictDevice(null)}
        title="Equipamento já existe"
        width="max-w-xl"
      >
        <div className="space-y-4 text-white">
          <p className="text-sm text-white/80">
            {conflictDevice?.message || "Já existe um equipamento com este IMEI / uniqueId no Euro One."}
          </p>
          <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
            <div className="font-semibold text-white">UniqueId</div>
            <div className="break-all">{conflictDevice?.uniqueId || ""}</div>
          </div>
          {!conflictDevice?.deviceId && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100">
              Não foi possível localizar o equipamento automaticamente. Use a busca pelo uniqueId acima para encontrar e
              remover o equipamento na lista.
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConflictDevice(null)}>
              Fechar
            </Button>
            {conflictDevice?.deviceId && (
              <Button variant="ghost" className="text-red-100 hover:text-white" onClick={handleDeleteConflictDevice}>
                Excluir equipamento
              </Button>
            )}
            <Button onClick={handleGoToExistingDevice}>Ir para equipamento existente</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(mapTarget)}
        onClose={() => setMapTarget(null)}
        title={mapTarget?.device?.name || mapTarget?.device?.uniqueId || "Posição"}
        width="max-w-4xl"
      >
        {mapTarget?.position ? (
          <div className="h-[420px] overflow-hidden rounded-xl">
            <MapContainer
              ref={mapRef}
              center={[
                Number(mapTarget.position.latitude ?? mapTarget.position.lat ?? 0),
                Number(mapTarget.position.longitude ?? mapTarget.position.lon ?? mapTarget.position.lng ?? 0),
              ]}
              zoom={15}
              style={{ height: "100%", width: "100%" }}
              whenReady={onMapReady}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="OpenStreetMap" />
              <Marker
                position={[
                  Number(mapTarget.position.latitude ?? mapTarget.position.lat ?? 0),
                  Number(mapTarget.position.longitude ?? mapTarget.position.lon ?? mapTarget.position.lng ?? 0),
                ]}
              >
                <Popup>
                  <div className="space-y-1 text-sm">
                    <div className="font-semibold">{mapTarget.device?.name || mapTarget.device?.uniqueId}</div>
                    <div>{formatPositionSummary(mapTarget.position)}</div>
                    <div className="text-xs text-white/60">{formatPositionTimestamps(mapTarget.position)}</div>
                    <div>{formatLastCommunication(mapTarget.device || {})}</div>
                  </div>
                </Popup>
              </Marker>
            </MapContainer>
          </div>
        ) : (
          <p className="text-sm text-white/70">Sem posição recente para este dispositivo.</p>
        )}
      </Modal>
    </div>
  );
}
