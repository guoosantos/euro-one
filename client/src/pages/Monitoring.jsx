import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "../lib/i18n.js";

import MonitoringMap from "../components/map/MonitoringMap.jsx";
import MonitoringTable from "../components/monitoring/MonitoringTable.jsx";
import MonitoringToolbar, { MonitoringSearchBox } from "../components/monitoring/MonitoringToolbar.jsx";
import MonitoringColumnSelector from "../components/monitoring/MonitoringColumnSelector.jsx";
import MonitoringLayoutSelector from "../components/monitoring/MonitoringLayoutSelector.jsx";
import MapTableSplitter from "../components/monitoring/MapTableSplitter.jsx";
import VehicleDetailsDrawer from "../components/monitoring/VehicleDetailsDrawer.jsx";

import useMonitoringSettings from "../lib/hooks/useMonitoringSettings.js";
import useGeofences from "../lib/hooks/useGeofences.js";
import useUserPreferences from "../lib/hooks/useUserPreferences.js";
import useTelemetry from "../lib/hooks/useTelemetry.js";
import useGeocodeSearch from "../lib/hooks/useGeocodeSearch.js";
import { useTenant } from "../lib/tenant-context.jsx";
import useTasks from "../lib/hooks/useTasks.js";
import { getCachedReverse, reverseGeocode } from "../lib/reverseGeocode.js";
import { useUI } from "../lib/store.js";

import {
  deriveStatus,
  formatDateTime,
  getDeviceKey,
  getLastActivity,
  getIgnition,
  getLastUpdate,
  isOnline,
  minutesSince,
  pickCoordinate,
  pickSpeed,
} from "../lib/monitoring-helpers.js";

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
const DEFAULT_TILE_URL = import.meta.env.VITE_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;
const GOOGLE_TILE_KEY_PARAM = GOOGLE_MAPS_KEY ? `&key=${GOOGLE_MAPS_KEY}` : "";
const buildGoogleTileUrl = (layer) =>
  GOOGLE_MAPS_KEY ? `https://{s}.google.com/vt/lyrs=${layer}&x={x}&y={y}&z={z}&hl=pt-BR${GOOGLE_TILE_KEY_PARAM}` : null;

const GOOGLE_ROAD_TILE_URL = import.meta.env.VITE_GOOGLE_ROAD_TILE_URL || buildGoogleTileUrl("m");
const GOOGLE_SATELLITE_TILE_URL = import.meta.env.VITE_GOOGLE_SATELLITE_TILE_URL || buildGoogleTileUrl("s");
const GOOGLE_HYBRID_TILE_URL = import.meta.env.VITE_GOOGLE_HYBRID_TILE_URL || buildGoogleTileUrl("y");
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
const MAP_LAYER_STORAGE_KEY = "monitoring.map.layer";
const normaliseLayoutVisibility = (value = {}) => ({
  showMap: value.showMap !== false,
  showTable: value.showTable !== false,
  showToolbar: value.showToolbar !== false,
  showTopbar: value.showTopbar !== false,
});

