import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useTranslation } from "../lib/i18n.js";

import MonitoringMap from "../components/map/MonitoringMap.jsx";
import MonitoringTable from "../components/monitoring/MonitoringTable.jsx";
import MonitoringToolbar from "../components/monitoring/MonitoringToolbar.jsx";
import MonitoringColumnSelector from "../components/monitoring/MonitoringColumnSelector.jsx";
import MonitoringLayoutSelector from "../components/monitoring/MonitoringLayoutSelector.jsx";
import MapTableSplitter from "../components/monitoring/MapTableSplitter.jsx";
import VehicleDetailsDrawer from "../components/monitoring/VehicleDetailsDrawer.jsx";

import useMonitoringSettings from "../lib/hooks/useMonitoringSettings.js";
import useGeofences from "../lib/hooks/useGeofences.js";
import useUserPreferences from "../lib/hooks/useUserPreferences.js";
import useTelemetry from "../lib/hooks/useTelemetry.js";
import useGeocodeSearch from "../lib/hooks/useGeocodeSearch.js";

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

import { TELEMETRY_COLUMNS } from "../features/telemetry/telemetryColumns.js";

const DEFAULT_MAP_HEIGHT = 60;
const MIN_MAP_HEIGHT = 20;
const MAX_MAP_HEIGHT = 80;

const COLUMN_WIDTH_HINTS = {
  vehicle: 180,
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
  actions: 90,
};

const NEARBY_RADIUS_KM = 5;

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

