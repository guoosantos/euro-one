import React, { useCallback, useEffect, useMemo, useState } from "react";

import VehicleSelector from "../components/VehicleSelector.jsx";
import MonitoringTable from "../components/monitoring/MonitoringTable.jsx";
import MonitoringColumnSelector from "../components/monitoring/MonitoringColumnSelector.jsx";
import useVehicleSelection from "../lib/hooks/useVehicleSelection.js";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { useTranslation } from "../lib/i18n.js";
import { formatAddress } from "../lib/format-address.js";
import {
  loadColumnPreferences,
  mergeColumnPreferences,
  resolveVisibleColumns,
  saveColumnPreferences,
} from "../lib/column-preferences.js";
import { buildColumnPreset, EURO_PRESET_KEYS } from "../lib/report-column-presets.js";
import {
  buildAddressWithLatLng,
  resolveReportColumnLabel,
  resolveReportColumnTooltip,
} from "../lib/report-column-labels.js";

const PAGE_SIZE_OPTIONS = [100, 250, 500, 1000];
const COLUMN_STORAGE_KEY = "reports:analytic:columns";

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatSpeed(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (!Number.isFinite(Number(value))) return String(value);
  return `${Number(value)} km/h`;
}

function formatBoolean(value, yesLabel, noLabel) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  return value ? yesLabel : noLabel;
}

function resolveCommandStatusLabel(status, t) {
  if (!status) return t("reportsAnalytic.status.pending");
  const normalized = String(status).toUpperCase();
  if (normalized === "RESPONDED") return t("reportsAnalytic.status.success");
  if (normalized === "ERROR") return t("reportsAnalytic.status.failure");
  if (normalized === "SENT" || normalized === "PENDING") return t("reportsAnalytic.status.pending");
  if (normalized === "TIMEOUT") return t("reportsAnalytic.status.timeout");
  if (normalized === "UNSUPPORTED") return t("reportsAnalytic.status.unsupported");
  return status;
}

function resolveEventLabel(entry, t) {
  if (entry.type === "position") return t("reportsAnalytic.event.position");
  if (entry.type === "command") {
    const name = entry.commandName || t("reportsAnalytic.commandFallback");
    return t("reportsAnalytic.event.commandSent", { name });
  }
  if (entry.type === "command_response") {
    const name = entry.commandName || t("reportsAnalytic.commandFallback");
    return t("reportsAnalytic.event.commandResponse", { name });
  }
  const eventName = entry.eventType || entry.eventDescription || t("reportsAnalytic.event.generic");
  return eventName;
}

function resolveCriticalityLabel(entry, t) {
  const severity = entry.severity ? String(entry.severity).toLowerCase() : null;
  const known = new Set(["critical", "high", "medium", "low", "info"]);
  if (severity && known.has(severity)) return t(`severity.${severity}`);
  if (entry.isCritical) return t("severity.critical");
  return "—";
}

