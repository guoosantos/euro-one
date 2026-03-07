import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Globe } from "lucide-react";
import { useTranslation } from "../lib/i18n.js";

import MonitoringMap from "../components/map/MonitoringMap.jsx";
import MonitoringTable from "../components/monitoring/MonitoringTable.jsx";
import MonitoringToolbar from "../components/monitoring/MonitoringToolbar.jsx";
import MonitoringSearchBox from "../components/monitoring/MonitoringSearchBox.jsx";
import MonitoringColumnSelector from "../components/monitoring/MonitoringColumnSelector.jsx";
import MonitoringLayoutSelector from "../components/monitoring/MonitoringLayoutSelector.jsx";
import MapTableSplitter from "../components/monitoring/MapTableSplitter.jsx";
import VehicleDetailsDrawer from "../components/monitoring/VehicleDetailsDrawer.jsx";
import AddressAutocomplete from "../components/AddressAutocomplete.jsx";
import DataState from "../ui/DataState.jsx";
import AlertStateCard from "../ui/AlertStateCard.jsx";
import Button from "../ui/Button";

import useMonitoringSettings from "../lib/hooks/useMonitoringSettings.js";
import useUserPreferences from "../lib/hooks/useUserPreferences.js";
import useTelemetry from "../lib/hooks/useTelemetry.js";
import useVehicles from "../lib/hooks/useVehicles.js";
import { useTenant } from "../lib/tenant-context.jsx";
import useTasks from "../lib/hooks/useTasks.js";
import { useUI } from "../lib/store.js";
import { formatAddress } from "../lib/format-address.js";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import useAlerts from "../lib/hooks/useAlerts.js";
import useConjugatedAlerts from "../lib/hooks/useConjugatedAlerts.js";
import { resolveMapPreferences } from "../lib/map-config.js";
import { resolveEventDefinitionFromPayload } from "../lib/event-translations.js";
import useOverlayActivity from "../lib/hooks/useOverlayActivity.js";
import { useVehicleAccess } from "../contexts/VehicleAccessContext.jsx";
import useAutoRefresh from "../lib/hooks/useAutoRefresh.js";
import { isBlockingAccessReason, isNoVehiclesReason, resolveAccessReason } from "../lib/access-reasons.js";
import {
  DEFAULT_MAP_LAYER_KEY,
  ENABLED_MAP_LAYERS,
  MAP_LAYER_FALLBACK,
  MAP_LAYER_SECTIONS,
  MAP_LAYER_STORAGE_KEYS,
  getValidMapLayer,
} from "../lib/mapLayers.js";
import { buildTestModeBannerData, shouldAutoShowTestModeOverlay } from "../lib/itinerary-test-mode.js";

// Discovery note: map layer presets and persistence here will be reused on
// Trips replay to keep map type selection consistent with monitoring.

import {
  deriveStatus,
  formatDateTime,
  getDeviceKey,
  getEventTime,
  getLastActivity,
  getIgnition,
  getLastUpdate,
  isLinkedToVehicle,
  isOnline,
  matchesAnyTenant,
  minutesSince,
  pickCoordinate,
  pickSpeed,
  resolveVehicleDisplayName,
  resolveVehicleInfo,
} from "../lib/monitoring-helpers.js";
import useVehicleSelection from "../lib/hooks/useVehicleSelection.js";
import { resolveMarkerIconType } from "../lib/map/vehicleMarkerIcon.js";

import { TELEMETRY_COLUMNS } from "../features/telemetry/telemetryColumns.jsx";

const DEFAULT_MAP_HEIGHT = 60;
const DEFAULT_LAYOUT_VISIBILITY = {
  showMap: true,
  showTable: true,
  showToolbar: true,
  showTopbar: true,
  showExcelFilters: true,
};
const MIN_MAP_HEIGHT = 20;
const MAX_MAP_HEIGHT = 80;
const DEFAULT_RADIUS = 500;
const MIN_RADIUS = 50;
const MAX_RADIUS = 5000;
const MAP_LAYER_STORAGE_KEY = MAP_LAYER_STORAGE_KEYS.monitoring;
const NON_DEFAULT_MONITORING_MAP_LAYERS = new Set(["satellite", "hybrid", "google-satellite", "google-hybrid"]);
const DEFAULT_COLUMN_WIDTH = 120;
const DEFAULT_COLUMN_MIN_WIDTH = 60;
const COLUMN_MIN_WIDTHS = {
  default: DEFAULT_COLUMN_MIN_WIDTH,
  client: DEFAULT_COLUMN_MIN_WIDTH,
  vehicle: DEFAULT_COLUMN_MIN_WIDTH,
  plate: DEFAULT_COLUMN_MIN_WIDTH,
  address: DEFAULT_COLUMN_MIN_WIDTH,
  geofences: DEFAULT_COLUMN_MIN_WIDTH,
  notes: DEFAULT_COLUMN_MIN_WIDTH,
  actions: DEFAULT_COLUMN_MIN_WIDTH,
};
const PAGE_SIZE_OPTIONS = [20, 50, 100, "all"];
const DEFAULT_PAGE_SIZE = 50;
const GEO_CACHE_STORAGE_KEY = "monitoring:geocode-cache:v1";
const GEO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GEO_MAX_CACHE_ENTRIES = 500;
const GEO_MAX_CONCURRENT = 4;
const GEO_QUEUE_DELAY_MS = 120;
const LAYOUT_STORAGE_KEY = "monitoring:layout-visibility:v1";
const normaliseLayoutVisibility = (value = {}) => {
  const next = {
    showMap: value.showMap !== false,
    showTable: value.showTable !== false,
    showToolbar: value.showToolbar !== false,
    showTopbar: value.showTopbar !== false,
    showExcelFilters: value.showExcelFilters !== false,
  };
  if (!next.showMap && !next.showTable) {
    next.showMap = true;
  }
  return next;
};

const DEVICE_FOCUS_ZOOM = 17;
const normaliseBoundingBox = (boundingBox) => {
  if (!boundingBox) return null;
  if (
    Array.isArray(boundingBox) &&
    boundingBox.length === 4 &&
    boundingBox.every((value) => Number.isFinite(Number(value)))
  ) {
    const [south, north, west, east] = boundingBox.map((value) => Number(value));
    return [
      [south, west],
      [north, east],
    ];
  }

  if (
    Array.isArray(boundingBox) &&
    boundingBox.length === 2 &&
    boundingBox.every((point) => Array.isArray(point) && point.length === 2)
  ) {
    const [[south, west], [north, east]] = boundingBox;
    if ([south, west, north, east].every((value) => Number.isFinite(Number(value)))) {
      return [
        [Number(south), Number(west)],
        [Number(north), Number(east)],
      ];
    }
  }

  return null;
};

const EURO_ONE_DEFAULT_COLUMNS = [
  "client",
  "vehicle",
  "plate",
  "ignition",
  "deviceTime",
  "serverTime",
  "address",
  "lastEvent",
  "blocked",
  "input2Jammer",
  "input4Panel",
  "out1RouteDeviation",
  "out2CentralCommands",
  "batteryLevel",
  "voltage",
  "speed",
  "status",
  "geofences",
  "notes",
  "actions",
];

const COLUMN_WIDTH_HINTS = {
  default: DEFAULT_COLUMN_WIDTH,
  vehicle: DEFAULT_COLUMN_WIDTH,
  plate: DEFAULT_COLUMN_WIDTH,
  deviceId: DEFAULT_COLUMN_WIDTH,
  protocol: DEFAULT_COLUMN_WIDTH,
  serverTime: DEFAULT_COLUMN_WIDTH,
  deviceTime: DEFAULT_COLUMN_WIDTH,
  gpsTime: DEFAULT_COLUMN_WIDTH,
  lastEvent: DEFAULT_COLUMN_WIDTH,
  valid: DEFAULT_COLUMN_WIDTH,
  latitude: DEFAULT_COLUMN_WIDTH,
  longitude: DEFAULT_COLUMN_WIDTH,
  speed: DEFAULT_COLUMN_WIDTH,
  address: DEFAULT_COLUMN_WIDTH,
  status: DEFAULT_COLUMN_WIDTH,
  ignition: DEFAULT_COLUMN_WIDTH,
  voltage: DEFAULT_COLUMN_WIDTH,
  client: DEFAULT_COLUMN_WIDTH,
  geofences: DEFAULT_COLUMN_WIDTH,
  notes: DEFAULT_COLUMN_WIDTH,
  faceRecognition: DEFAULT_COLUMN_WIDTH,
  input2Jammer: DEFAULT_COLUMN_WIDTH,
  input4Panel: DEFAULT_COLUMN_WIDTH,
  out1RouteDeviation: DEFAULT_COLUMN_WIDTH,
  out2CentralCommands: DEFAULT_COLUMN_WIDTH,
  actions: DEFAULT_COLUMN_WIDTH,
};

function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const COLUMN_LABEL_OVERRIDES = {
  speed: "monitoring.columns.speedShort",
  address: "monitoring.columns.addressShort",
  serverTime: "monitoring.columns.serverTimeShort",
};

const COLUMN_LABEL_FALLBACKS = {
  "monitoring.columns.client": "Cliente",
  "monitoring.columns.geofences": "Itinerario",
  "monitoring.columns.faceRecognition": "Rec. Facial",
};
const FILTER_STORAGE_KEY = "monitoring.table.filters:v2";
const FILTER_VALUE_LIMIT = 200;
const DEFAULT_FILTER_STATE = {
  filters: {},
  sort: { key: null, dir: null },
  quickFilters: {
    filterMode: "all",
    routeFilter: null,
    securityFilters: [],
  },
  sortingEnabled: true,
};

function normalizeFilterState(payload) {
  const parsed = payload && typeof payload === "object" ? payload : {};
  const filters =
    parsed.filters && typeof parsed.filters === "object" ? parsed.filters : {};
  const rawSort = parsed.sort && typeof parsed.sort === "object" ? parsed.sort : {};
  const sortKey = rawSort.key ?? null;
  const sortDir = rawSort.dir === "asc" || rawSort.dir === "desc" ? rawSort.dir : null;
  const quick = parsed.quickFilters && typeof parsed.quickFilters === "object" ? parsed.quickFilters : {};
  const filterMode = quick.filterMode ?? parsed.filterMode ?? DEFAULT_FILTER_STATE.quickFilters.filterMode;
  const routeFilter = quick.routeFilter ?? parsed.routeFilter ?? DEFAULT_FILTER_STATE.quickFilters.routeFilter;
  const securityFilters = Array.isArray(quick.securityFilters)
    ? quick.securityFilters
    : Array.isArray(parsed.securityFilters)
      ? parsed.securityFilters
      : DEFAULT_FILTER_STATE.quickFilters.securityFilters;
  const sortingEnabled =
    typeof parsed.sortingEnabled === "boolean" ? parsed.sortingEnabled : DEFAULT_FILTER_STATE.sortingEnabled;

  return {
    filters,
    sort: { key: sortKey, dir: sortDir },
    quickFilters: {
      filterMode: filterMode || "all",
      routeFilter: routeFilter || null,
      securityFilters: securityFilters.filter(Boolean),
    },
    sortingEnabled,
  };
}

function loadMonitoringFilters(storageKey = FILTER_STORAGE_KEY) {
  if (typeof window === "undefined") return { ...DEFAULT_FILTER_STATE };
  try {
    const raw = window.localStorage?.getItem(storageKey);
    if (!raw) return { ...DEFAULT_FILTER_STATE };
    return normalizeFilterState(JSON.parse(raw));
  } catch (_error) {
    return { ...DEFAULT_FILTER_STATE };
  }
}

function persistMonitoringFilters(storageKey, next) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(storageKey, JSON.stringify(next));
  } catch (_error) {
    // ignore storage errors
  }
}

const FILTER_DATE_KEYS = new Set(["serverTime", "deviceTime", "gpsTime", "lastUpdate", "lastActivity"]);
const FILTER_NUMBER_KEYS = new Set([
  "speed",
  "latitude",
  "longitude",
  "altitude",
  "voltage",
  "batteryLevel",
  "charge",
  "distance",
  "totalDistance",
  "satellites",
  "rssi",
  "hdop",
  "accuracy",
  "deviceTemp",
]);
const FILTER_BOOLEAN_KEYS = new Set(["valid", "ignition", "blocked", "isOnline"]);

function resolveFilterType(key) {
  if (FILTER_DATE_KEYS.has(key)) return "date";
  if (FILTER_NUMBER_KEYS.has(key)) return "number";
  if (FILTER_BOOLEAN_KEYS.has(key)) return "boolean";
  return "string";
}

function resolveFilterValueForKey(key, row) {
  if (!row) return null;
  if (key === "serverTime") {
    return getLastUpdate(row.position) || row.lastUpdate || row.lastActivity || null;
  }
  if (key === "deviceTime") {
    return row.position?.deviceTime || null;
  }
  if (key === "gpsTime") {
    return row.position?.fixTime || row.position?.time || null;
  }
  if (key === "latitude") {
    return row.lat ?? row.position?.latitude ?? row.position?.lat ?? null;
  }
  if (key === "longitude") {
    return row.lng ?? row.position?.longitude ?? row.position?.lon ?? null;
  }
  if (key === "speed") {
    return row.speed ?? pickSpeed(row.position || {}) ?? null;
  }
  if (key === "ignition") {
    return typeof row.ignition === "boolean" ? row.ignition : getIgnition(row.position, row.device);
  }
  if (key === "valid") {
    return row.position?.valid ?? null;
  }
  if (key === "blocked") {
    return row.position?.blocked ?? row.attributes?.blocked ?? null;
  }
  if (key === "voltage") {
    const attributes = row.attributes || {};
    return (
      row.position?.voltage ??
      row.position?.attributes?.voltage ??
      row.position?.attributes?.externalVoltage ??
      row.position?.attributes?.vbat ??
      row.position?.attributes?.batteryVoltage ??
      row.position?.attributes?.power ??
      row.position?.attributes?.adc ??
      attributes.voltage ??
      attributes.externalVoltage ??
      attributes.vbat ??
      attributes.batteryVoltage ??
      attributes.power ??
      attributes.adc ??
      null
    );
  }
  if (key === "batteryLevel") {
    const attributes = row.attributes || {};
    return row.position?.batteryLevel ?? attributes.batteryLevel ?? attributes.battery ?? null;
  }
  if (key === "charge") {
    const attributes = row.attributes || {};
    return row.position?.charge ?? attributes.charge ?? null;
  }
  if (key === "status") {
    return row.statusBadge?.label || row.statusLabel || null;
  }
  if (key === "client") {
    return row.clientName || null;
  }
  if (key === "vehicle") {
    return row.deviceName || row.vehicleName || row.vehicle?.name || null;
  }
  if (key === "plate") {
    return row.plate || row.vehicle?.plate || null;
  }
  if (key === "deviceId") {
    return row.deviceId || row.device?.traccarId || row.device?.id || null;
  }
  return row[key] ?? null;
}

function normalizeDisplayValue(value, t) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") {
    const yes = t ? t("common.yes") : "Sim";
    const no = t ? t("common.no") : "Não";
    return value ? yes : no;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (value.formattedAddress) return String(value.formattedAddress);
    if (value.address) return String(value.address);
    if (value.label) return String(value.label);
  }
  return "";
}