export default function Monitoring() {
  const { t, locale } = useTranslation();

  const { telemetry, loading } = useTelemetry();
  const safeTelemetry = useMemo(() => (Array.isArray(telemetry) ? telemetry : []), [telemetry]);

  const { geofences } = useGeofences({ autoRefreshMs: 60_000 });
  const { preferences, loading: loadingPreferences, savePreferences } = useUserPreferences();

  const [query, setQuery] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [mapViewport, setMapViewport] = useState(null);
  const [regionQuery, setRegionQuery] = useState("");
  const [regionTarget, setRegionTarget] = useState(null);
  const [nearbyDeviceIds, setNearbyDeviceIds] = useState([]);
  const [detailsVehicle, setDetailsVehicle] = useState(null);
  const [localMapHeight, setLocalMapHeight] = useState(DEFAULT_MAP_HEIGHT);

  // Controle de Popups
  const [activePopup, setActivePopup] = useState(null); // 'columns' | 'layout' | null

  const [layoutVisibility, setLayoutVisibility] = useState({
    showMap: true,
    showTable: true,
  });

  const { isSearching, searchRegion } = useGeocodeSearch();

  const clampMapHeight = value => Math.min(
    MAX_MAP_HEIGHT,
    Math.max(MIN_MAP_HEIGHT, Number.isFinite(Number(value)) ? Number(value) : DEFAULT_MAP_HEIGHT),
  );

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

  // --- Lógica de Dados ---
  const normalizedTelemetry = useMemo(() => safeTelemetry.map(item => ({
    device: item.device || item,
    source: item,
  })), [safeTelemetry]);

  const searchFiltered = useMemo(() => {
    const term = query.toLowerCase().trim();
    if (!term) return normalizedTelemetry;

    return normalizedTelemetry.filter(({ device }) => {
      const name = (device.name ?? device.alias ?? "").toLowerCase();
      const plate = (device.plate ?? device.registrationNumber ?? "").toLowerCase();
      return name.includes(term) || plate.includes(term);
    });
  }, [query, normalizedTelemetry]);

  const filteredDevices = useMemo(() => {
    return searchFiltered.filter(({ source, device }) => {
      if (filterMode === "online") return isOnline(source?.position);
      if (filterMode === "offline") return !isOnline(source?.position);
      if (filterMode === "ignition") return getIgnition(source?.position, device) === true;
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
        statusBadge: deriveStatus(pos),
        onFocus: setSelectedDeviceId,
      };

      return {
        ...row,
        onOpenDetails: () => setDetailsVehicle(row),
      };
    });
  }, [filteredDevices]);

  const decoratedRows = useMemo(
    () => rows.map(row => ({ ...row, isNearby: nearbyDeviceIds.includes(row.deviceId) })),
    [rows, nearbyDeviceIds],
  );

  useEffect(() => {
    if (!detailsVehicle) return;
    const match = decoratedRows.find(item => item.deviceId === detailsVehicle.deviceId);
    if (match) setDetailsVehicle(match);
  }, [decoratedRows, detailsVehicle]);

  const markers = useMemo(() => {
    return decoratedRows
      .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng))
      .map(r => ({
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
      }));
  }, [decoratedRows, locale, selectedDeviceId]);

  const summary = useMemo(() => {
    const online = rows.filter(r => isOnline(r.position)).length;
    const moving = rows.filter(r => (r.speed ?? 0) > 0).length;
    return { online, offline: rows.length - online, moving, total: rows.length };
  }, [rows]);

  useEffect(() => {
    if (!regionTarget) {
      setNearbyDeviceIds([]);
      return;
    }

    const ids = rows
      .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng))
      .filter(r => distanceKm(r.lat, r.lng, regionTarget.lat, regionTarget.lng) <= NEARBY_RADIUS_KM)
      .map(r => r.deviceId);
    setNearbyDeviceIds(ids);
  }, [rows, regionTarget]);

  // --- Configuração de Colunas ---
  const telemetryColumns = useMemo(() =>
    TELEMETRY_COLUMNS.map(col => {
      const overrideKey = COLUMN_LABEL_OVERRIDES[col.key];
      const label = overrideKey ? t(overrideKey) : t(col.labelKey);

      return {
        ...col,
        width: COLUMN_WIDTH_HINTS[col.key] ?? col.width,
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
    render: row => (
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide">
        <button
          className="rounded border border-primary/40 bg-primary/10 px-2 py-1 font-semibold text-primary hover:bg-primary/20"
          onClick={() => row.onFocus?.(row.deviceId)}
        >
          Mapa
        </button>
        <button
          className="rounded border border-white/15 bg-white/5 px-2 py-1 font-semibold text-white/70 hover:text-white"
          onClick={(event) => {
            event.stopPropagation();
            row.onOpenDetails?.();
          }}
        >
          Detalhes
        </button>
      </div>
    ),
  }), [t]);

  const allColumns = useMemo(() => [...telemetryColumns, actionsColumn], [telemetryColumns, actionsColumn]);

  const handleRegionSearch = useCallback(async () => {
    if (!regionQuery.trim()) return;
    const result = await searchRegion(regionQuery);
    if (result) {
      setRegionTarget(result);
      setMapViewport({ center: [result.lat, result.lng], zoom: 13 });
    }
  }, [regionQuery, searchRegion]);

  const handleSelectRow = useCallback((deviceId) => {
    setSelectedDeviceId(deviceId);
  }, []);

  const {
    visibleColumns,
    columnPrefs,
    toggleColumn,
    restoreColumns,
    moveColumn,
    updateColumnWidth,
    mapHeightPercent,
    updateMapHeight,
    applyColumns,
  } = useMonitoringSettings({
    columns: allColumns,
    remotePreferences: preferences,
    loadingPreferences,
    storageKey: "monitoring.table.columns",
    savePreferences,
  });

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
      return `${localMapHeight}% 12px ${tableHeightPercent}%`;
    }
    if (layoutVisibility.showMap) return "1fr";
    if (layoutVisibility.showTable) return "auto 1fr";
    return "1fr";
  }, [layoutVisibility.showMap, layoutVisibility.showTable, localMapHeight, tableHeightPercent]);

  return (
    <div className="relative grid w-full bg-[#0b0f17]" style={{ minHeight: "calc(100vh - 64px)", gridTemplateRows }}>
      {layoutVisibility.showMap && (
        <div className="relative border-b border-white/10">
          <MonitoringMap
            markers={markers}
            geofences={geofences}
            focusMarkerId={selectedDeviceId}
            mapViewport={mapViewport}
            onViewportChange={setMapViewport}
            regionTarget={regionTarget}
          />
        </div>
      )}

      {layoutVisibility.showMap && layoutVisibility.showTable && (
        <MapTableSplitter onResize={handleMapResize} currentPercent={localMapHeight} />
      )}

      {layoutVisibility.showTable && (
        <div className="relative z-20 border-b border-white/10 bg-[#0f141c] px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <MonitoringToolbar
              query={query}
              onQueryChange={setQuery}
              filterMode={filterMode}
              onFilterChange={setFilterMode}
              summary={summary}
              activePopup={activePopup}
              onTogglePopup={(name) => setActivePopup(activePopup === name ? null : name)}
              regionQuery={regionQuery}
              onRegionQueryChange={setRegionQuery}
              onRegionSearch={handleRegionSearch}
              isSearchingRegion={isSearching}
            />
          </div>

          {activePopup === "layout" && (
            <div className="absolute right-4 top-full mt-2 z-30">
              <MonitoringLayoutSelector
                layoutVisibility={layoutVisibility}
                onToggle={key => setLayoutVisibility(prev => ({ ...prev, [key]: !prev[key] }))}
                onClose={() => setActivePopup(null)}
              />
            </div>
          )}
        </div>
      )}

      {layoutVisibility.showTable && (
        <div className="relative z-10 overflow-hidden">
          <div className="h-full overflow-hidden">
            <MonitoringTable
              rows={decoratedRows}
              columns={visibleColumnsWithWidths}
              selectedDeviceId={selectedDeviceId}
              onSelect={handleSelectRow}
              loading={loading}
              emptyText={t("monitoring.emptyState")}
              columnWidths={columnPrefs.widths}
              onColumnWidthChange={updateColumnWidth}
            />
          </div>
        </div>
      )}

      {activePopup === "columns" && (
        <MonitoringColumnSelector
          columns={allColumns}
          columnPrefs={columnPrefs}
          onApply={applyColumns}
          onRestore={restoreColumns}
          onClose={() => setActivePopup(null)}
        />
      )}

      <VehicleDetailsDrawer vehicle={detailsVehicle} onClose={() => setDetailsVehicle(null)} />
    </div>
  );
}
