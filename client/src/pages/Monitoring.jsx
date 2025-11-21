import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "../lib/i18n.js";
import { useNavigate } from "react-router-dom";

import MonitoringMap from "../components/map/MonitoringMap.jsx";
import api from "../lib/api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { formatAddress } from "../lib/format-address.js";
import {
  deriveStatus,
  distanceInKm,
  getDeviceKey,
  getIgnition,
  getLastUpdate,
  formatDateTime,
  isOnline,
  minutesSince,
  pickCoordinate,
  pickSpeed,
} from "../lib/monitoring-helpers.js";
import useDevices from "../lib/hooks/useDevices";
import useHeatmapEvents from "../lib/hooks/useHeatmapEvents.js";
import useGeofences from "../lib/hooks/useGeofences.js";
import useUserPreferences from "../lib/hooks/useUserPreferences.js";
import Card from "../ui/Card.jsx";

const COLUMN_STORAGE_KEY = "monitoredTableColumns";

function formatIgnition(value, t) {
  if (value === true) return t("monitoring.ignitionOn");
  if (value === false) return t("monitoring.ignitionOff");
  return "—";
}

function getStatusBadge(position, t) {
  const status = deriveStatus(position);
  switch (status) {
    case "online":
      return {
        label: t("monitoring.status.online"),
        status,
        className: "inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200",
      };
    case "alert":
      return {
        label: t("monitoring.status.alert"),
        status,
        className: "inline-flex items-center rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200",
      };
    case "blocked":
      return {
        label: t("monitoring.status.blocked"),
        status,
        className: "inline-flex items-center rounded-full bg-purple-500/10 px-3 py-1 text-xs font-medium text-purple-200",
      };
    default:
      return {
        label: t("monitoring.status.offline"),
        status,
        className: "inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/60",
      };
  }
}


function buildColumns(t) {
  return [
    { key: "name", label: t("monitoring.columns.vehicle"), render: (row) => row.deviceName },
    { key: "plate", label: t("monitoring.columns.plate"), render: (row) => row.plate || "—" },
    { key: "id", label: t("monitoring.columns.id"), render: (row) => row.position?.id ?? "—" },
    { key: "deviceId", label: t("monitoring.columns.deviceId"), render: (row) => row.deviceId || "—" },
    { key: "protocol", label: t("monitoring.columns.protocol"), render: (row) => row.position?.protocol ?? "—" },
    {
      key: "serverTime",
      label: t("monitoring.columns.serverTime"),
      render: (row) => formatDateTime(getLastUpdate(row.position), row.locale),
    },
    {
      key: "deviceTime",
      label: t("monitoring.columns.deviceTime"),
      render: (row) => formatDateTime(row.position?.deviceTime ? new Date(row.position.deviceTime) : null, row.locale),
    },
    {
      key: "fixTime",
      label: t("monitoring.columns.fixTime"),
      render: (row) => formatDateTime(row.position?.fixTime ? new Date(row.position.fixTime) : null, row.locale),
    },
    { key: "valid", label: t("monitoring.columns.valid"), render: (row) => (row.position?.valid ? t("common.yes") : t("common.no")) },
    {
      key: "latitude",
      label: t("monitoring.columns.latitude"),
      render: (row) => (Number.isFinite(row.lat) ? row.lat.toFixed(5) : "—"),
    },
    {
      key: "longitude",
      label: t("monitoring.columns.longitude"),
      render: (row) => (Number.isFinite(row.lng) ? row.lng.toFixed(5) : "—"),
    },
    { key: "altitude", label: t("monitoring.columns.altitude"), render: (row) => row.position?.altitude ?? "—" },
    {
      key: "speed",
      label: t("monitoring.columns.speed"),
      render: (row) => {
        const speed = pickSpeed(row.position);
        return speed !== null ? `${speed} km/h` : "—";
      },
    },
    { key: "course", label: t("monitoring.columns.course"), render: (row) => row.position?.course ?? "—" },
    {
      key: "address",
      label: t("monitoring.columns.address"),
      render: (row) =>
        formatAddress(
          row.position?.formattedAddress ||
            row.position?.address ||
            row.position?.attributes?.address ||
            row.device?.address,
        ),
    },
    { key: "accuracy", label: t("monitoring.columns.accuracy"), render: (row) => row.position?.accuracy ?? "—" },
    {
      key: "geofenceIds",
      label: t("monitoring.columns.geofenceIds"),
      render: (row) => (row.position?.geofenceIds ? [].concat(row.position.geofenceIds).join(", ") : "—"),
    },
    { key: "type", label: t("monitoring.columns.type"), render: (row) => row.position?.type ?? "—" },
    { key: "status", label: t("monitoring.columns.status"), render: (row) => row.statusBadge?.label ?? "—" },
    {
      key: "ignition",
      label: t("monitoring.columns.ignition"),
      render: (row) => formatIgnition(getIgnition(row.position, row.device), t),
    },
    { key: "charge", label: t("monitoring.columns.charge"), render: (row) => row.position?.charge ?? row.position?.attributes?.charge ?? "—" },
    { key: "blocked", label: t("monitoring.columns.blocked"), render: (row) => (row.position?.blocked ? t("common.yes") : t("common.no")) },
    {
      key: "batteryLevel",
      label: t("monitoring.columns.batteryLevel"),
      render: (row) => row.position?.batteryLevel ?? row.position?.attributes?.batteryLevel ?? "—",
    },
    { key: "rssi", label: t("monitoring.columns.rssi"), render: (row) => row.position?.rssi ?? row.position?.attributes?.rssi ?? "—" },
    { key: "distance", label: t("monitoring.columns.distance"), render: (row) => row.position?.distance ?? "—" },
    { key: "totalDistance", label: t("monitoring.columns.totalDistance"), render: (row) => row.position?.totalDistance ?? "—" },
    { key: "motion", label: t("monitoring.columns.motion"), render: (row) => (row.position?.motion ? t("common.yes") : t("common.no")) },
    { key: "hours", label: t("monitoring.columns.hours"), render: (row) => row.position?.hours ?? row.position?.attributes?.hours ?? "—" },
    {
      key: "actions",
      label: t("monitoring.columns.actions"),
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
    },
  ];
}

