import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import {
  Battery,
  Clock3,
  Download,
  EllipsisVertical,
  Link2,
  MapPin,
  Plus,
  Power,
  RefreshCw,
  Search,
  SignalMedium,
  Trash2,
  Unlink,
  Wifi,
  X,
} from "lucide-react";
import { latLngBounds } from "leaflet";
import "leaflet/dist/leaflet.css";

import Button from "../ui/Button";
import Modal from "../ui/Modal";
import Input from "../ui/Input";
import Select from "../ui/Select";
import PageHeader from "../ui/PageHeader";
import DropdownMenu from "../ui/DropdownMenu";
import { CoreApi, normaliseListPayload } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { useLivePositions } from "../lib/hooks/useLivePositions.js";
import useTraccarDevices from "../lib/hooks/useTraccarDevices.js";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";
import { computeAutoVisibility, loadColumnVisibility, saveColumnVisibility } from "../lib/column-visibility.js";

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

function formatBattery(position) {
  if (!position) return "—";
  const battery =
    position.batteryLevel ?? position.attributes?.batteryLevel ?? position.attributes?.battery ?? position.battery;
  if (battery === undefined || battery === null) return "—";
  if (typeof battery === "number" && !Number.isNaN(battery)) return `${battery}%`;
  return String(battery);
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
  chip,
  vehicle,
  position,
  status,
  batteryLabel,
  ignitionLabel,
  showSpeed,
  showChip,
  showIgnition,
  speedLabel,
  onMap,
  onLink,
  onUnlink,
  onEdit,
  onDelete,
  positionLabel,
  lastCommunication,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef(null);

  const toggleMenu = () => setMenuOpen((value) => !value);

  return (
    <tr className="hover:bg-white/5">
      <td className="px-4 py-3">
        <div className="font-semibold text-white">{device.name || traccarDevice?.name || "—"}</div>
        <div className="text-xs text-white/50">IMEI {device.uniqueId || traccarDevice?.uniqueId || "—"}</div>
      </td>
      <td className="px-4 py-3">
        <StatusPill meta={status} />
      </td>
      <td className="px-4 py-3">
        <div className="text-white">{lastCommunication}</div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span>{positionLabel}</span>
          {position && (
            <button
              type="button"
              onClick={onMap}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-white hover:border-primary"
            >
              <MapPin className="h-3 w-3" />
              Ver
            </button>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        {vehicle ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs">
            <Link2 className="h-3 w-3" />
            <div className="text-white">
              <div className="font-medium">{vehicle.plate || vehicle.name || "Veículo"}</div>
              <div className="text-[11px] text-white/60">{vehicle.clientName || "Vinculado"}</div>
            </div>
          </div>
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
      {showChip && (
        <td className="px-4 py-3">
          <div className="space-y-1 text-sm">
            <div className="text-white">{chip?.iccid || chip?.phone || "Sem chip"}</div>
            {chip?.carrier && <div className="text-xs text-white/60">{chip.carrier}</div>}
          </div>
        </td>
      )}
      {showSpeed && (
        <td className="px-4 py-3">
          <span>{speedLabel}</span>
        </td>
      )}
      {showIgnition && (
        <td className="px-4 py-3 space-y-1">
          <div className="flex items-center gap-2">
            <Battery className="h-4 w-4 text-white/60" />
            <span>{batteryLabel}</span>
          </div>
          {ignitionLabel && (
            <div className="flex items-center gap-2 text-xs">
              <Power className="h-3 w-3 text-white/60" />
              <span className="rounded-full bg-white/10 px-2 py-0.5">{ignitionLabel}</span>
            </div>
          )}
          {model?.name && <div className="text-[11px] text-white/50">{model.name}</div>}
        </td>
      )}
      <td className="px-4 py-3 text-right">
        <div className="relative inline-block text-left">
          <button
            type="button"
            onClick={toggleMenu}
            ref={menuButtonRef}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white hover:border-white/30"
            aria-label="Ações"
          >
            <EllipsisVertical className="h-4 w-4" />
          </button>
          <DropdownMenu open={menuOpen} anchorRef={menuButtonRef} onClose={() => setMenuOpen(false)}>
            <div className="flex flex-col py-2 text-sm text-white">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-white/5"
                onClick={() => {
                  onEdit?.();
                  setMenuOpen(false);
                }}
              >
                ✏️ Editar
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-white/5"
                onClick={() => {
                  onLink?.();
                  setMenuOpen(false);
                }}
              >
                🔗 Vincular veículo
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-white/5"
                onClick={() => {
                  onUnlink?.();
                  setMenuOpen(false);
                }}
              >
                <Unlink className="h-4 w-4" />
                Desvincular
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-white/5"
                onClick={() => {
                  onMap?.();
                  setMenuOpen(false);
                }}
              >
                <MapPin className="h-4 w-4" />
                Ver no mapa
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-red-200 hover:bg-red-500/10"
                onClick={() => {
                  onDelete?.();
                  setMenuOpen(false);
                }}
              >
                <Trash2 className="h-4 w-4" />
                Remover
              </button>
            </div>
          </DropdownMenu>
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
  const [filters, setFilters] = useState({
    status: "all",
    link: "all",
    model: "all",
  });
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const resolvedClientId = tenantId || user?.clientId || null;
  const columnStorageKey = useMemo(
    () => `devices.columns:${user?.id || "anon"}:${resolvedClientId || "all"}`,
    [resolvedClientId, user?.id],
  );
  const columnDefaults = useMemo(
    () => ({
      speed: true,
      chip: true,
      ignition: true,
    }),
    [],
  );
  const [visibleColumns, setVisibleColumns] = useState(
    () => loadColumnVisibility(columnStorageKey) ?? columnDefaults,
  );
  const columnAutoApplied = useRef(false);
  const [syncing, setSyncing] = useState(false);
  const [drawerTab, setDrawerTab] = useState("geral");
  const [initializedFromSearch, setInitializedFromSearch] = useState(false);
  const [creatingVehicle, setCreatingVehicle] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({ plate: "", name: "" });
  const [lastSyncAt, setLastSyncAt] = useState(null);

  const [deviceForm, setDeviceForm] = useState({
    name: "",
    uniqueId: "",
    modelId: "",
    chipId: "",
    vehicleId: "",
  });
  const [query, setQuery] = useState("");
  const [mapTarget, setMapTarget] = useState(null);
  const mapRef = useRef(null);
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
      vehiclesParams.includeUnlinked = true;
      const [deviceResult, modelResult, chipResult, vehicleResult] = await Promise.allSettled([
        CoreApi.listDevices(clientId ? { clientId } : undefined),
        CoreApi.models(clientId ? { clientId, includeGlobal: true } : undefined),
        CoreApi.listChips(clientId ? { clientId } : undefined),
        CoreApi.listVehicles(vehiclesParams),
      ]);

      if (deviceResult.status === "fulfilled") {
        setDevices(normaliseListPayload(deviceResult.value));
        setLastSyncAt(new Date());
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
    setFilters({ status: "all", link: "all", model: "all" });
    setQuery("");
    setLinkTarget(null);
    setLinkVehicleId("");
    setLinkQuery("");
    setMapTarget(null);
    setShowDeviceDrawer(false);
    setShowColumnPicker(false);
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
    if (!map || !target) return;
    const lat = Number(target.latitude ?? target.lat ?? target.latitute);
    const lng = Number(target.longitude ?? target.lon ?? target.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const bounds = latLngBounds([[lat, lng]]);
    map.fitBounds(bounds.pad(0.02), { maxZoom: 16 });
    setTimeout(() => map.invalidateSize(), 50);
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

  const modeloById = useMemo(() => {
    const map = new Map();
    models.forEach((model) => {
      if (model?.id) {
        map.set(model.id, model);
      }
    });
    return map;
  }, [models]);

  const chipOptions = useMemo(() => {
    return chips.map((chip) => ({
      value: chip.id,
      label: chip.iccid || chip.phone || chip.device?.uniqueId || chip.id,
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
    }));
  }, [vehicles]);
  const vehicleById = useMemo(() => {
    const map = new Map();
    vehicles.forEach((vehicle) => {
      if (vehicle?.id) map.set(vehicle.id, vehicle);
    });
    return map;
  }, [vehicles]);

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

  const columnDefs = useMemo(
    () => [
      {
        key: "chip",
        label: "Chip",
        defaultVisible: true,
        isMissing: (device) => {
          const chip = chipById.get(device.chipId) || device.chip;
          return !(chip?.iccid || chip?.phone);
        },
      },
      {
        key: "speed",
        label: "Velocidade",
        defaultVisible: true,
        isMissing: (device) => {
          const key = deviceKey(device);
          return !key || !latestPositionByDevice.get(key);
        },
      },
      {
        key: "ignition",
        label: "Bateria / Ignição",
        defaultVisible: true,
        isMissing: (device) => {
          const key = deviceKey(device);
          const position = key ? latestPositionByDevice.get(key) : null;
          const attrs = position?.attributes || {};
          const battery = attrs.batteryLevel ?? attrs.battery ?? attrs.power ?? attrs.charge;
          const ignition = typeof attrs.ignition === "boolean";
          return (battery === undefined || battery === null) && !ignition;
        },
      },
    ],
    [chipById, latestPositionByDevice],
  );

  useEffect(() => {
    columnAutoApplied.current = false;
    const stored = loadColumnVisibility(columnStorageKey);
    setVisibleColumns(stored ?? columnDefaults);
  }, [columnDefaults, columnStorageKey]);

  useEffect(() => {
    if (columnAutoApplied.current) return;
    if (!devices.length) return;
    const stored = loadColumnVisibility(columnStorageKey);
    if (stored) {
      columnAutoApplied.current = true;
      return;
    }
    const autoVisibility = computeAutoVisibility(devices, columnDefs, 0.9);
    setVisibleColumns((current) => ({ ...current, ...autoVisibility }));
    columnAutoApplied.current = true;
  }, [columnDefs, columnStorageKey, devices]);

  useEffect(() => {
    saveColumnVisibility(columnStorageKey, visibleColumns);
  }, [columnStorageKey, visibleColumns]);

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
    if (address) return address;
    const lat = Number(position.latitude ?? position.lat ?? position.latitute);
    const lon = Number(position.longitude ?? position.lon ?? position.lng);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    }
    return "—";
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
      const model = modeloById.get(device.modelId) || null;

      if (term) {
        const haystack = [
          device.name,
          device.uniqueId,
          device.imei,
          chip?.iccid,
          chip?.phone,
          vehicle?.plate,
          vehicle?.name,
          model?.name,
        ]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase());
        const matches = haystack.some((value) => value.includes(term));
        if (!matches) return false;
      }

      if (filters.link === "linked" && !device.vehicleId && !device.vehicle) return false;
      if (filters.link === "unlinked" && (device.vehicleId || device.vehicle)) return false;

      if (filters.model !== "all" && String(device.modelId || "") !== String(filters.model)) return false;

      if (filters.status !== "all") {
        const meta = statusMeta(device);
        if (meta.code !== filters.status) return false;
      }

      return true;
    });
  }, [chipById, devices, filters.link, filters.model, filters.status, modeloById, query, vehicleById]);


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

  function resetDeviceForm() {
    setDeviceForm({ name: "", uniqueId: "", modelId: "", chipId: "", vehicleId: "" });
    setEditingId(null);
  }

  async function handleSaveDevice(event) {
    event.preventDefault();
    if (!deviceForm.uniqueId.trim()) {
      showToast("Informe o IMEI / uniqueId", "error");
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
      const payload = {
        name: deviceForm.name?.trim() || undefined,
        uniqueId: deviceForm.uniqueId.trim(),
        modelId: deviceForm.modelId || undefined,
        chipId: deviceForm.chipId || undefined,
        vehicleId: deviceForm.vehicleId || undefined,
        clientId,
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

  async function handleDeleteDevice(id) {
    if (!id) return;
    if (!window.confirm("Remover este equipamento?")) return;
    const clientId = tenantId || user?.clientId || "";
    if (!clientId) {
      showToast("Selecione um cliente para remover o equipamento", "error");
      return;
    }
    try {
      await CoreApi.deleteDevice(id, { clientId });
      await load();
      showToast("Equipamento removido", "success");
    } catch (requestError) {
      showToast(requestError?.message || "Não foi possível remover o equipamento", "error");
    }
  }

  async function handleDeleteConflictDevice() {
    if (!conflictDevice?.deviceId) return;
    if (!window.confirm("Remover este equipamento?")) return;
    const clientId = tenantId || user?.clientId || "";
    if (!clientId) {
      showToast("Selecione um cliente para remover o equipamento", "error");
      return;
    }
    try {
      await CoreApi.deleteDevice(conflictDevice.deviceId, { clientId });
      await load();
      resetDeviceForm();
      setConflictDevice(null);
      showToast("Equipamento removido", "success");
    } catch (requestError) {
      showToast(requestError?.message || "Não foi possível remover o equipamento", "error");
    }
  }

  function openEditDevice(device) {
    setEditingId(device.id);
    setDeviceForm({
      name: device.name || "",
      uniqueId: device.uniqueId || "",
      modelId: device.modelId || "",
      chipId: device.chipId || "",
      vehicleId: device.vehicleId || "",
    });
    setDrawerTab("geral");
    setLinkTarget(device);
    setLinkVehicleId(device.vehicleId || "");
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

  async function handleSyncDevices() {
    const clientId = tenantId || user?.clientId || null;
    setSyncing(true);
    try {
      await CoreApi.syncDevicesFromTraccar(clientId ? { clientId } : undefined);
      await load();
      showToast("Sincronização com o Traccar iniciada", "success");
      setLastSyncAt(new Date());
    } catch (requestError) {
      showToast(requestError?.message || "Falha ao sincronizar com o Traccar", "error");
    } finally {
      setSyncing(false);
    }
  }

  function toggleColumn(key) {
    setVisibleColumns((current) => ({ ...current, [key]: !current[key] }));
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
      const model = modeloById.get(device.modelId) || {};
      return [
        device.name || "",
        device.uniqueId || "",
        meta.label,
        formatLastCommunication(device),
        formatPosition(device),
        vehicle?.plate || vehicle?.name || "",
        chip?.iccid || chip?.phone || "",
        model?.name || "",
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

  const tableColCount =
    6 + (visibleColumns.chip ? 1 : 0) + (visibleColumns.speed ? 1 : 0) + (visibleColumns.ignition ? 1 : 0);

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

      <div className="-mx-4 space-y-3 border-b border-white/5 bg-[#0c1119]/90 px-4 pb-4 pt-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
        <PageHeader
          title="Equipamentos"
          description="Cadastro e vínculos com chips/veículos"
          right={
            <div className="flex flex-col items-end gap-1 text-right">
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={handleSyncDevices}
                  className="inline-flex items-center gap-2"
                  disabled={syncing}
                >
                  <RefreshCw className="h-4 w-4" />
                  <span>{syncing ? "Sincronizando…" : "Sincronizar Traccar"}</span>
                </Button>
                <Button
                  onClick={() => {
                    resetDeviceForm();
                    setEditingId(null);
                    setDrawerTab("geral");
                    setShowDeviceDrawer(true);
                  }}
                  className="inline-flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  <span>Novo equipamento</span>
                </Button>
              </div>
              <span className="text-[11px] uppercase tracking-[0.12em] text-white/60">
                Última sincronização: {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : "—"}
              </span>
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por nome, IMEI, chip, placa"
              className="w-full rounded-lg border border-white/10 bg-white/10 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/50 focus:border-primary focus:outline-none"
            />
          </div>
          <select
            value={filters.link}
            onChange={(event) => setFilters((current) => ({ ...current, link: event.target.value }))}
            className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
          >
            <option value="all">Vínculo: Todos</option>
            <option value="linked">Vínculo: Vinculados</option>
            <option value="unlinked">Vínculo: Não vinculados</option>
          </select>
          <select
            value={filters.status}
            onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
            className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
          >
            <option value="all">Status: Todos</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="1-6h">Sem transmissão 1–6h</option>
            <option value="6-24h">Sem transmissão 6–24h</option>
            <option value=">24h">&gt;24h</option>
          </select>
          <select
            value={filters.model}
            onChange={(event) => setFilters((current) => ({ ...current, model: event.target.value }))}
            className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
          >
            <option value="all">Modelo/Tipo</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} · {model.brand}
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-white/60">
              {filteredDevices.length} de {devices.length} equipamentos
            </span>
            <Button
              variant="ghost"
              className="inline-flex items-center gap-2"
              onClick={handleExportCsv}
              disabled={!filteredDevices.length}
            >
              <Download className="h-4 w-4" />
              <span>Exportar CSV</span>
            </Button>
            <Button
              variant="ghost"
              className="inline-flex items-center gap-2"
              onClick={() => setShowColumnPicker((prev) => !prev)}
            >
              <SignalMedium className="h-4 w-4" />
              <span>Exibir colunas</span>
            </Button>
          </div>
        </div>

        {showColumnPicker && (
          <div className="flex flex-wrap gap-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/80">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={visibleColumns.speed}
                onChange={() => toggleColumn("speed")}
                className="h-4 w-4 rounded border-white/30 bg-transparent"
              />
              Velocidade
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={visibleColumns.chip}
                onChange={() => toggleColumn("chip")}
                className="h-4 w-4 rounded border-white/30 bg-transparent"
              />
              Chip
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={visibleColumns.ignition}
                onChange={() => toggleColumn("ignition")}
                className="h-4 w-4 rounded border-white/30 bg-transparent"
              />
              Bateria / Ignição
            </label>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error.message}</div>
      )}

      <div className="flex-1 rounded-2xl border border-white/10 bg-[#0d131c]/80 shadow-2xl">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-white/80">
            <thead className="sticky top-0 bg-white/5 text-xs uppercase tracking-wide text-white/60 backdrop-blur">
              <tr>
                <th className="px-4 py-3 text-left">Nome / IMEI</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Última comunicação</th>
                <th className="px-4 py-3 text-left">Última posição</th>
                <th className="px-4 py-3 text-left">Vínculo</th>
                {visibleColumns.chip && <th className="px-4 py-3 text-left">Chip</th>}
                {visibleColumns.speed && <th className="px-4 py-3 text-left">Vel.</th>}
                {visibleColumns.ignition && <th className="px-4 py-3 text-left">Bateria / Ignição</th>}
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {(loading || traccarLoading) && (
                <tr>
                  <td colSpan={tableColCount} className="px-4 py-6 text-center text-white/60">
                    Carregando equipamentos…
                  </td>
                </tr>
              )}
              {!loading && !traccarLoading && filteredDevices.length === 0 && (
                <tr>
                  <td colSpan={tableColCount} className="px-4 py-10 text-center text-white/60">
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-white">Nenhum resultado</p>
                      <p className="text-xs text-white/60">
                        Ajuste filtros ou cadastre um novo equipamento.
                      </p>
                      <div className="flex justify-center gap-2 text-xs">
                        <Button
                          variant="ghost"
                          className="inline-flex items-center gap-2"
                          onClick={() => {
                            setFilters({ status: "all", link: "all", model: "all" });
                            setQuery("");
                          }}
                        >
                          <RefreshCw className="h-4 w-4" />
                          Limpar filtros
                        </Button>
                        <Button
                          className="inline-flex items-center gap-2"
                          onClick={() => {
                            resetDeviceForm();
                            setEditingId(null);
                            setDrawerTab("geral");
                            setShowDeviceDrawer(true);
                          }}
                        >
                          <Plus className="h-4 w-4" />
                          Cadastrar novo
                        </Button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              {!loading &&
                filteredDevices.map((device) => {
                  const modelo = modeloById.get(device.modelId) || null;
                  const chip = chipById.get(device.chipId) || device.chip;
                  const vehicle = vehicleById.get(device.vehicleId) || device.vehicle;
                  const position = latestPositionByDevice.get(deviceKey(device));
                  const meta = statusMeta(device);
                  const ignitionLabel = formatIgnition(device);
                  const batteryLabel = formatBattery(device);
                  const traccarDevice = traccarDeviceFor(device);
                  return (
                    <DeviceRow
                      key={device.internalId || device.id || device.uniqueId}
                      device={device}
                      traccarDevice={traccarDevice}
                      model={modelo}
                      chip={chip}
                      vehicle={vehicle}
                      position={position}
                      status={meta}
                      batteryLabel={batteryLabel}
                      ignitionLabel={ignitionLabel}
                      speedLabel={formatSpeed(device)}
                      showSpeed={visibleColumns.speed}
                      showChip={visibleColumns.chip}
                      showIgnition={visibleColumns.ignition}
                      onMap={() => position && setMapTarget({ device, position })}
                      onLink={() => {
                        setLinkTarget(device);
                        setLinkVehicleId(device.vehicleId || "");
                      }}
                      onUnlink={() => handleUnlinkFromVehicle(device)}
                      onEdit={() => openEditDevice(device)}
                      onDelete={() => handleDeleteDevice(device.id)}
                      positionLabel={formatPositionSummary(position)}
                      lastCommunication={formatLastCommunication(device)}
                    />
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer
        open={showDeviceDrawer}
        onClose={() => setShowDeviceDrawer(false)}
        title={editingId ? "Editar equipamento" : "Novo equipamento"}
        description="Edite dados gerais, vínculos e telemetria em um layout lateral."
      >
        <div className="flex gap-2 overflow-x-auto pb-2 text-[11px] uppercase tracking-[0.1em] text-white/60">
          {["geral", "vinculos", "telemetria", "acoes"].map((key) => (
            <button
              key={key}
              onClick={() => setDrawerTab(key)}
              className={`rounded-md px-3 py-2 transition ${drawerTab === key ? "bg-primary/20 text-white border border-primary/40" : "border border-transparent hover:border-white/20"}`}
            >
              {key === "geral" && "Geral"}
              {key === "vinculos" && "Vínculos"}
              {key === "telemetria" && "Telemetria"}
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
            <Select
              label="Modelo"
              value={deviceForm.modelId}
              onChange={(event) => setDeviceForm((current) => ({ ...current, modelId: event.target.value }))}
            >
              <option value="">— Selecione —</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} · {model.brand}
                </option>
              ))}
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
              <Select
                label="Chip vinculado"
                value={deviceForm.chipId}
                onChange={(event) => setDeviceForm((current) => ({ ...current, chipId: event.target.value }))}
              >
                <option value="">— Sem chip —</option>
                {chipOptions.map((chip) => (
                  <option key={chip.value} value={chip.value}>
                    {chip.label}
                  </option>
                ))}
              </Select>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.1em] text-white/60">Buscar placa/veículo</label>
                <input
                  value={linkQuery}
                  onChange={(event) => setLinkQuery(event.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                  placeholder="Digite a placa ou nome"
                />
              </div>
              <div className="md:col-span-2 space-y-2">
                <label className="text-xs uppercase tracking-[0.1em] text-white/60">Selecionar veículo</label>
                <select
                  value={linkVehicleId}
                  onChange={(event) => setLinkVehicleId(event.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                  required
                >
                  <option value="">— Escolha um veículo —</option>
                  {linkVehicleOptions.map((vehicle) => (
                    <option key={vehicle.value} value={vehicle.value}>
                      {vehicle.label}
                    </option>
                  ))}
                </select>
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
          <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.1em] text-white/50">Última comunicação</span>
              <span className="text-sm text-white">{formatLastCommunication(deviceForm)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.1em] text-white/50">Posição</span>
              <span className="text-sm text-white">{formatPosition(deviceForm)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.1em] text-white/50">Status</span>
              <StatusPill meta={statusMeta(deviceForm)} />
            </div>
          </div>
        )}

        {drawerTab === "acoes" && (
          <div className="space-y-3">
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
            <label className="text-xs uppercase tracking-[0.1em] text-white/60">Buscar placa/veículo</label>
            <input
              value={linkQuery}
              onChange={(event) => setLinkQuery(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
              placeholder="Digite a placa ou nome"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.1em] text-white/60">Selecionar veículo</label>
            <select
              value={linkVehicleId}
              onChange={(event) => setLinkVehicleId(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
              required
            >
              <option value="">— Escolha um veículo —</option>
              {linkVehicleOptions.map((vehicle) => (
                <option key={vehicle.value} value={vehicle.value}>
                  {vehicle.label}
                </option>
              ))}
            </select>
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
              center={[
                Number(mapTarget.position.latitude ?? mapTarget.position.lat ?? 0),
                Number(mapTarget.position.longitude ?? mapTarget.position.lon ?? mapTarget.position.lng ?? 0),
              ]}
              zoom={15}
              style={{ height: "100%", width: "100%" }}
              whenCreated={(map) => {
                mapRef.current = map;
                setTimeout(() => map.invalidateSize(), 50);
              }}
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