const arraysEqual = (a = [], b = []) => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
};

const loadGeocodeCache = () => {
  if (typeof window === "undefined") return new Map();
  try {
    const stored = localStorage.getItem(GEO_CACHE_STORAGE_KEY);
    if (!stored) return new Map();
    const parsed = JSON.parse(stored);
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    const now = Date.now();
    const hydrated = entries
      .filter((entry) => entry && Array.isArray(entry) && entry.length >= 2)
      .map(([key, value]) => {
        const updatedAt = Number(value?.updatedAt ?? 0);
        if (updatedAt && now - updatedAt > GEO_CACHE_TTL_MS) return null;
        return [key, value];
      })
      .filter(Boolean);
    return new Map(hydrated);
  } catch (_error) {
    return new Map();
  }
};

const loadLayoutVisibility = (storageKey) => {
  if (typeof window === "undefined") return null;
  if (!storageKey) return null;
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return null;
    return normaliseLayoutVisibility(JSON.parse(stored));
  } catch (_error) {
    return null;
  }
};

const persistLayoutVisibility = (storageKey, value) => {
  if (typeof window === "undefined") return;
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(normaliseLayoutVisibility(value)));
  } catch (_error) {
    // ignore
  }
};

const persistGeocodeCache = (cache) => {
  if (typeof window === "undefined") return;
  try {
    const entries = Array.from(cache.entries())
      .sort((a, b) => Number(b?.[1]?.updatedAt ?? 0) - Number(a?.[1]?.updatedAt ?? 0))
      .slice(0, GEO_MAX_CACHE_ENTRIES);
    localStorage.setItem(GEO_CACHE_STORAGE_KEY, JSON.stringify({ entries }));
  } catch (_error) {
    // ignore
  }
};

const getColumnMinWidth = (key) => {
  const minWidths = typeof COLUMN_MIN_WIDTHS === "undefined" ? null : COLUMN_MIN_WIDTHS;
  return minWidths?.[key] ?? minWidths?.default ?? DEFAULT_COLUMN_MIN_WIDTH;
};

const getColumnBaseWidth = (key) => {
  const candidates = [
    COLUMN_WIDTH_HINTS?.[key],
    COLUMN_WIDTH_HINTS?.default,
    DEFAULT_COLUMN_WIDTH,
  ];
  const resolved = candidates.find((value) => Number.isFinite(value) && value > 0);
  return resolved ?? DEFAULT_COLUMN_WIDTH;
};

function PaginationFooter({
  pageSize,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  pageIndex,
  totalPages,
  onPageChange,
  pageStart,
  pageEnd,
  totalRows,
}) {
  const currentPage = Math.max(1, Math.min(pageIndex + 1, totalPages));
  const isFirstPage = currentPage <= 1;
  const isLastPage = currentPage >= totalPages;

  const handlePageSizeChange = (event) => {
    const { value } = event.target;
    onPageSizeChange?.(value === "all" ? "all" : Number(value));
  };

  return (
    <div className="shrink-0 border-t border-white/10 bg-[#0f141c] px-2 py-1 text-[10px] leading-tight">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-white/70">
          <label className="text-[9px] uppercase tracking-[0.1em] text-white/50" htmlFor="monitoring-page-size">
            Itens por página
          </label>
          <select
            id="monitoring-page-size"
            value={pageSize === "all" ? "all" : String(pageSize)}
            onChange={handlePageSizeChange}
            className="h-7 min-w-[72px] rounded border border-white/10 bg-[#0b0f17] px-1.5 py-1 text-[10px] font-semibold text-white shadow-inner focus:border-primary focus:outline-none"
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option === "all" ? "Todos" : option}
              </option>
            ))}
          </select>

          <span className="text-[9px] uppercase tracking-[0.1em] text-white/50">
            Página {currentPage} de {totalPages}
          </span>
          <span className="text-[9px] uppercase tracking-[0.1em] text-white/50">
            Mostrando {pageStart}–{pageEnd} de {totalRows}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <PaginationButton disabled={isFirstPage} onClick={() => onPageChange?.(0)}>
            Primeira
          </PaginationButton>
          <PaginationButton disabled={isFirstPage} onClick={() => onPageChange?.(Math.max(pageIndex - 1, 0))}>
            Anterior
          </PaginationButton>
          <PaginationButton disabled={isLastPage} onClick={() => onPageChange?.(Math.min(pageIndex + 1, totalPages - 1))}>
            Próxima
          </PaginationButton>
          <PaginationButton disabled={isLastPage} onClick={() => onPageChange?.(totalPages - 1)}>
            Última
          </PaginationButton>
        </div>
      </div>
    </div>
  );
}

function PaginationButton({ children, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`
        flex h-7 min-w-[88px] items-center justify-center rounded border px-2 text-[10px] font-semibold uppercase tracking-[0.08em] transition
        ${disabled
          ? "cursor-not-allowed border-white/5 bg-white/5 text-white/30"
          : "border-white/15 bg-white/10 text-white hover:border-primary/60 hover:text-primary"}
      `}
    >
      {children}
    </button>
  );
}