function loadColumnPreferences(defaults) {
  try {
    const saved = localStorage.getItem(COLUMN_STORAGE_KEY);
    if (!saved) return defaults;
    const parsed = JSON.parse(saved);
    return {
      visible: parsed.visible || defaults.visible,
      order: parsed.order || defaults.order,
    };
  } catch (error) {
    return defaults;
  }
}

function saveColumnPreferences(prefs) {
  try {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(prefs));
  } catch (error) {
    // ignore
  }
}

function MapSection({ markers, geofences, focusMarkerId, t }) {
  if (typeof window === "undefined") {
    return (
      <div className="flex h-[360px] flex-col justify-center gap-2 p-6 text-sm text-white/60">
        <strong className="text-white/80">{t("monitoring.mapUnavailableTitle")}</strong>
        <span>{t("monitoring.mapUnavailableBody")}</span>
      </div>
    );
  }

  const hasMarkers = Array.isArray(markers) && markers.length > 0;

  try {
    return (
      <div className="relative h-[360px]">
        <MonitoringMap markers={markers} geofences={geofences} focusMarkerId={focusMarkerId} height={360} />
        {!hasMarkers ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl text-sm text-white/60">
            <span className="rounded-lg bg-black/50 px-3 py-2 shadow-lg shadow-black/40">
              {t("monitoring.noPositions")}
            </span>
          </div>
        ) : null}
      </div>
    );
  } catch (mapError) {
    console.error("Monitoring map render failed", mapError);
    return (
      <div className="flex h-[360px] flex-col justify-center gap-2 p-6 text-sm text-white/60">
        <strong className="text-white/80">{t("monitoring.mapLoadErrorTitle")}</strong>
        <span>{t("monitoring.mapLoadErrorBody")}</span>
      </div>
    );
  }
}

