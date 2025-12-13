import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
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
import { getCachedReverse, reverseGeocode } from "../lib/reverseGeocode.js";

import {
  deriveStatus,
  formatDateTime,
  getDeviceKey,
  getIgnition,
  getLastUpdate,
  isOnline,
  pickCoordinate,
  pickSpeed,
} from "../lib/monitoring-helpers.js";

import { TELEMETRY_COLUMNS } from "../features/telemetry/telemetryColumns.jsx";

const DEFAULT_MAP_HEIGHT = 60;
const MIN_MAP_HEIGHT = 20;
const MAX_MAP_HEIGHT = 80;
const DEFAULT_RADIUS = 500;
const MIN_RADIUS = 50;
const MAX_RADIUS = 5000;

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
  vehicle: 160,
  plate: 110,
  deviceId: 120,
  protocol: 120,
  serverTime: 150,
  deviceTime: 150,
  gpsTime: 150,
  lastEvent: 140,
  valid: 90,
  latitude: 120,
  longitude: 120,
  speed: 90,
  address: 260,
  status: 120,
  ignition: 110,
  client: 160,
  geofences: 140,
  notes: 180,
  faceRecognition: 120,
  actions: 90,
};

const COLUMN_MIN_WIDTHS = {
  vehicle: 120,
  plate: 90,
  deviceId: 100,
  protocol: 100,
  serverTime: 120,
  deviceTime: 120,
  gpsTime: 120,
  lastEvent: 110,
  valid: 70,
  latitude: 110,
  longitude: 110,
  speed: 80,
  address: 140,
  status: 100,
  ignition: 90,
  client: 120,
  geofences: 120,
  notes: 120,
  faceRecognition: 110,
  actions: 80,
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
  "monitoring.columns.notes": "Rec. Facial",
};