const BASE_MAP_LAYERS = [
  {
    key: "openstreetmap",
    label: "OpenStreetMap",
    description: "Mapa padrão de ruas",
    url: DEFAULT_TILE_URL,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  {
    key: "osm-hot",
    label: "OpenStreetMap HOT",
    description: "Estilo humanitário (HOT)",
    url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    key: "opentopomap",
    label: "OpenTopoMap",
    description: "Topografia com relevo",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM',
    maxZoom: 17,
  },
  {
    key: "carto-light",
    label: "Carto Basemaps",
    description: "Tema claro estilo Traccar",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    key: "carto-dark",
    label: "Carto Dark",
    description: "Tema escuro",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    key: "satellite",
    label: "Satélite",
    description: "Imagem de alta resolução (Esri World Imagery)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxZoom: 19,
  },
  {
    key: "hybrid",
    label: "Híbrido",
    description: "Sátelite + labels (Esri)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: 'Tiles &copy; Esri — Source: Esri',
    maxZoom: 20,
  },
];

const HAS_GOOGLE_LAYERS = Boolean(GOOGLE_ROAD_TILE_URL || GOOGLE_SATELLITE_TILE_URL || GOOGLE_HYBRID_TILE_URL);

const GOOGLE_LAYERS = [
  {
    key: "google-road",
    label: "Google Estrada",
    description: "Mapa padrão do Google (se habilitado)",
    url: GOOGLE_ROAD_TILE_URL,
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
    maxZoom: 20,
    attribution: "Map data ©2024 Google",
    available: HAS_GOOGLE_LAYERS && Boolean(GOOGLE_ROAD_TILE_URL),
  },
  {
    key: "google-satellite",
    label: "Google Satélite",
    description: "Imagem de satélite Google (se habilitado)",
    url: GOOGLE_SATELLITE_TILE_URL,
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
    maxZoom: 20,
    attribution: "Map data ©2024 Google",
    available: HAS_GOOGLE_LAYERS && Boolean(GOOGLE_SATELLITE_TILE_URL),
  },
  {
    key: "google-hybrid",
    label: "Google Híbrido",
    description: "Satélite + labels Google (se habilitado)",
    url: GOOGLE_HYBRID_TILE_URL,
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
    maxZoom: 20,
    attribution: "Map data ©2024 Google",
    available: HAS_GOOGLE_LAYERS && Boolean(GOOGLE_HYBRID_TILE_URL),
  },
];

const MAP_LAYER_SECTIONS = [
  {
    key: "core",
    label: "OpenStreetMap / Carto / Topo",
    layers: BASE_MAP_LAYERS,
  },
  {
    key: "google",
    label: "Google",
    disabledMessage: "Google Maps não configurado (adicione VITE_GOOGLE_MAPS_KEY ou URLs de tile)",
    layers: GOOGLE_LAYERS,
  },
];

const ENABLED_MAP_LAYERS = MAP_LAYER_SECTIONS.flatMap((section) =>
  section.layers
    .filter((layer) => layer.available !== false && layer.url)
    .map((layer) => ({ ...layer, section: section.key })),
);

const MAP_LAYER_FALLBACK = ENABLED_MAP_LAYERS[0] || BASE_MAP_LAYERS[0];
const DEFAULT_MAP_LAYER_KEY = MAP_LAYER_FALLBACK?.key || BASE_MAP_LAYERS[0]?.key || "openstreetmap";
const DEVICE_FOCUS_ZOOM = 16;
const ADDRESS_FOCUS_ZOOM = 16;

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
  "batteryLevel",
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
  client: DEFAULT_COLUMN_WIDTH,
  geofences: DEFAULT_COLUMN_WIDTH,
  notes: DEFAULT_COLUMN_WIDTH,
  faceRecognition: DEFAULT_COLUMN_WIDTH,
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
  "monitoring.columns.geofences": "Rotas",
  "monitoring.columns.faceRecognition": "Rec. Facial",
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
  const [searchParams] = useSearchParams();

  const { tenantId, user } = useTenant();
  const { telemetry, loading } = useTelemetry();
  const safeTelemetry = useMemo(() => (Array.isArray(telemetry) ? telemetry : []), [telemetry]);
  const { tasks } = useTasks(useMemo(() => ({ clientId: tenantId }), [tenantId]));

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

  const { geofences } = useGeofences({ autoRefreshMs: 60_000 });
  const { preferences, loading: loadingPreferences, savePreferences } = useUserPreferences();
  const setMonitoringTopbarVisible = useUI((state) => state.setMonitoringTopbarVisible);

  const [vehicleQuery, setVehicleQuery] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  const [selectedAddress, setSelectedAddress] = useState(null);
  const [filterMode, setFilterMode] = useState("all");
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [mapViewport, setMapViewport] = useState(null);
  const [regionTarget, setRegionTarget] = useState(null);
  const [addressViewport, setAddressViewport] = useState(null);
  const [addressPin, setAddressPin] = useState(null);
  const [nearbyDeviceIds, setNearbyDeviceIds] = useState([]);
  const [focusTarget, setFocusTarget] = useState(null);
  const [detailsDeviceId, setDetailsDeviceId] = useState(null);
  const [localMapHeight, setLocalMapHeight] = useState(DEFAULT_MAP_HEIGHT);
  const [mapInvalidateKey, setMapInvalidateKey] = useState(0);
  const [reverseAddresses, setReverseAddresses] = useState({});
  const [mapLayerKey, setMapLayerKey] = useState(DEFAULT_MAP_LAYER_KEY);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [pageIndex, setPageIndex] = useState(0);
  const [routeFilter, setRouteFilter] = useState(null);
  const [securityFilters, setSecurityFilters] = useState([]);

  useEffect(() => {
    const filter = searchParams.get("filter");
    if (filter) setFilterMode(filter);
    const incomingRouteFilter = searchParams.get("routeFilter");
    setRouteFilter(incomingRouteFilter);
    const rawSecurityFilter = searchParams.get("securityFilter");
    if (rawSecurityFilter) {
      setSecurityFilters(
        rawSecurityFilter
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      );
    } else {
      setSecurityFilters([]);
    }
  }, [searchParams]);

  // Controle de Popups
  const [activePopup, setActivePopup] = useState(null); // 'columns' | 'layout' | null
  const layoutButtonRef = useRef(null);

  const [layoutVisibility, setLayoutVisibility] = useState(() => ({ ...DEFAULT_LAYOUT_VISIBILITY }));

  const toggleLayoutVisibility = useCallback((key) => {
    setLayoutVisibility((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (key === "showMap" || key === "showTable") {
        if (!next.showMap && !next.showTable) {
          next[key] = true;
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (loadingPreferences) return;
    const remote = preferences?.monitoringLayoutVisibility;

      if (remote) {
        setLayoutVisibility((prev) => {
          const next = normaliseLayoutVisibility({ ...DEFAULT_LAYOUT_VISIBILITY, ...remote });
          const unchanged =
            prev.showMap === next.showMap &&
            prev.showTable === next.showTable &&
            prev.showToolbar === next.showToolbar &&
            prev.showTopbar === next.showTopbar;
          return unchanged ? prev : next;
        });
      } else {
        setLayoutVisibility((prev) => normaliseLayoutVisibility(prev));
      }
  }, [loadingPreferences, preferences?.monitoringLayoutVisibility]);

  useEffect(() => {
    if (loadingPreferences) return;
    savePreferences({ monitoringLayoutVisibility: layoutVisibility }).catch(() => {});
  }, [layoutVisibility, loadingPreferences, savePreferences]);

  useEffect(() => {
    setMonitoringTopbarVisible(layoutVisibility.showTopbar !== false);
    return () => setMonitoringTopbarVisible(true);
  }, [layoutVisibility.showTopbar, setMonitoringTopbarVisible]);

  const columnStorageKey = useMemo(
    () => `monitoring.table.columns:${tenantId || "global"}:${user?.id || "anon"}`,
    [tenantId, user?.id],
  );

  const {
    isSearching,
    suggestions: addressSuggestions,
    previewSuggestions,
    clearSuggestions,
    searchRegion,
    error: geocodeError,
  } = useGeocodeSearch();

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

  useEffect(() => {
    if (addressQuery.trim()) {
      previewSuggestions(addressQuery);
    } else {
      clearSuggestions();
    }
  }, [addressQuery, clearSuggestions, previewSuggestions]);

  useEffect(() => {
    try {
      const storedLayer = localStorage.getItem(MAP_LAYER_STORAGE_KEY);
      if (storedLayer && ENABLED_MAP_LAYERS.some((layer) => layer.key === storedLayer)) {
        setMapLayerKey(storedLayer);
      }
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

  // --- Lógica de Dados ---
  const normalizedTelemetry = useMemo(() => safeTelemetry.map(item => ({
    device: item.device || item,
    source: item,
  })), [safeTelemetry]);

  const vehicleOptions = useMemo(() => normalizedTelemetry.map(({ device }) => {
    const name = device.name ?? device.alias ?? "";
    const plate = device.plate ?? device.registrationNumber ?? "";
    const identifier = device.identifier ?? device.uniqueId ?? "";
    const label = name || plate || identifier || "Veículo";
    const description = plate && name ? `${plate} · ${name}` : plate || name || identifier;
    const searchValue = `${label} ${plate} ${identifier}`.toLowerCase();
    return { type: "vehicle", deviceId: getDeviceKey(device), label, description, searchValue };
  }), [normalizedTelemetry]);

  const vehicleSuggestions = useMemo(() => {
    const term = vehicleQuery.toLowerCase().trim();
    if (!term) return [];
    return vehicleOptions.filter((option) => option.searchValue.includes(term)).slice(0, 8);
  }, [vehicleOptions, vehicleQuery]);

  const addressSuggestionOptions = useMemo(() => {
    return addressSuggestions.map((item) => ({
      type: "address",
      id: item.id,
      label: item.label,
      description: item.concise,
      lat: item.lat,
      lng: item.lng,
      boundingBox: item.boundingBox,
    }));
  }, [addressSuggestions]);

  const searchFiltered = useMemo(() => {
    const term = vehicleQuery.toLowerCase().trim();
    if (!term) return normalizedTelemetry;

    return normalizedTelemetry.filter(({ device }) => {
      const name = (device.name ?? device.alias ?? "").toLowerCase();
      const plate = (device.plate ?? device.registrationNumber ?? "").toLowerCase();
      const identifier = (device.identifier ?? device.uniqueId ?? "").toLowerCase();
      const deviceKey = (getDeviceKey(device) ?? "").toLowerCase();
      return (
        name.includes(term) ||
        plate.includes(term) ||
        identifier.includes(term) ||
        deviceKey.includes(term)
      );
    });
  }, [normalizedTelemetry, vehicleQuery]);

  const filteredDevices = useMemo(() => {
    const now = Date.now();

    return searchFiltered.filter(({ source, device }) => {
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
      if (filterMode === "critical") return deriveStatus(position) === "alert";
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
  }, [searchFiltered, filterMode, routeFilter, routesByVehicle, securityFilters]);

  const resolveAddress = (position, lat, lng) => {
    const rawAddress = position?.address || position?.attributes?.formattedAddress;
    if (typeof rawAddress === "string" && rawAddress.trim()) return rawAddress.trim();
    if (typeof position?.address === "object") {
      if (typeof position.address.formattedAddress === "string" && position.address.formattedAddress.trim()) {
        return position.address.formattedAddress.trim();
      }
      if (typeof position.address.address === "string" && position.address.address.trim()) {
        return position.address.address.trim();
      }
    }

    const coordKey = buildCoordKey(lat, lng);
    if (coordKey && reverseAddresses[coordKey]) return reverseAddresses[coordKey];

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const cached = getCachedReverse(lat, lng);
      if (cached) return cached;
    }

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }

    return "Endereço não disponível";
  };

  const rows = useMemo(() => {
    return filteredDevices.map(({ device, source }) => {
      const key = getDeviceKey(device);
      const pos = source?.position;
      const lat = pickCoordinate([pos?.lat, pos?.latitude]);
      const lng = pickCoordinate([pos?.lng, pos?.longitude]);
      const statusBadge = deriveStatus(pos);
      const statusLabel = statusBadge === "online"
        ? t("monitoring.filters.online")
        : statusBadge === "alert"
          ? t("monitoring.filters.criticalEvents")
          : t("monitoring.filters.offline");
      const lastActivity = getLastActivity(pos, device) || getLastUpdate(pos);
      const stalenessMinutes = minutesSince(lastActivity);

      const row = {
        key,
        device,
        deviceId: key,
        position: pos,
        lat,
        lng,
        deviceName: device.name ?? "—",
        plate: device.plate ?? "—",
        address: resolveAddress(pos, lat, lng),
        speed: pickSpeed(pos),
        lastUpdate: lastActivity,
        lastActivity,
        stalenessMinutes,
        statusBadge,
        statusLabel,
      };

      return row;
    });
  }, [buildCoordKey, filteredDevices, reverseAddresses, t]);

  useEffect(() => {
    const missing = rows
      .map((row) => ({
        key: buildCoordKey(row.lat, row.lng),
        lat: row.lat,
        lng: row.lng,
      }))
      .filter((item) => item.key && !reverseAddresses[item.key])
      .slice(0, 4);

    if (!missing.length) return undefined;

    let cancelled = false;
    (async () => {
      for (const item of missing) {
        try {
          const value = await reverseGeocode(item.lat, item.lng);
          if (cancelled) return;
          setReverseAddresses((prev) => (prev[item.key] ? prev : { ...prev, [item.key]: value }));
        } catch (_err) {
          // ignore individual failures
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [buildCoordKey, reverseAddresses, rows]);

  const decoratedRows = useMemo(
    () => rows.map(row => ({ ...row, isNearby: nearbyDeviceIds.includes(row.deviceId) })),
    [rows, nearbyDeviceIds],
  );

  const displayRows = useMemo(
    () => (regionTarget ? decoratedRows.filter((row) => row.isNearby) : decoratedRows),
    [decoratedRows, regionTarget],
  );

  const detailsVehicle = useMemo(
    () => decoratedRows.find(item => item.deviceId === detailsDeviceId) || null,
    [decoratedRows, detailsDeviceId],
  );

  const openDetailsFor = useCallback((deviceId) => {
    setDetailsDeviceId(deviceId);
  }, []);

  const focusDevice = useCallback((deviceId, { openDetails = false, allowToggle = true } = {}) => {
    if (!deviceId) return;
    const isAlreadySelected = selectedDeviceId === deviceId;

    if (isAlreadySelected && allowToggle) {
      setSelectedDeviceId(null);
      setFocusTarget(null);
      setDetailsDeviceId((prev) => (openDetails ? null : prev));
      return;
    }

    setSelectedDeviceId(deviceId);
    const targetRow = decoratedRows.find((item) => item.deviceId === deviceId);
    if (targetRow && Number.isFinite(targetRow.lat) && Number.isFinite(targetRow.lng)) {
      const currentCenter = Array.isArray(mapViewport?.center) ? mapViewport.center : null;
      const currentZoom = Number.isFinite(mapViewport?.zoom) ? mapViewport.zoom : null;
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
          key: `device-${deviceId}-${Date.now()}`,
        };
        setFocusTarget(focus);
        setMapViewport(focus);
      }
    }
    if (openDetails) openDetailsFor(deviceId);
  }, [decoratedRows, mapViewport, openDetailsFor, selectedDeviceId]);

  const handleVehicleSearchChange = useCallback((value) => {
    setVehicleQuery(value);
  }, []);

  const mapLayer = useMemo(
    () => ENABLED_MAP_LAYERS.find((item) => item.key === mapLayerKey) || MAP_LAYER_FALLBACK || BASE_MAP_LAYERS[0],
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
            ? t("monitoring.filters.criticalEvents")
            : t("monitoring.filters.offline");

        return {
          id: r.deviceId,
          lat: r.lat,
          lng: r.lng,
          label: r.deviceName,
          plate: r.plate,
          address: r.address,
          speedLabel: `${r.speed ?? 0} km/h`,
          lastUpdateLabel: formatDateTime(r.lastUpdate, locale),
          color: r.statusBadge === "online" ? "#22c55e" : "#f87171",
          accentColor: r.deviceId === selectedDeviceId ? "#f97316" : r.isNearby ? "#22d3ee" : undefined,
          statusLabel,
        };
      });
  }, [displayRows, locale, selectedDeviceId, t]);

  const summary = useMemo(() => {
    const base = {
      online: 0,
      offline: 0,
      moving: 0,
      critical: 0,
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
      const critical = deriveStatus(row.position) === "alert";

      if (online) base.online += 1;
      else base.offline += 1;

      if ((row.speed ?? 0) > 0) base.moving += 1;
      if (critical) base.critical += 1;

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
  }, [displayRows]);

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
    render: row => (
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide">
        <a
          className="rounded border border-primary/40 bg-primary/10 px-2 py-1 font-semibold text-primary hover:bg-primary/20"
          href={Number.isFinite(row.lat) && Number.isFinite(row.lng) ? `https://www.google.com/maps?q=${row.lat},${row.lng}` : "#"}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          Mapa
        </a>
        <button
          className="rounded border border-white/15 bg-white/5 px-2 py-1 font-semibold text-white/70 hover:text-white"
          onClick={(event) => {
            event.stopPropagation();
            focusDevice(row.deviceId, { openDetails: true });
          }}
        >
          Detalhes
        </button>
      </div>
    ),
  }), [focusDevice, t]);

  const allColumns = useMemo(() => [...telemetryColumns, actionsColumn], [telemetryColumns, actionsColumn]);

  const handleSelectRow = useCallback((deviceId) => {
    focusDevice(deviceId);
  }, [focusDevice]);

  const handleRowClick = useCallback((row) => {
    focusDevice(row.deviceId, { openDetails: true });
  }, [focusDevice]);

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
    if (!payload || !Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) return;
    const radius = clampRadius(payload.radius ?? radiusValue);
    const boundingBox = normaliseBoundingBox(payload.viewport || payload.boundingBox || payload.boundingbox);
    const target = {
      lat: payload.lat,
      lng: payload.lng,
      label: payload.label,
      address: payload.description || payload.address || payload.label,
      radius,
      boundingBox,
    };
    setRegionTarget(target);
    setSelectedAddress(target);
    setAddressPin({
      lat: payload.lat,
      lng: payload.lng,
      label: payload.label || payload.description || "Local selecionado",
    });

    const focus = boundingBox
      ? { bounds: boundingBox, center: [payload.lat, payload.lng], key: `address-${Date.now()}` }
      : { center: [payload.lat, payload.lng], zoom: ADDRESS_FOCUS_ZOOM, key: `address-${Date.now()}` };

    setAddressViewport(focus);

    setSelectedDeviceId(null);
    setDetailsDeviceId(null);
    setFocusTarget(focus);
    setMapViewport({ center: [payload.lat, payload.lng], zoom: focus.zoom || ADDRESS_FOCUS_ZOOM });
    setLayoutVisibility((prev) => ({ ...prev, showMap: true, showTable: true }));
    setMapInvalidateKey((prev) => prev + 1);
  }, [clampRadius, normaliseBoundingBox, radiusValue]);

  const handleSelectVehicleSuggestion = useCallback((option) => {
    if (!option) return;
    setVehicleQuery(option.label ?? "");
    focusDevice(option.deviceId, { openDetails: true });
    clearSuggestions();
  }, [clearSuggestions, focusDevice]);

  const handleSelectAddressSuggestion = useCallback((option) => {
    if (!option) return;
    setAddressQuery(option.label ?? "");
    applyAddressTarget(option);
    clearSuggestions();
  }, [applyAddressTarget, clearSuggestions]);

  const handleAddressSubmit = useCallback(async (queryValue) => {
    const term = queryValue?.trim();
    if (!term) return;
    const result = await searchRegion(term);
    if (result) {
      setAddressQuery(result.label ?? term);
      applyAddressTarget(result);
      clearSuggestions();
    }
  }, [applyAddressTarget, clearSuggestions, searchRegion]);

  const handleClearAddress = useCallback(() => {
    setRegionTarget(null);
    setAddressPin(null);
    setAddressQuery("");
    setSelectedAddress(null);
    setAddressViewport(null);
    setNearbyDeviceIds([]);
    setFocusTarget(null);
    clearSuggestions();
  }, [clearSuggestions]);

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
    setFocusTarget(null);
  }, []);

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

  const tableHeightPercent = useMemo(
    () => (layoutVisibility.showMap ? Math.max(10, 100 - localMapHeight) : 100),
    [layoutVisibility.showMap, localMapHeight],
  );

  const totalRows = displayRows.length;
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

  return (
    <div
      className="relative grid h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-[#0b0f17]"
      style={{ gridTemplateRows }}
    >
      {layoutVisibility.showMap && (
        <div className="relative min-h-0 h-full border-b border-white/10">
          <MonitoringMap
            markers={markers}
            geofences={geofences}
            focusMarkerId={selectedDeviceId}
            mapViewport={mapViewport}
            onViewportChange={setMapViewport}
            regionTarget={regionTarget}
            onMarkerSelect={handleMarkerSelect}
            onMarkerOpenDetails={handleMarkerDetails}
            mapLayer={mapLayer}
            focusTarget={focusTarget}
            addressMarker={addressPin}
            addressViewport={addressViewport}
            invalidateKey={mapInvalidateKey}
          />

          {!layoutVisibility.showTable && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col gap-2 px-3 py-2 lg:pr-28">
              <div className="flex flex-col items-start gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:gap-3">
                <div className="pointer-events-auto flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center">
                  <MonitoringSearchBox
                    value={vehicleQuery}
                    onChange={handleVehicleSearchChange}
                    placeholder={t("monitoring.searchPlaceholderSimple")}
                    suggestions={vehicleSuggestions}
                    onSelectSuggestion={handleSelectVehicleSuggestion}
                    containerClassName="bg-black/70 backdrop-blur-md"
                  />

                  <MonitoringSearchBox
                    value={addressQuery}
                    onChange={setAddressQuery}
                    placeholder={t("monitoring.searchRegionPlaceholder")}
                    suggestions={addressSuggestionOptions}
                    onSelectSuggestion={handleSelectAddressSuggestion}
                    isLoading={isSearching}
                    onClear={handleClearAddress}
                    containerClassName="bg-black/70 backdrop-blur-md"
                    errorMessage={geocodeError?.message}
                  />
                </div>

                <div className="pointer-events-auto flex items-center gap-2">
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
        <div className="relative z-20 flex h-full min-h-0 flex-col overflow-hidden bg-[#0f141c]">
          <div className="border-b border-white/10 px-3 py-2">
            {layoutVisibility.showToolbar ? (
              <div className="flex flex-col justify-center gap-2 lg:flex-row lg:items-center lg:justify-between">
                <MonitoringToolbar
                  vehicleSearchTerm={vehicleQuery}
                  onVehicleSearchChange={handleVehicleSearchChange}
                  vehicleSuggestions={vehicleSuggestions}
                  onSelectVehicleSuggestion={handleSelectVehicleSuggestion}
                  addressSearchTerm={addressQuery}
                  onAddressSearchChange={setAddressQuery}
                  onAddressSubmit={handleAddressSubmit}
                  addressSuggestions={addressSuggestionOptions}
                  onSelectAddressSuggestion={handleSelectAddressSuggestion}
                  addressError={geocodeError?.message}
                  filterMode={filterMode}
                  onFilterChange={setFilterMode}
                  summary={summary}
                  activePopup={activePopup}
                  onTogglePopup={handleTogglePopup}
                  isSearchingRegion={isSearching}
                  layoutButtonRef={layoutButtonRef}
                  onClearAddress={handleClearAddress}
                  hasSelection={Boolean(selectedDeviceId)}
                  onClearSelection={clearSelection}
                />
              </div>
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

                  <MonitoringSearchBox
                    value={addressQuery}
                    onChange={setAddressQuery}
                    placeholder={t("monitoring.searchRegionPlaceholder")}
                    suggestions={addressSuggestionOptions}
                    onSelectSuggestion={handleSelectAddressSuggestion}
                    isLoading={isSearching}
                    onClear={handleClearAddress}
                    errorMessage={geocodeError?.message}
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

          <div className="relative z-10 flex-1 min-h-0 overflow-hidden">
            <div className="h-full min-h-0 overflow-hidden">
              <MonitoringTable
                rows={paginatedRows}
                columns={visibleColumnsWithWidths}
                selectedDeviceId={selectedDeviceId}
                onSelect={handleSelectRow}
                onRowClick={handleRowClick}
                loading={loading}
                emptyText={t("monitoring.emptyState")}
                columnWidths={columnPrefs.widths}
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

      <VehicleDetailsDrawer vehicle={detailsVehicle} onClose={() => setDetailsDeviceId(null)} />
    </div>
  );
}