export default function Monitoring() {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const { devices, positionsByDeviceId, loading, error, reload, stats, liveStatus } = useDevices();
  const { points: dangerPoints } = useHeatmapEvents({ eventType: "crime" });
  const { geofences } = useGeofences({ autoRefreshMs: 60_000 });
  const { preferences, loading: loadingPreferences, savePreferences, resetPreferences } = useUserPreferences();

  const [query, setQuery] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const [showColumns, setShowColumns] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportRange, setExportRange] = useState({
    from: new Date(Date.now() - 6 * 60 * 60 * 1000),
    to: new Date(),
  });
  const [exportColumns, setExportColumns] = useState([]);
  const [focusedMarkerId, setFocusedMarkerId] = useState(null);

  const allColumns = useMemo(() => buildColumns(t), [t]);
  const defaultPreferences = useMemo(
    () => ({
      visible: Object.fromEntries(allColumns.map((column) => [column.key, true])),
      order: allColumns.map((column) => column.key),
    }),
    [allColumns],
  );

  const mergeColumnPrefs = useCallback(
    (saved) => ({
      visible: { ...defaultPreferences.visible, ...(saved?.visible || {}) },
      order: saved?.order?.length ? saved.order : defaultPreferences.order,
    }),
    [defaultPreferences],
  );

  const [columnPrefs, setColumnPrefs] = useState(defaultPreferences);

  useEffect(() => {
    if (loadingPreferences) return;
    const saved = preferences?.monitoringTableColumns || loadColumnPreferences(defaultPreferences);
    setColumnPrefs(mergeColumnPrefs(saved));
    if (preferences?.monitoringDefaultFilters?.mode) {
      setFilterMode(preferences.monitoringDefaultFilters.mode);
    }
  }, [defaultPreferences, loadingPreferences, mergeColumnPrefs, preferences]);

  useEffect(() => {
    saveColumnPreferences(columnPrefs);
  }, [columnPrefs]);

  const persistColumnPrefs = useCallback(
    (next) => {
      saveColumnPreferences(next);
      if (!loadingPreferences) {
        savePreferences({ monitoringTableColumns: { visible: next.visible, order: next.order } }).catch((prefError) => {
          console.warn("Falha ao salvar preferências de colunas", prefError);
        });
      }
    },
    [loadingPreferences, savePreferences],
  );

  useEffect(() => {
    if (loadingPreferences) return;
    const currentMode = preferences?.monitoringDefaultFilters?.mode;
    if (currentMode === filterMode) return;
    savePreferences({
      monitoringDefaultFilters: { ...(preferences?.monitoringDefaultFilters || {}), mode: filterMode },
    }).catch((prefError) => console.warn("Falha ao salvar filtro padrão", prefError));
  }, [filterMode, loadingPreferences, preferences, savePreferences]);

  const visibleColumns = useMemo(() => {
    const visible = columnPrefs.visible || {};
    const order = columnPrefs.order || [];
    const ordered = order
      .map((key) => allColumns.find((column) => column.key === key))
      .filter(Boolean)
      .filter((column) => visible[column.key] !== false);
    const missing = allColumns.filter((column) => !order.includes(column.key) && visible[column.key] !== false);
    return [...ordered, ...missing];
  }, [allColumns, columnPrefs]);

  const handleFocusOnMap = useCallback((deviceId) => {
    if (!deviceId) return;
    setFocusedMarkerId(deviceId);
  }, []);

  const handleReplay = useCallback(
    (deviceId) => {
      if (!deviceId) return;
      navigate(`/trips?deviceId=${encodeURIComponent(deviceId)}`);
    },
    [navigate],
  );

  const safeDevices = useMemo(() => (Array.isArray(devices) ? devices : []), [devices]);
  const safePositions = useMemo(
    () => (positionsByDeviceId && typeof positionsByDeviceId === "object" ? positionsByDeviceId : {}),
    [positionsByDeviceId],
  );

  const deviceIndex = useMemo(() => {
    const map = new Map();
    for (const device of safeDevices) {
      const key = getDeviceKey(device);
      if (key) {
        map.set(key, device);
      }
    }
    return map;
  }, [safeDevices]);

  const searchFilteredDevices = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return safeDevices;
    return safeDevices.filter((device) => {
      const name = (device?.name ?? device?.vehicle ?? device?.alias ?? "").toString().toLowerCase();
      const plate = (device?.plate ?? device?.registrationNumber ?? device?.uniqueId ?? "").toString().toLowerCase();
      return name.includes(term) || plate.includes(term);
    });
  }, [safeDevices, query]);

  const rows = useMemo(() => {
    return searchFilteredDevices.map((device) => {
      const key = getDeviceKey(device);
      const position = key ? safePositions[key] : undefined;
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
      const riskZone = dangerPoints.some((point) => {
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
        if (!point?.lat || !point?.lng) return false;
        return distanceInKm({ lat, lng }, { lat: point.lat, lng: point.lng }) <= 2;
      });
      return {
        key,
        device,
        deviceId: key,
        position,
        deviceName: device?.name ?? device?.vehicle ?? device?.alias ?? t("monitoring.unknownDevice"),
        plate: device?.plate ?? device?.registrationNumber ?? device?.uniqueId,
        lat,
        lng,
        statusBadge: badge,
        lastUpdate,
        riskZone,
        locale,
        onFocus: handleFocusOnMap,
        onReplay: handleReplay,
      };
    });
  }, [dangerPoints, handleFocusOnMap, handleReplay, locale, safePositions, searchFilteredDevices, t]);

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
        case "danger":
          return row.riskZone;
        default:
          return true;
      }
    });
  }, [filterMode, rows]);

  const markers = useMemo(() => {
    return filteredRows
      .map((row) => {
        if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return null;
        const address =
          formatAddress(
            row.position?.formattedAddress ||
              row.position?.address ||
              row.position?.attributes?.address ||
              row.device?.address,
          ) || t("monitoring.noAddress");
        const speed = pickSpeed(row.position);
        const lastUpdateLabel = formatDateTime(getLastUpdate(row.position), locale);
        const distance = row.position?.totalDistance ?? row.position?.distance;
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
          address,
          speedLabel: speed !== null ? `${speed} km/h` : "—",
          speedTitle: t("monitoring.popup.speed"),
          statusLabel: row.statusBadge?.label,
          statusTitle: t("monitoring.popup.status"),
          lastUpdateLabel,
          updatedTitle: t("monitoring.popup.serverTime"),
          color,
        };
      })
      .filter(Boolean);
  }, [filteredRows, locale, t]);

  const onlineCount = useMemo(() => filteredRows.filter((row) => isOnline(row.position)).length, [filteredRows]);
  const movingCount = useMemo(() => filteredRows.filter((row) => row.position?.motion || pickSpeed(row.position) > 0).length, [filteredRows]);
  const ignitionOnCount = useMemo(
    () => filteredRows.filter((row) => getIgnition(row.position, row.device) === true).length,
    [filteredRows],
  );
  const ignitionOffCount = useMemo(
    () => filteredRows.filter((row) => getIgnition(row.position, row.device) === false).length,
    [filteredRows],
  );

  const summary = {
    total: stats?.total ?? safeDevices.length,
    withPosition: stats?.withPosition ?? Object.keys(safePositions).length,
    online: onlineCount,
    offline: Math.max(0, (stats?.total ?? safeDevices.length) - onlineCount),
    moving: movingCount,
    ignitionOn: ignitionOnCount,
    ignitionOff: ignitionOffCount,
  };

  const visibleColumnCount = Math.max(1, visibleColumns.length);

  const handleToggleColumn = useCallback(
    (key) => {
      setColumnPrefs((current) => {
        const isVisible = current.visible?.[key] !== false;
        const next = { ...current, visible: { ...current.visible, [key]: !isVisible } };
        persistColumnPrefs(next);
        return next;
      });
    },
    [persistColumnPrefs],
  );

  const handleRestoreColumns = useCallback(() => {
    const next = mergeColumnPrefs(defaultPreferences);
    setColumnPrefs(next);
    persistColumnPrefs(next);
    resetPreferences().catch((prefError) => console.warn("Falha ao restaurar preferências", prefError));
    setFilterMode("all");
  }, [defaultPreferences, mergeColumnPrefs, persistColumnPrefs, resetPreferences]);

  const handleExport = useCallback(
    async (event) => {
      event.preventDefault();
      try {
        const params = {
          from: exportRange.from?.toISOString(),
          to: exportRange.to?.toISOString(),
        };
        const deviceIds = filteredRows.map((row) => row.deviceId).filter(Boolean);
        if (deviceIds.length) {
          params.deviceId = deviceIds.join(",");
        }
        if (exportColumns.length) {
          params.columns = exportColumns.join(",");
        }
        const response = await api.get(API_ROUTES.positionsExport, {
          params,
          responseType: "blob",
        });
        const blob = new Blob([response.data], { type: "text/csv;charset=utf-8" });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `positions-export-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        window.URL.revokeObjectURL(url);
        setShowExportModal(false);
      } catch (exportError) {
        console.error("Falha ao exportar CSV", exportError);
        alert(t("monitoring.exportError"));
      }
    },
    [exportColumns, exportRange.from, exportRange.to, filteredRows, t],
  );

  useEffect(() => {
    if (showExportModal) {
      setExportColumns(visibleColumns.map((column) => column.key));
    }
  }, [showExportModal, visibleColumns]);

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <div className="font-medium">{t("monitoring.loadErrorTitle")}</div>
          <div className="mt-1 text-xs opacity-80">{error.message ?? t("monitoring.loadErrorBody")}</div>
        </div>
      )}

      {liveStatus?.fallback && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          <div className="font-medium">{t("monitoring.liveFallback")}</div>
          {liveStatus?.fallbackMessage && (
            <div className="mt-1 text-xs opacity-80">{liveStatus.fallbackMessage}</div>
          )}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {["all", "valid", "online", "offline", "danger"].map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setFilterMode(mode)}
              className={`rounded-full border px-4 py-2 text-xs font-semibold transition ${
                filterMode === mode
                  ? "border-primary/60 bg-primary/20 text-primary"
                  : "border-white/10 bg-white/5 text-white/70 hover:border-white/20"
              }`}
            >
              {t(`monitoring.filters.${mode}`)}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className="btn" onClick={() => setShowExportModal(true)}>
              {t("monitoring.exportCsv")}
            </button>
            <button type="button" className="btn" onClick={reload} disabled={loading}>
              {loading ? t("monitoring.refreshing") : t("monitoring.refresh")}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card className="p-6">
            <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium text-white">{t("monitoring.mapTitle")}</div>
                <div className="text-xs text-white/50">
                  {loading
                    ? t("monitoring.syncing")
                    : t("monitoring.withPosition", { count: summary.withPosition })}
                </div>
              </div>
            </header>

            <div className="mt-4 overflow-hidden rounded-xl border border-white/5 bg-white/5">
              <MapSection markers={markers} geofences={geofences} focusMarkerId={focusedMarkerId} t={t} />
            </div>
          </Card>

          <Card className="space-y-4 p-6">
            <div>
              <div className="text-sm font-medium text-white">{t("monitoring.fleetSummary")}</div>
              <div className="text-xs text-white/50">{t("monitoring.fleetSummarySubtitle")}</div>
            </div>
            <dl className="space-y-3 text-sm text-white/80">
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <dt className="text-white/60">{t("monitoring.totalDevices")}</dt>
                <dd className="text-base font-semibold text-white">{summary.total}</dd>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <dt className="text-white/60">{t("monitoring.withValidPosition")}</dt>
                <dd className="text-base font-semibold text-white">{summary.withPosition}</dd>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <dt className="text-white/60">{t("monitoring.onlineNow")}</dt>
                <dd className="text-base font-semibold text-emerald-200">{summary.online}</dd>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <dt className="text-white/60">{t("monitoring.noRecentSignal")}</dt>
                <dd className="text-base font-semibold text-white/70">{summary.offline}</dd>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <dt className="text-white/60">{t("monitoring.moving")}</dt>
                <dd className="text-base font-semibold text-sky-200">{summary.moving}</dd>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <dt className="text-white/60">{t("monitoring.ignitionOnNow")}</dt>
                <dd className="text-base font-semibold text-amber-200">{summary.ignitionOn}</dd>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <dt className="text-white/60">{t("monitoring.ignitionOffNow")}</dt>
                <dd className="text-base font-semibold text-white/70">{summary.ignitionOff}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </section>

      <Card className="card" padding={false}>
        <header className="flex flex-col gap-4 border-b border-white/5 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-medium text-white">{t("monitoring.tableTitle")}</div>
            <div className="text-xs text-white/50">
              {loading
                ? t("monitoring.updating")
                : t("monitoring.showingDevices", { count: filteredRows.length })}
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("monitoring.searchPlaceholder")}
              className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder:text-white/40 focus:border-primary/40 focus:outline-none sm:w-64"
            />
            <div className="relative">
              <button type="button" className="btn" onClick={() => setShowColumns((value) => !value)}>
                {t("monitoring.columnsButton")}
              </button>
              {showColumns && (
                <div className="absolute right-0 z-10 mt-2 w-56 rounded-xl border border-white/10 bg-[#0f141c] p-3 text-sm text-white/80 shadow-xl">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
                    {t("monitoring.showColumns")}
                  </div>
                  {allColumns.map((column) => (
                    <label key={column.key} className="flex items-center justify-between py-1">
                      <span className="text-white/70">{column.label}</span>
                      <input
                        type="checkbox"
                        checked={columnPrefs.visible?.[column.key] !== false}
                        onChange={() => handleToggleColumn(column.key)}
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    className="mt-3 w-full rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold text-white/80 hover:border-white/30"
                    onClick={handleRestoreColumns}
                  >
                    {t("monitoring.restoreDefaults")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/40">
              <tr>
                {visibleColumns.map((column) => (
                  <th key={column.key} className="px-6 py-3">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.key ?? row.deviceId ?? row.device?.id} className="border-b border-white/5 last:border-none">
                  {visibleColumns.map((column) => (
                    <td key={column.key} className="px-6 py-3 text-white/80">
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}

              {!loading && filteredRows.length === 0 && (
                <tr>
                  <td colSpan={visibleColumnCount} className="px-6 py-8 text-center text-sm text-white/50">
                    {t("monitoring.emptyState")}
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td colSpan={visibleColumnCount} className="px-6 py-8 text-center text-sm text-white/50">
                    {t("monitoring.loadingTelemetry")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#0f141c] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-white">{t("monitoring.exportTitle")}</div>
                <div className="text-xs text-white/60">{t("monitoring.exportSubtitle")}</div>
              </div>
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/70 hover:border-white/30"
              >
                {t("monitoring.close")}
              </button>
            </div>

            <form className="mt-4 space-y-4" onSubmit={handleExport}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1 text-sm text-white/80">
                  <span className="text-white/60">{t("monitoring.from")}</span>
                  <input
                    type="datetime-local"
                    value={exportRange.from ? new Date(exportRange.from).toISOString().slice(0, 16) : ""}
                    onChange={(event) =>
                      setExportRange((current) => ({ ...current, from: new Date(event.target.value) }))
                    }
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/40 focus:outline-none"
                  />
                </label>
                <label className="space-y-1 text-sm text-white/80">
                  <span className="text-white/60">{t("monitoring.to")}</span>
                  <input
                    type="datetime-local"
                    value={exportRange.to ? new Date(exportRange.to).toISOString().slice(0, 16) : ""}
                    onChange={(event) =>
                      setExportRange((current) => ({ ...current, to: new Date(event.target.value) }))
                    }
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/40 focus:outline-none"
                  />
                </label>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-white/50">{t("monitoring.selectColumns")}</div>
                <div className="mt-2 grid max-h-48 grid-cols-2 gap-2 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80">
                  {allColumns.map((column) => (
                    <label key={column.key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={exportColumns.includes(column.key)}
                        onChange={() => {
                          setExportColumns((current) =>
                            current.includes(column.key)
                              ? current.filter((key) => key !== column.key)
                              : [...current, column.key],
                          );
                        }}
                      />
                      <span>{column.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-lg px-4 py-2 text-sm text-white/70 hover:text-white"
                  onClick={() => setShowExportModal(false)}
                >
                  {t("monitoring.cancel")}
                </button>
                <button type="submit" className="btn">
                  {t("monitoring.exportNow")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
