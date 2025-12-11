import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "../lib/i18n.js";
import { useNavigate } from "react-router-dom";
import MonitoringMap from "../components/map/MonitoringMap.jsx";
import MonitoringTable from "../components/monitoring/MonitoringTable.jsx";
import MonitoringToolbar from "../components/monitoring/MonitoringToolbar.jsx";
import MonitoringColumnSelector from "../components/monitoring/MonitoringColumnSelector.jsx";
import MonitoringLayoutSelector from "../components/monitoring/MonitoringLayoutSelector.jsx";
import useMonitoringSettings from "../lib/hooks/useMonitoringSettings.js";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import {
  deriveStatus,
  formatDateTime,
  getDeviceKey,
  getIgnition,
  getLastUpdate,
  isOnline,
  minutesSince,
  pickCoordinate,
  pickSpeed,
} from "../lib/monitoring-helpers.js";
import useGeofences from "../lib/hooks/useGeofences.js";
import useUserPreferences from "../lib/hooks/useUserPreferences.js";
import useTelemetry from "../lib/hooks/useTelemetry.js";
import { TELEMETRY_COLUMNS } from "../features/telemetry/telemetryColumns.js";

const COLUMN_STORAGE_KEY = "monitoredTableColumns";
const DEFAULT_MAP_ZOOM = 12;

function getStatusBadge(position, t) {
  const status = deriveStatus(position);
  switch (status) {
    case "online":
      return { label: t("monitoring.status.online"), status, className: "text-emerald-200" };
    case "alert":
      return { label: t("monitoring.status.alert"), status, className: "text-amber-200" };
    case "blocked":
      return { label: t("monitoring.status.blocked"), status, className: "text-purple-200" };
    default:
      return { label: t("monitoring.status.offline"), status, className: "text-white/60" };
  }
}