export default function Monitoring() {
  const { t, locale } = useTranslation();
  const testModeLabels = useMemo(
    () => ({
      headline: t("monitoring.testModeLabel"),
      lastItineraryLabel: t("monitoring.testModeLastItinerary"),
      itineraryLabel: t("monitoring.testModeItinerary"),
      plateLabel: t("monitoring.testModePlate"),
      statusLabel: t("monitoring.testModeStatus"),
      disembarkedMessage: t("monitoring.testModeDisembarked"),
    }),
    [t],
  );
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const {
    tenantId,
    user,
    tenant,
    canAccess,
    isGlobalAdmin,
    isMirrorReceiver,
    logout,
  } = useTenant();
  const canAccessMonitoring = canAccess("primary", "monitoring");
  const canAccessAlerts = canAccessMonitoring || canAccess("primary", "events");
  const canAccessConjugatedAlerts = canAccessAlerts;
  const {
    accessibleVehicles,
    isRestricted,
    reason: accessListReason,
    accessReason: mirrorAccessReason,
  } = useVehicleAccess();
  const { telemetry, loading, reload } = useTelemetry();
  const safeTelemetry = useMemo(() => (Array.isArray(telemetry) ? telemetry : []), [telemetry]);
  const {
    tasks,
    loading: tasksLoading,
    error: tasksError,
    reload: reloadTasks,
  } = useTasks(useMemo(() => ({ clientId: tenantId }), [tenantId]), { enabled: canAccessMonitoring });
  const {
    vehicles,
    loading: vehiclesLoading,
    error: vehiclesError,
    reason: vehiclesReason,
    accessReason: vehiclesAccessReason,
  } = useVehicles({ enabled: canAccessMonitoring });
  const pendingAlertsRefresh = useAutoRefresh({
    enabled: canAccessMonitoring,
    intervalMs: 30_000,
    pauseWhenOverlayOpen: true,
  });
  const conjugatedAlertsRefresh = useAutoRefresh({
    enabled: canAccessMonitoring,
    intervalMs: 60_000,
    pauseWhenOverlayOpen: true,
  });
  const pendingAlertParams = useMemo(() => ({ status: "pending" }), []);
  const conjugatedAlertParams = useMemo(() => ({ windowHours: 5 }), []);
  const { alerts: pendingAlerts } = useAlerts({
    params: pendingAlertParams,
    refreshInterval: pendingAlertsRefresh.intervalMs,
    enabled: pendingAlertsRefresh.enabled && canAccessAlerts,
  });
  const { alerts: conjugatedAlerts } = useConjugatedAlerts({
    params: conjugatedAlertParams,
    refreshInterval: conjugatedAlertsRefresh.intervalMs,
    enabled: conjugatedAlertsRefresh.enabled && canAccessConjugatedAlerts,
  });
  const mapPreferences = useMemo(() => resolveMapPreferences(tenant?.attributes), [tenant?.attributes]);

  const hasTasksData = useMemo(
    () => !tasksLoading && !tasksError && Array.isArray(tasks),
    [tasks, tasksError, tasksLoading],
  );

  const activeTasks = useMemo(
    () =>
      hasTasksData
        ? tasks.filter((task) => !String(task.status || "").toLowerCase().includes("final"))
        : [],
    [hasTasksData, tasks],
  );

  const routesByVehicle = useMemo(() => {
    const map = new Map();
    if (!hasTasksData) return map;
    activeTasks.forEach((task) => {
      const key = String(task.vehicleId ?? task.deviceId ?? task.device?.id ?? task.device?.deviceId ?? "");
      if (key) map.set(key, task);
    });
    return map;
  }, [activeTasks, hasTasksData]);

  const vehiclesById = useMemo(() => {
    const map = new Map();
    vehicles.forEach((vehicle) => {
      if (vehicle?.id !== null && vehicle?.id !== undefined) {
        map.set(String(vehicle.id), vehicle);
      }
    });
    return map;
  }, [vehicles]);

  const allowedTenantIds = useMemo(() => {
    const ids = new Set();
    if (tenantId !== null && tenantId !== undefined) {
      ids.add(String(tenantId));
    }
    if (isRestricted && Array.isArray(accessibleVehicles)) {
      accessibleVehicles.forEach((vehicle) => {
        if (vehicle?.clientId !== null && vehicle?.clientId !== undefined) {
          ids.add(String(vehicle.clientId));
        }
      });
    }
    return Array.from(ids.values());
  }, [accessibleVehicles, isRestricted, tenantId]);

  const pendingAlertDeviceIds = useMemo(() => {
    const set = new Set();
    pendingAlerts.forEach((alert) => {
      if (alert?.deviceId) set.add(String(alert.deviceId));
    });
    return set;
  }, [pendingAlerts]);

  const pendingAlertVehicleIds = useMemo(() => {
    const set = new Set();
    pendingAlerts.forEach((alert) => {
      if (alert?.vehicleId) set.add(String(alert.vehicleId));
    });
    return set;
  }, [pendingAlerts]);

  const conjugatedAlertDeviceIds = useMemo(() => {
    const set = new Set();
    conjugatedAlerts.forEach((alert) => {
      if (alert?.deviceId) set.add(String(alert.deviceId));
    });
    return set;
  }, [conjugatedAlerts]);

  const userMonitoringStorageKey = useMemo(
    () => `monitoring:${user?.id || "anon"}`,
    [user?.id],
  );
  const { preferences, loading: loadingPreferences, savePreferences } = useUserPreferences();
  const setMonitoringTopbarVisible = useUI((state) => state.setMonitoringTopbarVisible);
  const filterStorageKey = useMemo(
    () => `${FILTER_STORAGE_KEY}:${userMonitoringStorageKey}`,
    [userMonitoringStorageKey],
  );
  const initialFilterState = useMemo(() => loadMonitoringFilters(filterStorageKey), [filterStorageKey]);

  const [vehicleQuery, setVehicleQuery] = useState("");
  const [addressValue, setAddressValue] = useState({ formattedAddress: "" });
  const [selectedAddress, setSelectedAddress] = useState(null);
  const [filterMode, setFilterMode] = useState(
    () => initialFilterState.quickFilters?.filterMode || "all",
  );
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [mapViewport, setMapViewport] = useState(null);
  const [regionTarget, setRegionTarget] = useState(null);
  const [addressPin, setAddressPin] = useState(null);
  const [nearbyDeviceIds, setNearbyDeviceIds] = useState([]);
  const [detailsDeviceId, setDetailsDeviceId] = useState(null);
  const [drawerMounted, setDrawerMounted] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [localMapHeight, setLocalMapHeight] = useState(DEFAULT_MAP_HEIGHT);
  const [mapInvalidateKey, setMapInvalidateKey] = useState(0);
  const [mapLayerKey, setMapLayerKey] = useState(DEFAULT_MAP_LAYER_KEY);
  const mapLayerHydratedRef = useRef(false);
  const mapLayerLocalPersistReadyRef = useRef(false);
  const mapLayerPersistRef = useRef(null);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [pageIndex, setPageIndex] = useState(0);
  const [columnFilters, setColumnFilters] = useState(() => initialFilterState.filters);
  const [columnSort, setColumnSort] = useState(() => initialFilterState.sort);
  const [sortingEnabled, setSortingEnabled] = useState(() => initialFilterState.sortingEnabled);
  const [activePopup, setActivePopup] = useState(null); // 'columns' | 'layout' | null
  const [layoutVisibility, setLayoutVisibility] = useState(() => ({ ...DEFAULT_LAYOUT_VISIBILITY }));
  const [layoutSaveRequestedAt, setLayoutSaveRequestedAt] = useState(null);
  const layoutHydratedRef = useRef(false);
  const layoutLocalPersistReadyRef = useRef(false);
  const filtersEnabled = layoutVisibility.showExcelFilters !== false;
  const effectiveColumnFilters = filtersEnabled ? columnFilters : {};
  const effectiveSortingEnabled = filtersEnabled && sortingEnabled;
  const layoutStorageKey = useMemo(
    () => `${LAYOUT_STORAGE_KEY}:${userMonitoringStorageKey}`,
    [userMonitoringStorageKey],
  );
  const mapLayerStorageKey = useMemo(
    () => `${MAP_LAYER_STORAGE_KEY}:${userMonitoringStorageKey}`,
    [userMonitoringStorageKey],
  );
  const resolveInitialMapLayer = useCallback((candidateLayerKey) => {
    const validLayerKey = getValidMapLayer(candidateLayerKey);
    if (NON_DEFAULT_MONITORING_MAP_LAYERS.has(validLayerKey)) {
      return DEFAULT_MAP_LAYER_KEY;
    }
    return validLayerKey;
  }, []);
  const columnStorageKey = useMemo(
    () => `monitoring.table.columns:${userMonitoringStorageKey}`,
    [userMonitoringStorageKey],
  );
  const [itineraryOverlayState, setItineraryOverlayState] = useState({
    vehicleId: null,
    enabled: false,
    overlay: null,
  });
  const [itineraryDebugOverlayState, setItineraryDebugOverlayState] = useState({
    vehicleId: null,
    enabled: false,
    overlay: null,
    status: null,
    attemptAt: null,
    summary: null,
    preventAutoOverlay: false,
  });
  const [routeFilter, setRouteFilter] = useState(() => initialFilterState.quickFilters?.routeFilter || null);
  const [securityFilters, setSecurityFilters] = useState(
    () => initialFilterState.quickFilters?.securityFilters || [],
  );
  const filtersHydratedRef = useRef(false);
  const filterPersistTimerRef = useRef(null);
  const filterPendingRef = useRef(null);
  const ignitionStateRef = useRef(new Map());
  const mapControllerRef = useRef(null);
  const pendingFocusDeviceIdRef = useRef(null);
  const searchParamsKey = searchParams.toString();
  const {
    selectedVehicleId: globalVehicleId,
    selectedTelemetryDeviceId: globalDeviceId,
    setVehicleSelection,
    clearVehicleSelection,
  } = useVehicleSelection({ syncQuery: true });
  const decoratedRowsRef = useRef([]);
  const mapViewportRef = useRef(null);
  const selectionRef = useRef({ vehicleId: null, deviceId: null });
  const selectedDeviceIdRef = useRef(null);
  const geocodeCacheRef = useRef(loadGeocodeCache());
  const geocodeQueueRef = useRef([]);
  const geocodeQueuedRef = useRef(new Set());
  const geocodeInFlightRef = useRef(new Map());
  const geocodeActiveRef = useRef(0);
  const geocodePersistTimerRef = useRef(null);
  const geocodePumpTimerRef = useRef(null);
  const [geocodeVersion, setGeocodeVersion] = useState(0);

  const scheduleFilterPersist = useCallback(
    (nextState) => {
      if (loadingPreferences || typeof savePreferences !== "function") return;
      filterPendingRef.current = nextState;
      if (filterPersistTimerRef.current) return;
      filterPersistTimerRef.current = setTimeout(() => {
        const pending = filterPendingRef.current;
        filterPendingRef.current = null;
        filterPersistTimerRef.current = null;
        if (!pending) return;
        savePreferences({ monitoringDefaultFilters: pending }).catch((error) => {
          console.warn("Falha ao salvar filtros de monitoramento", error);
        });
      }, 800);
    },
    [loadingPreferences, savePreferences],
  );

  const persistFilterState = useCallback(
    (filters, sort, quickFiltersOverride = null, sortingEnabledOverride = null, options = {}) => {
      const nextState = normalizeFilterState({
        filters,
        sort,
        quickFilters: quickFiltersOverride || {
          filterMode,
          routeFilter,
          securityFilters,
        },
        sortingEnabled:
          sortingEnabledOverride !== null && sortingEnabledOverride !== undefined
            ? sortingEnabledOverride
            : sortingEnabled,
      });
      persistMonitoringFilters(filterStorageKey, nextState);
      if (!options.skipRemote && filtersHydratedRef.current) {
        scheduleFilterPersist(nextState);
      }
      return nextState;
    },
    [filterMode, filterStorageKey, routeFilter, scheduleFilterPersist, securityFilters, sortingEnabled],
  );


  const updateColumnFilter = useCallback(
    (key, nextFilter) => {
      setColumnFilters((current) => {
        const next = { ...current };
        if (!nextFilter) {
          delete next[key];
        } else {
          next[key] = nextFilter;
        }
        persistFilterState(next, columnSort);
        return next;
      });
    },
    [columnSort, persistFilterState],
  );

  const updateColumnSort = useCallback(
    (nextSort) => {
      setColumnSort(nextSort);
      setSortingEnabled(true);
      persistFilterState(columnFilters, nextSort, null, true);
    },
    [columnFilters, persistFilterState],
  );

  const clearAllFilters = useCallback(() => {
    setVehicleQuery("");
    setAddressValue({ formattedAddress: "" });
    setSelectedAddress(null);
    setFilterMode("all");
    setRouteFilter(null);
    setSecurityFilters([]);
    setColumnFilters({});
    setColumnSort({ key: null, dir: null });
    setSortingEnabled(true);
    persistFilterState(
      {},
      { key: null, dir: null },
      { filterMode: "all", routeFilter: null, securityFilters: [] },
      true,
    );
    setPageIndex(0);
  }, [persistFilterState]);

  const hasActiveFilters = useMemo(() => {
    const hasColumnFilters = Object.keys(columnFilters || {}).length > 0;
    const hasSort = effectiveSortingEnabled && Boolean(columnSort?.key);
    const hasVehicle = Boolean(vehicleQuery?.trim());
    const hasAddress = Boolean(selectedAddress || addressValue?.formattedAddress?.trim());
    const hasMode = filterMode !== "all";
    const hasRoute = Boolean(routeFilter);
    const hasSecurity = Array.isArray(securityFilters) && securityFilters.length > 0;
    return hasColumnFilters || hasSort || hasVehicle || hasAddress || hasMode || hasRoute || hasSecurity;
  }, [
    addressValue?.formattedAddress,
    columnFilters,
    columnSort?.key,
    filterMode,
    routeFilter,
    securityFilters,
    selectedAddress,
    effectiveSortingEnabled,
    vehicleQuery,
  ]);

  const handleSortChange = useCallback(
    (key, direction) => {
      setSortingEnabled(true);
      setColumnSort((current) => {
        const currentKey = current?.key || null;
        const currentDir = current?.dir || null;
        let next = { key, dir: "asc" };
        if (direction === "asc" || direction === "desc") {
          next = { key, dir: direction };
        } else if (direction === "clear") {
          next = { key: null, dir: null };
        } else if (currentKey === key) {
          if (currentDir === "asc") next = { key, dir: "desc" };
          else if (currentDir === "desc") next = { key: null, dir: null };
        }
        persistFilterState(columnFilters, next, null, true);
        return next;
      });
      setPageIndex(0);
    },
    [columnFilters, persistFilterState],
  );

  useEffect(() => {
    persistFilterState(
      columnFilters,
      columnSort,
      { filterMode, routeFilter, securityFilters },
      sortingEnabled,
    );
  }, [columnFilters, columnSort, filterMode, persistFilterState, routeFilter, securityFilters, sortingEnabled]);

  const scheduleGeocodePersist = useCallback(() => {
    if (geocodePersistTimerRef.current) return;
    geocodePersistTimerRef.current = setTimeout(() => {
      geocodePersistTimerRef.current = null;
      persistGeocodeCache(geocodeCacheRef.current);
    }, 800);
  }, []);

  const updateGeocodeCache = useCallback((key, payload) => {
    if (!key) return;
    const current = geocodeCacheRef.current.get(key) || {};
    const next = { ...current, ...payload, updatedAt: Date.now() };
    geocodeCacheRef.current.set(key, next);
    setGeocodeVersion((prev) => prev + 1);
    scheduleGeocodePersist();
  }, [scheduleGeocodePersist]);

  const pumpGeocodeQueue = useCallback(() => {
    if (geocodePumpTimerRef.current) return;

    const run = () => {
      while (geocodeActiveRef.current < GEO_MAX_CONCURRENT && geocodeQueueRef.current.length > 0) {
        const next = geocodeQueueRef.current.shift();
        if (!next) continue;
        const { key, lat, lng, deviceId } = next;
        geocodeQueuedRef.current.delete(key);
        if (geocodeInFlightRef.current.has(key)) continue;
        geocodeActiveRef.current += 1;
        updateGeocodeCache(key, { status: "pending" });

        const request = safeApi.get(API_ROUTES.geocode.reverse, {
          params: {
            lat,
            lng,
            deviceId,
            reason: "monitoring",
            priority: "high",
          },
        });
        geocodeInFlightRef.current.set(key, request);

        request
          .then(({ data, error: requestError }) => {
            if (requestError) {
              updateGeocodeCache(key, { status: "fallback" });
              return;
            }
            const formatted = data?.formattedAddress || data?.address || data?.shortAddress || "";
            updateGeocodeCache(key, {
              status: data?.status || data?.geocodeStatus || (formatted ? "ok" : "pending"),
              address: formatted || null,
              shortAddress: data?.shortAddress || null,
              gridKey: data?.gridKey || null,
            });
          })
          .catch(() => {
            updateGeocodeCache(key, { status: "fallback" });
          })
          .finally(() => {
            geocodeInFlightRef.current.delete(key);
            geocodeActiveRef.current = Math.max(0, geocodeActiveRef.current - 1);
          });
      }

      if (geocodeQueueRef.current.length || geocodeActiveRef.current > 0) {
        geocodePumpTimerRef.current = setTimeout(run, GEO_QUEUE_DELAY_MS);
      } else {
        geocodePumpTimerRef.current = null;
      }
    };

    geocodePumpTimerRef.current = setTimeout(run, GEO_QUEUE_DELAY_MS);
  }, [updateGeocodeCache]);

  const queryFilters = useMemo(() => {
    const params = new URLSearchParams(searchParamsKey);
    const filter = params.get("filter");
    const normalizedFilter = filter === "critical" ? "conjugated" : filter;
    const incomingRouteFilter = params.get("routeFilter");
    const rawSecurityFilter = params.get("securityFilter") || "";
    const normalizedSecurityFilters = rawSecurityFilter
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return {
      filter: normalizedFilter || null,
      routeFilter: incomingRouteFilter || null,
      securityFilters: normalizedSecurityFilters,
    };
  }, [searchParamsKey]);

  useEffect(() => {
    if (queryFilters.filter) {
      setFilterMode((prev) => (prev === queryFilters.filter ? prev : queryFilters.filter));
    }
    const normalizedRouteFilter = queryFilters.routeFilter ?? null;
    setRouteFilter((prev) => (prev === normalizedRouteFilter ? prev : normalizedRouteFilter));
    setSecurityFilters((prev) => (arraysEqual(prev, queryFilters.securityFilters) ? prev : queryFilters.securityFilters));
  }, [queryFilters]);

  useEffect(() => {
    filtersHydratedRef.current = false;
  }, [filterStorageKey]);

  useEffect(() => {
    if (loadingPreferences) return;
    if (filtersHydratedRef.current) return;
    const remoteFilters = preferences?.monitoringDefaultFilters;
    const resolved = remoteFilters ? normalizeFilterState(remoteFilters) : loadMonitoringFilters(filterStorageKey);
    persistMonitoringFilters(filterStorageKey, resolved);
    setVehicleQuery("");
    setAddressValue({ formattedAddress: "" });
    setSelectedAddress(null);
    setFilterMode(resolved.quickFilters?.filterMode || "all");
    setSelectedDeviceId(null);
    setMapViewport(null);
    setRegionTarget(null);
    setAddressPin(null);
    setNearbyDeviceIds([]);
    setDetailsDeviceId(null);
    setPageIndex(0);
    setRouteFilter(resolved.quickFilters?.routeFilter || null);
    setSecurityFilters(resolved.quickFilters?.securityFilters || []);
    setColumnFilters(resolved.filters || {});
    setColumnSort(resolved.sort || { key: null, dir: null });
    setSortingEnabled(resolved.sortingEnabled);
    clearVehicleSelection();
    filtersHydratedRef.current = true;
  }, [
    clearVehicleSelection,
    filterStorageKey,
    loadingPreferences,
    preferences?.monitoringDefaultFilters,
  ]);

  // Controle de Popups
  const layoutButtonRef = useRef(null);

  const layoutsEqual = useCallback((a, b) => {
    return (
      a?.showMap === b?.showMap &&
      a?.showTable === b?.showTable &&
      a?.showToolbar === b?.showToolbar &&
      a?.showTopbar === b?.showTopbar &&
      a?.showExcelFilters === b?.showExcelFilters
    );
  }, []);

  const applyLayoutVisibility = useCallback(
    (updater, { persist = false } = {}) => {
      setLayoutVisibility((prev) => {
        const next = normaliseLayoutVisibility(
          typeof updater === "function" ? updater(prev) : updater,
        );
        const changed = !layoutsEqual(prev, next);

        if (persist && changed) {
          setLayoutSaveRequestedAt(Date.now());
        }

        return changed ? next : prev;
      });
    },
    [layoutsEqual],
  );

  const toggleLayoutVisibility = useCallback(
    (key) => {
      applyLayoutVisibility((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        if (key === "showMap" || key === "showTable") {
          if (!next.showMap && !next.showTable) {
            next[key] = true;
          }
        }
        return next;
      }, { persist: true });
    },
    [applyLayoutVisibility],
  );

  useEffect(() => {
    layoutHydratedRef.current = false;
    layoutLocalPersistReadyRef.current = false;
  }, [layoutStorageKey]);

  useEffect(() => {
    if (loadingPreferences) return;
    if (layoutHydratedRef.current) return;
    const storedLayout = loadLayoutVisibility(layoutStorageKey);
    const remote = preferences?.monitoringLayoutVisibility;

    if (remote) {
      applyLayoutVisibility({ ...DEFAULT_LAYOUT_VISIBILITY, ...remote }, { persist: false });
      layoutHydratedRef.current = true;
      return;
    }

    if (storedLayout) {
      applyLayoutVisibility({ ...DEFAULT_LAYOUT_VISIBILITY, ...storedLayout }, { persist: false });
    } else {
      applyLayoutVisibility((prev) => normaliseLayoutVisibility(prev), { persist: false });
    }
    layoutHydratedRef.current = true;
  }, [applyLayoutVisibility, layoutStorageKey, loadingPreferences, preferences?.monitoringLayoutVisibility]);

  useEffect(() => {
    if (!layoutHydratedRef.current) return;
    if (!layoutLocalPersistReadyRef.current) {
      layoutLocalPersistReadyRef.current = true;
      return;
    }
    persistLayoutVisibility(layoutStorageKey, layoutVisibility);
  }, [layoutStorageKey, layoutVisibility]);

  useEffect(() => {
    if (loadingPreferences || !layoutSaveRequestedAt) return undefined;
    const timeout = setTimeout(() => {
      savePreferences({ monitoringLayoutVisibility: layoutVisibility }).catch(() => {});
    }, 800);
    return () => clearTimeout(timeout);
  }, [layoutSaveRequestedAt, layoutVisibility, loadingPreferences, savePreferences]);

  useEffect(() => {
    setMonitoringTopbarVisible(layoutVisibility.showTopbar !== false);
    return () => setMonitoringTopbarVisible(true);
  }, [layoutVisibility.showTopbar, setMonitoringTopbarVisible]);

  useEffect(() => () => {
    if (geocodePersistTimerRef.current) {
      clearTimeout(geocodePersistTimerRef.current);
      geocodePersistTimerRef.current = null;
    }
    if (geocodePumpTimerRef.current) {
      clearTimeout(geocodePumpTimerRef.current);
      geocodePumpTimerRef.current = null;
    }
    if (filterPersistTimerRef.current) {
      clearTimeout(filterPersistTimerRef.current);
      filterPersistTimerRef.current = null;
    }
  }, []);

  const clampMapHeight = value => Math.min(
    MAX_MAP_HEIGHT,
    Math.max(MIN_MAP_HEIGHT, Number.isFinite(Number(value)) ? Number(value) : DEFAULT_MAP_HEIGHT),
  );

  const clampRadius = useCallback(
    (value) => Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, Number.isFinite(Number(value)) ? Number(value) : DEFAULT_RADIUS)),
    [],
  );

  const buildCoordKey = useCallback((lat, lng) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
  }, []);

  const buildAddressFocusKey = useCallback((payload, lat, lng) => {
    const rawKey =
      payload?.key ||
      payload?.id ||
      payload?.placeId ||
      payload?.place_id ||
      payload?.raw?.place_id ||
      payload?.raw?.placeId;
    if (rawKey) return `address:${rawKey}`;

    const coordKey = buildCoordKey(lat, lng);
    if (coordKey) return `address:${coordKey}`;

    const label = payload?.label || payload?.description || payload?.address || payload?.concise;
    if (label) {
      return `address:${label}`.trim().toLowerCase().replace(/\s+/g, "-");
    }

    return "address:unknown";
  }, [buildCoordKey]);

  useEffect(() => {
    mapLayerHydratedRef.current = false;
    mapLayerLocalPersistReadyRef.current = false;
    mapLayerPersistRef.current = null;
  }, [mapLayerStorageKey]);

  useEffect(() => {
    if (loadingPreferences || mapLayerHydratedRef.current) return;
    const remoteKey = preferences?.monitoringMapLayerKey;
    if (remoteKey) {
      setMapLayerKey(resolveInitialMapLayer(remoteKey));
      mapLayerHydratedRef.current = true;
      return;
    }
    try {
      const storedLayer = localStorage.getItem(mapLayerStorageKey) || localStorage.getItem(MAP_LAYER_STORAGE_KEY);
      setMapLayerKey(resolveInitialMapLayer(storedLayer));
    } catch (_error) {
      // ignore
    } finally {
      mapLayerHydratedRef.current = true;
    }
  }, [loadingPreferences, mapLayerStorageKey, preferences?.monitoringMapLayerKey, resolveInitialMapLayer]);

  useEffect(() => {
    if (!mapLayerHydratedRef.current) return;
    if (!mapLayerLocalPersistReadyRef.current) {
      mapLayerLocalPersistReadyRef.current = true;
      return;
    }
    try {
      localStorage.setItem(mapLayerStorageKey, mapLayerKey);
    } catch (_error) {
      // ignore
    }

    if (loadingPreferences || typeof savePreferences !== "function") return;
    if (mapLayerPersistRef.current === mapLayerKey) return;
    mapLayerPersistRef.current = mapLayerKey;
    savePreferences({ monitoringMapLayerKey: mapLayerKey }).catch((error) => {
      console.warn("Falha ao salvar tipo de mapa", error);
    });
  }, [loadingPreferences, mapLayerKey, mapLayerStorageKey, savePreferences]);

  useEffect(() => {
    mapViewportRef.current = mapViewport;
  }, [mapViewport]);

  useEffect(() => {
    selectedDeviceIdRef.current = selectedDeviceId;
  }, [selectedDeviceId]);

  useEffect(() => {
    selectionRef.current = {
      vehicleId: globalVehicleId ? String(globalVehicleId) : null,
      deviceId: globalDeviceId ? String(globalDeviceId) : null,
    };
  }, [globalDeviceId, globalVehicleId]);

  // --- Lógica de Dados ---
  const normalizedTelemetry = useMemo(() => safeTelemetry
    .map((item) => {
      const sourceDevice = item.device || item;
      const vehicleId =
        item.vehicleId ??
        sourceDevice?.vehicleId ??
        sourceDevice?.vehicle?.id ??
        sourceDevice?.vehicle_id ??
        sourceDevice?.vehicle?.vehicleId ??
        item.vehicle?.id ??
        null;
      const vehicleFromList = vehicleId ? vehiclesById.get(String(vehicleId)) : null;

      const resolvedVehicleType =
        vehicleFromList?.type ??
        vehicleFromList?.vehicleType ??
        vehicleFromList?.category ??
        item.vehicleType ??
        item.type ??
        item.category ??
        sourceDevice?.vehicleType ??
        sourceDevice?.attributes?.vehicleType ??
        sourceDevice?.vehicle?.vehicleType ??
        sourceDevice?.vehicle?.type ??
        sourceDevice?.vehicle?.category ??
        null;
      const resolvedVehicleCategory =
        vehicleFromList?.category ??
        item.category ??
        sourceDevice?.vehicle?.category ??
        sourceDevice?.attributes?.vehicleCategory ??
        null;

      const baseVehicle =
        item.vehicle ||
        sourceDevice?.vehicle ||
        (vehicleId
          ? {
              id: vehicleId,
              plate: item.plate ?? sourceDevice?.plate ?? sourceDevice?.registrationNumber,
              name: item.vehicleName ?? sourceDevice?.vehicleName ?? sourceDevice?.name,
              clientId: item.clientId ?? sourceDevice?.clientId,
              type:
                item.vehicleType ??
                item.type ??
                sourceDevice?.vehicleType ??
                sourceDevice?.type ??
                sourceDevice?.attributes?.vehicleType ??
                null,
              category:
                item.category ??
                sourceDevice?.vehicle?.category ??
                sourceDevice?.attributes?.vehicleCategory ??
                null,
              __synthetic: true,
            }
          : null);
      const vehicle = baseVehicle
        ? {
            ...baseVehicle,
            ...(vehicleFromList || {}),
            type: resolvedVehicleType,
            category: resolvedVehicleCategory,
          }
        : vehicleFromList
          ? {
              ...vehicleFromList,
              type: resolvedVehicleType,
              category: resolvedVehicleCategory,
            }
          : null;

      const device = {
        ...sourceDevice,
        vehicleId,
        vehicle: vehicle || sourceDevice?.vehicle,
        plate: sourceDevice?.plate ?? sourceDevice?.registrationNumber ?? item.plate ?? vehicle?.plate,
        clientId: sourceDevice?.clientId ?? item.clientId ?? vehicle?.clientId,
      };

      return { device, source: item, vehicle };
    })
    .filter((entry) => matchesAnyTenant(entry, allowedTenantIds)), [allowedTenantIds, safeTelemetry, vehiclesById]);

  const linkedTelemetry = useMemo(
    () =>
      normalizedTelemetry.filter((entry) => {
        const deviceKey = getDeviceKey(entry.device);
        if (!deviceKey) return false;
        return isLinkedToVehicle(entry);
      }),
    [normalizedTelemetry],
  );

  const plateOnlineMap = useMemo(() => {
    const map = new Map();
    linkedTelemetry.forEach(({ device, vehicle, source }) => {
      const plateRaw =
        device?.plate ??
        device?.registrationNumber ??
        vehicle?.plate ??
        vehicle?.registrationNumber ??
        "";
      const plate = String(plateRaw || "").trim();
      if (!plate) return;
      if (!isOnline(source?.position)) return;
      const key = getDeviceKey(device);
      if (!key) return;
      const list = map.get(plate) || [];
      const normalizedKey = String(key);
      if (!list.includes(normalizedKey)) {
        list.push(normalizedKey);
      }
      map.set(plate, list);
    });
    map.forEach((list, plate) => {
      list.sort((a, b) => String(a).localeCompare(String(b)));
      map.set(plate, list);
    });
    return map;
  }, [linkedTelemetry]);

  const vehicleOptions = useMemo(
    () =>
      linkedTelemetry.map(({ device, vehicle, source }) => {
        const name = device.name ?? device.alias ?? "";
        const plateRaw = device.plate ?? device.registrationNumber ?? vehicle?.plate ?? "";
        const plateValue = String(plateRaw || "").trim();
        const identifier = device.identifier ?? device.uniqueId ?? "";
        const clientName =
          device.clientName ||
          device.client?.name ||
          vehicle?.clientName ||
          vehicle?.client?.name ||
          "";
        const deviceKey = getDeviceKey(device);
        const online = isOnline(source?.position);
        const onlinePlateIds = online && plateValue ? plateOnlineMap.get(plateValue) : null;
        let plateLabel = plateValue || "Sem placa";
        if (onlinePlateIds && onlinePlateIds.length > 1 && deviceKey) {
          const index = onlinePlateIds.indexOf(String(deviceKey));
          if (index > 0) {
            plateLabel = `${plateValue}-${index + 1}`;
          }
        }
        const label = plateLabel || "Sem placa";
        const descriptionParts = [name || identifier, clientName].filter(Boolean);
        const description = descriptionParts.length ? descriptionParts.join(" · ") : undefined;
        const searchValue = `${label} ${plateValue} ${name} ${identifier} ${clientName}`.toLowerCase();
        return { type: "vehicle", deviceId: deviceKey, label, description, searchValue };
      }),
    [linkedTelemetry, plateOnlineMap],
  );

  const vehicleSuggestions = useMemo(() => {
    const term = vehicleQuery.toLowerCase().trim();
    if (!term) return [];
    return vehicleOptions.filter((option) => option.searchValue.includes(term)).slice(0, 8);
  }, [vehicleOptions, vehicleQuery]);

  const searchFiltered = useMemo(() => {
    const term = vehicleQuery.toLowerCase().trim();
    if (!term) return linkedTelemetry;

    return linkedTelemetry.filter(({ device, vehicle }) => {
      const name = (device.name ?? device.alias ?? "").toLowerCase();
      const plate = (device.plate ?? device.registrationNumber ?? vehicle?.plate ?? "").toLowerCase();
      const identifier = (device.identifier ?? device.uniqueId ?? "").toLowerCase();
      const deviceKey = (getDeviceKey(device) ?? "").toLowerCase();
      const clientName = (
        device.clientName ||
        device.client?.name ||
        vehicle?.clientName ||
        vehicle?.client?.name ||
        ""
      ).toLowerCase();
      return (
        name.includes(term) ||
        plate.includes(term) ||
        identifier.includes(term) ||
        deviceKey.includes(term) ||
        clientName.includes(term)
      );
    });
  }, [linkedTelemetry, vehicleQuery]);

  const filteredDevices = useMemo(() => {
    const now = Date.now();

    return searchFiltered.filter(({ source, device, vehicle }) => {
      const position = source?.position;
      const online = isOnline(position);
      const lastActivity = getLastActivity(position, device) || getLastUpdate(position);
      const stalenessMinutes = minutesSince(lastActivity);
      const hasStaleness = Number.isFinite(stalenessMinutes);
      const deviceKey = getDeviceKey(device);
      const activeTask = hasTasksData && deviceKey ? routesByVehicle.get(String(deviceKey)) : null;
      const hasRoute = hasTasksData && Boolean(activeTask);
      const startExpected = activeTask?.startTimeExpected ? Date.parse(activeTask.startTimeExpected) : null;
      const endExpected = activeTask?.endTimeExpected ? Date.parse(activeTask.endTimeExpected) : null;
      const statusText = String(activeTask?.status || "").toLowerCase();
      const routeDelay = Boolean(hasTasksData && hasRoute && startExpected && now > startExpected && !statusText.includes("final"));
      const routeDeviation = Boolean(hasTasksData && hasRoute && endExpected && now > endExpected && !statusText.includes("final"));
      const alarmText = String(
        position?.attributes?.alarm ??
          position?.attributes?.event ??
          position?.alarm ??
          device?.alarm ??
          device?.alerts?.[0] ??
          "",
      ).toLowerCase();
      const vehicleKey = vehicle?.id ?? device?.vehicleId ?? null;
      const hasConjugatedAlert = deviceKey ? conjugatedAlertDeviceIds.has(String(deviceKey)) : false;
      const hasPendingAlert =
        (deviceKey ? pendingAlertDeviceIds.has(String(deviceKey)) : false) ||
        (vehicleKey ? pendingAlertVehicleIds.has(String(vehicleKey)) : false);
      const isBlocked = Boolean(device?.blocked || position?.blocked || String(position?.status || "").toLowerCase() === "blocked");

      if (hasTasksData) {
        if (routeFilter === "active" && !hasRoute) return false;
        if (routeFilter === "with_signal" && (!hasRoute || !online)) return false;
        if (routeFilter === "without_signal" && (!hasRoute || online)) return false;
      }

      if (securityFilters.length) {
        const matchesSecurity = securityFilters.some((filter) => {
          if (filter === "jammer") return alarmText.includes("jam");
          if (filter === "violation") return alarmText.includes("viol");
          if (filter === "face") return alarmText.includes("face");
          if (filter === "blocked") return isBlocked;
          if (filter === "routeDeviation") return hasTasksData && routeDeviation;
          if (filter === "routeDelay") return hasTasksData && routeDelay;
          return false;
        });
        if (!matchesSecurity) return false;
      }

      if (filterMode === "online") return online;
      if (filterMode === "alerts") return hasPendingAlert;
      if (filterMode === "conjugated") return hasConjugatedAlert;
      if (filterMode === "stale_0_1") return !online && hasStaleness && stalenessMinutes >= 0 && stalenessMinutes < 60;
      if (filterMode === "stale_1_6") return !online && hasStaleness && stalenessMinutes >= 60 && stalenessMinutes < 360;
      if (filterMode === "stale_6_12") return !online && hasStaleness && stalenessMinutes >= 360 && stalenessMinutes < 720;
      if (filterMode === "stale_6_24") return !online && hasStaleness && stalenessMinutes >= 360 && stalenessMinutes < 1440;
      if (filterMode === "stale_12_24") return !online && hasStaleness && stalenessMinutes >= 720 && stalenessMinutes < 1440;
      if (filterMode === "stale_24_72") return !online && hasStaleness && stalenessMinutes >= 1440 && stalenessMinutes < 4320;
      if (filterMode === "stale_72_10d") return !online && hasStaleness && stalenessMinutes >= 4320 && stalenessMinutes < 14400;
      if (filterMode === "stale_10d_30d") return !online && hasStaleness && stalenessMinutes >= 14400 && stalenessMinutes < 43200;
      if (filterMode === "stale_24_plus") return !online && hasStaleness && stalenessMinutes >= 1440 && stalenessMinutes < 14400;
      if (filterMode === "stale_10d_plus") return !online && hasStaleness && stalenessMinutes >= 14400;
      if (filterMode === "stale_30d_plus") return !online && hasStaleness && stalenessMinutes >= 43200;
      return true;
    });
  }, [
    searchFiltered,
    filterMode,
    routeFilter,
    routesByVehicle,
    securityFilters,
    conjugatedAlertDeviceIds,
    pendingAlertDeviceIds,
    pendingAlertVehicleIds,
  ]);

  const rows = useMemo(() => {
    const list = Array.isArray(filteredDevices) ? filteredDevices : [];
    return list.map(({ device, source, vehicle } = {}) => {
      const key = getDeviceKey(device);
      const pos = source?.position;
      const lat = pickCoordinate([pos?.lat, pos?.latitude]);
      const lng = pickCoordinate([pos?.lng, pos?.longitude]);
      const statusBadge = deriveStatus(pos);
      const reportedIgnition = getIgnition(pos, device);
      const eventDefinition = resolveEventDefinitionFromPayload({ position: pos }, locale, t);
      const eventIgnition =
        typeof eventDefinition?.ignition === "boolean" ? eventDefinition.ignition : null;
      const fallbackIgnition =
        typeof reportedIgnition === "boolean"
          ? reportedIgnition
          : typeof pos?.attributes?.ignition === "boolean"
            ? pos.attributes.ignition
            : typeof pos?.attributes?.io === "boolean"
              ? pos.attributes.io
              : null;
      const previousIgnition = key ? ignitionStateRef.current.get(key) : null;
      let persistentIgnition = previousIgnition ?? null;
      if (typeof eventIgnition === "boolean") {
        persistentIgnition = eventIgnition;
      } else if (persistentIgnition === null && typeof fallbackIgnition === "boolean") {
        persistentIgnition = fallbackIgnition;
      }
      if (key) {
        ignitionStateRef.current.set(key, persistentIgnition);
      }
      const ignition = typeof persistentIgnition === "boolean" ? persistentIgnition : fallbackIgnition;
      const online = isOnline(pos);
      const statusLabel = statusBadge === "online"
        ? t("monitoring.filters.online")
        : statusBadge === "alert"
          ? t("monitoring.filters.alerts")
          : t("monitoring.filters.offline");
      const lastActivity = getLastActivity(pos, device) || getLastUpdate(pos);
      const stalenessMinutes = minutesSince(lastActivity);
      const rawAddress = pos?.address || pos?.attributes?.formattedAddress;
      const addressKey = buildCoordKey(lat, lng);
      const geocodeStatus = pos?.geocodeStatus || null;
      const mergedAttributes = {
        ...(vehicle?.attributes || {}),
        ...(device?.attributes || {}),
        ...(pos?.attributes || {}),
      };
      const vehicleType =
        vehicle?.type ||
        vehicle?.vehicleType ||
        vehicle?.category ||
        device?.vehicleType ||
        device?.type ||
        device?.attributes?.vehicleType ||
        device?.vehicle?.type ||
        device?.vehicle?.vehicleType ||
        device?.vehicle?.category ||
        null;
      const iconType = resolveMarkerIconType(
        {
          iconType: vehicle?.iconType || device?.iconType || mergedAttributes.iconType,
          vehicleType,
          type: device?.type || vehicle?.type,
          category: vehicle?.category,
          attributes: mergedAttributes,
        },
        [mergedAttributes.vehicleType, mergedAttributes.type, vehicleType, vehicle?.category],
      );

      const plateRaw =
        device?.plate ??
        device?.registrationNumber ??
        vehicle?.plate ??
        vehicle?.registrationNumber ??
        "—";
      const plateValue = String(plateRaw || "").trim() || "—";
      const onlinePlateIds = online && plateValue !== "—" ? plateOnlineMap.get(plateValue) : null;
      let plateLabel = plateValue;
      if (onlinePlateIds && onlinePlateIds.length > 1 && key) {
        const index = onlinePlateIds.indexOf(String(key));
        if (index > 0) {
          plateLabel = `${plateValue}-${index + 1}`;
        }
      }

      const row = {
        key,
        device,
        vehicle,
        deviceId: key,
        position: pos,
        lat,
        lng,
        deviceName: device.name ?? "—",
        clientName:
          device.clientName ||
          device.client?.name ||
          device.customerName ||
          device.customer?.name ||
          device.attributes?.client ||
          device.attributes?.customer ||
          source?.clientName ||
          source?.client?.name ||
          source?.customerName ||
          vehicle?.clientName ||
          vehicle?.client?.name ||
          "—",
        plate: plateValue,
        plateLabel,
        rawAddress,
        addressKey,
        geocodeStatus,
        speed: pickSpeed(pos),
        lastUpdate: lastActivity,
        lastActivity,
        stalenessMinutes,
        statusBadge,
        statusLabel,
        ignition,
        isOnline: online,
        heading:
          pos?.course ??
          pos?.heading ??
          pos?.attributes?.course ??
          pos?.attributes?.heading ??
          device?.heading ??
          null,
        vehicleType,
        iconType,
        attributes: mergedAttributes,
      };

      return row;
    });
  }, [buildCoordKey, filteredDevices, locale, plateOnlineMap, t]);

  const queueGeocodeForRow = useCallback(
    (row) => {
      if (!row?.addressKey) return;
      if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return;
      const cached = geocodeCacheRef.current.get(row.addressKey);
      if (cached?.status === "ok" && cached?.address) return;
      if (geocodeInFlightRef.current.has(row.addressKey)) return;
      if (geocodeQueuedRef.current.has(row.addressKey)) return;
      const formatted = formatAddress(row.rawAddress);
      if (formatted && formatted !== "—") return;
      geocodeQueuedRef.current.add(row.addressKey);
      geocodeQueueRef.current.push({
        key: row.addressKey,
        lat: row.lat,
        lng: row.lng,
        deviceId: row.deviceId,
      });
      updateGeocodeCache(row.addressKey, { status: "pending" });
      pumpGeocodeQueue();
    },
    [pumpGeocodeQueue, updateGeocodeCache],
  );

  useEffect(() => {
    rows.forEach((row) => queueGeocodeForRow(row));
  }, [queueGeocodeForRow, rows]);

  const decoratedRows = useMemo(() => {
    return rows.map((row) => {
      const cached = row.addressKey ? geocodeCacheRef.current.get(row.addressKey) : null;
      const cachedAddress = cached?.address || cached?.formattedAddress || cached?.shortAddress || null;
      const formatted = cachedAddress || formatAddress(row.rawAddress);
      const resolved = formatted && formatted !== "—" ? formatted : null;
      const geocodeStatus = cached?.status || row.geocodeStatus || null;
      const isLoading = geocodeStatus === "pending" && !cachedAddress;

      return {
        ...row,
        address: resolved,
        addressLoading: isLoading,
        geocodeStatus,
        isNearby: nearbyDeviceIds.includes(row.deviceId),
      };
    });
  }, [geocodeVersion, nearbyDeviceIds, rows]);

  const focusSelectedRowOnMap = useCallback((row, reason) => {
    if (!row) return;
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return;
    const ok = mapControllerRef.current?.focusDevice?.({
      lat: row.lat,
      lng: row.lng,
      zoom: DEVICE_FOCUS_ZOOM,
      animate: true,
      reason,
    });
    if (!ok) {
      setTimeout(() => {
        mapControllerRef.current?.focusDevice?.({
          lat: row.lat,
          lng: row.lng,
          zoom: DEVICE_FOCUS_ZOOM,
          animate: true,
          reason: `${reason}_RETRY`,
        });
      }, 200);
    }
  }, []);

  useEffect(() => {
    decoratedRowsRef.current = decoratedRows;
  }, [decoratedRows]);

  useEffect(() => {
    const pendingId = pendingFocusDeviceIdRef.current;
    if (!pendingId) return;
    const row = decoratedRows.find((item) => item.deviceId === pendingId);
    if (!row) return;
    focusSelectedRowOnMap(row, "GLOBAL_SEARCH_SELECT");
    pendingFocusDeviceIdRef.current = null;
  }, [decoratedRows, focusSelectedRowOnMap]);

  const displayRows = useMemo(
    () => (regionTarget ? decoratedRows.filter((row) => row.isNearby) : decoratedRows),
    [decoratedRows, regionTarget],
  );

  const filteredRows = useMemo(() => {
    const filters = effectiveColumnFilters || {};
    const filterEntries = Object.entries(filters)
      .map(([key, filter]) => ({ key, filter }))
      .filter(({ filter }) => filter && (filter.value || filter.valueTo || (filter.selected && filter.selected.length)));

    if (!filterEntries.length) return displayRows;

    const columnsByKey = new Map(TELEMETRY_COLUMNS.map((col) => [col.key, col]));

    const prepared = filterEntries.map(({ key, filter }) => {
      const column = columnsByKey.get(key);
      const filterType = column?.filterType || resolveFilterType(key);
      const operator = filter.operator || (filterType === "number" || filterType === "date" ? "equals" : "contains");
      const value = String(filter.value || "").trim();
      const valueTo = String(filter.valueTo || "").trim();
      const selectedSet = new Set(
        (filter.selected || [])
          .map((item) => String(item).trim().toLowerCase())
          .filter(Boolean),
      );
      return { key, filterType, operator, value, valueTo, selectedSet, column };
    });

    const parseComparable = (type, raw, display) => {
      if (type === "number") {
        const numeric = Number(raw ?? display);
        return Number.isFinite(numeric) ? numeric : null;
      }
      if (type === "date") {
        const candidate = raw ?? display;
        if (!candidate) return null;
        const time = candidate instanceof Date ? candidate.getTime() : new Date(candidate).getTime();
        return Number.isFinite(time) ? time : null;
      }
      return String(display || "").trim().toLowerCase();
    };

    return displayRows.filter((row) => {
      for (const entry of prepared) {
        const { filterType, operator, value, valueTo, selectedSet, column } = entry;
        const rawValue =
          column?.getFilterValue?.(row, { t, locale }) ??
          resolveFilterValueForKey(entry.key, row) ??
          row?.[entry.key];
        const displayValue = normalizeDisplayValue(rawValue, t);
        const normalizedDisplay = String(displayValue || "").trim().toLowerCase();

        if (selectedSet.size > 0 && !selectedSet.has(normalizedDisplay)) {
          return false;
        }

        if (!value && !valueTo) {
          continue;
        }

        const comparable = parseComparable(filterType, rawValue, displayValue);

        if (filterType === "number" || filterType === "date") {
          const left = comparable;
          const right = value ? parseComparable(filterType, value, value) : null;
          const rightTo = valueTo ? parseComparable(filterType, valueTo, valueTo) : null;
          if (left === null) return false;
          if (operator === "greater" && (right === null || left <= right)) return false;
          if (operator === "less" && (right === null || left >= right)) return false;
          if (operator === "between") {
            if (right === null || rightTo === null) return false;
            if (left < right || left > rightTo) return false;
          }
          if (operator === "equals" && right !== null && left !== right) return false;
          if (operator === "not_equals" && right !== null && left === right) return false;
          continue;
        }

        if (operator === "contains" && value && !normalizedDisplay.includes(value.toLowerCase())) return false;
        if (operator === "not_contains" && value && normalizedDisplay.includes(value.toLowerCase())) return false;
        if (operator === "equals" && value && normalizedDisplay !== value.toLowerCase()) return false;
        if (operator === "not_equals" && value && normalizedDisplay === value.toLowerCase()) return false;
      }
      return true;
    });
  }, [effectiveColumnFilters, displayRows, locale, t]);

  const detailsVehicle = useMemo(
    () => decoratedRows.find(item => item.deviceId === detailsDeviceId) || null,
    [decoratedRows, detailsDeviceId],
  );
  const detailsVehicleId = useMemo(
    () =>
      detailsVehicle?.vehicleId ??
      detailsVehicle?.vehicle?.id ??
      detailsVehicle?.id ??
      null,
    [detailsVehicle],
  );
  const debugOverlayVehicle = useMemo(() => {
    if (!itineraryDebugOverlayState.enabled) return null;
    const targetVehicleId = itineraryDebugOverlayState.vehicleId;
    if (!targetVehicleId) return detailsVehicle;
    const match = decoratedRows.find((item) => {
      const candidate =
        item?.vehicleId ??
        item?.vehicle?.id ??
        item?.vehicle?.vehicleId ??
        item?.id ??
        null;
      return candidate != null && String(candidate) === String(targetVehicleId);
    });
    return match || detailsVehicle;
  }, [decoratedRows, detailsVehicle, itineraryDebugOverlayState.enabled, itineraryDebugOverlayState.vehicleId]);
  const itineraryDebugSummary = itineraryDebugOverlayState.summary || null;
  const itineraryDebugBadge = useMemo(() => {
    if (!itineraryDebugOverlayState.enabled) return null;
    const overlay = itineraryDebugOverlayState.overlay || null;
    const summaryName = itineraryDebugSummary?.itineraryName || "";
    const itineraryName = summaryName || overlay?.name || "";
    const itineraryId = overlay?.id || "";
    const itineraryLabel = String(itineraryName || itineraryId || "—").trim() || "—";
    const plateRaw =
      debugOverlayVehicle?.plate ||
      debugOverlayVehicle?.device?.plate ||
      debugOverlayVehicle?.vehicle?.plate ||
      debugOverlayVehicle?.vehicle?.registrationNumber ||
      debugOverlayVehicle?.device?.registrationNumber ||
      "";
    const plateLabel = String(plateRaw).trim() || "—";
    const statusRaw =
      itineraryDebugSummary?.status ||
      itineraryDebugOverlayState.status ||
      overlay?.status ||
      "PENDING";
    const hasConfirmedEmbarked = Boolean(itineraryDebugSummary?.hasConfirmedEmbarked);
    const isDisembarked = Boolean(itineraryDebugSummary?.isDisembarked);
    return buildTestModeBannerData({
      enabled: true,
      itineraryName: itineraryLabel,
      plate: plateLabel,
      status: statusRaw,
      hasConfirmedEmbarked,
      isDisembarked,
      labels: testModeLabels,
    });
  }, [
    debugOverlayVehicle,
    itineraryDebugOverlayState.enabled,
    itineraryDebugOverlayState.overlay,
    itineraryDebugOverlayState.status,
    itineraryDebugSummary,
    testModeLabels,
  ]);
  const shouldShowDebugOverlay = useMemo(
    () =>
      shouldAutoShowTestModeOverlay({
        enabled: itineraryDebugOverlayState.enabled,
        hasOverlay: Boolean(itineraryDebugOverlayState.overlay),
        hasConfirmedEmbarked:
          Boolean(itineraryDebugSummary?.hasConfirmedEmbarked) ||
          Boolean(itineraryDebugOverlayState.preventAutoOverlay),
        isDisembarked: Boolean(itineraryDebugSummary?.isDisembarked),
      }),
    [
      itineraryDebugOverlayState.enabled,
      itineraryDebugOverlayState.overlay,
      itineraryDebugOverlayState.preventAutoOverlay,
      itineraryDebugSummary,
    ],
  );
  const showOfficialOverlay = useMemo(() => {
    if (!itineraryOverlayState.enabled) return false;
    if (!itineraryDebugOverlayState.enabled) return true;
    if (!shouldShowDebugOverlay) return true;
    const officialId = String(itineraryOverlayState.vehicleId || "");
    const debugId = String(itineraryDebugOverlayState.vehicleId || "");
    return officialId && debugId ? officialId !== debugId : false;
  }, [
    shouldShowDebugOverlay,
    itineraryDebugOverlayState.enabled,
    itineraryDebugOverlayState.vehicleId,
    itineraryOverlayState.enabled,
    itineraryOverlayState.vehicleId,
  ]);

  const isDetailsOpen = Boolean(detailsDeviceId);
  useOverlayActivity(isDetailsOpen);
  const keepSelectionOnClose = useMemo(() => {
    if (!detailsVehicleId) return false;
    const normalizedVehicleId = String(detailsVehicleId);
    const hasOfficialOverlay =
      Boolean(itineraryOverlayState.enabled) &&
      String(itineraryOverlayState.vehicleId || "") === normalizedVehicleId;
    const hasDebugOverlay =
      Boolean(itineraryDebugOverlayState.enabled) &&
      String(itineraryDebugOverlayState.vehicleId || "") === normalizedVehicleId;
    return hasOfficialOverlay || hasDebugOverlay;
  }, [
    detailsVehicleId,
    itineraryDebugOverlayState.enabled,
    itineraryDebugOverlayState.vehicleId,
    itineraryOverlayState.enabled,
    itineraryOverlayState.vehicleId,
  ]);
  const closeDetails = useCallback(() => {
    setDetailsDeviceId(null);
    if (keepSelectionOnClose) return;
    setSelectedDeviceId(null);
    clearVehicleSelection();
  }, [clearVehicleSelection, keepSelectionOnClose]);

  const handleItineraryOverlayChange = useCallback(({ vehicleId, enabled, overlay }) => {
    if (!enabled) {
      setItineraryOverlayState({ vehicleId: null, enabled: false, overlay: null });
      return;
    }
    const normalizedVehicleId = vehicleId ? String(vehicleId) : null;
    const nextOverlay = overlay ? { ...overlay } : null;
    if (nextOverlay && !nextOverlay.fitToken) {
      nextOverlay.fitToken = Date.now();
    }
    setItineraryOverlayState({
      vehicleId: normalizedVehicleId,
      enabled: Boolean(enabled),
      overlay: nextOverlay,
    });
  }, []);

  const handleItineraryDebugOverlayChange = useCallback(({
    vehicleId,
    enabled,
    overlay,
    status,
    attemptAt,
    summary,
    preventAutoOverlay,
  }) => {
    if (!enabled) {
      setItineraryDebugOverlayState({
        vehicleId: null,
        enabled: false,
        overlay: null,
        status: null,
        attemptAt: null,
        summary: null,
        preventAutoOverlay: false,
      });
      return;
    }
    const normalizedVehicleId = vehicleId ? String(vehicleId) : null;
    const nextOverlay = overlay ? { ...overlay } : null;
    if (nextOverlay && !nextOverlay.fitToken) {
      nextOverlay.fitToken = Date.now();
    }
    setItineraryDebugOverlayState({
      vehicleId: normalizedVehicleId,
      enabled: Boolean(enabled),
      overlay: nextOverlay,
      status: status || null,
      attemptAt: attemptAt || null,
      summary: summary || null,
      preventAutoOverlay: Boolean(preventAutoOverlay),
    });
  }, []);

  useEffect(() => {
    if (!itineraryOverlayState.enabled) return;
    if (!detailsVehicleId) return;
    if (String(detailsVehicleId) !== String(itineraryOverlayState.vehicleId)) {
      setItineraryOverlayState({ vehicleId: null, enabled: false, overlay: null });
    }
  }, [detailsVehicleId, itineraryOverlayState.enabled, itineraryOverlayState.vehicleId]);

  useEffect(() => {
    if (!itineraryDebugOverlayState.enabled) return;
    if (!detailsVehicleId) return;
    if (String(detailsVehicleId) !== String(itineraryDebugOverlayState.vehicleId)) {
      setItineraryDebugOverlayState({
        vehicleId: null,
        enabled: false,
        overlay: null,
        status: null,
        attemptAt: null,
        summary: null,
        preventAutoOverlay: false,
      });
    }
  }, [detailsVehicleId, itineraryDebugOverlayState.enabled, itineraryDebugOverlayState.vehicleId]);

  const openDetailsFor = useCallback((deviceId) => {
    setDetailsDeviceId(deviceId);
  }, []);

  const focusDevice = useCallback(
    (deviceId, { openDetails = false, allowToggle = true } = {}) => {
      const normalizedDeviceId = deviceId ? String(deviceId) : null;
      if (!normalizedDeviceId) return;
      const isAlreadySelected = selectedDeviceIdRef.current === normalizedDeviceId;

      if (isAlreadySelected && allowToggle && !openDetails) {
        setSelectedDeviceId(null);
        setDetailsDeviceId((prev) => (openDetails ? null : prev));
        clearVehicleSelection();
        selectionRef.current = { vehicleId: null, deviceId: null };
        return;
      }

      setSelectedDeviceId((prev) => (prev === normalizedDeviceId ? prev : normalizedDeviceId));
      const targetRow = decoratedRowsRef.current.find((item) => item.deviceId === normalizedDeviceId);
      if (targetRow && Number.isFinite(targetRow.lat) && Number.isFinite(targetRow.lng)) {
        const currentViewport = mapViewportRef.current;
        const currentCenter = Array.isArray(currentViewport?.center) ? currentViewport.center : null;
        const currentZoom = Number.isFinite(currentViewport?.zoom) ? currentViewport.zoom : null;
        const distanceToCurrent = currentCenter
          ? distanceKm(targetRow.lat, targetRow.lng, currentCenter[0], currentCenter[1]) * 1000
          : null;
        const alreadyFocused =
          isAlreadySelected &&
          distanceToCurrent !== null &&
          distanceToCurrent < 50 &&
          (currentZoom ?? 0) >= DEVICE_FOCUS_ZOOM - 1;

        if (!alreadyFocused) {
          const focus = {
            center: [targetRow.lat, targetRow.lng],
            zoom: DEVICE_FOCUS_ZOOM,
          };
          setMapViewport(focus);
          mapViewportRef.current = focus;
        }
      }
      if (openDetails) openDetailsFor(normalizedDeviceId);
      const targetVehicleId =
        targetRow?.device?.vehicleId ?? targetRow?.device?.vehicle?.id ?? targetRow?.vehicle?.id ?? null;
      const normalizedVehicleId = targetVehicleId ? String(targetVehicleId) : null;
      const currentVehicleId = selectionRef.current.vehicleId;
      const currentDeviceId = selectionRef.current.deviceId;
      if (normalizedVehicleId !== currentVehicleId || normalizedDeviceId !== currentDeviceId) {
        selectionRef.current = { vehicleId: normalizedVehicleId, deviceId: normalizedDeviceId };
        setVehicleSelection(normalizedVehicleId, normalizedDeviceId);
      }
    },
    [clearVehicleSelection, openDetailsFor, setVehicleSelection],
  );

  useEffect(() => {
    const focusDeviceId = location.state?.focusDeviceId ?? null;
    if (!focusDeviceId) return;
    pendingFocusDeviceIdRef.current = String(focusDeviceId);
    focusDevice(String(focusDeviceId), { openDetails: true, allowToggle: false });
  }, [focusDevice, location.state]);
  useEffect(() => {
    if (!globalDeviceId && !globalVehicleId) return;
    const rowsSource = decoratedRowsRef.current || [];
    const target =
      rowsSource.find((row) => row.deviceId === globalDeviceId) ||
      rowsSource.find((row) => {
        const vehicleId = row.device?.vehicleId ?? row.device?.vehicle?.id ?? row.vehicle?.id;
        return vehicleId && globalVehicleId && String(vehicleId) === String(globalVehicleId);
      });
    if (target && target.deviceId !== selectedDeviceIdRef.current) {
      focusDevice(target.deviceId, { openDetails: false, allowToggle: false });
    }
  }, [focusDevice, globalDeviceId, globalVehicleId]);

  useEffect(() => {
    if (!isDetailsOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeDetails();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeDetails, isDetailsOpen]);

  useEffect(() => {
    if (isDetailsOpen) {
      setDrawerMounted(true);
      requestAnimationFrame(() => setDrawerVisible(true));
      return;
    }
    if (drawerMounted) {
      setDrawerVisible(false);
    }
  }, [drawerMounted, isDetailsOpen]);

  const handleVehicleSearchChange = useCallback((value) => {
    setVehicleQuery(value);
  }, []);

  const mapLayer = useMemo(
    () => ENABLED_MAP_LAYERS.find((item) => item.key === mapLayerKey) || MAP_LAYER_FALLBACK,
    [mapLayerKey],
  );

  const handleMapLayerChange = useCallback((nextKey) => {
    const valid = ENABLED_MAP_LAYERS.find((item) => item.key === nextKey);
    setMapLayerKey(valid ? valid.key : DEFAULT_MAP_LAYER_KEY);
  }, []);

  const markers = useMemo(() => {
    const byDeviceId = new Map();
    filteredRows.forEach((row) => {
      const id = row.deviceId ?? row.device?.id ?? row.device?.traccarId ?? null;
      if (!id) return;
      const key = String(id);
      const existing = byDeviceId.get(key);
      if (!existing) {
        byDeviceId.set(key, row);
        return;
      }
      const existingTime = existing.lastUpdate?.getTime?.() ?? -Infinity;
      const nextTime = row.lastUpdate?.getTime?.() ?? -Infinity;
      if (nextTime > existingTime) {
        byDeviceId.set(key, row);
      }
    });

    return Array.from(byDeviceId.values())
      .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng))
      .map((row) => {
        const resolvedVehicle = row.vehicle || row.device?.vehicle || null;
        const resolvedDeviceId = row.deviceId ?? row.device?.id ?? row.device?.traccarId ?? null;
        const deviceFromVehicle = resolvedVehicle?.devices?.find((device) => {
          if (!resolvedDeviceId) return false;
          const candidates = [device?.traccarId, device?.id, device?.uniqueId].filter(Boolean).map(String);
          return candidates.includes(String(resolvedDeviceId));
        });
        const resolvedDevice = row.device || deviceFromVehicle || null;
        const resolvedAttributes =
          row.attributes ||
          resolvedDevice?.attributes ||
          resolvedVehicle?.attributes ||
          deviceFromVehicle?.attributes ||
          {};
        const info = resolveVehicleInfo({
          vehicle: resolvedVehicle || row.vehicle || row,
          device: resolvedDevice || row.device,
          attributes: resolvedAttributes,
        });

        const status = row.statusBadge;
        const statusLabel = status === "online"
          ? t("monitoring.filters.online")
          : status === "alert"
            ? t("monitoring.filters.alerts")
            : t("monitoring.filters.offline");

        const ignitionColor =
          row.ignition === true ? "#22c55e" : row.ignition === false ? "#ef4444" : "#94a3b8";
        const markerIconType = resolveMarkerIconType(
          {
            iconType: row.iconType || resolvedAttributes?.iconType,
            vehicleType: row.vehicleType || resolvedVehicle?.vehicleType || resolvedVehicle?.type,
            type: resolvedDevice?.type || resolvedVehicle?.type || row.device?.type,
            category: resolvedVehicle?.category,
            attributes: resolvedAttributes,
          },
          [
            row.vehicleType,
            resolvedAttributes?.vehicleType,
            resolvedVehicle?.vehicleType,
            resolvedVehicle?.category,
            resolvedVehicle?.type,
          ],
        );

        const plateLabelRaw =
          row.plateLabel ||
          info.plate ||
          resolvedVehicle?.plate ||
          resolvedDevice?.plate ||
          row.plate ||
          "";
        const plateLabel = String(plateLabelRaw).trim() || "Sem placa";
        const displayName = resolveVehicleDisplayName(info);
        const secondaryLabel = displayName !== "—" ? displayName : "";
        const eventDefinition = resolveEventDefinitionFromPayload(row.position || resolvedDevice?.position || {});
        const eventTime = getEventTime(row.position || resolvedDevice?.position || null);
        const ignitionLabel =
          row.ignition === true ? "Ligada" : row.ignition === false ? "Desligada" : "—";

        return {
          id: resolvedDeviceId ? String(resolvedDeviceId) : String(row.deviceId),
          lat: row.lat,
          lng: row.lng,
          label: plateLabel,
          mapLabel: plateLabel,
          plate: plateLabel,
          model: secondaryLabel,
          address: row.address,
          speedLabel: `${row.speed ?? 0} km/h`,
          lastUpdateLabel: formatDateTime(row.lastUpdate, locale),
          ignitionLabel,
          lastEventLabel: eventDefinition?.label || "—",
          lastEventTimeLabel: eventTime ? formatDateTime(eventTime, locale) : "—",
          color: ignitionColor,
          accentColor: row.deviceId === selectedDeviceId ? "#f97316" : row.isNearby ? "#22d3ee" : undefined,
          muted: !row.isOnline,
          status,
          statusLabel,
          iconType: markerIconType,
          heading: row.heading,
        };
      });
  }, [filteredRows, locale, selectedDeviceId, t]);

  const summary = useMemo(() => {
    const base = {
      online: 0,
      offline: 0,
      moving: 0,
      alertsPending: pendingAlerts.length,
      alertsConjugated: conjugatedAlerts.length,
      stale0to1: 0,
      stale1to6: 0,
      stale6to12: 0,
      stale12to24: 0,
      stale24to72: 0,
      stale72to10d: 0,
      stale10dto30d: 0,
      stale30dPlus: 0,
      total: filteredRows.length,
    };

    filteredRows.forEach((row) => {
      const online = isOnline(row.position);
      const staleness = Number.isFinite(row.stalenessMinutes)
        ? row.stalenessMinutes
        : minutesSince(row.lastActivity);
      if (online) base.online += 1;
      else base.offline += 1;

      if ((row.speed ?? 0) > 0) base.moving += 1;

      if (!online && Number.isFinite(staleness)) {
        if (staleness >= 0 && staleness < 60) base.stale0to1 += 1;
        if (staleness >= 60 && staleness < 360) base.stale1to6 += 1;
        if (staleness >= 360 && staleness < 720) base.stale6to12 += 1;
        if (staleness >= 720 && staleness < 1440) base.stale12to24 += 1;
        if (staleness >= 1440 && staleness < 4320) base.stale24to72 += 1;
        if (staleness >= 4320 && staleness < 14400) base.stale72to10d += 1;
        if (staleness >= 14400 && staleness < 43200) base.stale10dto30d += 1;
        if (staleness >= 43200) base.stale30dPlus += 1;
      }
    });

    return {
      ...base,
      stale6to24: base.stale6to12 + base.stale12to24,
      stale24Plus: base.stale24to72 + base.stale72to10d,
      stale10dPlus: base.stale10dto30d + base.stale30dPlus,
    };
  }, [filteredRows, pendingAlerts.length, conjugatedAlerts.length]);

  // --- Configuração de Colunas ---
  const telemetryColumns = useMemo(() =>
    TELEMETRY_COLUMNS.map(col => {
      const overrideKey = COLUMN_LABEL_OVERRIDES[col.key];
      const translated = overrideKey ? t(overrideKey) : t(col.labelKey);
      const label = COLUMN_LABEL_FALLBACKS[translated] || COLUMN_LABEL_FALLBACKS[col.labelKey] || translated;
      const filterType = col.filterType || resolveFilterType(col.key);
      const getFilterValue = col.getFilterValue
        ? col.getFilterValue
        : (row, helpers = {}) => {
            const resolved = resolveFilterValueForKey(col.key, row);
            if (resolved !== null && resolved !== undefined) return resolved;
            return typeof col.getValue === "function" ? col.getValue(row, helpers) : row?.[col.key];
          };

      return {
        ...col,
        width: getColumnBaseWidth(col.key),
        minWidth: getColumnMinWidth(col.key),
        label,
        render: row => col.getValue(row, { t, locale }),
        filterType,
        getFilterValue,
      };
    }),
  [t, locale]);

  const actionsColumn = useMemo(() => ({
    key: "actions",
    label: t("monitoring.columns.actions"),
    defaultVisible: true,
    fixed: true,
    width: getColumnBaseWidth("actions"),
    minWidth: getColumnMinWidth("actions"),
    render: (row) => {
      const formattedAddress = formatAddress(row.address || row.rawAddress || row.position?.address || row.device?.address);
      const addressValue = formattedAddress && formattedAddress !== "—" ? formattedAddress : null;
      const hasCoords = Number.isFinite(row.lat) && Number.isFinite(row.lng);
      const mapUrl = hasCoords
        ? `https://www.google.com/maps?q=${row.lat},${row.lng}`
        : addressValue
          ? `https://www.google.com/maps?q=${encodeURIComponent(addressValue)}`
          : null;

      return (
        <div className="flex items-center justify-center">
          {mapUrl ? (
            <a
              className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary transition hover:border-primary/60 hover:bg-primary/20"
              href={mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Abrir no Google Maps"
              onClick={(event) => event.stopPropagation()}
            >
              <Globe size={16} />
            </a>
          ) : (
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-white/30"
              aria-hidden
              title="Localização indisponível"
            >
              <Globe size={16} />
            </span>
          )}
        </div>
      );
    },
  }), [t]);

  const allColumns = useMemo(() => [...telemetryColumns, actionsColumn], [telemetryColumns, actionsColumn]);

  const columnValueOptions = useMemo(() => {
    if (!filtersEnabled) return {};
    const map = new Map();
    telemetryColumns.forEach((col) => {
      map.set(col.key, new Set());
    });
    displayRows.forEach((row) => {
      telemetryColumns.forEach((col) => {
        const rawValue =
          col.getFilterValue?.(row, { t, locale }) ??
          resolveFilterValueForKey(col.key, row) ??
          row?.[col.key];
        const displayValue = normalizeDisplayValue(rawValue, t);
        if (!displayValue) return;
        const bucket = map.get(col.key);
        if (!bucket || bucket.size >= FILTER_VALUE_LIMIT) return;
        bucket.add(displayValue);
      });
    });
    const result = {};
    map.forEach((set, key) => {
      result[key] = Array.from(set.values()).sort((a, b) => String(a).localeCompare(String(b)));
    });
    return result;
  }, [displayRows, filtersEnabled, locale, t, telemetryColumns]);

  const handleSelectRow = useCallback((deviceId) => {
    focusDevice(deviceId);
  }, [focusDevice]);

  const handleRowClick = useCallback((row) => {
    focusSelectedRowOnMap(row, "TABLE_SELECT");
    focusDevice(row.deviceId, { openDetails: true });
  }, [focusDevice, focusSelectedRowOnMap]);

  const handleMarkerSelect = useCallback((deviceId) => {
    focusDevice(deviceId);
  }, [focusDevice]);

  const handleMarkerDetails = useCallback((deviceId) => {
    focusDevice(deviceId, { openDetails: true });
  }, [focusDevice]);

  const handleTogglePopup = useCallback((name) => {
    setActivePopup((prev) => {
      return prev === name ? null : name;
    });
  }, []);

  const {
    columnDefaults,
    visibleColumns,
    columnPrefs,
    toggleColumn,
    restoreColumns: restoreColumnsBase,
    moveColumn,
    updateColumnWidth,
    mapHeightPercent,
    updateMapHeight,
    applyColumns: applyColumnsBase,
    searchRadius,
    updateSearchRadius,
  } = useMonitoringSettings({
    columns: allColumns,
    remotePreferences: preferences,
    loadingPreferences,
    storageKey: columnStorageKey,
    savePreferences,
    defaultColumnKeys: EURO_ONE_DEFAULT_COLUMNS,
    alwaysVisibleKeys: ["client"],
  });

  const radiusValue = useMemo(() => clampRadius(searchRadius ?? DEFAULT_RADIUS), [clampRadius, searchRadius]);
  const persistMonitoringSnapshot = useCallback(
    (overrides = {}) => {
      if (loadingPreferences || typeof savePreferences !== "function") return;
      const resolvedColumns = overrides.columns || columnPrefs;
      const hasMapLayerOverride = Object.prototype.hasOwnProperty.call(overrides, "mapLayerKey");
      const nextMapLayerKey = hasMapLayerOverride ? overrides.mapLayerKey : mapLayerKey;
      const nextRadius = clampRadius(
        Object.prototype.hasOwnProperty.call(overrides, "searchRadius")
          ? overrides.searchRadius
          : radiusValue,
      );
      const nextLayout = normaliseLayoutVisibility(overrides.layoutVisibility || layoutVisibility);
      const nextSortingEnabled =
        typeof overrides.sortingEnabled === "boolean" ? overrides.sortingEnabled : sortingEnabled;
      const nextSort = overrides.sort || columnSort;
      const nextFilters = normalizeFilterState({
        filters: overrides.filters || columnFilters,
        sort: nextSort,
        quickFilters: overrides.quickFilters || {
          filterMode,
          routeFilter,
          securityFilters,
        },
        sortingEnabled: nextSortingEnabled,
      });

      savePreferences({
        monitoringTableColumns: resolvedColumns
          ? {
              visible: resolvedColumns.visible || {},
              order: Array.isArray(resolvedColumns.order) ? resolvedColumns.order : [],
              widths: resolvedColumns.widths && typeof resolvedColumns.widths === "object" ? resolvedColumns.widths : {},
            }
          : null,
        monitoringColumnWidths:
          resolvedColumns?.widths && typeof resolvedColumns.widths === "object"
            ? resolvedColumns.widths
            : null,
        monitoringDefaultFilters: nextFilters,
        monitoringLayoutVisibility: nextLayout,
        monitoringMapLayerKey: nextMapLayerKey || null,
        monitoringMapHeight: clampMapHeight(localMapHeight),
        monitoringSearchRadius: nextRadius,
      }).catch((error) => {
        console.warn("Falha ao salvar snapshot do monitoramento", error);
      });
    },
    [
      clampMapHeight,
      clampRadius,
      columnFilters,
      columnPrefs,
      columnSort,
      filterMode,
      layoutVisibility,
      loadingPreferences,
      localMapHeight,
      mapLayerKey,
      radiusValue,
      routeFilter,
      savePreferences,
      securityFilters,
      sortingEnabled,
    ],
  );
  const handleApplyColumns = useCallback(
    (nextPrefs) => {
      const applied = applyColumnsBase(nextPrefs);
      if (applied) {
        persistMonitoringSnapshot({ columns: applied });
      }
    },
    [applyColumnsBase, persistMonitoringSnapshot],
  );
  const handleRestoreColumns = useCallback(() => {
    const restored = restoreColumnsBase();
    if (restored) {
      persistMonitoringSnapshot({ columns: restored });
    }
  }, [persistMonitoringSnapshot, restoreColumnsBase]);

  const applyAddressTarget = useCallback((payload) => {
    const lat = Number(payload?.lat);
    const lng = Number(payload?.lng);
    if (!payload || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const radius = clampRadius(payload.radius ?? radiusValue);
    const raw = payload.raw && typeof payload.raw === "object" ? payload.raw : null;
    const boundingBox = normaliseBoundingBox(payload.viewport || raw?.boundingBox || raw?.boundingbox);
    const label = payload.formattedAddress || payload.description || payload.address || payload.label || "Local selecionado";
    const focusKey = buildAddressFocusKey(payload, lat, lng);
    const target = {
      lat,
      lng,
      label,
      address: label,
      radius,
      boundingBox,
    };
    setRegionTarget(target);
    setSelectedAddress(target);
    setAddressPin({
      lat,
      lng,
      label,
      key: focusKey,
    });

    mapControllerRef.current?.focusAddress?.({ lat, lng });

    setSelectedDeviceId(null);
    setDetailsDeviceId(null);
    setMapInvalidateKey((prev) => prev + 1);
  }, [buildAddressFocusKey, clampRadius, normaliseBoundingBox, radiusValue]);

  const handleSelectVehicleSuggestion = useCallback((option) => {
    if (!option) return;
    setVehicleQuery(option.label ?? "");
    const targetRow = decoratedRowsRef.current.find((item) => item.deviceId === option.deviceId);
    if (targetRow) {
      focusSelectedRowOnMap(targetRow, "GLOBAL_SEARCH_SELECT");
      pendingFocusDeviceIdRef.current = null;
    } else {
      pendingFocusDeviceIdRef.current = option.deviceId ?? null;
    }
    focusDevice(option.deviceId, { openDetails: true });
  }, [focusDevice, focusSelectedRowOnMap]);

  const handleAddressChange = useCallback((value) => {
    setAddressValue(value || { formattedAddress: "" });
  }, []);

  const handleSelectAddress = useCallback((option) => {
    if (!option) return;
    setAddressValue(option);
    applyAddressTarget(option);
  }, [applyAddressTarget]);

  const handleClearAddress = useCallback(() => {
    setAddressValue({ formattedAddress: "" });
    setRegionTarget(null);
    setAddressPin(null);
    setSelectedAddress(null);
    setNearbyDeviceIds([]);
  }, []);

  useEffect(() => {
    if (!regionTarget) {
      setNearbyDeviceIds((prev) => (prev.length ? [] : prev));
      return;
    }

    const radiusKm = clampRadius(regionTarget.radius ?? radiusValue) / 1000;
    const ids = rows
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
      .filter((r) => distanceKm(r.lat, r.lng, regionTarget.lat, regionTarget.lng) <= radiusKm)
      .map((r) => r.deviceId);

    setNearbyDeviceIds((prev) => {
      if (prev.length === ids.length && prev.every((id, index) => id === ids[index])) {
        return prev;
      }
      return ids;
    });
  }, [clampRadius, radiusValue, regionTarget, rows]);

  useEffect(() => {
    setRegionTarget((prev) => (prev ? { ...prev, radius: clampRadius(prev.radius ?? radiusValue) } : prev));
    setSelectedAddress((prev) => (prev ? { ...prev, radius: clampRadius(prev.radius ?? radiusValue) } : prev));
  }, [clampRadius, radiusValue]);

  const clearSelection = useCallback(() => {
    setSelectedDeviceId(null);
    setDetailsDeviceId(null);
    clearVehicleSelection();
    selectionRef.current = { vehicleId: null, deviceId: null };
  }, [clearVehicleSelection]);

  useEffect(() => {
    const next = Number.isFinite(mapHeightPercent)
      ? clampMapHeight(mapHeightPercent)
      : DEFAULT_MAP_HEIGHT;
    setLocalMapHeight(prev => (prev !== next ? next : prev));
  }, [mapHeightPercent]);

  useEffect(() => {
    setMapInvalidateKey((prev) => prev + 1);
  }, [layoutVisibility.showMap, layoutVisibility.showTable, localMapHeight]);

  const handleMapResize = useCallback(
    (value) => {
      const next = clampMapHeight(value);
      setLocalMapHeight(next);
      updateMapHeight(next);
    },
    [updateMapHeight],
  );

  const handleLayoutSave = useCallback(
    (payload) => {
      if (!payload) {
        setActivePopup(null);
        return;
      }
      const nextVisibility = normaliseLayoutVisibility(payload.visibility || layoutVisibility);
      applyLayoutVisibility(nextVisibility, { persist: true });

      if (Number.isFinite(payload.searchRadius)) {
        updateSearchRadius(clampRadius(payload.searchRadius));
      }

      if (payload.mapLayerKey && payload.mapLayerKey !== mapLayerKey) {
        setMapLayerKey(payload.mapLayerKey);
      }

      const nextFiltersEnabled = nextVisibility.showExcelFilters !== false;
      const nextSortingEnabled = nextFiltersEnabled
        ? typeof payload.sortingEnabled === "boolean"
          ? payload.sortingEnabled
          : sortingEnabled
        : false;
      const hasPayloadSortKey = Object.prototype.hasOwnProperty.call(payload, "sortKey");
      const requestedSortKey = hasPayloadSortKey
        ? payload.sortKey
          ? String(payload.sortKey)
          : null
        : columnSort?.key || null;
      const requestedSortDir = payload.sortDir === "asc" || payload.sortDir === "desc" ? payload.sortDir : null;
      let nextSort = columnSort;
      if (!nextSortingEnabled) {
        nextSort = { key: null, dir: null };
      } else if (requestedSortKey) {
        const fallbackDir =
          columnSort?.key === requestedSortKey && (columnSort?.dir === "asc" || columnSort?.dir === "desc")
            ? columnSort.dir
            : null;
        nextSort = { key: requestedSortKey, dir: requestedSortDir || fallbackDir || "asc" };
      } else {
        nextSort = { key: null, dir: null };
      }
      setColumnSort(nextSort);
      setSortingEnabled(nextSortingEnabled);
      persistFilterState(
        columnFilters,
        nextSort,
        { filterMode, routeFilter, securityFilters },
        nextSortingEnabled,
      );
      persistMonitoringSnapshot({
        layoutVisibility: nextVisibility,
        searchRadius: Number.isFinite(payload.searchRadius) ? payload.searchRadius : radiusValue,
        mapLayerKey: payload.mapLayerKey && payload.mapLayerKey !== mapLayerKey ? payload.mapLayerKey : mapLayerKey,
        sort: nextSort,
        sortingEnabled: nextSortingEnabled,
      });
      setActivePopup(null);
    },
    [
      applyLayoutVisibility,
      clampRadius,
      columnFilters,
      columnSort,
      filterMode,
      layoutVisibility,
      mapLayerKey,
      persistMonitoringSnapshot,
      persistFilterState,
      radiusValue,
      routeFilter,
      securityFilters,
      sortingEnabled,
      updateSearchRadius,
    ],
  );

  const visibleColumnsWithWidths = useMemo(() => {
    const list = Array.isArray(visibleColumns) ? visibleColumns : [];

    return list.map(col => {
      const preferredWidth = columnPrefs.widths?.[col.key];
      const widthCandidates = [preferredWidth, col.width, getColumnBaseWidth(col.key)];
      const resolvedWidth = widthCandidates.find((value) => Number.isFinite(value) && value > 0) ?? DEFAULT_COLUMN_WIDTH;
      const minWidth = getColumnMinWidth(col.key);

      return {
        ...col,
        width: Math.max(minWidth, resolvedWidth),
        minWidth,
      };
    });
  }, [columnPrefs.widths, visibleColumns]);

  const sortableColumns = useMemo(
    () => visibleColumnsWithWidths.map((col) => col.key).filter((key) => key !== "actions"),
    [visibleColumnsWithWidths],
  );
  const sortColumnOptions = useMemo(
    () =>
      telemetryColumns
        .filter((col) => col.key !== "actions")
        .map((col) => ({ key: col.key, label: col.label || col.key })),
    [telemetryColumns],
  );

  const stableColumnWidths = useMemo(() => columnPrefs.widths || {}, [columnPrefs.widths]);

  const tableHeightPercent = useMemo(
    () => (layoutVisibility.showMap ? Math.max(10, 100 - localMapHeight) : 100),
    [layoutVisibility.showMap, localMapHeight],
  );

  const sortedRows = useMemo(() => {
    const sortKey = effectiveSortingEnabled ? columnSort?.key : null;
    const sortDir = effectiveSortingEnabled ? columnSort?.dir : null;
    if (!sortKey || !sortDir) return filteredRows;
    const column = telemetryColumns.find((col) => col.key === sortKey);
    const filterType = column?.filterType || resolveFilterType(sortKey);
    const direction = sortDir === "desc" ? -1 : 1;
    const resolveComparable = (row) => {
      const rawValue =
        column?.getFilterValue?.(row, { t, locale }) ??
        resolveFilterValueForKey(sortKey, row) ??
        row?.[sortKey];
      const displayValue = normalizeDisplayValue(rawValue, t);
      if (filterType === "number") {
        const numeric = Number(rawValue ?? displayValue);
        return Number.isFinite(numeric) ? numeric : null;
      }
      if (filterType === "date") {
        const candidate = rawValue ?? displayValue;
        if (!candidate) return null;
        const time = candidate instanceof Date ? candidate.getTime() : new Date(candidate).getTime();
        return Number.isFinite(time) ? time : null;
      }
      return String(displayValue || "").trim().toLowerCase();
    };
    return [...filteredRows].sort((a, b) => {
      const left = resolveComparable(a);
      const right = resolveComparable(b);
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      if (left === right) return 0;
      return left > right ? direction : -direction;
    });
  }, [columnSort?.dir, columnSort?.key, effectiveSortingEnabled, filteredRows, locale, t, telemetryColumns]);

  const totalRows = sortedRows.length;
  const isAdminContext = isGlobalAdmin || isMirrorReceiver;
  const accessReason = vehiclesAccessReason || mirrorAccessReason || resolveAccessReason(vehiclesError);
  const noVehiclesReason = vehiclesReason || accessListReason;
  const hasAccessIssue = isBlockingAccessReason(accessReason);
  const showNoVehiclesState = !vehiclesLoading && !hasAccessIssue && isNoVehiclesReason(noVehiclesReason);
  const effectivePageSize = pageSize === "all" ? totalRows || 1 : pageSize;
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(totalRows / pageSize));
  const safePageIndex = Math.min(pageIndex, Math.max(totalPages - 1, 0));
  const pageStart = totalRows === 0 ? 0 : safePageIndex * effectivePageSize + 1;
  const pageEnd = totalRows === 0 ? 0 : Math.min(totalRows, pageStart + effectivePageSize - 1);
  const paginatedRows = pageSize === "all"
    ? sortedRows
    : sortedRows.slice(safePageIndex * pageSize, safePageIndex * pageSize + pageSize);

  useEffect(() => {
    setPageIndex(0);
  }, [pageSize, sortedRows.length]);

  const gridTemplateRows = useMemo(() => {
    if (layoutVisibility.showMap && layoutVisibility.showTable) {
      return `${localMapHeight}% 12px minmax(0, ${tableHeightPercent}%)`;
    }
    if (layoutVisibility.showMap) return "minmax(0, 1fr)";
    if (layoutVisibility.showTable) return "minmax(0, 1fr)";
    return "1fr";
  }, [layoutVisibility.showMap, layoutVisibility.showTable, localMapHeight, tableHeightPercent]);

  const handleLogout = useCallback(async () => {
    await logout();
    navigate("/login");
  }, [logout, navigate]);

  if (loadingPreferences) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0b0f17] px-6 py-10">
        <DataState
          tone="muted"
          state="loading"
          title="Carregando preferências do monitoramento"
          description="Aplicando layout, filtros e mapa salvos."
        />
      </div>
    );
  }

  if (hasAccessIssue) {
    const accessBullets = isAdminContext
      ? [
          "Revise o status do usuário (ativo/bloqueado/expirado) e as permissões do perfil.",
          "Se o tenant estiver inativo/bloqueado, regularize o acesso antes de prosseguir.",
          "Caso seja um usuário de cliente, valide as regras do tenant selecionado.",
        ]
      : [
          "Seu tempo de acesso ao sistema pode ter expirado.",
          "Para liberação, procure o administrador ou o setor de gestão de acesso da sua empresa para avaliação e reativação.",
        ];
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 bg-[#0b0f17] px-6 py-10 text-white">
        <AlertStateCard
          title="Alerta de Usuário"
          text={isAdminContext ? "Acesso expirado, bloqueado ou sem permissão" : "Acesso expirado ou bloqueado"}
          bullets={accessBullets}
          actions={(
            <>
              <Button onClick={handleLogout}>Sair</Button>
              <Button variant="secondary" onClick={handleLogout}>Voltar ao login</Button>
            </>
          )}
        />
      </div>
    );
  }

  if (showNoVehiclesState) {
    const vehicleBullets = isAdminContext
      ? [
          "Confirme se existe equipamento com sinal e se o veículo foi vinculado corretamente.",
          "Verifique permissões do usuário e se o veículo está liberado para monitoramento no tenant selecionado.",
          "Se necessário, realize o vínculo/atribuição do veículo ao usuário.",
        ]
      : [
          "Apenas veículos vinculados/liberados ao seu usuário aparecem na lista e no mapa.",
          "Se não visualizar o veículo, verifique se foi transferido sinal do equipamento e se ocorreu o vínculo ao seu usuário pelo administrador do sistema.",
        ];
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 bg-[#0b0f17] px-6 py-10 text-white">
        <AlertStateCard
          title="Alerta Vínculo de Veículo"
          text={isAdminContext ? "Nenhum veículo disponível para este cliente/usuário" : "Nenhum veículo vinculado para monitoramento"}
          bullets={vehicleBullets}
          actions={isAdminContext ? (
            <Link to="/equipamentos?link=unlinked" className="btn btn-outline">
              Ir para vínculos
            </Link>
          ) : null}
        />
        <button
          type="button"
          onClick={reload}
          className="text-xs text-white/70 underline underline-offset-4 hover:text-white"
        >
          Atualizar telemetria
        </button>
      </div>
    );
  }

  return (
    <div
      className="relative grid h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-[#0b0f17]"
      style={{ gridTemplateRows }}
    >
      {layoutVisibility.showMap && (
        <div className="relative min-h-0 h-full min-w-0 overflow-hidden border-b border-white/10">
          <MonitoringMap
            ref={mapControllerRef}
            markers={markers}
            focusMarkerId={selectedDeviceId}
            mapViewport={mapViewport}
            onViewportChange={setMapViewport}
            regionTarget={regionTarget}
            onMarkerSelect={handleMarkerSelect}
            onMarkerOpenDetails={handleMarkerDetails}
            mapLayer={mapLayer}
            addressMarker={addressPin}
            itineraryOverlay={showOfficialOverlay ? itineraryOverlayState.overlay : null}
            itineraryOverlayFocusPoint={
              showOfficialOverlay && detailsVehicle && Number.isFinite(detailsVehicle.lat) && Number.isFinite(detailsVehicle.lng)
                ? { lat: detailsVehicle.lat, lng: detailsVehicle.lng }
                : null
            }
            itineraryDebugOverlay={shouldShowDebugOverlay ? itineraryDebugOverlayState.overlay : null}
            itineraryDebugOverlayFocusPoint={
              shouldShowDebugOverlay && detailsVehicle && Number.isFinite(detailsVehicle.lat) && Number.isFinite(detailsVehicle.lng)
                ? { lat: detailsVehicle.lat, lng: detailsVehicle.lng }
                : null
            }
            itineraryDebugBadge={itineraryDebugBadge}
            invalidateKey={mapInvalidateKey}
            mapPreferences={mapPreferences}
          />

          {!layoutVisibility.showTable && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col gap-2 overflow-visible px-3 py-2 lg:pr-28">
              <div className="flex flex-col items-start gap-2 overflow-visible lg:flex-row lg:flex-wrap lg:items-center lg:gap-3">
                <div className="pointer-events-auto flex w-full flex-col gap-2 overflow-visible lg:w-auto lg:flex-row lg:flex-wrap lg:items-center">
                  <MonitoringSearchBox
                    value={vehicleQuery}
                    onChange={handleVehicleSearchChange}
                    placeholder={t("monitoring.searchPlaceholderSimple")}
                    suggestions={vehicleSuggestions}
                    onSelectSuggestion={handleSelectVehicleSuggestion}
                    containerClassName="bg-black/70 backdrop-blur-md"
                  />

                  <AddressAutocomplete
                    label={null}
                    value={addressValue}
                    onChange={handleAddressChange}
                    onSelect={handleSelectAddress}
                    onClear={handleClearAddress}
                    containerClassName="bg-black/70 backdrop-blur-md"
                    variant="toolbar"
                    mapPreferences={mapPreferences}
                  />
                </div>

                <div className="pointer-events-auto flex items-center gap-2 overflow-visible">
                  <button
                    ref={layoutButtonRef}
                    type="button"
                    onClick={() => handleTogglePopup("layout")}
                    className={`
                      flex h-10 w-10 items-center justify-center rounded-md border text-xs leading-none transition-all
                      ${activePopup === "layout"
                        ? "bg-primary/20 text-white border-primary/50 shadow-inner shadow-primary/20"
                        : "bg-black/60 text-white/70 border-white/20 hover:text-white hover:border-white/40"}
                    `}
                    title="Layout"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="16" rx="2" />
                      <line x1="3" y1="11" x2="21" y2="11" />
                      <line x1="12" y1="4" x2="12" y2="20" />
                    </svg>
                  </button>
                  {selectedDeviceId ? (
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="flex h-10 items-center justify-center rounded-md border border-white/20 bg-black/60 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/70 transition hover:border-white/40 hover:text-white"
                      title="Limpar seleção"
                    >
                      Limpar
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {layoutVisibility.showMap && layoutVisibility.showTable && (
        <MapTableSplitter onResize={handleMapResize} currentPercent={localMapHeight} />
      )}

      {layoutVisibility.showTable && (
        <div className="relative z-20 flex h-full min-h-0 min-w-0 flex-col overflow-visible bg-[#0f141c]">
          <div className="relative z-30 overflow-visible border-b border-white/10 px-3 py-2">
            {tasksError ? (
              <div className="pb-2">
                <DataState
                  tone="error"
                  state="error"
                  compact
                  title={t("tasks.loadError")}
                  description={tasksError.message}
                  action={
                    <button
                      type="button"
                      onClick={reloadTasks}
                      className="text-xs font-semibold uppercase tracking-[0.08em] text-red-200 hover:text-red-100"
                    >
                      {t("refresh")}
                    </button>
                  }
                />
              </div>
            ) : null}
            {layoutVisibility.showToolbar ? (
              <MonitoringToolbar
                vehicleSearchTerm={vehicleQuery}
                onVehicleSearchChange={handleVehicleSearchChange}
                vehicleSuggestions={vehicleSuggestions}
                onSelectVehicleSuggestion={handleSelectVehicleSuggestion}
                addressValue={addressValue}
                onAddressChange={handleAddressChange}
                onSelectAddress={handleSelectAddress}
                filterMode={filterMode}
                onFilterChange={setFilterMode}
                summary={summary}
                activePopup={activePopup}
                onTogglePopup={handleTogglePopup}
                layoutButtonRef={layoutButtonRef}
                onClearAddress={handleClearAddress}
                hasSelection={Boolean(selectedDeviceId)}
                onClearSelection={clearSelection}
                mapPreferences={mapPreferences}
                onClearFilters={clearAllFilters}
                filtersActive={hasActiveFilters}
              />
            ) : (
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
                <div className="flex w-full flex-1 flex-wrap gap-2">
                  <MonitoringSearchBox
                    value={vehicleQuery}
                    onChange={handleVehicleSearchChange}
                    placeholder={t("monitoring.searchPlaceholderSimple")}
                    suggestions={vehicleSuggestions}
                    onSelectSuggestion={handleSelectVehicleSuggestion}
                  />

                  <AddressAutocomplete
                    label={null}
                    value={addressValue}
                    onChange={handleAddressChange}
                    onSelect={handleSelectAddress}
                    onClear={handleClearAddress}
                    variant="toolbar"
                    mapPreferences={mapPreferences}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleTogglePopup("columns")}
                    className={`flex h-10 w-10 items-center justify-center rounded-md border text-xs leading-none transition ${
                      activePopup === "columns"
                        ? "bg-primary/20 text-white border-primary/50 shadow-inner shadow-primary/20"
                        : "bg-[#0d1117] text-white/60 border-white/15 hover:text-white hover:border-white/40"
                    }`}
                    title="Colunas"
                    aria-label="Selecionar colunas"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="5" width="5" height="14" rx="1" />
                      <rect x="10" y="5" width="5" height="14" rx="1" />
                      <rect x="17" y="5" width="4" height="14" rx="1" />
                    </svg>
                  </button>
                  <button
                    ref={layoutButtonRef}
                    type="button"
                    onClick={() => handleTogglePopup("layout")}
                    className={`flex h-10 w-10 items-center justify-center rounded-md border text-xs leading-none transition ${
                      activePopup === "layout"
                        ? "bg-primary/20 text-white border-primary/50 shadow-inner shadow-primary/20"
                        : "bg-[#0d1117] text-white/60 border-white/15 hover:text-white hover:border-white/40"
                    }`}
                    title="Layout"
                    aria-label="Abrir layout"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="16" rx="2" />
                      <line x1="3" y1="11" x2="21" y2="11" />
                      <line x1="12" y1="4" x2="12" y2="20" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    disabled={!hasActiveFilters}
                    className="flex h-10 items-center justify-center rounded-md border border-white/15 bg-[#0d1117] px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/70 transition hover:border-white/30 hover:text-white disabled:opacity-40"
                    title="Limpar filtros"
                    aria-label="Limpar filtros"
                  >
                    Limpar filtros
                  </button>
                  {selectedDeviceId ? (
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="flex h-10 w-10 items-center justify-center rounded-md border border-white/15 bg-[#0d1117] text-[10px] font-semibold uppercase tracking-[0.08em] text-white/70 transition hover:border-white/30 hover:text-white"
                      title="Limpar seleção"
                      aria-label="Limpar seleção"
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div className="relative z-10 flex-1 min-h-0 min-w-0 overflow-hidden">
            <div className="h-full min-h-0 min-w-0 overflow-hidden">
              <MonitoringTable
                rows={paginatedRows}
                columns={visibleColumnsWithWidths}
                selectedDeviceId={selectedDeviceId}
                onSelect={handleSelectRow}
                onRowClick={handleRowClick}
                loading={loading}
                emptyText={t("monitoring.emptyState")}
                columnWidths={stableColumnWidths}
                onColumnWidthChange={updateColumnWidth}
                columnFilters={effectiveColumnFilters}
                onColumnFilterChange={updateColumnFilter}
                columnFilterOptions={columnValueOptions}
                sortKey={effectiveSortingEnabled ? columnSort?.key : null}
                sortDir={effectiveSortingEnabled ? columnSort?.dir : null}
                onSortChange={effectiveSortingEnabled ? handleSortChange : undefined}
                sortableColumns={sortableColumns}
                filtersEnabled={filtersEnabled}
              />
            </div>
          </div>

          <PaginationFooter
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            pageIndex={safePageIndex}
            totalPages={totalPages}
            onPageChange={setPageIndex}
            pageStart={pageStart}
            pageEnd={pageEnd}
            totalRows={totalRows}
          />
        </div>
      )}

      {activePopup === "layout" && (
        <MonitoringLayoutSelector
          layoutVisibility={layoutVisibility}
          searchRadius={radiusValue}
          mapLayerSections={MAP_LAYER_SECTIONS}
          mapLayers={ENABLED_MAP_LAYERS}
          activeMapLayer={mapLayer.key}
          sortingEnabled={filtersEnabled ? sortingEnabled : false}
          sortKey={filtersEnabled ? columnSort?.key || null : null}
          sortDirection={columnSort?.dir || null}
          sortOptions={sortColumnOptions}
          onSave={handleLayoutSave}
          onClose={() => setActivePopup(null)}
        />
      )}

      {activePopup === "columns" && (
        <MonitoringColumnSelector
          columns={allColumns}
          columnPrefs={columnPrefs}
          defaultPrefs={columnDefaults}
          onApply={handleApplyColumns}
          onRestore={handleRestoreColumns}
          onClose={() => setActivePopup(null)}
          lockedKeys={["client"]}
        />
      )}

      {drawerMounted && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[11000] flex h-full items-stretch justify-end">
              <button
                type="button"
                aria-label="Fechar painel de detalhes do veículo"
                className={`flex-1 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${drawerVisible ? "opacity-100" : "opacity-0"}`}
                onClick={closeDetails}
              />
              <div
                className={`pointer-events-auto relative h-full w-full min-w-[320px] max-w-[960px] overflow-hidden bg-[#0b0f17] shadow-2xl transition-transform duration-300 ease-out sm:w-[60vw] sm:min-w-[420px] ${
                  drawerVisible ? "translate-x-0" : "translate-x-full"
                }`}
                onClick={(event) => event.stopPropagation()}
                onTransitionEnd={() => {
                  if (!isDetailsOpen) {
                    setDrawerMounted(false);
                  }
                }}
              >
                <VehicleDetailsDrawer
                  vehicle={detailsVehicle}
                  onClose={closeDetails}
                  floating={false}
                  itineraryOverlayState={itineraryOverlayState}
                  onItineraryOverlayChange={handleItineraryOverlayChange}
                  itineraryDebugOverlayState={itineraryDebugOverlayState}
                  onItineraryDebugOverlayChange={handleItineraryDebugOverlayChange}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