export default function Monitoring() {
  const { t, locale } = useTranslation();

  const { telemetry, loading } = useTelemetry();
  const safeTelemetry = useMemo(() => (Array.isArray(telemetry) ? telemetry : []), [telemetry]);

  const { geofences } = useGeofences({ autoRefreshMs: 60_000 });
  const { preferences, loading: loadingPreferences, savePreferences } = useUserPreferences();

  const [vehicleQuery, setVehicleQuery] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [mapViewport, setMapViewport] = useState(null);
  const [regionTarget, setRegionTarget] = useState(null);
  const [nearbyDeviceIds, setNearbyDeviceIds] = useState([]);
  const [detailsDeviceId, setDetailsDeviceId] = useState(null);
  const [localMapHeight, setLocalMapHeight] = useState(DEFAULT_MAP_HEIGHT);
  const [reverseAddresses, setReverseAddresses] = useState({});

  // Controle de Popups
  const [activePopup, setActivePopup] = useState(null); // 'columns' | 'layout' | null
  const layoutButtonRef = useRef(null);

  const [layoutVisibility, setLayoutVisibility] = useState({
    showMap: true,
    showTable: true,
  });

  const { isSearching, suggestions: addressSuggestions, previewSuggestions, clearSuggestions } = useGeocodeSearch();

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
    return searchFiltered.filter(({ source, device }) => {
      if (filterMode === "online") return isOnline(source?.position);
      if (filterMode === "stale") return !isOnline(source?.position);
      if (filterMode === "critical") return deriveStatus(source?.position) === "alert";
      return true;
    });
  }, [searchFiltered, filterMode]);

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
        lastUpdate: getLastUpdate(pos),
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

  const detailsVehicle = useMemo(
    () => decoratedRows.find(item => item.deviceId === detailsDeviceId) || null,
    [decoratedRows, detailsDeviceId],
  );

  const openDetailsFor = useCallback((deviceId) => {
    setDetailsDeviceId(deviceId);
  }, []);

  const focusDevice = useCallback((deviceId, { openDetails = false } = {}) => {
    if (!deviceId) return;
    setSelectedDeviceId(deviceId);
    if (openDetails) openDetailsFor(deviceId);
  }, [openDetailsFor]);

  const handleVehicleSearchChange = useCallback((value) => {
    setVehicleQuery(value);
  }, []);

  const markers = useMemo(() => {
    return decoratedRows
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
  }, [decoratedRows, locale, selectedDeviceId, t]);

  const summary = useMemo(() => {
    const online = rows.filter(r => isOnline(r.position)).length;
    const moving = rows.filter(r => (r.speed ?? 0) > 0).length;
    const critical = rows.filter(r => deriveStatus(r.position) === "alert").length;
    const offline = rows.length - online;
    return { online, offline, moving, total: rows.length, critical };
  }, [rows]);

  // --- Configuração de Colunas ---
  const telemetryColumns = useMemo(() =>
    TELEMETRY_COLUMNS.map(col => {
      const overrideKey = COLUMN_LABEL_OVERRIDES[col.key];
      const translated = overrideKey ? t(overrideKey) : t(col.labelKey);
      const label = COLUMN_LABEL_FALLBACKS[translated] || COLUMN_LABEL_FALLBACKS[col.labelKey] || translated;

      return {
        ...col,
        width: COLUMN_WIDTH_HINTS[col.key] ?? col.width,
        minWidth: COLUMN_MIN_WIDTHS[col.key] ?? col.minWidth,
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
    width: COLUMN_WIDTH_HINTS.actions,
    minWidth: COLUMN_MIN_WIDTHS.actions,
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
    storageKey: "monitoring.table.columns",
    savePreferences,
    defaultColumnKeys: EURO_ONE_DEFAULT_COLUMNS,
  });

  const radiusValue = useMemo(() => clampRadius(searchRadius ?? DEFAULT_RADIUS), [clampRadius, searchRadius]);

  const applyAddressTarget = useCallback((payload) => {
    if (!payload || !Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) return;
    const radius = clampRadius(payload.radius ?? radiusValue);
    const target = {
      lat: payload.lat,
      lng: payload.lng,
      label: payload.label,
      address: payload.description || payload.address || payload.label,
      radius,
    };
    setRegionTarget(target);
    setMapViewport({ center: [payload.lat, payload.lng], zoom: 15 });
  }, [clampRadius, radiusValue]);

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
  }, [applyAddressTarget]);

  const handleClearAddress = useCallback(() => {
    setRegionTarget(null);
    setVehicleQuery("");
    setAddressQuery("");
    setNearbyDeviceIds([]);
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
  }, [clampRadius, radiusValue]);

  useEffect(() => {
    const next = Number.isFinite(mapHeightPercent)
      ? clampMapHeight(mapHeightPercent)
      : DEFAULT_MAP_HEIGHT;
    setLocalMapHeight(prev => (prev !== next ? next : prev));
  }, [mapHeightPercent]);

  const handleMapResize = useCallback(
    (value) => {
      const next = clampMapHeight(value);
      setLocalMapHeight(next);
      updateMapHeight(next);
    },
    [updateMapHeight],
  );

  const visibleColumnsWithWidths = useMemo(
    () => visibleColumns.map(col => ({ ...col, width: columnPrefs.widths?.[col.key] ?? col.width })),
    [visibleColumns, columnPrefs.widths],
  );

  const tableHeightPercent = useMemo(
    () => (layoutVisibility.showMap ? Math.max(10, 100 - localMapHeight) : 100),
    [layoutVisibility.showMap, localMapHeight],
  );

  const gridTemplateRows = useMemo(() => {
    if (layoutVisibility.showMap && layoutVisibility.showTable) {
      return `${localMapHeight}% 12px minmax(0, ${tableHeightPercent}%)`;
    }
    if (layoutVisibility.showMap) return "minmax(0, 1fr)";
    if (layoutVisibility.showTable) return "minmax(0, 1fr)";
    return "1fr";
  }, [layoutVisibility.showMap, layoutVisibility.showTable, localMapHeight, tableHeightPercent]);

  return (
    <div
      className="relative grid w-full min-h-0 bg-[#0b0f17]"
      style={{ height: "calc(100vh - 64px)", gridTemplateRows }}
    >
      {layoutVisibility.showMap && (
        <div className="relative min-h-0 border-b border-white/10">
          <MonitoringMap
            markers={markers}
            geofences={geofences}
            focusMarkerId={selectedDeviceId}
            mapViewport={mapViewport}
            onViewportChange={setMapViewport}
            regionTarget={regionTarget}
            onMarkerSelect={handleMarkerSelect}
            onMarkerOpenDetails={handleMarkerDetails}
          />

          {!layoutVisibility.showTable && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col gap-3 px-4 py-3">
              <div className="flex flex-col items-start gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="pointer-events-auto flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:items-center">
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
                    containerClassName="bg-black/70 backdrop-blur-md"
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
        <div className="relative z-20 flex min-h-0 flex-col overflow-hidden bg-[#0f141c]">
          <div className="border-b border-white/10 px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <MonitoringToolbar
                vehicleSearchTerm={vehicleQuery}
                onVehicleSearchChange={handleVehicleSearchChange}
                vehicleSuggestions={vehicleSuggestions}
                onSelectVehicleSuggestion={handleSelectVehicleSuggestion}
                addressSearchTerm={addressQuery}
                onAddressSearchChange={setAddressQuery}
                addressSuggestions={addressSuggestionOptions}
                onSelectAddressSuggestion={handleSelectAddressSuggestion}
                filterMode={filterMode}
                onFilterChange={setFilterMode}
                summary={summary}
                activePopup={activePopup}
                onTogglePopup={handleTogglePopup}
                isSearchingRegion={isSearching}
                layoutButtonRef={layoutButtonRef}
                addressFilter={regionTarget ? { label: regionTarget.label || regionTarget.address, radius: radiusValue } : null}
                onClearAddress={handleClearAddress}
              />
            </div>
          </div>

          <div className="relative z-10 flex-1 min-h-0 overflow-hidden">
            <div className="h-full min-h-0 overflow-hidden">
              <MonitoringTable
                rows={decoratedRows}
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
        </div>
      )}

      {activePopup === "layout" && (
        <MonitoringLayoutSelector
          layoutVisibility={layoutVisibility}
          onToggle={key => setLayoutVisibility(prev => ({ ...prev, [key]: !prev[key] }))}
          searchRadius={radiusValue}
          onRadiusChange={(value) => updateSearchRadius(clampRadius(value))}
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