export default function Monitoring() {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const { telemetry, loading, stats } = useTelemetry();
  const safeTelemetry = useMemo(() => (Array.isArray(telemetry) ? telemetry : []), [telemetry]);
  const [filterMode, setFilterMode] = useState("all");
  const { geofences } = useGeofences({ autoRefreshMs: 60_000 });
  const { preferences, loading: loadingPreferences, savePreferences } = useUserPreferences();

  const [query, setQuery] = useState("");
  const [showColumns, setShowColumns] = useState(false);
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [mapViewport, setMapViewport] = useState(null);
  const [layoutVisibility, setLayoutVisibility] = useState({ showMap: true, showTable: true });

  const handleFocusOnMap = useCallback((deviceId) => setSelectedDeviceId(deviceId), []);

  const handleReplay = useCallback(
    (deviceId) => {
      if (!deviceId) return;
      const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const to = new Date().toISOString();
      navigate(`/trips?deviceId=${encodeURIComponent(deviceId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    },
    [navigate],
  );

  const telemetryColumns = useMemo(
    () =>
      TELEMETRY_COLUMNS.map((column) => ({
        ...column,
        label: t(column.labelKey),
        render: (row) => column.getValue(row, { t, locale }),
      })),
    [locale, t],
  );

  const actionsColumn = useMemo(
    () => ({
      key: "actions",
      label: t("monitoring.columns.actions"),
      defaultVisible: true,
      fixed: true,
      render: (row) => (
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg bg-primary/15 px-3 py-1 text-[11px] font-semibold text-primary hover:bg-primary/25"
            onClick={() => row.onFocus?.(row.deviceId)}
          >
            {t("monitoring.actions.map")}
          </button>
          <button
            type="button"
            className="rounded-lg border border-white/10 px-3 py-1 text-[11px] font-semibold text-white/80 hover:border-white/30"
            onClick={() => row.onReplay?.(row.deviceId)}
          >
            {t("monitoring.actions.replay")}
          </button>
        </div>
      ),
    }),
    [t],
  );

  const allColumns = useMemo(() => [...telemetryColumns, actionsColumn], [actionsColumn, telemetryColumns]);

  const { columnPrefs, visibleColumns, moveColumn, toggleColumn, restoreColumns } = useMonitoringSettings({
    columns: allColumns,
    storageKey: COLUMN_STORAGE_KEY,
    remotePreferences: preferences,
    loadingPreferences,
    savePreferences,
  });

  useEffect(() => {
    if (preferences?.monitoringDefaultFilters?.mode) {
      setFilterMode(preferences.monitoringDefaultFilters.mode);
    }
    if (preferences?.monitoringMapViewport?.center?.length === 2) {
      setMapViewport({
        center: preferences.monitoringMapViewport.center,
        zoom: preferences.monitoringMapViewport.zoom || DEFAULT_MAP_ZOOM,
      });
    }
    if (preferences?.monitoringLayoutVisibility) {
      setLayoutVisibility((current) => ({ ...current, ...preferences.monitoringLayoutVisibility }));
    }
  }, [preferences]);

  useEffect(() => {
    if (loadingPreferences) return;
    savePreferences({ monitoringLayoutVisibility: layoutVisibility }).catch((prefError) =>
      console.warn("Falha ao salvar preferências de layout", prefError),
    );
  }, [layoutVisibility, loadingPreferences, savePreferences]);

  useEffect(() => {
    if (loadingPreferences) return;
    savePreferences({
      monitoringDefaultFilters: { ...(preferences?.monitoringDefaultFilters || {}), mode: filterMode },
    }).catch((prefError) => console.warn("Falha ao salvar filtro padrão", prefError));
  }, [filterMode, loadingPreferences, preferences, savePreferences]);

  const searchFilteredDevices = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return safeTelemetry.map((item) => item?.device || item);
    return safeTelemetry
      .map((item) => item?.device || item)
      .filter((device) => {
        const name = (device?.name ?? device?.vehicle ?? device?.alias ?? "").toString().toLowerCase();
        const plate = (device?.plate ?? device?.registrationNumber ?? device?.uniqueId ?? "").toString().toLowerCase();
        return name.includes(term) || plate.includes(term);
      });
  }, [safeTelemetry, query]);

  const rows = useMemo(() => {
    return searchFilteredDevices.map((device) => {
      const key = getDeviceKey(device);
      const telemetryItem = safeTelemetry.find((item) => getDeviceKey(item?.device || item) === key);
      const position = telemetryItem?.position;
      const lat = pickCoordinate([
        position?.latitude,
        position?.lat,
        position?.latitude_deg,
        position?.lat_deg,
      ]);
      const lng = pickCoordinate([
        position?.longitude,
        position?.lon,
        position?.lng,
        position?.lng_deg,
      ]);
      const badge = getStatusBadge(position, t);
      const lastUpdate = getLastUpdate(position);
      const lastEventName = telemetryItem?.lastEvent?.type || telemetryItem?.lastEvent?.event || telemetryItem?.lastEvent?.attributes?.alarm;
      return {
        key,
        device,
        deviceId: key,
        traccarId: device?.traccarId || telemetryItem?.traccarId,
        position,
        deviceName: device?.name ?? device?.vehicle ?? device?.alias ?? t("monitoring.unknownDevice"),
        plate: device?.plate ?? device?.vehicle?.plate ?? device?.registrationNumber ?? device?.uniqueId,
        vehicle: telemetryItem?.vehicle || device?.vehicle || null,
        lat,
        lng,
        statusBadge: badge,
        lastUpdate,
        lastEvent: telemetryItem?.lastEvent || null,
        lastEventName,
        locale,
        iconType: telemetryItem?.iconType || telemetryItem?.attributes?.iconType || device?.attributes?.iconType || null,
        onFocus: handleFocusOnMap,
        onReplay: handleReplay,
        address: position?.address,
      };
    });
  }, [dangerPoints, handleFocusOnMap, handleReplay, locale, safeTelemetry, searchFilteredDevices, t]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const { position } = row;
      const online = isOnline(position);
      const lastUpdate = getLastUpdate(position);
      const offlineMinutes = minutesSince(lastUpdate);
      switch (filterMode) {
        case "valid":
          return position?.valid === true;
        case "online":
          return online;
        case "offline":
          return !online && offlineMinutes > 5;
        case "ignition":
          return getIgnition(position, row.device) === true;
        default:
          return true;
      }
    });
  }, [filterMode, rows]);

  const markers = useMemo(() => {
    return filteredRows
      .map((row) => {
        if (!row?.position) return null;
        if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return null;
        const addressText = row.address;
        const displayAddress = addressText || t("monitoring.noAddress");
        const speed = pickSpeed(row.position);
        const lastUpdateLabel = formatDateTime(getLastUpdate(row.position), locale);
        const color =
          row.statusBadge?.status === "online"
            ? row.position?.motion
              ? "#22c55e"
              : "#10b981"
            : row.statusBadge?.status === "alert"
            ? "#facc15"
            : "#f87171";
        return {
          id: row.deviceId,
          lat: row.lat,
          lng: row.lng,
          status: row.statusBadge?.status,
          label: row.deviceName,
          plate: row.plate || null,
          address: displayAddress,
          iconType: row.iconType || null,
          speedLabel: speed !== null ? `${speed} km/h` : "—",
          statusLabel: row.statusBadge?.label,
          lastUpdateLabel,
          updatedTitle: t("monitoring.popup.serverTime"),
          color,
        };
      })
      .filter(Boolean);
  }, [filteredRows, locale, t]);

  const onlineCount = useMemo(() => filteredRows.filter((row) => isOnline(row.position)).length, [filteredRows]);
  const movingCount = useMemo(() => filteredRows.filter((row) => row.position?.motion || pickSpeed(row.position) > 0).length, [filteredRows]);
  const ignitionOnCount = useMemo(() => filteredRows.filter((row) => getIgnition(row.position, row.device) === true).length, [filteredRows]);
  const ignitionOffCount = useMemo(() => filteredRows.filter((row) => getIgnition(row.position, row.device) === false).length, [filteredRows]);

  const summary = {
    total: stats?.total ?? safeTelemetry.length,
    withPosition: stats?.withPosition ?? safeTelemetry.filter((item) => item?.position).length,
    online: onlineCount,
    offline: Math.max(0, (stats?.total ?? safeTelemetry.length) - onlineCount),
    moving: movingCount,
    ignitionOn: ignitionOnCount,
    ignitionOff: ignitionOffCount,
  };

  const selectedRow = useMemo(() => filteredRows.find((row) => row.deviceId === selectedDeviceId) || null, [filteredRows, selectedDeviceId]);

  const handleExport = useCallback(
    async (event) => {
      event?.preventDefault();
      const devices = filteredRows.map((row) => row.deviceId);
      if (!devices.length) return;
      await safeApi(
        API_ROUTES.reports.export,
        { method: "POST", body: { devices } },
        { onError: (error) => console.error("Export failed", error) },
      );
    },
    [filteredRows],
  );

  const mapHeight = layoutVisibility.showTable ? "60%" : "100%";
  const tableHeight = layoutVisibility.showMap ? "40%" : "100%";

  return (
    <div className="relative flex h-[calc(100vh-64px)] w-[calc(100%+3rem)] flex-col overflow-hidden bg-[#0b0f17] -m-6 md:-m-8 md:w-[calc(100%+4rem)]">
      {layoutVisibility.showMap ? (
        <div className="relative w-full flex-none" style={{ height: mapHeight }}>
          <MonitoringMap
            markers={markers}
            geofences={geofences}
            focusMarkerId={selectedDeviceId}
            height="100%"
            mapViewport={mapViewport}
            onViewportChange={setMapViewport}
          />

          <div className="pointer-events-none absolute top-4 left-4 right-4 z-[500] flex flex-col gap-3">
            <div className="pointer-events-auto flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-xs text-white/80 shadow-xl backdrop-blur-md">
              <div>
                <div className="text-sm font-semibold text-white">{t("monitoring.title")}</div>
                <div className="text-[11px] text-white/60">
                  {t("monitoring.showingDevices", { count: filteredRows.length })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/70">
                <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-emerald-100 shadow-sm">
                  Online: {summary.online}
                </span>
                <span className="rounded-full bg-red-500/20 px-3 py-1 text-red-100 shadow-sm">
                  Offline: {summary.offline}
                </span>
                <span className="rounded-full bg-sky-500/20 px-3 py-1 text-sky-100 shadow-sm">
                  Movendo: {summary.moving}
                </span>
                <button
                  type="button"
                  className="rounded-lg border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/80 shadow-sm transition hover:border-white/30 hover:bg-white/10"
                  onClick={handleExport}
                >
                  {t("monitoring.exportNow")}
                </button>
              </div>
            </div>

            <div className="pointer-events-auto">
              <MonitoringToolbar
                query={query}
                onQueryChange={setQuery}
                filterMode={filterMode}
                onFilterChange={setFilterMode}
                onOpenColumns={() => {
                  setShowColumns(true);
                  setShowLayoutMenu(false);
                }}
                onOpenLayout={() => {
                  setShowLayoutMenu(true);
                  setShowColumns(false);
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {layoutVisibility.showTable ? (
        <div className="relative w-full flex-none overflow-hidden bg-[#0b0f17]" style={{ height: tableHeight }}>
          <div className="absolute inset-0 z-10 overflow-hidden">
            <MonitoringTable
              rows={filteredRows}
              columns={visibleColumns}
              selectedDeviceId={selectedDeviceId}
              onSelect={setSelectedDeviceId}
              loading={loading}
              emptyText={t("monitoring.emptyState")}
            />
          </div>
          {showColumns ? (
            <div className="absolute right-4 top-3 z-[9999]">
              <MonitoringColumnSelector
                columns={allColumns}
                visibleState={columnPrefs.visible}
                onToggle={toggleColumn}
                onReorder={moveColumn}
                onRestore={restoreColumns}
                onClose={() => setShowColumns(false)}
              />
            </div>
          ) : null}
          {showLayoutMenu ? (
            <div className="absolute right-4 top-3 z-[9999]">
              <MonitoringLayoutSelector
                layoutVisibility={layoutVisibility}
                onToggle={(key) => setLayoutVisibility((current) => ({ ...current, [key]: !current[key] }))}
                onClose={() => setShowLayoutMenu(false)}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