export default function ReportsAnalytic() {
  const { t } = useTranslation();
  const { selectedVehicleId, selectedVehicle } = useVehicleSelection({ syncQuery: true });
  const [from, setFrom] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [typeFilter, setTypeFilter] = useState("all");
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [geofenceFilter, setGeofenceFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [entries, setEntries] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [activePopup, setActivePopup] = useState(null);
  const [exportingCsv, setExportingCsv] = useState(false);

  const columns = useMemo(
    () => [
      {
        key: "occurredAt",
        label: resolveReportColumnLabel("occurredAt", t("reportsAnalytic.columns.datetime")),
        fullLabel: resolveReportColumnTooltip("occurredAt", t("reportsAnalytic.columns.datetime")),
        width: 160,
        minWidth: 140,
      },
      {
        key: "event",
        label: resolveReportColumnLabel("event", t("reportsAnalytic.columns.event")),
        fullLabel: resolveReportColumnTooltip("event", t("reportsAnalytic.columns.event")),
        width: 240,
        minWidth: 200,
      },
      {
        key: "address",
        label: resolveReportColumnLabel("address", t("reportsAnalytic.columns.address")),
        fullLabel: resolveReportColumnTooltip("address", t("reportsAnalytic.columns.address")),
        width: 320,
        minWidth: 260,
        render: (row) => buildAddressWithLatLng(row.address, row.lat, row.lng),
      },
      {
        key: "criticality",
        label: resolveReportColumnLabel("criticality", "Criticidade"),
        fullLabel: resolveReportColumnTooltip("criticality", "Criticidade"),
        width: 110,
        minWidth: 100,
      },
      {
        key: "geofence",
        label: resolveReportColumnLabel("geofence", t("reportsAnalytic.columns.geofence")),
        fullLabel: resolveReportColumnTooltip("geofence", t("reportsAnalytic.columns.geofence")),
        width: 140,
        minWidth: 120,
      },
      {
        key: "ioSummary",
        label: resolveReportColumnLabel("ioSummary", "Entradas/Saídas"),
        fullLabel: resolveReportColumnTooltip("ioSummary", "Entradas/Saídas"),
        width: 140,
        minWidth: 120,
      },
      {
        key: "ignition",
        label: resolveReportColumnLabel("ignition", t("reportsAnalytic.columns.ignition")),
        fullLabel: resolveReportColumnTooltip("ignition", t("reportsAnalytic.columns.ignition")),
        width: 90,
        minWidth: 80,
      },
      {
        key: "vehicleVoltage",
        label: resolveReportColumnLabel("vehicleVoltage", t("reportsAnalytic.columns.voltage")),
        fullLabel: resolveReportColumnTooltip("vehicleVoltage", t("reportsAnalytic.columns.voltage")),
        width: 110,
        minWidth: 100,
      },
      {
        key: "speed",
        label: resolveReportColumnLabel("speed", t("reportsAnalytic.columns.speed")),
        fullLabel: resolveReportColumnTooltip("speed", t("reportsAnalytic.columns.speed")),
        width: 90,
        minWidth: 80,
      },
      {
        key: "audit",
        label: resolveReportColumnLabel("audit", "Auditoria"),
        fullLabel: resolveReportColumnTooltip("audit", "Auditoria"),
        width: 180,
        minWidth: 140,
      },
    ],
    [t],
  );

  const defaultPrefs = useMemo(
    () => buildColumnPreset(columns, EURO_PRESET_KEYS),
    [columns],
  );
  const [columnPrefs, setColumnPrefs] = useState(() => loadColumnPreferences(COLUMN_STORAGE_KEY, defaultPrefs));

  useEffect(() => {
    setColumnPrefs((prev) => mergeColumnPreferences(defaultPrefs, prev));
  }, [defaultPrefs]);

  const visibleColumns = useMemo(
    () => resolveVisibleColumns(columns, columnPrefs),
    [columns, columnPrefs],
  );

  const visibleColumnsWithWidths = useMemo(
    () =>
      visibleColumns.map((column) => ({
        ...column,
        width: columnPrefs?.widths?.[column.key] ?? column.width,
      })),
    [visibleColumns, columnPrefs],
  );

  const handleColumnWidthChange = useCallback(
    (key, width) => {
      setColumnPrefs((prev) => {
        const next = { ...prev, widths: { ...(prev?.widths || {}), [key]: width } };
        saveColumnPreferences(COLUMN_STORAGE_KEY, next);
        return next;
      });
    },
    [],
  );

  const handleApplyColumns = useCallback(
    (next) => {
      setColumnPrefs(next);
      saveColumnPreferences(COLUMN_STORAGE_KEY, next);
    },
    [],
  );

  const handleRestoreColumns = useCallback(() => {
    setColumnPrefs(defaultPrefs);
    saveColumnPreferences(COLUMN_STORAGE_KEY, defaultPrefs);
  }, [defaultPrefs]);

  const fetchReport = useCallback(async () => {
    if (!selectedVehicleId) return;
    setLoading(true);
    setError(null);
    try {
      const params = {
        vehicleId: selectedVehicleId,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        page,
        limit: pageSize,
        type: typeFilter,
        geofence: geofenceFilter,
        criticalOnly: criticalOnly ? "true" : "false",
      };
      const { data, error: requestError } = await safeApi.get(API_ROUTES.reports.analytic, { params });
      if (requestError) throw requestError;
      const payload = data?.data || data?.items || data?.entries || [];
      setEntries(Array.isArray(payload) ? payload : []);
      setMeta(data?.meta || null);
    } catch (requestError) {
      setError(requestError);
      setEntries([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, [criticalOnly, from, geofenceFilter, page, pageSize, selectedVehicleId, to, typeFilter]);

  useEffect(() => {
    if (!hasGenerated) return;
    fetchReport();
  }, [fetchReport, hasGenerated]);

  const handleSubmit = (event) => {
    event.preventDefault();
    setPage(1);
    setHasGenerated(true);
    fetchReport();
  };

  const totalItems = meta?.totalItems ?? entries.length;
  const totalPages = meta?.totalPages ?? 1;
  const currentPage = meta?.page ?? page;

  const rows = useMemo(
    () =>
      entries.map((entry) => {
        const commandStatus = entry.commandStatus ? resolveCommandStatusLabel(entry.commandStatus, t) : null;
        const commandResult = entry.commandResult ? `${commandStatus ? `${commandStatus} · ` : ""}${entry.commandResult}` : commandStatus;
        const eventLabel = resolveEventLabel(entry, t);
        const ignitionLabel = formatBoolean(entry.ignition, t("common.yes"), t("common.no"));
        const audit =
          entry.userName
            ? `${entry.userName}${entry.auditAction ? ` · ${entry.auditAction}` : ""}`
            : entry.auditSummary || "—";
        return {
          key: entry.id || `${entry.type}-${entry.occurredAt}`,
          occurredAt: formatDateTime(entry.occurredAt),
          event: entry.type === "command_response" && commandResult ? `${eventLabel} (${commandResult})` : eventLabel,
          address: formatAddress(entry.address),
          rawAddress: entry.address,
          lat: entry.latitude ?? entry.lat ?? null,
          lng: entry.longitude ?? entry.lng ?? null,
          criticality: resolveCriticalityLabel(entry, t),
          speed: formatSpeed(entry.speed),
          ignition: ignitionLabel,
          ioSummary: entry.ioSummary || "—",
          geofence: entry.geofence || "—",
          jamming: formatBoolean(entry.jamming, t("common.yes"), t("common.no")),
          vehicleVoltage: entry.vehicleVoltage ? `${entry.vehicleVoltage} V` : "—",
          audit,
        };
      }),
    [entries, t],
  );

  const handleExportCsv = useCallback(() => {
    if (!rows.length) return;
    setExportingCsv(true);
    try {
      const headers = visibleColumns.map((column) => column.label);
      const toCsvValue = (value) => {
        if (value === null || value === undefined) return "";
        if (typeof value === "number") return String(value);
        if (typeof value === "boolean") return value ? t("common.yes") : t("common.no");
        if (typeof value === "string") return value;
        return String(value);
      };
      const escapeCsv = (value) => `"${String(value).replace(/\"/g, '""')}"`;
      const lines = [
        headers.map(escapeCsv).join(";"),
        ...rows.map((row) =>
          visibleColumns.map((column) => escapeCsv(toCsvValue(row[column.key]))).join(";"),
        ),
      ];
      const csv = `\ufeff${lines.join("\n")}`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const plate = selectedVehicle?.plate || selectedVehicle?.name || "veiculo";
      const fileName = `relatorio-analitico-${String(plate).replace(/\s+/g, "-")}.csv`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    } finally {
      setExportingCsv(false);
    }
  }, [rows, selectedVehicle, t, visibleColumns]);

  return (
    <div className="space-y-4">
      <section className="card space-y-4">
        <header>
          <h2 className="text-lg font-semibold">{t("reportsAnalytic.title")}</h2>
          <p className="text-xs text-white/60">{t("reportsAnalytic.subtitle")}</p>
        </header>

        <form onSubmit={handleSubmit} className="filters grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <VehicleSelector />
          </div>
          <label className="text-xs text-white/60">
            {t("from")}
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="input mt-1"
              required
            />
          </label>
          <label className="text-xs text-white/60">
            {t("to")}
            <input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="input mt-1"
              required
            />
          </label>
          <label className="text-xs text-white/60">
            {t("reportsAnalytic.filters.type")}
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="input mt-1"
            >
              <option value="all">{t("reportsAnalytic.filters.all")}</option>
              <option value="position">{t("reportsAnalytic.filters.position")}</option>
              <option value="event">{t("reportsAnalytic.filters.event")}</option>
              <option value="command">{t("reportsAnalytic.filters.command")}</option>
              <option value="response">{t("reportsAnalytic.filters.response")}</option>
              <option value="audit">{t("reportsAnalytic.filters.audit")}</option>
              <option value="critical">{t("reportsAnalytic.filters.critical")}</option>
            </select>
          </label>
          <label className="text-xs text-white/60">
            {t("reportsAnalytic.filters.geofence")}
            <select
              value={geofenceFilter}
              onChange={(event) => setGeofenceFilter(event.target.value)}
              className="input mt-1"
            >
              <option value="all">{t("reportsAnalytic.filters.geofenceAll")}</option>
              <option value="inside">{t("reportsAnalytic.filters.geofenceInside")}</option>
              <option value="outside">{t("reportsAnalytic.filters.geofenceOutside")}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-white/60 md:col-span-2 md:mt-6">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-white/30 bg-transparent"
              checked={criticalOnly}
              onChange={(event) => setCriticalOnly(event.target.checked)}
            />
            {t("reportsAnalytic.filters.criticalOnly")}
          </label>
          <div className="flex items-center gap-2 md:col-span-4">
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
              disabled={!selectedVehicleId || loading}
            >
              {loading ? t("reportsAnalytic.loading") : t("reportsAnalytic.generate")}
            </button>
            <button
              type="button"
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-white/80 hover:bg-white/10"
              onClick={() => setActivePopup("columns")}
            >
              {t("monitoring.columnsButton")}
            </button>
            <button
              type="button"
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-white/80 hover:bg-white/10 disabled:opacity-60"
              onClick={handleExportCsv}
              disabled={!rows.length || exportingCsv}
            >
              {exportingCsv ? t("reportsAnalytic.loading") : "Exportar CSV (Excel)"}
            </button>
            <div className="flex items-center gap-2 text-xs text-white/60">
              <span>{t("reportsAnalytic.pagination.pageSize")}</span>
              <select
                className="input py-1"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
            <span className="ml-auto text-xs text-white/50">
              {t("reportsAnalytic.pagination.total", { count: totalItems })}
            </span>
          </div>
        </form>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error.message || t("reportsAnalytic.loadError")}
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/80">{t("reportsAnalytic.timelineTitle")}</h3>
          <span className="text-xs text-white/60">
            {t("reportsAnalytic.pagination.pageInfo", { current: currentPage, total: totalPages })}
          </span>
        </header>

        <div className="h-[520px]">
          <MonitoringTable
            rows={rows}
            columns={visibleColumnsWithWidths}
            loading={loading}
            emptyText={hasGenerated ? t("reportsAnalytic.empty") : t("reportsAnalytic.emptyBefore")}
            liveGeocode={false}
            columnWidths={columnPrefs?.widths}
            onColumnWidthChange={handleColumnWidthChange}
          />
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-1 text-xs text-white/70 hover:bg-white/10 disabled:opacity-50"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPage <= 1 || loading}
          >
            {t("reportsAnalytic.pagination.prev")}
          </button>
          <div className="text-xs text-white/60">
            {t("reportsAnalytic.pagination.pageInfo", { current: currentPage, total: totalPages })}
          </div>
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-1 text-xs text-white/70 hover:bg-white/10 disabled:opacity-50"
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={currentPage >= totalPages || loading}
          >
            {t("reportsAnalytic.pagination.next")}
          </button>
        </div>
      </section>

      {activePopup === "columns" && (
        <MonitoringColumnSelector
          columns={columns}
          columnPrefs={columnPrefs}
          defaultPrefs={defaultPrefs}
          onApply={handleApplyColumns}
          onRestore={handleRestoreColumns}
          onClose={() => setActivePopup(null)}
        />
      )}
    </div>
  );
}
