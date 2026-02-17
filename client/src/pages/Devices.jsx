import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import {
  Clock3,
  Download,
  Globe,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SignalMedium,
  SlidersHorizontal,
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
import AutocompleteSelect from "../components/ui/AutocompleteSelect.jsx";
import PageHeader from "../components/ui/PageHeader.jsx";
import FilterBar from "../components/ui/FilterBar.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import DataCard from "../components/ui/DataCard.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import SkeletonTable from "../components/ui/SkeletonTable.jsx";
import DataTablePagination from "../ui/DataTablePagination.jsx";
import DataState from "../ui/DataState.jsx";
import { CoreApi, normaliseListPayload } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { useConfirmDialog } from "../components/ui/ConfirmDialogProvider.jsx";
import useAdminGeneralAccess from "../lib/hooks/useAdminGeneralAccess.js";
import { usePermissionGate } from "../lib/permissions/permission-gate.js";
import { useLivePositions } from "../lib/hooks/useLivePositions.js";
import useTraccarDevices from "../lib/hooks/useTraccarDevices.js";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";
import useMapLifecycle from "../lib/map/useMapLifecycle.js";
import { leafletDefaultIcon } from "../lib/map/leaflet-default-icon.js";
import { createVehicleMarkerIcon } from "../lib/map/vehicleMarkerIcon.js";
import { DEFAULT_MAP_LAYER } from "../lib/mapLayers.js";
import { formatAddress } from "../lib/format-address.js";
import { buildPortList, normalizePortCounts } from "../lib/device-ports.js";
import { resolveEquipmentMovementMeta } from "../lib/equipment-movement.js";
import { EQUIPMENT_STATUS_OPTIONS, normalizeEquipmentStatusValue } from "../lib/equipment-status.js";
import { isServiceStockGlobalPermissionGroup } from "../lib/permissions/profile-groups.js";

const PAGE_SIZE_OPTIONS = [5, 20, 50, 100, 500, 1000, 5000];
const DEVICE_EDITOR_TABS = [
  "geral",
  "vinculos",
  "status",
  "propriedade",
  "telemetria",
  "portas",
  "garantia",
  "condicoes",
  "historico",
  "massa",
  "acoes",
];
const EQUIPMENT_CONDITION_OPTIONS = [
  "Novo",
  "Usado funcionando",
  "Usado com defeito",
  "Manutenção",
  "Com defeito",
  "Retirado",
];

const DEVICE_TABLE_COLUMNS = [
  { key: "id", label: "ID / IMEI" },
  { key: "model", label: "Modelo" },
  { key: "status", label: "Status" },
  { key: "lastCommunication", label: "Última comunicação" },
  { key: "lastPosition", label: "Última posição" },
  { key: "link", label: "Vínculo" },
  { key: "client", label: "Cliente" },
  { key: "warranty", label: "Garantia" },
  { key: "actions", label: "Ações" },
];

const DEFAULT_DEVICE_COLUMN_VISIBILITY = Object.fromEntries(DEVICE_TABLE_COLUMNS.map((column) => [column.key, true]));
const NON_TOGGLABLE_DEVICE_COLUMNS = new Set(["id", "actions"]);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONGO_OBJECT_ID_REGEX = /^[0-9a-f]{24}$/i;

function normalizeDeviceColumnVisibility(value) {
  const base = { ...DEFAULT_DEVICE_COLUMN_VISIBILITY };
  if (!value || typeof value !== "object") return base;
  DEVICE_TABLE_COLUMNS.forEach((column) => {
    if (Object.prototype.hasOwnProperty.call(value, column.key)) {
      base[column.key] = Boolean(value[column.key]);
    }
  });
  const hasAnyVisible = DEVICE_TABLE_COLUMNS.some((column) => base[column.key]);
  if (!hasAnyVisible) {
    base.id = true;
  }
  NON_TOGGLABLE_DEVICE_COLUMNS.forEach((columnKey) => {
    base[columnKey] = true;
  });
  return base;
}

function toLocalInputDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

function resolveDeviceEditorRoute(pathname = "") {
  const normalized = String(pathname || "");
  const newMatch = normalized.match(/^\/(devices|equipamentos)\/new$/i);
  if (newMatch) {
    return {
      isEditorRoute: true,
      isNewRoute: true,
      pathBase: `/${String(newMatch[1]).toLowerCase()}`,
      routeDeviceId: null,
    };
  }
  const editMatch = normalized.match(/^\/(devices|equipamentos)\/([^/]+)\/(edit|editar)$/i);
  if (editMatch) {
    return {
      isEditorRoute: true,
      isNewRoute: false,
      pathBase: `/${String(editMatch[1]).toLowerCase()}`,
      routeDeviceId: String(editMatch[2] || ""),
    };
  }
  const listMatch = normalized.match(/^\/(devices|equipamentos)(?:\/)?$/i);
  return {
    isEditorRoute: false,
    isNewRoute: false,
    pathBase: `/${String(listMatch?.[1] || "devices").toLowerCase()}`,
    routeDeviceId: null,
  };
}

function normalizeEditorTab(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  return DEVICE_EDITOR_TABS.includes(value) ? value : "geral";
}

function getDeviceTabLabel(key) {
  if (key === "geral") return "Geral";
  if (key === "vinculos") return "Vínculos";
  if (key === "status") return "Status";
  if (key === "propriedade") return "Propriedade";
  if (key === "telemetria") return "Telemetria";
  if (key === "portas") return "Portas";
  if (key === "garantia") return "Garantia";
  if (key === "condicoes") return "Condições";
  if (key === "historico") return "Histórico";
  if (key === "massa") return "Massa";
  if (key === "acoes") return "Ações";
  return key;
}

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

function formatTransferDate(value) {
  const parsed = Date.parse(value || 0);
  if (!value || Number.isNaN(parsed)) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(parsed));
}

function normalizeOwnershipTypeValue(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "VENDA" ? "VENDA" : "COMODATO";
}

function isTechnicalIdentifier(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  return UUID_REGEX.test(normalized) || MONGO_OBJECT_ID_REGEX.test(normalized);
}

function sanitizeHistoryDisplayValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (isTechnicalIdentifier(normalized)) return null;
  return normalized;
}

