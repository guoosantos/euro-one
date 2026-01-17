import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Globe } from "lucide-react";
import { useTranslation } from "../lib/i18n.js";

import MonitoringMap from "../components/map/MonitoringMap.jsx";
import MonitoringTable from "../components/monitoring/MonitoringTable.jsx";
import MonitoringToolbar, { MonitoringSearchBox } from "../components/monitoring/MonitoringToolbar.jsx";
import MonitoringColumnSelector from "../components/monitoring/MonitoringColumnSelector.jsx";
import MonitoringLayoutSelector from "../components/monitoring/MonitoringLayoutSelector.jsx";
import MapTableSplitter from "../components/monitoring/MapTableSplitter.jsx";
import VehicleDetailsDrawer from "../components/monitoring/VehicleDetailsDrawer.jsx";
import AddressSearchInput, { useAddressSearchState } from "../components/shared/AddressSearchInput.jsx";
import DataState from "../ui/DataState.jsx";

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
import { matchesTenant } from "../lib/tenancy.js";
import {
  DEFAULT_MAP_LAYER_KEY,
  ENABLED_MAP_LAYERS,
  MAP_LAYER_FALLBACK,
  MAP_LAYER_SECTIONS,
  MAP_LAYER_STORAGE_KEYS,
  getValidMapLayer,
} from "../lib/mapLayers.js";

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
  minutesSince,
  pickCoordinate,
  pickSpeed,
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
};
const MIN_MAP_HEIGHT = 20;
const MAX_MAP_HEIGHT = 80;
const DEFAULT_RADIUS = 500;
const MIN_RADIUS = 50;
const MAX_RADIUS = 5000;
const MAP_LAYER_STORAGE_KEY = MAP_LAYER_STORAGE_KEYS.monitoring;
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
const normaliseLayoutVisibility = (value = {}) => ({
  showMap: value.showMap !== false,
  showTable: value.showTable !== false,
  showToolbar: value.showToolbar !== false,
  showTopbar: value.showTopbar !== false,
});

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
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const { tenantId, user, tenant } = useTenant();
  const { telemetry, loading, reload } = useTelemetry();
  const safeTelemetry = useMemo(() => (Array.isArray(telemetry) ? telemetry : []), [telemetry]);
  const { tasks } = useTasks(useMemo(() => ({ clientId: tenantId }), [tenantId]));
  const { vehicles } = useVehicles();
  const { alerts: pendingAlerts } = useAlerts({
    params: { status: "pending" },
    refreshInterval: 30_000,
  });
  const { alerts: conjugatedAlerts } = useConjugatedAlerts({
    params: { windowHours: 5 },
    refreshInterval: 60_000,
  });
  const mapPreferences = useMemo(() => resolveMapPreferences(tenant?.attributes), [tenant?.attributes]);

  const activeTasks = useMemo(
    () =>
      Array.isArray(tasks)
        ? tasks.filter((task) => !String(task.status || "").toLowerCase().includes("final"))
        : [],
    [tasks],
  );

  const routesByVehicle = useMemo(() => {
    const map = new Map();
    activeTasks.forEach((task) => {
      const key = String(task.vehicleId ?? task.deviceId ?? task.device?.id ?? task.device?.deviceId ?? "");
      if (key) map.set(key, task);
    });
    return map;
  }, [activeTasks]);

  const vehiclesById = useMemo(() => {
    const map = new Map();
    vehicles.forEach((vehicle) => {
      if (vehicle?.id !== null && vehicle?.id !== undefined) {
        map.set(String(vehicle.id), vehicle);
      }
    });
    return map;
  }, [vehicles]);

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

  const { preferences, loading: loadingPreferences, savePreferences } = useUserPreferences();
  const setMonitoringTopbarVisible = useUI((state) => state.setMonitoringTopbarVisible);

  const [vehicleQuery, setVehicleQuery] = useState("");
  const addressSearch = useAddressSearchState({ mapPreferences });
  const clearAddressSearch = addressSearch?.onClear;
  const [selectedAddress, setSelectedAddress] = useState(null);
  const [filterMode, setFilterMode] = useState("all");
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
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [pageIndex, setPageIndex] = useState(0);
  const [routeFilter, setRouteFilter] = useState(null);
  const [securityFilters, setSecurityFilters] = useState([]);
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
    setVehicleQuery("");
    clearAddressSearch?.();
    setSelectedAddress(null);
    setFilterMode("all");
    setSelectedDeviceId(null);
    setMapViewport(null);
    setRegionTarget(null);
    setAddressPin(null);
    setNearbyDeviceIds([]);
    setDetailsDeviceId(null);
    setPageIndex(0);
    setRouteFilter(null);
    setSecurityFilters([]);
    clearVehicleSelection();
  }, [clearAddressSearch, clearVehicleSelection, tenantId]);

  // Controle de Popups
  const [activePopup, setActivePopup] = useState(null); // 'columns' | 'layout' | null
  const layoutButtonRef = useRef(null);

  const [layoutVisibility, setLayoutVisibility] = useState(() => ({ ...DEFAULT_LAYOUT_VISIBILITY }));
  const [layoutSaveRequestedAt, setLayoutSaveRequestedAt] = useState(null);
  const layoutHydratedRef = useRef(false);
  const layoutStorageKey = useMemo(
    () => `${LAYOUT_STORAGE_KEY}:${tenantId || "global"}:${user?.id || "anon"}`,
    [tenantId, user?.id],
  );
  const columnStorageKey = useMemo(
    () => `monitoring.table.columns:${tenantId || "global"}:${user?.id || "anon"}`,
    [tenantId, user?.id],
  );

  const layoutsEqual = useCallback((a, b) => {
    return (
      a?.showMap === b?.showMap &&
      a?.showTable === b?.showTable &&
      a?.showToolbar === b?.showToolbar &&
      a?.showTopbar === b?.showTopbar
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
  }, [layoutStorageKey]);

  useEffect(() => {
    if (loadingPreferences) return;
    if (layoutHydratedRef.current) return;
    const storedLayout = loadLayoutVisibility(layoutStorageKey);
    const remote = preferences?.monitoringLayoutVisibility;

    if (storedLayout) {
      applyLayoutVisibility({ ...DEFAULT_LAYOUT_VISIBILITY, ...storedLayout }, { persist: false });
      layoutHydratedRef.current = true;
      return;
    }

    if (remote) {
      applyLayoutVisibility({ ...DEFAULT_LAYOUT_VISIBILITY, ...remote }, { persist: false });
    } else {
      applyLayoutVisibility((prev) => normaliseLayoutVisibility(prev), { persist: false });
    }
    layoutHydratedRef.current = true;
  }, [applyLayoutVisibility, layoutStorageKey, loadingPreferences, preferences?.monitoringLayoutVisibility]);

  useEffect(() => {
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
    try {
      const storedLayer = localStorage.getItem(MAP_LAYER_STORAGE_KEY);
      setMapLayerKey(getValidMapLayer(storedLayer));
    } catch (_error) {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(MAP_LAYER_STORAGE_KEY, mapLayerKey);
    } catch (_error) {
      // ignore
    }
  }, [mapLayerKey]);

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
    .filter((entry) =>
      matchesTenant(entry?.device, tenantId) ||
      matchesTenant(entry?.vehicle, tenantId) ||
      matchesTenant(entry?.source, tenantId),
    ), [safeTelemetry, tenantId, vehiclesById]);

  const linkedTelemetry = useMemo(
    () =>
      normalizedTelemetry.filter((entry) => {
        const deviceKey = getDeviceKey(entry.device);
        if (!deviceKey) return false;
        return isLinkedToVehicle(entry);
      }),
    [normalizedTelemetry],
  );

  const vehicleOptions = useMemo(
    () =>
      linkedTelemetry.map(({ device, vehicle }) => {
        const name = device.name ?? device.alias ?? "";
        const plate = device.plate ?? device.registrationNumber ?? vehicle?.plate ?? "";
        const identifier = device.identifier ?? device.uniqueId ?? "";
        const clientName =
          device.clientName ||
          device.client?.name ||
          vehicle?.clientName ||
          vehicle?.client?.name ||
          "";
        const label = plate || "Sem placa";
        const descriptionParts = [name || identifier, clientName].filter(Boolean);
        const description = descriptionParts.length ? descriptionParts.join(" · ") : undefined;
        const searchValue = `${label} ${plate} ${name} ${identifier} ${clientName}`.toLowerCase();
        return { type: "vehicle", deviceId: getDeviceKey(device), label, description, searchValue };
      }),
    [linkedTelemetry],
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
      const activeTask = deviceKey ? routesByVehicle.get(String(deviceKey)) : null;
      const hasRoute = Boolean(activeTask);
      const startExpected = activeTask?.startTimeExpected ? Date.parse(activeTask.startTimeExpected) : null;
      const endExpected = activeTask?.endTimeExpected ? Date.parse(activeTask.endTimeExpected) : null;
      const statusText = String(activeTask?.status || "").toLowerCase();
      const routeDelay = Boolean(hasRoute && startExpected && now > startExpected && !statusText.includes("final"));
      const routeDeviation = Boolean(hasRoute && endExpected && now > endExpected && !statusText.includes("final"));
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

      if (routeFilter === "active" && !hasRoute) return false;
      if (routeFilter === "with_signal" && (!hasRoute || !online)) return false;
      if (routeFilter === "without_signal" && (!hasRoute || online)) return false;

      if (securityFilters.length) {
        const matchesSecurity = securityFilters.some((filter) => {
          if (filter === "jammer") return alarmText.includes("jam");
          if (filter === "violation") return alarmText.includes("viol");
          if (filter === "face") return alarmText.includes("face");
          if (filter === "blocked") return isBlocked;
          if (filter === "routeDeviation") return routeDeviation;
          if (filter === "routeDelay") return routeDelay;
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
        plate: device.plate ?? "—",
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
  }, [buildCoordKey, filteredDevices, locale, t]);

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

  const detailsVehicle = useMemo(
    () => decoratedRows.find(item => item.deviceId === detailsDeviceId) || null,
    [decoratedRows, detailsDeviceId],
  );

  const isDetailsOpen = Boolean(detailsDeviceId);
  const closeDetails = useCallback(() => {
    setDetailsDeviceId(null);
    setSelectedDeviceId(null);
    clearVehicleSelection();
  }, [clearVehicleSelection]);

  const openDetailsFor = useCallback((deviceId) => {
    setDetailsDeviceId(deviceId);
  }, []);

  const focusDevice = useCallback(
    (deviceId, { openDetails = false, allowToggle = true } = {}) => {
      const normalizedDeviceId = deviceId ? String(deviceId) : null;
      if (!normalizedDeviceId) return;
      const isAlreadySelected = selectedDeviceIdRef.current === normalizedDeviceId;

      if (isAlreadySelected && allowToggle) {
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
    return displayRows
      .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng))
      .map(r => {
        const status = r.statusBadge;
        const statusLabel = status === "online"
          ? t("monitoring.filters.online")
          : status === "alert"
            ? t("monitoring.filters.alerts")
            : t("monitoring.filters.offline");

        const ignitionColor =
          r.ignition === true ? "#22c55e" : r.ignition === false ? "#ef4444" : "#94a3b8";
        const markerIconType = resolveMarkerIconType(
          {
            iconType: r.iconType,
            vehicleType: r.vehicleType,
            type: r.device?.type || r.vehicle?.type,
            category: r.vehicle?.category,
            attributes: r.attributes || r.device?.attributes || {},
          },
          [r.vehicleType, r.attributes?.vehicleType, r.vehicle?.category],
        );

        const plateLabel = (r.vehicle?.plate ?? r.device?.plate ?? r.plate ?? "").trim() || "Sem placa";
        const vehicleName = r.vehicle?.name || r.vehicle?.item || r.device?.vehicle?.name || null;
        const vehicleLabel = vehicleName || plateLabel;
        const modelLabel = [r.vehicle?.brand, r.vehicle?.model].filter(Boolean).join(" ") || r.vehicle?.model || "—";
        const eventDefinition = resolveEventDefinitionFromPayload(r.position || r.device?.position || {});
        const eventTime = getEventTime(r.position || r.device?.position || null);
        const ignitionLabel =
          r.ignition === true ? "Ligada" : r.ignition === false ? "Desligada" : "—";

        return {
          id: r.deviceId,
          lat: r.lat,
          lng: r.lng,
          label: vehicleLabel,
          mapLabel: plateLabel,
          plate: plateLabel,
          model: modelLabel,
          address: r.address,
          speedLabel: `${r.speed ?? 0} km/h`,
          lastUpdateLabel: formatDateTime(r.lastUpdate, locale),
          ignitionLabel,
          lastEventLabel: eventDefinition?.label || "—",
          lastEventTimeLabel: eventTime ? formatDateTime(eventTime, locale) : "—",
          color: ignitionColor,
          accentColor: r.deviceId === selectedDeviceId ? "#f97316" : r.isNearby ? "#22d3ee" : undefined,
          muted: !r.isOnline,
          statusLabel,
          iconType: markerIconType,
          heading: r.heading,
        };
      });
  }, [displayRows, locale, selectedDeviceId, t]);

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
      total: displayRows.length,
    };

    displayRows.forEach((row) => {
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
  }, [displayRows, pendingAlerts.length, conjugatedAlerts.length]);

  // --- Configuração de Colunas ---
  const telemetryColumns = useMemo(() =>
    TELEMETRY_COLUMNS.map(col => {
      const overrideKey = COLUMN_LABEL_OVERRIDES[col.key];
      const translated = overrideKey ? t(overrideKey) : t(col.labelKey);
      const label = COLUMN_LABEL_FALLBACKS[translated] || COLUMN_LABEL_FALLBACKS[col.labelKey] || translated;

      return {
        ...col,
        width: getColumnBaseWidth(col.key),
        minWidth: getColumnMinWidth(col.key),
        label,
        render: row => col.getValue(row, { t, locale }),
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
    restoreColumns,
    moveColumn,
    updateColumnWidth,
    mapHeightPercent,
    updateMapHeight,
    applyColumns,
    searchRadius,
    updateSearchRadius,
  } = useMonitoringSettings({
    columns: allColumns,
    remotePreferences: preferences,
    loadingPreferences,
    storageKey: columnStorageKey,
    savePreferences,
    defaultColumnKeys: EURO_ONE_DEFAULT_COLUMNS,
  });

  const radiusValue = useMemo(() => clampRadius(searchRadius ?? DEFAULT_RADIUS), [clampRadius, searchRadius]);

  const applyAddressTarget = useCallback((payload) => {
    const lat = Number(payload?.lat);
    const lng = Number(payload?.lng);
    if (!payload || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const radius = clampRadius(payload.radius ?? radiusValue);
    const boundingBox = normaliseBoundingBox(payload.viewport || payload.boundingBox || payload.boundingbox);
    const focusKey = buildAddressFocusKey(payload, lat, lng);
    const target = {
      lat,
      lng,
      label: payload.label,
      address: payload.description || payload.address || payload.label,
      radius,
      boundingBox,
    };
    setRegionTarget(target);
    setSelectedAddress(target);
    setAddressPin({
      lat,
      lng,
      label: payload.label || payload.description || "Local selecionado",
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

  const handleSelectAddress = useCallback((option) => {
    if (!option) return;
    applyAddressTarget(option);
  }, [applyAddressTarget]);

  const handleClearAddress = useCallback(() => {
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

  const stableColumnWidths = useMemo(() => columnPrefs.widths || {}, [columnPrefs.widths]);

  const tableHeightPercent = useMemo(
    () => (layoutVisibility.showMap ? Math.max(10, 100 - localMapHeight) : 100),
    [layoutVisibility.showMap, localMapHeight],
  );

  const totalRows = displayRows.length;
  const hasLinkedVehicles = linkedTelemetry.length > 0;
  const showNoLinkedState = !loading && !hasLinkedVehicles;
  const effectivePageSize = pageSize === "all" ? totalRows || 1 : pageSize;
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(totalRows / pageSize));
  const safePageIndex = Math.min(pageIndex, Math.max(totalPages - 1, 0));
  const pageStart = totalRows === 0 ? 0 : safePageIndex * effectivePageSize + 1;
  const pageEnd = totalRows === 0 ? 0 : Math.min(totalRows, pageStart + effectivePageSize - 1);
  const paginatedRows = pageSize === "all"
    ? displayRows
    : displayRows.slice(safePageIndex * pageSize, safePageIndex * pageSize + pageSize);

  useEffect(() => {
    setPageIndex(0);
  }, [pageSize, displayRows.length]);

  const gridTemplateRows = useMemo(() => {
    if (layoutVisibility.showMap && layoutVisibility.showTable) {
      return `${localMapHeight}% 8px minmax(0, ${tableHeightPercent}%)`;
    }
    if (layoutVisibility.showMap) return "minmax(0, 1fr)";
    if (layoutVisibility.showTable) return "minmax(0, 1fr)";
    return "1fr";
  }, [layoutVisibility.showMap, layoutVisibility.showTable, localMapHeight, tableHeightPercent]);

  if (showNoLinkedState) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 bg-[#0b0f17] px-6 py-10 text-white">
        <DataState
          tone="muted"
          state="info"
          title="Nenhum veículo vinculado para monitoramento"
          description="Somente veículos com equipamento vinculado aparecem na lista e no mapa."
          action={(
            <Link
              to="/equipamentos?link=unlinked"
              className="inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-white hover:border-primary/60"
            >
              Vincular equipamento a um veículo
            </Link>
          )}
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

                  <AddressSearchInput
                    state={addressSearch}
                    onSelect={handleSelectAddress}
                    onClear={handleClearAddress}
                    containerClassName="bg-black/70 backdrop-blur-md"
                    variant="toolbar"
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
            {layoutVisibility.showToolbar ? (
              <MonitoringToolbar
                vehicleSearchTerm={vehicleQuery}
                onVehicleSearchChange={handleVehicleSearchChange}
                vehicleSuggestions={vehicleSuggestions}
                onSelectVehicleSuggestion={handleSelectVehicleSuggestion}
                addressSearchState={addressSearch}
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

                  <AddressSearchInput
                    state={addressSearch}
                    onSelect={handleSelectAddress}
                    onClear={handleClearAddress}
                    variant="toolbar"
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
          onToggle={toggleLayoutVisibility}
          searchRadius={radiusValue}
          onRadiusChange={(value) => updateSearchRadius(clampRadius(value))}
          mapLayerSections={MAP_LAYER_SECTIONS}
          mapLayers={ENABLED_MAP_LAYERS}
          activeMapLayer={mapLayer.key}
          onMapLayerChange={handleMapLayerChange}
          onClose={() => setActivePopup(null)}
        />
      )}

      {activePopup === "columns" && (
        <MonitoringColumnSelector
          columns={allColumns}
          columnPrefs={columnPrefs}
          defaultPrefs={columnDefaults}
          onApply={applyColumns}
          onRestore={restoreColumns}
          onClose={() => setActivePopup(null)}
        />
      )}

      {drawerMounted ? (
        <div className="fixed inset-0 z-[9996] flex h-full items-stretch justify-end">
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
            <VehicleDetailsDrawer vehicle={detailsVehicle} onClose={closeDetails} floating={false} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