function sanitizeHistoryResponsible(value) {
  const normalized = sanitizeHistoryDisplayValue(value);
  if (!normalized) return null;
  if (normalized.toLowerCase() === "system") return "Sistema";
  return normalized;
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
  canDelete,
  positionLabel,
  lastCommunication,
  visibleColumns = DEFAULT_DEVICE_COLUMN_VISIBILITY,
}) {
  const showId = Boolean(visibleColumns.id);
  const showModel = Boolean(visibleColumns.model);
  const showStatus = Boolean(visibleColumns.status);
  const showLastCommunication = Boolean(visibleColumns.lastCommunication);
  const showLastPosition = Boolean(visibleColumns.lastPosition);
  const showLink = Boolean(visibleColumns.link);
  const showClient = Boolean(visibleColumns.client);
  const showWarranty = Boolean(visibleColumns.warranty);
  const showActions = Boolean(visibleColumns.actions);
  const imei = device.uniqueId || traccarDevice?.uniqueId || "—";
  const internalCode = device?.attributes?.internalCode || device?.internalCode || "—";
  const equipmentDisplayId = device?.displayId || imei || device?.id || "—";
  const modelLabel = model?.name || device?.modelName || "—";
  const modelDetail = model?.version || model?.protocol || device?.modelProtocol || "";
  const linkedVehicleId = vehicle?.id || device?.vehicleId || device?.vehicle?.id || null;
  const isLinked = Boolean(vehicle || linkedVehicleId);
  const vehicleLabel = vehicle?.plate || vehicle?.name || (linkedVehicleId ? "Vinculado" : "Não vinculado");
  const vehicleSubtitle =
    vehicle?.clientName ||
    vehicle?.client?.name ||
    (linkedVehicleId ? `ID ${linkedVehicleId}` : "Sem vínculo");
  const clientLabel =
    device?.clientName ||
    device?.client?.name ||
    vehicle?.clientName ||
    vehicle?.client?.name ||
    "—";
  return (
    <tr className="group h-[72px] align-middle hover:bg-white/5">
      {showId && (
        <td className="w-[220px] min-w-[220px] px-3 py-2 align-middle">
          <div className="max-w-[200px] truncate font-semibold text-white" title={imei}>
            {imei}
          </div>
          <div className="max-w-[200px] truncate text-xs text-white/50" title={`ID interno ${internalCode}`}>
            ID interno {internalCode}
          </div>
        </td>
      )}
      {showModel && (
        <td className="e-hide-mobile w-[240px] min-w-[220px] px-3 py-2 align-middle sm:table-cell">
          <div className="max-w-[220px] truncate text-white" title={modelLabel}>
            {modelLabel}
          </div>
          <div className="max-w-[220px] truncate text-xs text-white/50" title={modelDetail}>
            {modelDetail}
          </div>
        </td>
      )}
      {showStatus && (
        <td className="w-[180px] min-w-[170px] px-3 py-2 align-middle">
          <StatusPill meta={status} />
        </td>
      )}
      {showLastCommunication && (
        <td className="w-[190px] min-w-[180px] px-3 py-2 align-middle">
          <div className="max-w-[180px] truncate text-white" title={lastCommunication}>
            {lastCommunication}
          </div>
        </td>
      )}
      {showLastPosition && (
        <td className="e-hide-mobile w-[340px] min-w-[280px] px-3 py-2 align-middle md:table-cell">
          <div
            className="max-w-[320px] truncate whitespace-nowrap text-xs leading-snug text-white/70"
            title={positionLabel || ""}
          >
            {positionLabel}
          </div>
        </td>
      )}
      {showLink && (
        <td className="w-[280px] min-w-[220px] px-3 py-2 align-middle sm:min-w-[240px]">
          {isLinked ? (
            <button
              type="button"
              onClick={onNavigateToMonitoring}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white hover:border-primary"
            >
              <Link2 className="h-3 w-3" />
              <div className="text-left">
                <div className="max-w-[160px] truncate font-medium">{vehicleLabel}</div>
                <div className="max-w-[160px] truncate text-[11px] text-white/60">{vehicleSubtitle}</div>
                <div className="max-w-[160px] truncate text-[10px] text-white/45">Equip.: {equipmentDisplayId}</div>
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
      )}
      {showClient && (
        <td className="e-hide-mobile w-[220px] min-w-[180px] px-3 py-2 align-middle md:table-cell">
          <div className="max-w-[200px] truncate text-white/70" title={clientLabel}>
            {clientLabel}
          </div>
        </td>
      )}
      {showWarranty && (
        <td className="e-hide-mobile w-[250px] min-w-[220px] px-3 py-2 align-middle text-white/70 md:table-cell">
          <span className="inline-block max-w-[220px] truncate whitespace-nowrap" title={warrantyLabel}>
            {warrantyLabel}
          </span>
        </td>
      )}
      {showActions && (
        <td className="w-[170px] min-w-[170px] bg-[#111722] px-3 py-2 text-right align-middle group-hover:bg-[#192233] md:sticky md:right-0 md:z-10">
          <div className="inline-flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white hover:border-white/30"
              onClick={onEdit}
              aria-label="Editar equipamento"
            >
              <Pencil className="h-4 w-4" />
            </button>
            {isLinked && (
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
              <Globe className="h-4 w-4" />
            </button>
            {canDelete && (
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-400/30 text-red-200 hover:border-red-300"
                onClick={onDelete}
                aria-label="Remover"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </td>
      )}
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

function Drawer({ open, onClose, title, description, children, panelClassName = "" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9998] flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative h-full w-full max-w-3xl border-l border-white/10 bg-[#0f141c] shadow-3xl ${panelClassName}`.trim()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {description ? <p className="text-sm text-white/60">{description}</p> : null}
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
        <div className="h-[calc(100%-80px)] overflow-y-auto overflow-x-hidden px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

function DeviceEditorContainer({ isEditorRoute, open, onClose, title, description, children }) {
  if (isEditorRoute) {
    return (
      <DataCard className="space-y-4">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            {title ? <h2 className="text-xl font-semibold text-white">{title}</h2> : null}
            {description ? <p className="text-sm text-white/60">{description}</p> : null}
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
        <div className="overflow-x-hidden">{children}</div>
      </DataCard>
    );
  }

  return (
    <Drawer open={open} onClose={onClose} title={title} description={description}>
      {children}
    </Drawer>
  );
}

export default function Devices() {
  const { tenantId, tenantScope, user, permissionContext } = useTenant();
  const isTechnician = user?.role === "technician";
  const isServiceStockGlobalProfile = isServiceStockGlobalPermissionGroup(permissionContext);
  const serviceStockColumnsCount = 7;
  const devicesPermission = usePermissionGate({ menuKey: "primary", pageKey: "devices", subKey: "devices-list" });
  const canCreateDevice = !isTechnician && !isServiceStockGlobalProfile && devicesPermission.isFull;
  const baseLayer = DEFAULT_MAP_LAYER;
  const tileUrl = baseLayer?.url || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileAttribution =
    baseLayer?.attribution || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const tileSubdomains = baseLayer?.subdomains ?? "abc";
  const tileMaxZoom = baseLayer?.maxZoom;
  const location = useLocation();
  const navigate = useNavigate();
  const editorRoute = useMemo(() => resolveDeviceEditorRoute(location.pathname), [location.pathname]);
  const isEditorRoute = editorRoute.isEditorRoute;
  const isNewRoute = editorRoute.isNewRoute;
  const routeDeviceId = editorRoute.routeDeviceId;
  const listPath = editorRoute.pathBase || "/devices";
  const { positions } = useLivePositions();
  const { byId: traccarById, byUniqueId: traccarByUniqueId, loading: traccarLoading } = useTraccarDevices({
    enabled: devicesPermission.hasAccess,
  });
  const [devices, setDevices] = useState([]);
  const [models, setModels] = useState([]);
  const [chips, setChips] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingDevice, setSavingDevice] = useState(false);
  const [savingPorts, setSavingPorts] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingClientId, setEditingClientId] = useState("");
  const [showDeviceDrawer, setShowDeviceDrawer] = useState(false);
  const [conflictDevice, setConflictDevice] = useState(null);
  const [linkTarget, setLinkTarget] = useState(null);
  const [linkVehicleId, setLinkVehicleId] = useState("");
  const [linkQuery, setLinkQuery] = useState("");
  const { confirmDelete } = useConfirmDialog();
  const { isAdminGeneral, sessionClient } = useAdminGeneralAccess();
  const [filters, setFilters] = useState({
    status: "all",
    link: "all",
    model: "",
  });
  const [modelDraft, setModelDraft] = useState("");
  const resolvedClientId = tenantScope === "ALL" ? null : (tenantId || user?.clientId || null);
  const adminGeneralClientId = isAdminGeneral ? String(sessionClient?.id || "").trim() : "";
  const resolveWriteClientId = useCallback(
    (...candidates) => {
      for (const candidate of candidates) {
        const value = candidate === undefined || candidate === null ? "" : String(candidate).trim();
        if (value) return value;
      }
      return adminGeneralClientId || "";
    },
    [adminGeneralClientId],
  );
  const [syncing, setSyncing] = useState(false);
  const [drawerTab, setDrawerTab] = useState("geral");
  const [internalCodePreviewLoading, setInternalCodePreviewLoading] = useState(false);
  const [internalCodePreviewError, setInternalCodePreviewError] = useState(null);
  const [internalCodePreviewRetryKey, setInternalCodePreviewRetryKey] = useState(0);
  const internalCodeTouchedRef = useRef(false);
  const editorRouteInitRef = useRef("");
  const [initializedFromSearch, setInitializedFromSearch] = useState(false);
  const [creatingVehicle, setCreatingVehicle] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({ plate: "", name: "" });

  const [deviceForm, setDeviceForm] = useState({
    name: "",
    uniqueId: "",
    modelId: "",
    internalCode: "",
    gprsCommunication: true,
    ownershipType: "COMODATO",
    equipmentStatus: "ESTOQUE NOVO",
    chipId: "",
    vehicleId: "",
    portLabels: {},
    productionDate: "",
    installationDate: "",
    warrantyOrigin: "production",
    warrantyDays: "",
    warrantyEndDate: "",
  });
  const [conditionDraft, setConditionDraft] = useState({
    condition: "Novo",
    date: toLocalInputDateTime(new Date()),
    note: "",
  });
  const [query, setQuery] = useState("");
  const [columnVisibility, setColumnVisibility] = useState(() => ({ ...DEFAULT_DEVICE_COLUMN_VISIBILITY }));
  const [columnVisibilityDraft, setColumnVisibilityDraft] = useState(() => ({ ...DEFAULT_DEVICE_COLUMN_VISIBILITY }));
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
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
  const [forbidden, setForbidden] = useState(false);
  const [deviceHistoryRows, setDeviceHistoryRows] = useState([]);
  const [deviceHistoryLoading, setDeviceHistoryLoading] = useState(false);
  const [deviceHistoryError, setDeviceHistoryError] = useState("");
  const mapRef = useRef(null);
  const columnMenuRef = useRef(null);
  const columnPrefsInitializedRef = useRef(false);
  const pendingQueryNavigateRef = useRef(null);
  const syncingTabFromQueryRef = useRef(false);
  const { onMapReady } = useMapLifecycle({ mapRef });
  const columnStorageKey = useMemo(
    () => `devices.table.columns:${user?.id || user?.email || user?.username || "default"}`,
    [user?.email, user?.id, user?.username],
  );
  const mapMarkerIcon = useMemo(() => {
    if (!mapTarget?.position) return leafletDefaultIcon;
    const device = mapTarget?.device || {};
    const position = mapTarget?.position || {};
    const attrs = device.attributes || {};
    return (
      createVehicleMarkerIcon({
        bearing: Number(position.course ?? position.heading ?? 0),
        iconType: attrs.iconType || device.iconType,
        label: device.name || device.uniqueId,
        plate: device.uniqueId,
      }) || leafletDefaultIcon
    );
  }, [mapTarget]);
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

  useEffect(() => {
    try {
      const raw = window.localStorage?.getItem(columnStorageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      const normalized = normalizeDeviceColumnVisibility(parsed);
      setColumnVisibility(normalized);
      setColumnVisibilityDraft(normalized);
    } catch (_error) {
      const fallback = normalizeDeviceColumnVisibility(DEFAULT_DEVICE_COLUMN_VISIBILITY);
      setColumnVisibility(fallback);
      setColumnVisibilityDraft(fallback);
    } finally {
      columnPrefsInitializedRef.current = true;
    }
  }, [columnStorageKey]);

  useEffect(() => {
    if (!columnPrefsInitializedRef.current) return;
    try {
      window.localStorage?.setItem(columnStorageKey, JSON.stringify(columnVisibility));
    } catch (_error) {
      // armazenamento indisponível no navegador
    }
  }, [columnStorageKey, columnVisibility]);

  useEffect(() => {
    if (!showColumnsMenu) return undefined;
    setColumnVisibilityDraft(columnVisibility);
    const handlePointerDown = (event) => {
      if (!columnMenuRef.current) return;
      if (!columnMenuRef.current.contains(event.target)) {
        setShowColumnsMenu(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [columnVisibility, showColumnsMenu]);

  useEffect(() => {
    if (!isTechnician) return;
    setFilters({ status: "all", link: "all", model: "" });
    setModelDraft("");
  }, [isTechnician]);

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
    if (!devicesPermission.hasAccess) {
      setForbidden(true);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const clientId = resolvedClientId;
      const vehiclesParams = clientId ? { clientId } : {};
      const modelParams = clientId ? { clientId, includeGlobal: true } : {};
      if (isServiceStockGlobalProfile) {
        modelParams.scope = "both";
      }
      vehiclesParams.accessible = true;
      vehiclesParams.includeUnlinked = true;
      vehiclesParams.skipPositions = true;
      const [deviceResult, modelResult, chipResult, vehicleResult] = await Promise.allSettled([
        CoreApi.listDevices(clientId ? { clientId } : undefined),
        CoreApi.models(modelParams),
        CoreApi.listChips(clientId ? { clientId } : undefined),
        CoreApi.listVehicles(vehiclesParams),
      ]);

      if (deviceResult.status === "fulfilled") {
        setDevices(normaliseListPayload(deviceResult.value));
      } else {
        const status = deviceResult.reason?.response?.status ?? deviceResult.reason?.status;
        if (status === 403) {
          setForbidden(true);
          setLoading(false);
          return;
        }
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
      const status = requestError?.response?.status ?? requestError?.status;
      if (status === 403) {
        setForbidden(true);
        setError(null);
        return;
      }
      setError(requestError instanceof Error ? requestError : new Error("Falha ao carregar dados"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!devicesPermission.loading && (resolvedClientId || user)) {
      load();
    }
  }, [devicesPermission.hasAccess, devicesPermission.loading, resolvedClientId, user]);

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
    if (!isEditorRoute) {
      syncingTabFromQueryRef.current = false;
      return;
    }
    const params = new URLSearchParams(location.search);
    const queryTab = normalizeEditorTab(params.get("tab"));
    setDrawerTab((current) => {
      if (current === queryTab) {
        syncingTabFromQueryRef.current = false;
        return current;
      }
      syncingTabFromQueryRef.current = true;
      return queryTab;
    });
  }, [isEditorRoute, location.search]);

  useEffect(() => {
    if (!initializedFromSearch) return;
    const currentPath = `${location.pathname}${location.search}`;
    if (pendingQueryNavigateRef.current && pendingQueryNavigateRef.current === currentPath) {
      pendingQueryNavigateRef.current = null;
    }
  }, [initializedFromSearch, location.pathname, location.search]);

  useEffect(() => {
    if (!initializedFromSearch) return;
    if (isEditorRoute && syncingTabFromQueryRef.current) return;
    const params = new URLSearchParams(location.search);
    if (filters.link === "all") {
      params.delete("link");
    } else {
      params.set("link", filters.link);
    }
    if (isEditorRoute) {
      const nextTab = normalizeEditorTab(drawerTab);
      if (nextTab === "geral") {
        params.delete("tab");
      } else {
        params.set("tab", nextTab);
      }
    } else {
      params.delete("tab");
    }
    const nextSearch = params.toString() ? `?${params.toString()}` : "";
    const currentPath = `${location.pathname}${location.search}`;
    const nextPath = `${location.pathname}${nextSearch}`;
    if (nextPath === currentPath) return;
    if (pendingQueryNavigateRef.current === nextPath) return;
    pendingQueryNavigateRef.current = nextPath;
    navigate({ pathname: location.pathname, search: nextSearch }, { replace: true });
  }, [drawerTab, filters.link, initializedFromSearch, isEditorRoute, location.pathname, location.search, navigate]);

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
  const editingDevice = useMemo(
    () => (editingId ? devices.find((item) => String(item.id) === String(editingId)) : null),
    [devices, editingId],
  );

  const selectedModel = deviceForm.modelId ? modeloById.get(String(deviceForm.modelId)) : null;
  const internalCodePreview = useMemo(() => {
    if (deviceForm.internalCode) return String(deviceForm.internalCode).trim();
    return selectedModel?.nextInternalCode || "";
  }, [deviceForm.internalCode, selectedModel]);

  useEffect(() => {
    const modelId = String(deviceForm.modelId || "").trim();
    const shouldHydrateInternalCodeField = Boolean(editingId);
    const persistedCode = editingDevice?.attributes?.internalCode || editingDevice?.internalCode || "";
    const currentCode = String(deviceForm.internalCode || "").trim();
    const shouldSkipAutofill =
      shouldHydrateInternalCodeField && Boolean(currentCode || persistedCode || internalCodeTouchedRef.current);
    if (!modelId || shouldSkipAutofill) {
      setInternalCodePreviewLoading(false);
      setInternalCodePreviewError(null);
      return;
    }

    const previewFromModel = String(selectedModel?.nextInternalCode || "").trim();
    if (previewFromModel) {
      setInternalCodePreviewLoading(false);
      setInternalCodePreviewError(null);
      if (shouldHydrateInternalCodeField) {
        setDeviceForm((current) => {
          if (String(current.internalCode || "").trim()) return current;
          return { ...current, internalCode: previewFromModel };
        });
      }
      return;
    }

    let cancelled = false;
    setInternalCodePreviewLoading(true);
    setInternalCodePreviewError(null);

    CoreApi.getModel(modelId, resolvedClientId ? { clientId: resolvedClientId } : undefined)
      .then((response) => {
        if (cancelled) return;
        const modelData = response?.model || null;
        if (modelData?.id) {
          setModels((current) => {
            const list = Array.isArray(current) ? [...current] : [];
            const index = list.findIndex((item) => String(item?.id) === String(modelData.id));
            if (index >= 0) {
              list[index] = { ...list[index], ...modelData };
            } else {
              list.push(modelData);
            }
            return list;
          });
        }
        const generated = String(modelData?.nextInternalCode || "").trim();
        if (!generated) {
          setInternalCodePreviewError("Não foi possível gerar o código interno.");
          return;
        }
        if (shouldHydrateInternalCodeField) {
          setDeviceForm((current) => {
            if (String(current.internalCode || "").trim() || internalCodeTouchedRef.current) return current;
            return { ...current, internalCode: generated };
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInternalCodePreviewError("Não foi possível gerar o código interno.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setInternalCodePreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    deviceForm.internalCode,
    deviceForm.modelId,
    editingDevice?.attributes?.internalCode,
    editingDevice?.internalCode,
    editingId,
    internalCodePreviewRetryKey,
    resolvedClientId,
    selectedModel?.nextInternalCode,
  ]);
  const portSummary = useMemo(() => {
    if (!selectedModel) return "—";
    const counts = normalizePortCounts(selectedModel?.portCounts, selectedModel?.ports);
    const entries = Object.entries(counts).filter(([, value]) => Number(value) > 0);
    if (!entries.length) return "—";
    const labelMap = {
      di: "DI",
      do: "DO",
      rs232: "RS232",
      rs485: "RS485",
      can: "CAN",
      lora: "LoRa",
      wifi: "Wi-Fi",
      bluetooth: "BT",
    };
    return entries
      .map(([key, value]) => `${labelMap[key] || key.toUpperCase()}: ${value}`)
      .join(" · ");
  }, [selectedModel]);

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
      if (vehicle?.id) map.set(String(vehicle.id), vehicle);
    });
    return map;
  }, [vehicles]);
  const vehicleByDeviceId = useMemo(() => {
    const map = new Map();
    const register = (vehicle, device) => {
      if (!vehicle || !device) return;
      const candidates = [
        device.id,
        device.deviceId,
        device.uniqueId,
        device.internalId,
      ]
        .filter(Boolean)
        .map((value) => String(value));
      candidates.forEach((key) => {
        if (!map.has(key)) map.set(key, vehicle);
      });
    };
    vehicles.forEach((vehicle) => {
      if (vehicle?.deviceId) {
        const key = String(vehicle.deviceId);
        if (!map.has(key)) map.set(key, vehicle);
      }
      if (vehicle?.device) register(vehicle, vehicle.device);
      if (Array.isArray(vehicle?.devices)) {
        vehicle.devices.forEach((device) => register(vehicle, device));
      }
    });
    return map;
  }, [vehicles]);

  const resolveLinkedVehicle = useCallback(
    (device) => {
      if (!device) return null;
      const directId = device.vehicleId || device.vehicle?.id || device.vehicle_id || null;
      if (directId && vehicleById.has(String(directId))) {
        return vehicleById.get(String(directId));
      }
      const candidates = [
        device.id,
        device.deviceId,
        device.uniqueId,
        device.internalId,
      ]
        .filter(Boolean)
        .map((value) => String(value));
      for (const key of candidates) {
        const linked = vehicleByDeviceId.get(key);
        if (linked) return linked;
      }
      return device.vehicle || null;
    },
    [vehicleByDeviceId, vehicleById],
  );
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
  const editingPosition = useMemo(() => {
    if (!editingDevice) return null;
    return latestPositionByDevice.get(deviceKey(editingDevice)) || null;
  }, [editingDevice, latestPositionByDevice]);
  const portList = useMemo(
    () =>
      buildPortList({
        model: selectedModel,
        telemetry: editingPosition?.attributes || {},
        deviceLabels: deviceForm.portLabels || {},
      }),
    [deviceForm.portLabels, editingPosition?.attributes, selectedModel],
  );
  const deviceConditionHistory = useMemo(() => {
    const list = Array.isArray(editingDevice?.attributes?.conditions) ? editingDevice.attributes.conditions : [];
    return [...list].sort((left, right) => {
      const leftTime = Date.parse(left?.createdAt || left?.date || left?.at || 0) || 0;
      const rightTime = Date.parse(right?.createdAt || right?.date || right?.at || 0) || 0;
      return rightTime - leftTime;
    });
  }, [editingDevice?.attributes?.conditions]);

  const normalizedDeviceHistoryRows = useMemo(
    () =>
      (Array.isArray(deviceHistoryRows) ? deviceHistoryRows : []).map((entry, index) => {
        const movementMeta = resolveEquipmentMovementMeta(entry?.type);
        const fallbackTitle = movementMeta.known ? movementMeta.label : "Movimentação";
        const rawTitle = String(entry?.title || "").trim();
        const title = rawTitle && rawTitle.toLowerCase() !== String(entry?.type || "").toLowerCase() ? rawTitle : fallbackTitle;
        return {
          id: entry?.id || `history-${index}`,
          date: entry?.date || null,
          title,
          movementCode: movementMeta.code,
          movementKnown: movementMeta.known,
          movementLabel: movementMeta.label,
          responsible: sanitizeHistoryResponsible(entry?.responsible),
          origin: sanitizeHistoryDisplayValue(entry?.origin),
          destination: sanitizeHistoryDisplayValue(entry?.destination),
          reference: sanitizeHistoryDisplayValue(entry?.reference),
          status: sanitizeHistoryDisplayValue(entry?.status),
          vehicle: sanitizeHistoryDisplayValue(entry?.vehicle),
          notes: sanitizeHistoryDisplayValue(entry?.notes),
        };
      }),
    [deviceHistoryRows],
  );

  useEffect(() => {
    if (!isEditorRoute) {
      editorRouteInitRef.current = "";
      return;
    }
    const routeKey = isNewRoute ? "new" : `edit:${routeDeviceId || ""}`;
    if (editorRouteInitRef.current === routeKey) return;

    const queryTab = normalizeEditorTab(new URLSearchParams(location.search).get("tab"));

    if (isNewRoute) {
      resetDeviceForm();
      setDrawerTab(queryTab);
      setShowDeviceDrawer(false);
      editorRouteInitRef.current = routeKey;
      return;
    }

    if (loading) return;
    const match = devices.find((item) => String(item.id) === String(routeDeviceId || ""));
    if (!match) {
      showToast("Equipamento não encontrado.", "error");
      navigate(listPath, { replace: true });
      return;
    }
    fillDeviceForm(match);
    setDrawerTab(queryTab);
    setShowDeviceDrawer(false);
    editorRouteInitRef.current = routeKey;
  }, [devices, isEditorRoute, isNewRoute, listPath, loading, location.search, navigate, routeDeviceId]);

  const loadDeviceHistory = useCallback(async () => {
    if (!editingId) return;
    setDeviceHistoryLoading(true);
    setDeviceHistoryError("");
    try {
      const scopedClientId = resolveWriteClientId(editingClientId, editingDevice?.clientId, resolvedClientId) || undefined;
      const response = await CoreApi.getDeviceHistory(editingId, scopedClientId ? { clientId: scopedClientId } : undefined);
      setDeviceHistoryRows(Array.isArray(response?.items) ? response.items : []);
    } catch (historyError) {
      setDeviceHistoryRows([]);
      setDeviceHistoryError(historyError?.message || "Falha ao carregar histórico do equipamento.");
    } finally {
      setDeviceHistoryLoading(false);
    }
  }, [editingClientId, editingDevice?.clientId, editingId, resolveWriteClientId, resolvedClientId]);

  useEffect(() => {
    if (!editingId || drawerTab !== "historico") {
      setDeviceHistoryRows([]);
      setDeviceHistoryError("");
      setDeviceHistoryLoading(false);
      return;
    }
    void loadDeviceHistory();
  }, [drawerTab, editingId, loadDeviceHistory]);


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

  function resolveWarrantyEndDate(device) {
    const attrs = device?.attributes || {};
    let warrantyEnd = attrs.warrantyEndDate || attrs.warrantyUntil || attrs.warrantyDate || null;
    const origin = attrs.warrantyOrigin || "production";
    const start =
      origin === "installation"
        ? attrs.installationDate || attrs.warrantyStartDate || null
        : attrs.productionDate || attrs.warrantyStartDate || null;
    if (!warrantyEnd) {
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
    return warrantyEnd || null;
  }

  function normalizeWarrantyDateKey(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const directDateMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (directDateMatch) return directDateMatch[1];
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
  }

  function formatWarrantyDate(value) {
    const normalizedDate = normalizeWarrantyDateKey(value);
    if (!normalizedDate) return "—";
    const [year, month, day] = normalizedDate.split("-");
    return `${day}/${month}/${year}`;
  }

  function formatWarranty(device) {
    return formatWarrantyDate(resolveWarrantyEndDate(device));
  }

  function formatLastServiceDate(value) {
    if (!value) return "—";
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(parsed));
  }

  function formatOwnershipType(device) {
    const raw = String(device?.ownershipType || device?.attributes?.ownershipType || "COMODATO")
      .trim()
      .toUpperCase();
    return raw === "VENDA" ? "Venda" : "Comodato";
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
      const vehicle = resolveLinkedVehicle(device);
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

      const isLinked = Boolean(vehicle || device.vehicleId || device.vehicle);
      if (filters.link === "linked" && !isLinked) return false;
      if (filters.link === "unlinked" && isLinked) return false;

    if (filters.model && String(deviceModelId || "") !== String(filters.model)) return false;

      if (filters.status !== "all") {
        const meta = statusMeta(device);
        if (meta.code !== filters.status) return false;
      }

      return true;
    });
  }, [chipById, devices, filters.link, filters.model, filters.status, modeloById, query, resolveLinkedVehicle]);

  const sharedServiceStockWarrantyLabel = useMemo(() => {
    if (!isServiceStockGlobalProfile || !filteredDevices.length) return null;
    const grouped = new Map();
    filteredDevices.forEach((device) => {
      const dateKey = normalizeWarrantyDateKey(resolveWarrantyEndDate(device));
      if (!dateKey) return;
      grouped.set(dateKey, (grouped.get(dateKey) || 0) + 1);
    });
    if (!grouped.size) return null;
    const sorted = Array.from(grouped.entries()).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return Date.parse(b[0]) - Date.parse(a[0]);
    });
    return formatWarrantyDate(sorted[0][0]);
  }, [filteredDevices, isServiceStockGlobalProfile]);

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
    internalCodeTouchedRef.current = false;
    setInternalCodePreviewError(null);
    setInternalCodePreviewLoading(false);
    setInternalCodePreviewRetryKey(0);
    setDeviceForm({
      name: "",
      uniqueId: "",
      modelId: "",
      internalCode: "",
      gprsCommunication: true,
      ownershipType: "COMODATO",
      equipmentStatus: "ESTOQUE NOVO",
      chipId: "",
      vehicleId: "",
      portLabels: {},
      productionDate: "",
      installationDate: "",
      warrantyOrigin: "production",
      warrantyDays: "",
      warrantyEndDate: "",
    });
    setConditionDraft({
      condition: "Novo",
      date: toLocalInputDateTime(new Date()),
      note: "",
    });
    setEditingId(null);
    setEditingClientId("");
  }

  async function handleSaveDevice(event) {
    event?.preventDefault?.();
    if (!deviceForm.uniqueId.trim()) {
      showToast("Informe o IMEI / uniqueId", "error");
      return;
    }
    const hasManualWarrantyBase = Boolean(deviceForm.productionDate);
    const warrantyDaysValue = deviceForm.warrantyDays === "" ? null : Number(deviceForm.warrantyDays);
    const startDate = deviceForm.productionDate || deviceForm.installationDate;
    if (hasManualWarrantyBase && (!Number.isFinite(warrantyDaysValue) || warrantyDaysValue <= 0)) {
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
    if (deviceForm.warrantyEndDate && startDate) {
      const startMs = Date.parse(startDate);
      const endMs = Date.parse(deviceForm.warrantyEndDate);
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs < startMs) {
        showToast("Data fim da garantia deve ser igual ou posterior à data base.", "error");
        return;
      }
    }
    const currentDevice = editingId ? devices.find((item) => String(item.id) === String(editingId)) : null;
    const clientId = resolveWriteClientId(currentDevice?.clientId, resolvedClientId);
    if (!clientId) {
      showToast("Selecione um cliente para salvar o equipamento", "error");
      return;
    }
    setSavingDevice(true);
    try {
      let createdResponse = null;
      const warrantyPayload = {};
      if (deviceForm.productionDate) warrantyPayload.productionDate = deviceForm.productionDate;
      if (deviceForm.warrantyDays !== "") warrantyPayload.warrantyDays = Number(deviceForm.warrantyDays) || 0;
      if (deviceForm.warrantyEndDate) warrantyPayload.warrantyEndDate = deviceForm.warrantyEndDate;
      const resolvedInternalCode = String(deviceForm.internalCode || "").trim();
      if (editingId && resolvedInternalCode) warrantyPayload.internalCode = resolvedInternalCode;
      if (deviceForm.portLabels && Object.keys(deviceForm.portLabels).length) {
        warrantyPayload.portLabels = deviceForm.portLabels;
      }
      warrantyPayload.gprsCommunication = Boolean(deviceForm.gprsCommunication);
      const payload = {
        name: deviceForm.name?.trim() || undefined,
        uniqueId: deviceForm.uniqueId.trim(),
        modelId: deviceForm.modelId || undefined,
        chipId: deviceForm.chipId || undefined,
        vehicleId: deviceForm.vehicleId || undefined,
        ownershipType: normalizeOwnershipTypeValue(deviceForm.ownershipType),
        equipmentStatus: normalizeEquipmentStatusValue(deviceForm.equipmentStatus),
        gprsCommunication: deviceForm.gprsCommunication,
        internalCode: editingId ? resolvedInternalCode || undefined : undefined,
        clientId,
        attributes: Object.keys(warrantyPayload).length ? warrantyPayload : undefined,
      };
      if (editingId) {
        await CoreApi.updateDevice(editingId, payload);
        showToast("Equipamento atualizado com sucesso", "success");
      } else {
        createdResponse = await CoreApi.createDevice(payload);
        const upserted = createdResponse?.device && createdResponse?.upserted;
        if (upserted) {
          showToast("Equipamento já existia e foi sincronizado com sucesso.", "success");
        } else {
          showToast("Equipamento criado com sucesso", "success");
        }
      }
      await load();
      if (isEditorRoute) {
        if (!editingId) {
          const createdId = createdResponse?.device?.id || createdResponse?.id || null;
          if (createdId) {
            navigate(`${listPath}/${createdId}/edit`, { replace: true });
          } else {
            navigate(listPath, { replace: true });
          }
        }
      } else {
        resetDeviceForm();
        setShowDeviceDrawer(false);
        setDrawerTab("geral");
      }
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
        if (!isEditorRoute) {
          setShowDeviceDrawer(false);
        }
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

  async function handleSavePortLabels() {
    if (!editingId) return;
    const currentDevice = devices.find((item) => String(item.id) === String(editingId));
    const clientId = resolveWriteClientId(currentDevice?.clientId, resolvedClientId);
    if (!clientId) {
      showToast("Selecione um cliente para salvar as portas", "error");
      return;
    }
    setSavingPorts(true);
    try {
      await CoreApi.updateDevice(editingId, {
        clientId,
        attributes: { portLabels: deviceForm.portLabels || {} },
      });
      await load();
      showToast("Portas atualizadas com sucesso", "success");
    } catch (requestError) {
      showToast("Falha ao salvar portas", "error");
    } finally {
      setSavingPorts(false);
    }
  }

  async function handleAddDeviceCondition() {
    if (!editingId) return;
    const currentDevice = devices.find((item) => String(item.id) === String(editingId));
    const clientId = resolveWriteClientId(currentDevice?.clientId, resolvedClientId);
    if (!clientId) {
      showToast("Selecione um cliente para salvar a condição", "error");
      return;
    }
    const conditionValue = String(conditionDraft.condition || "").trim();
    if (!conditionValue) {
      showToast("Selecione uma condição válida", "error");
      return;
    }
    const createdAt = conditionDraft.date ? new Date(conditionDraft.date).toISOString() : new Date().toISOString();
    const nextEntry = {
      id: crypto.randomUUID(),
      condition: conditionValue,
      note: String(conditionDraft.note || "").trim(),
      createdAt,
      source: "manual",
    };
    const existing = Array.isArray(currentDevice?.attributes?.conditions) ? currentDevice.attributes.conditions : [];
    const nextConditions = [nextEntry, ...existing];

    setSavingDevice(true);
    try {
      await CoreApi.updateDevice(editingId, {
        clientId,
        attributes: { conditions: nextConditions },
      });
      await load();
      setConditionDraft({
        condition: conditionValue,
        date: toLocalInputDateTime(new Date()),
        note: "",
      });
      showToast("Condição registrada com sucesso", "success");
    } catch (requestError) {
      showToast(requestError?.message || "Falha ao registrar condição", "error");
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
    const clientId = resolveWriteClientId(resolvedClientId);
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
    if (!isAdminGeneral) return;
    const clientId = resolveWriteClientId(resolvedClientId);
    if (!clientId) {
      showToast("Selecione um cliente para remover o equipamento", "error");
      return;
    }
    await confirmDelete({
      title: "Excluir equipamento",
      message: `Tem certeza que deseja excluir o equipamento ${id}? Essa ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      onConfirm: async () => {
        try {
          await CoreApi.deleteDevice(id, { clientId });
          await load();
          showToast("Excluído com sucesso.");
        } catch (requestError) {
          showToast("Falha ao excluir.", "error");
          throw requestError;
        }
      },
    });
  }

  async function handleDeleteConflictDevice() {
    if (!conflictDevice?.deviceId) return;
    if (!isAdminGeneral) return;
    const clientId = resolveWriteClientId(resolvedClientId);
    if (!clientId) {
      showToast("Selecione um cliente para remover o equipamento", "error");
      return;
    }
    await confirmDelete({
      title: "Excluir equipamento",
      message: `Tem certeza que deseja excluir o equipamento ${conflictDevice.deviceId}? Essa ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      onConfirm: async () => {
        try {
          await CoreApi.deleteDevice(conflictDevice.deviceId, { clientId });
          await load();
          resetDeviceForm();
          setConflictDevice(null);
          showToast("Excluído com sucesso.");
        } catch (requestError) {
          showToast("Falha ao excluir.", "error");
          throw requestError;
        }
      },
    });
  }

  function fillDeviceForm(device) {
    const installationDate = device.attributes?.installationDate || device.attributes?.warrantyStartDate || "";
    const warrantyOrigin = device.attributes?.warrantyOrigin || "production";
    const history = Array.isArray(device?.attributes?.conditions) ? device.attributes.conditions : [];
    const latestCondition = [...history].sort((left, right) => {
      const leftTime = Date.parse(left?.createdAt || left?.date || left?.at || 0) || 0;
      const rightTime = Date.parse(right?.createdAt || right?.date || right?.at || 0) || 0;
      return rightTime - leftTime;
    })[0];
    setEditingId(device.id);
    setEditingClientId(String(device.clientId || ""));
    setDeviceForm({
      name: device.name || "",
      uniqueId: device.uniqueId || "",
      modelId: device.modelId || device.attributes?.modelId ? String(device.modelId || device.attributes?.modelId) : "",
      internalCode: device.attributes?.internalCode || "",
      gprsCommunication: device.attributes?.gprsCommunication !== false,
      ownershipType: normalizeOwnershipTypeValue(device.ownershipType || device.attributes?.ownershipType),
      equipmentStatus: normalizeEquipmentStatusValue(
        device.equipmentStatus || device.status || device.attributes?.equipmentStatus,
      ),
      chipId: device.chipId || "",
      vehicleId: device.vehicleId || "",
      portLabels: device.attributes?.portLabels || {},
      productionDate: device.attributes?.productionDate || "",
      installationDate,
      warrantyOrigin,
      warrantyDays: device.attributes?.warrantyDays ?? "",
      warrantyEndDate: device.attributes?.warrantyEndDate || "",
    });
    setConditionDraft({
      condition: latestCondition?.condition || device.attributes?.condition || "Novo",
      date: toLocalInputDateTime(new Date()),
      note: "",
    });
    setDrawerTab("geral");
    setInternalCodePreviewError(null);
    setInternalCodePreviewLoading(false);
    setInternalCodePreviewRetryKey(0);
    internalCodeTouchedRef.current = false;
  }

  function openEditDevice(device) {
    if (!device?.id) return;
    navigate(`${listPath}/${device.id}/edit`);
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
      navigate(`${listPath}/${match.id}/edit`);
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
      const alreadyLinked = resolveLinkedVehicle(targetDevice);
      if (alreadyLinked && String(alreadyLinked.id) === String(linkVehicleId)) {
        showToast("Equipamento já está vinculado a este veículo.", "info");
        return;
      }
      const targetClientId = resolveWriteClientId(vehicle?.clientId, targetDevice?.clientId, resolvedClientId);
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
      setDevices((current) =>
        current.map((item) =>
          String(item.id) === String(targetDevice.id)
            ? { ...item, vehicleId: linkVehicleId, vehicle }
            : item,
        ),
      );
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
      const clientId = resolveWriteClientId(resolvedClientId, linkTarget?.clientId);
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

  async function handleUnlinkFromVehicle(device, linkedVehicle = null) {
    const resolvedVehicleId = device?.vehicleId || linkedVehicle?.id || device?.vehicle?.id || null;
    if (!resolvedVehicleId) return;
    try {
      const vehicle =
        linkedVehicle ||
        vehicles.find((item) => String(item.id) === String(resolvedVehicleId)) ||
        device.vehicle;
      const targetClientId = resolveWriteClientId(vehicle?.clientId, device?.clientId, resolvedClientId);
      if (!targetClientId) {
        showToast("Selecione um cliente antes de desvincular", "error");
        return;
      }
      await CoreApi.unlinkDeviceFromVehicle(resolvedVehicleId, device.id, { clientId: targetClientId });
      setDevices((current) =>
        current.map((item) =>
          String(item.id) === String(device.id)
            ? { ...item, vehicleId: null, vehicle: null }
            : item,
        ),
      );
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
        const clientId = resolveWriteClientId(device?.clientId, resolvedClientId);
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

  async function handleRefreshDevices() {
    setSyncing(true);
    try {
      await load();
      showToast("Lista atualizada com sucesso", "success");
    } catch (requestError) {
      showToast(requestError?.message || "Falha ao atualizar lista", "error");
    } finally {
      setSyncing(false);
    }
  }

  function handleExportCsv() {
    if (!filteredDevices.length) return;
    const headers = [
      "Nome",
      "IMEI",
      "Código interno",
      "Cliente",
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
      const vehicle = vehicleById.get(String(device.vehicleId)) || device.vehicle;
      const clientLabel =
        device?.clientName ||
        device?.client?.name ||
        vehicle?.clientName ||
        vehicle?.client?.name ||
        "";
      const deviceModelId = device.modelId || device.attributes?.modelId;
      const model = deviceModelId ? modeloById.get(String(deviceModelId)) || {} : {};
      return [
        device.name || "",
        device.uniqueId || "",
        device.attributes?.internalCode || device.internalCode || "",
        clientLabel,
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

  const closeDeviceEditor = useCallback(() => {
    if (isEditorRoute) {
      navigate(listPath);
      return;
    }
    setShowDeviceDrawer(false);
  }, [isEditorRoute, listPath, navigate]);

  const openNewDeviceEditor = useCallback(() => {
    resetDeviceForm();
    setDrawerTab("geral");
    navigate(`${listPath}/new`);
  }, [listPath, navigate]);

  const visibleColumns = useMemo(
    () => DEVICE_TABLE_COLUMNS.filter((column) => columnVisibility[column.key]),
    [columnVisibility],
  );
  const tableColCount = Math.max(1, visibleColumns.length);

  const toggleColumnVisibilityDraft = useCallback((columnKey) => {
    if (NON_TOGGLABLE_DEVICE_COLUMNS.has(columnKey)) return;
    setColumnVisibilityDraft((current) => {
      const enabledCount = DEVICE_TABLE_COLUMNS.reduce((count, column) => count + (current[column.key] ? 1 : 0), 0);
      if (current[columnKey] && enabledCount <= 1) return current;
      return normalizeDeviceColumnVisibility({ ...current, [columnKey]: !current[columnKey] });
    });
  }, []);

  const restoreDefaultColumns = useCallback(() => {
    const defaults = normalizeDeviceColumnVisibility(DEFAULT_DEVICE_COLUMN_VISIBILITY);
    setColumnVisibilityDraft(defaults);
  }, []);

  const applyColumnVisibility = useCallback(() => {
    setColumnVisibility(normalizeDeviceColumnVisibility(columnVisibilityDraft));
    setShowColumnsMenu(false);
  }, [columnVisibilityDraft]);

  const toastClassName =
    "fixed right-4 top-20 z-[12000] rounded-lg border px-4 py-3 text-sm shadow-lg " +
    (toast?.type === "error"
      ? "border-red-500/40 bg-red-500/20 text-red-50"
      : toast?.type === "warning"
      ? "border-amber-500/40 bg-amber-500/20 text-amber-50"
      : "border-emerald-500/40 bg-emerald-500/20 text-emerald-50");

  if ((forbidden || (!devicesPermission.loading && !devicesPermission.hasAccess)) && !devicesPermission.loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <DataState state="info" tone="muted" title="Sem permissão para acessar equipamentos" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-6">
      {toast && <div className={toastClassName}>{toast.message}</div>}

      <PageHeader
        actions={
          isEditorRoute ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={closeDeviceEditor}
                className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
              >
                {isNewRoute ? "Cancelar" : "Voltar"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSaveDevice();
                }}
                disabled={savingDevice || drawerTab === "massa" || drawerTab === "acoes" || drawerTab === "historico"}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-60"
              >
                {savingDevice ? "Salvando..." : editingId ? "Atualizar" : "Salvar"}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRefreshDevices}
                disabled={syncing}
                className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15 disabled:opacity-60"
              >
                <span className="inline-flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  {syncing ? "Atualizando…" : "Atualizar"}
                </span>
              </button>
              {!isTechnician ? (
                <>
                  {!isServiceStockGlobalProfile ? (
                    <div ref={columnMenuRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setShowColumnsMenu((current) => !current)}
                        className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/15"
                      >
                        <span className="inline-flex items-center gap-2">
                          <SlidersHorizontal className="h-4 w-4" />
                          Colunas
                        </span>
                      </button>
                      {showColumnsMenu && (
                        <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-none border border-white/10 bg-[#121926] p-3 shadow-2xl">
                          <div className="mb-2 text-xs uppercase tracking-[0.1em] text-white/60">Mostrar/Ocultar</div>
                          <div className="space-y-2">
                            {DEVICE_TABLE_COLUMNS.map((column) => {
                              const checked = Boolean(columnVisibilityDraft[column.key]);
                              const enabledCount = DEVICE_TABLE_COLUMNS.reduce((count, item) => {
                                return count + (columnVisibilityDraft[item.key] ? 1 : 0);
                              }, 0);
                              const locked = NON_TOGGLABLE_DEVICE_COLUMNS.has(column.key);
                              return (
                                <label key={column.key} className="flex cursor-pointer items-center gap-2 text-sm text-white/80">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={locked || (checked && enabledCount <= 1)}
                                    onChange={() => toggleColumnVisibilityDraft(column.key)}
                                    className="h-4 w-4 rounded border-white/30 bg-transparent"
                                  />
                                  <span>
                                    {column.label}
                                    {locked ? " (fixa)" : ""}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                          <div className="mt-3 flex items-center justify-end gap-2 border-t border-white/10 pt-3">
                            <button
                              type="button"
                              onClick={restoreDefaultColumns}
                              className="rounded-none border border-white/20 px-3 py-1.5 text-xs text-white/80 transition hover:border-white/40 hover:text-white"
                            >
                              Restaurar padrão
                            </button>
                            <button
                              type="button"
                              onClick={applyColumnVisibility}
                              className="rounded-none border border-sky-400/50 bg-sky-400/15 px-3 py-1.5 text-xs font-semibold text-sky-100 transition hover:bg-sky-400/25"
                            >
                              Aplicar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                  {canCreateDevice ? (
                    <button
                      type="button"
                      onClick={openNewDeviceEditor}
                      className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Plus className="h-4 w-4" />
                        Novo equipamento
                      </span>
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          )
        }
      />

      {isEditorRoute && error && (
        <div className="rounded-none border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error.message}
        </div>
      )}

      {!isEditorRoute && (
        <>
          <FilterBar
            left={
              <div className="flex flex-1 flex-wrap items-center gap-3 md:flex-nowrap">
                <div className="relative min-w-0 flex-1 sm:min-w-[240px]">
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
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none sm:min-w-[200px]"
                >
                  <option value="all">Vínculo: Todos</option>
                  <option value="linked">Vínculo: Vinculado</option>
                  <option value="unlinked">Vínculo: Sem vínculo</option>
                </select>
                {!isTechnician ? (
                  <select
                    value={filters.status}
                    onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none sm:min-w-[200px]"
                  >
                    <option value="all">Status: Todos</option>
                    <option value="online">Online</option>
                    <option value="offline">Offline</option>
                    <option value="1-6h">Sem transmissão 1–6h</option>
                    <option value="6-24h">Sem transmissão 6–24h</option>
                    <option value=">24h">&gt;24h</option>
                  </select>
                ) : null}
                <div className="min-w-0 flex-1 sm:min-w-[240px]">
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
              <div className="relative flex w-full flex-wrap items-center justify-between gap-3 md:w-auto md:justify-end">
                <span className="text-xs text-white/60">
                  {filteredDevices.length} de {devices.length} equipamentos
                </span>
                {!isTechnician ? (
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
                ) : null}
              </div>
            }
          />

          {error && (
            <div className="rounded-none border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error.message}
            </div>
          )}

          <div className="pb-4">
            <div className="rounded-none border border-white/10">
              <DataTable horizontalScroll className="overflow-x-auto overflow-y-visible" tableClassName="min-w-max w-full table-auto text-white/80">
                <thead className="sticky top-0 bg-white/5 text-xs uppercase tracking-wide text-white/60 backdrop-blur">
                  {isTechnician ? (
                    <tr>
                      <th className="px-3 py-3 text-left">Cliente</th>
                      <th className="e-hide-mobile px-3 py-3 text-left sm:table-cell">Modelo</th>
                      <th className="px-3 py-3 text-left">ID do Equipamento</th>
                      <th className="px-3 py-3 text-left">Data transferido</th>
                    </tr>
                  ) : isServiceStockGlobalProfile ? (
                    <tr>
                      <th className="px-3 py-3 text-left">ID / IMEI</th>
                      <th className="px-3 py-3 text-left">Modelo</th>
                      <th className="px-3 py-3 text-left">Localização</th>
                      <th className="e-hide-mobile px-3 py-3 text-left md:table-cell">Técnico</th>
                      <th className="e-hide-mobile px-3 py-3 text-left md:table-cell">Garantia</th>
                      <th className="e-hide-mobile px-3 py-3 text-left md:table-cell">Data do Último Serviço</th>
                      <th className="px-3 py-3 text-left">Propriedade</th>
                    </tr>
                  ) : (
                    <tr>
                      {columnVisibility.id && <th className="w-[220px] min-w-[220px] px-3 py-3 text-left">ID / IMEI</th>}
                      {columnVisibility.model && (
                        <th className="e-hide-mobile w-[240px] min-w-[220px] px-3 py-3 text-left sm:table-cell">Modelo</th>
                      )}
                      {columnVisibility.status && <th className="w-[180px] min-w-[170px] px-3 py-3 text-left">Status</th>}
                      {columnVisibility.lastCommunication && (
                        <th className="w-[190px] min-w-[180px] px-3 py-3 text-left">Última comunicação</th>
                      )}
                      {columnVisibility.lastPosition && (
                        <th className="e-hide-mobile w-[340px] min-w-[280px] px-3 py-3 text-left md:table-cell">Última posição</th>
                      )}
                      {columnVisibility.link && <th className="w-[280px] min-w-[240px] px-3 py-3 text-left">Vínculo</th>}
                      {columnVisibility.client && (
                        <th className="e-hide-mobile w-[220px] min-w-[180px] px-3 py-3 text-left md:table-cell">Cliente</th>
                      )}
                      {columnVisibility.warranty && (
                        <th className="e-hide-mobile w-[250px] min-w-[220px] px-3 py-3 text-left md:table-cell">Garantia</th>
                      )}
                      {columnVisibility.actions && (
                        <th className="w-[170px] min-w-[170px] bg-[#151d2b] px-3 py-3 text-right md:sticky md:right-0 md:z-20">
                          Ações
                        </th>
                      )}
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-white/10">
                  {(loading || traccarLoading) && (
                    <tr>
                      <td
                        colSpan={isTechnician ? 4 : isServiceStockGlobalProfile ? serviceStockColumnsCount : tableColCount}
                        className="px-4 py-6"
                      >
                        <SkeletonTable
                          rows={6}
                          columns={
                            isTechnician
                              ? 4
                              : isServiceStockGlobalProfile
                                ? serviceStockColumnsCount
                                : Math.max(visibleColumns.length, 1)
                          }
                        />
                      </td>
                    </tr>
                  )}
                  {!loading && !traccarLoading && filteredDevices.length === 0 && (
                    <tr>
                      <td
                        colSpan={isTechnician ? 4 : isServiceStockGlobalProfile ? serviceStockColumnsCount : tableColCount}
                        className="px-4 py-8"
                      >
                        <EmptyState
                          title="Nenhum equipamento encontrado com os filtros atuais."
                          subtitle={isTechnician ? "Não há equipamentos vinculados ao técnico." : "Ajuste os filtros para buscar equipamentos."}
                          action={
                            isTechnician ? null : (
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
                                {canCreateDevice ? (
                                  <button
                                    type="button"
                                    onClick={openNewDeviceEditor}
                                    className="rounded-xl bg-sky-500 px-3 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
                                  >
                                    <span className="inline-flex items-center gap-2">
                                      <Plus className="h-4 w-4" />
                                      Cadastrar equipamento
                                    </span>
                                  </button>
                                ) : null}
                              </div>
                            )
                          }
                        />
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    !traccarLoading &&
                    paginatedDevices.map((device) => {
                      if (isTechnician) {
                        const deviceModelId = device.modelId || device.attributes?.modelId || null;
                        const model = deviceModelId ? modeloById.get(String(deviceModelId)) || null : null;
                        const transferDate =
                          device.technicianMovementAt ||
                          device.attributes?.technicianMovementAt ||
                          device.attributes?.lastTransferAt ||
                          device.updatedAt ||
                          null;
                        return (
                          <tr key={device.internalId || device.id || device.uniqueId} className="hover:bg-white/5">
                            <td className="px-3 py-3 text-white/70">
                              {device.clientName || device.vehicle?.clientName || "—"}
                            </td>
                            <td className="e-hide-mobile px-3 py-3 text-white/70 sm:table-cell">{model?.name || device.modelName || "—"}</td>
                            <td className="px-3 py-3 text-white">{device.uniqueId || device.id || "—"}</td>
                            <td className="px-3 py-3 text-white/70">{formatTransferDate(transferDate)}</td>
                          </tr>
                        );
                      }
                      if (isServiceStockGlobalProfile) {
                        const deviceModelId = device.modelId || device.attributes?.modelId || null;
                        const model = deviceModelId ? modeloById.get(String(deviceModelId)) || null : null;
                        const warrantyLabel = sharedServiceStockWarrantyLabel || formatWarranty(device);
                        const propertyLabel = formatOwnershipType(device);
                        const locationLabel = device.locationLabel || (device.vehicleId ? "No veículo" : "Base");
                        const isLinkedToVehicle = Boolean(device.vehicleId || device.vehicle?.id);
                        const technicianLabel = isLinkedToVehicle ? "—" : device.technicianName || "—";
                        return (
                          <tr key={device.internalId || device.id || device.uniqueId} className="hover:bg-white/5">
                            <td className="px-3 py-3 text-white">{device.uniqueId || device.id || "—"}</td>
                            <td className="px-3 py-3 text-white/80">{model?.name || device.modelName || "—"}</td>
                            <td className="px-3 py-3 text-white/70">{locationLabel}</td>
                            <td className="e-hide-mobile px-3 py-3 text-white/70 md:table-cell">{technicianLabel}</td>
                            <td className="e-hide-mobile px-3 py-3 text-white/70 md:table-cell">{warrantyLabel}</td>
                            <td className="e-hide-mobile px-3 py-3 text-white/70 md:table-cell">{formatLastServiceDate(device.lastServiceAt)}</td>
                            <td className="px-3 py-3 text-white/70">{propertyLabel}</td>
                          </tr>
                        );
                      }
                      const deviceModelId = device.modelId || device.attributes?.modelId || null;
                      const modelo = deviceModelId ? modeloById.get(String(deviceModelId)) || null : null;
                      const vehicle = resolveLinkedVehicle(device);
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
                            setLinkVehicleId(device.vehicleId || vehicle?.id || "");
                          }}
                          onUnlink={() => handleUnlinkFromVehicle(device, vehicle)}
                          onNavigateToMonitoring={() => handleNavigateToMonitoring(device)}
                          onEdit={() => openEditDevice(device)}
                          onDelete={() => handleDeleteDevice(device.id)}
                          canDelete={isAdminGeneral}
                          positionLabel={formatPositionSummary(position)}
                          lastCommunication={formatLastCommunication(device)}
                          visibleColumns={columnVisibility}
                        />
                      );
                    })}
                </tbody>
              </DataTable>
            </div>
            <DataTablePagination
              className="mt-4"
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
        </>
      )}

      <DeviceEditorContainer
        isEditorRoute={isEditorRoute}
        open={isEditorRoute || showDeviceDrawer}
        onClose={closeDeviceEditor}
        title={isEditorRoute ? null : editingId ? "Editar equipamento" : "Novo equipamento"}
        description={null}
      >
        <div className="flex flex-wrap gap-2 pb-2 text-[11px] uppercase tracking-[0.1em] text-white/60">
          {DEVICE_EDITOR_TABS.map((key) => (
            <button
              key={key}
              onClick={() => setDrawerTab(key)}
              className={`whitespace-nowrap rounded-md px-3 py-2 transition ${drawerTab === key ? "bg-primary/20 text-white border border-primary/40" : "border border-transparent hover:border-white/20"}`}
            >
              {getDeviceTabLabel(key)}
            </button>
          ))}
        </div>

        {drawerTab === "geral" && (
          <form onSubmit={handleSaveDevice} className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2 text-xs uppercase tracking-[0.12em] text-white/50">
              Informações do equipamento
            </div>
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
              value={editingId ? deviceForm.internalCode || "" : ""}
              placeholder={internalCodePreviewLoading ? "Carregando..." : "Gerado automaticamente ao salvar"}
              disabled
            />
            {internalCodePreviewLoading && !deviceForm.internalCode && (
              <div className="-mt-2 text-xs text-white/50">Carregando código interno...</div>
            )}
            {internalCodePreviewError && !deviceForm.internalCode && (
              <div className="-mt-2 flex items-center gap-2 text-xs text-amber-300">
                <span>{internalCodePreviewError}</span>
                <button
                  type="button"
                  className="rounded border border-amber-300/30 px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-amber-100 hover:bg-amber-300/10"
                  onClick={() => setInternalCodePreviewRetryKey((current) => current + 1)}
                >
                  Tentar novamente
                </button>
              </div>
            )}
            <div className="md:col-span-2 text-xs uppercase tracking-[0.12em] text-white/50">
              Modelo e comunicação
            </div>
            <div className="md:col-span-2">
              <label className="text-xs uppercase tracking-[0.1em] text-white/60">Modelo</label>
              <AutocompleteSelect
                value={deviceForm.modelId}
                onChange={(nextValue, option) => {
                  const nextId = String(nextValue || "");
                  const modelData = option?.data;
                  if (modelData && !modeloById.has(String(modelData.id))) {
                    setModels((current) => [...current, modelData]);
                  }
                  setDeviceForm((current) => ({ ...current, modelId: nextId }));
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
                    <div className="text-[11px] uppercase tracking-[0.1em] text-white/50">Interfaces</div>
                    <div className="text-white">{portSummary}</div>
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
            <div className="md:col-span-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeDeviceEditor}>
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
                    Tipo do veículo: {vehicleById.get(String(linkVehicleId))?.type || "—"}
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
                <Button type="button" variant="ghost" onClick={closeDeviceEditor}>
                  Fechar
                </Button>
                <Button type="submit" disabled={!linkVehicleId}>
                  Vincular
                </Button>
              </div>
            </div>
          </form>
        )}

        {drawerTab === "status" && (
          <form onSubmit={handleSaveDevice} className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.12em] text-white/50">Status do equipamento</div>
              <p className="mt-1 text-xs text-white/60">
                Este status é sincronizado com Veículo &gt; Equipamentos. Ao vincular, o status muda automaticamente para HABILITADO.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Select
                  label="Status atual"
                  value={normalizeEquipmentStatusValue(deviceForm.equipmentStatus)}
                  onChange={(event) =>
                    setDeviceForm((current) => ({
                      ...current,
                      equipmentStatus: normalizeEquipmentStatusValue(event.target.value),
                    }))
                  }
                >
                  {EQUIPMENT_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeDeviceEditor}>
                Cancelar
              </Button>
              <Button type="submit" disabled={savingDevice}>
                {savingDevice ? "Salvando..." : "Salvar status"}
              </Button>
            </div>
          </form>
        )}

        {drawerTab === "propriedade" && (
          <form onSubmit={handleSaveDevice} className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.12em] text-white/50">Propriedade do equipamento</div>
              <p className="mt-1 text-xs text-white/60">
                Define se o equipamento está em regime de comodato ou venda.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Select
                  label="Tipo de propriedade"
                  value={normalizeOwnershipTypeValue(deviceForm.ownershipType)}
                  onChange={(event) =>
                    setDeviceForm((current) => ({
                      ...current,
                      ownershipType: normalizeOwnershipTypeValue(event.target.value),
                    }))
                  }
                >
                  <option value="COMODATO">Comodato</option>
                  <option value="VENDA">Venda</option>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeDeviceEditor}>
                Cancelar
              </Button>
              <Button type="submit" disabled={savingDevice}>
                {savingDevice ? "Salvando..." : "Salvar propriedade"}
              </Button>
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

        {drawerTab === "portas" && (
          <div className="space-y-4">
            {!editingId && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                Salve o equipamento para configurar as portas.
              </div>
            )}
            {editingId && portList.length === 0 && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                Nenhuma porta configurada para este modelo.
              </div>
            )}
            {editingId && portList.length > 0 && (
              <div className="grid gap-3">
                {portList.map((port) => (
                  <div key={port.key} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs uppercase tracking-[0.12em] text-white/50">{port.key}</div>
                      {port.stateLabel ? (
                        <span className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-white/70">
                          {port.stateLabel}
                        </span>
                      ) : null}
                    </div>
                    <Input
                      value={deviceForm.portLabels?.[port.key] ?? port.label}
                      onChange={(event) => {
                        const value = event.target.value;
                        setDeviceForm((current) => {
                          const currentLabels = { ...(current.portLabels || {}) };
                          if (value.trim()) {
                            currentLabels[port.key] = value;
                          } else {
                            delete currentLabels[port.key];
                          }
                          return { ...current, portLabels: currentLabels };
                        });
                      }}
                      placeholder={port.defaultLabel}
                    />
                    <div className="text-xs text-white/40">Nome padrão: {port.defaultLabel}</div>
                  </div>
                ))}
              </div>
            )}
            {editingId && (
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={closeDeviceEditor}>
                  Cancelar
                </Button>
                <Button type="button" onClick={handleSavePortLabels} disabled={savingPorts}>
                  {savingPorts ? "Salvando…" : "Salvar portas"}
                </Button>
              </div>
            )}
          </div>
        )}

        {drawerTab === "garantia" && (
          <form onSubmit={handleSaveDevice} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-xs uppercase tracking-[0.1em] text-white/60">
                Data de produção
                <Input
                  type="date"
                  value={deviceForm.productionDate}
                  onChange={(event) => setDeviceForm((current) => ({ ...current, productionDate: event.target.value }))}
                  className="mt-2"
                />
              </label>
              <label className="text-xs uppercase tracking-[0.1em] text-white/60">
                Início da garantia (OS)
                <Input
                  type="date"
                  value={deviceForm.installationDate}
                  className="mt-2"
                  disabled
                  readOnly
                />
                <span className="mt-1 block text-[11px] normal-case tracking-normal text-white/45">
                  Preenchido automaticamente pela data da OS quando o equipamento é associado.
                </span>
              </label>
              <label className="text-xs uppercase tracking-[0.1em] text-white/60">
                Dias de garantia
                <Input
                  type="number"
                  min="0"
                  value={deviceForm.warrantyDays}
                  onChange={(event) => setDeviceForm((current) => ({ ...current, warrantyDays: event.target.value }))}
                  className="mt-2"
                />
              </label>
              <label className="text-xs uppercase tracking-[0.1em] text-white/60">
                Fim da garantia
                <Input
                  type="date"
                  value={deviceForm.warrantyEndDate}
                  onChange={(event) => setDeviceForm((current) => ({ ...current, warrantyEndDate: event.target.value }))}
                  className="mt-2"
                  disabled
                />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeDeviceEditor}>
                Cancelar
              </Button>
              <Button type="submit" disabled={savingDevice}>
                {savingDevice ? "Salvando…" : "Salvar garantia"}
              </Button>
            </div>
          </form>
        )}

        {drawerTab === "condicoes" && (
          <div className="space-y-4">
            {!editingId && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                Salve o equipamento para registrar as condições.
              </div>
            )}
            {editingId && (
              <>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.12em] text-white/50">Nova condição</div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <Select
                      label="Condição"
                      value={conditionDraft.condition}
                      onChange={(event) => setConditionDraft((current) => ({ ...current, condition: event.target.value }))}
                    >
                      {EQUIPMENT_CONDITION_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                    <Input
                      type="datetime-local"
                      label="Data e hora"
                      value={conditionDraft.date}
                      onChange={(event) => setConditionDraft((current) => ({ ...current, date: event.target.value }))}
                    />
                    <Input
                      label="Observação"
                      placeholder="Observação"
                      value={conditionDraft.note}
                      onChange={(event) => setConditionDraft((current) => ({ ...current, note: event.target.value }))}
                    />
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button type="button" onClick={handleAddDeviceCondition} disabled={savingDevice}>
                      {savingDevice ? "Salvando..." : "Registrar condição"}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.12em] text-white/50">Histórico</div>
                  {deviceConditionHistory.length === 0 && (
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                      Nenhuma condição registrada ainda.
                    </div>
                  )}
                  {deviceConditionHistory.length > 0 && (
                    <div className="space-y-2">
                      {deviceConditionHistory.map((entry) => (
                        <div key={entry.id || entry.createdAt} className="rounded-xl border border-white/10 bg-white/5 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-white">{entry.condition || "—"}</div>
                            <div className="text-xs text-white/60">
                              {entry.createdAt || entry.date || entry.at
                                ? new Date(entry.createdAt || entry.date || entry.at).toLocaleString()
                                : "—"}
                            </div>
                          </div>
                          {entry.note ? (
                            <div className="mt-2 text-xs text-white/70">{entry.note}</div>
                          ) : (
                            <div className="mt-2 text-xs text-white/40">Sem observação</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {drawerTab === "historico" && (
          <div className="space-y-4">
            {!editingId && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                Salve o equipamento para visualizar o histórico completo.
              </div>
            )}
            {editingId && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-white/50">Histórico</div>
                    <div className="text-sm text-white/80">Ciclo completo do equipamento</div>
                  </div>
                  <Button type="button" variant="ghost" onClick={loadDeviceHistory} disabled={deviceHistoryLoading}>
                    {deviceHistoryLoading ? "Atualizando..." : "Atualizar"}
                  </Button>
                </div>

                {deviceHistoryError ? (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
                    {deviceHistoryError}
                  </div>
                ) : null}

                {!deviceHistoryLoading && normalizedDeviceHistoryRows.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                    Nenhum evento de histórico disponível para este equipamento.
                  </div>
                ) : null}

                {deviceHistoryLoading ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <SkeletonTable rows={5} columns={1} />
                  </div>
                ) : null}

                {!deviceHistoryLoading && normalizedDeviceHistoryRows.length > 0 ? (
                  <div className="space-y-3">
                    {normalizedDeviceHistoryRows.map((entry) => (
                      <div key={entry.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-white">{entry.title}</div>
                          <div className="text-xs text-white/60">{formatTransferDate(entry.date)}</div>
                        </div>
                        <div className="mt-3 grid gap-3 text-xs text-white/70 md:grid-cols-3">
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-white/50">Responsável</div>
                            <div className="text-sm text-white">{entry.responsible || "—"}</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-white/50">Origem / Destino</div>
                            <div className="text-sm text-white">
                              {[entry.origin, entry.destination].filter(Boolean).join(" → ") || "—"}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-white/50">Referência</div>
                            <div className="text-sm text-white">{entry.reference || "—"}</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-white/50">Veículo</div>
                            <div className="text-sm text-white">{entry.vehicle || "—"}</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-white/50">Status</div>
                            <div className="text-sm text-white">{entry.status || "—"}</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-white/50">Tipo técnico</div>
                            <div
                              className="text-sm text-white"
                              title={!entry.movementKnown && entry.movementCode ? entry.movementCode : undefined}
                            >
                              {entry.movementKnown ? entry.movementLabel : "Movimentação"}
                            </div>
                          </div>
                        </div>
                        {entry.notes ? (
                          <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/70">
                            {entry.notes}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
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
                if (device) handleUnlinkFromVehicle(device, resolveLinkedVehicle(device));
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
            {isAdminGeneral && (
              <Button
                variant="ghost"
                className="inline-flex items-center gap-2 text-red-200 hover:text-white"
                onClick={() => handleDeleteDevice(editingId)}
                disabled={!editingId}
              >
                <Trash2 className="h-4 w-4" />
                Remover equipamento
              </Button>
            )}
          </div>
        )}
      </DeviceEditorContainer>

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
                Tipo do veículo: {vehicleById.get(String(linkVehicleId))?.type || "—"}
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
            {conflictDevice?.deviceId && isAdminGeneral && (
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
        zIndex="z-[13000]"
        containerClassName="items-center"
        topOffsetClassName="py-6"
        panelClassName="p-0"
        headerClassName="px-6 pt-5 pb-4"
        bodyClassName="pt-0"
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
              <TileLayer url={tileUrl} attribution={tileAttribution} subdomains={tileSubdomains} maxZoom={tileMaxZoom} />
              <Marker
                position={[
                  Number(mapTarget.position.latitude ?? mapTarget.position.lat ?? 0),
                  Number(mapTarget.position.longitude ?? mapTarget.position.lon ?? mapTarget.position.lng ?? 0),
                ]}
                icon={mapMarkerIcon}
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
