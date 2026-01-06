import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import VehicleSelector from "../components/VehicleSelector.jsx";
import MonitoringTable from "../components/monitoring/MonitoringTable.jsx";
import MonitoringColumnSelector from "../components/monitoring/MonitoringColumnSelector.jsx";
import useVehicleSelection from "../lib/hooks/useVehicleSelection.js";
import useAnalyticReport from "../lib/hooks/useAnalyticReport.js";
import { useTranslation } from "../lib/i18n.js";
import { formatAddress } from "../lib/format-address.js";
import { resolveEventDefinition } from "../lib/event-translations.js";
import {
  loadColumnPreferences,
  mergeColumnPreferences,
  resolveVisibleColumns,
  saveColumnPreferences,
} from "../lib/column-preferences.js";
import { buildColumnPreset, EURO_ANALYTIC_PRESET_KEYS } from "../lib/report-column-presets.js";
import {
  buildAddressWithLatLng,
  resolveReportColumnLabel,
  resolveReportColumnTooltip,
} from "../lib/report-column-labels.js";
import buildPositionsSchema from "../../../shared/buildPositionsSchema.js";
import { positionsColumns, resolveColumnLabel } from "../../../shared/positionsColumns.js";
import { resolveTelemetryDescriptor } from "../../../shared/telemetryDictionary.js";
import { resolveSensorLabel } from "../i18n/sensors.ptBR.js";

const PAGE_SIZE_OPTIONS = [20, 50, 100, 500, 1000, 5000];
const DEFAULT_PAGE_SIZE = 100;
const COLUMN_STORAGE_KEY = "reports:analytic:columns";

const FALLBACK_COLUMNS = positionsColumns.map((column) => {
  const label = resolveColumnLabel(column, "pt");
  return {
    ...column,
    label: resolveSensorLabel({ name: label, key: column.key }),
  };
});

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

function formatVehicleVoltage(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (!Number.isFinite(Number(value))) return String(value);
  return `${Number(value).toFixed(2)} V`;
}

function formatByDescriptor(key, value) {
  const descriptor = resolveTelemetryDescriptor(key);
  if (!descriptor) return value ?? "—";
  if (value === null || value === undefined || value === "") return "—";
  if (descriptor.type === "boolean") {
    if (typeof value === "string") return value;
    return value ? "Ativo" : "Inativo";
  }
  if (descriptor.type === "number") {
    if (!Number.isFinite(Number(value))) return String(value);
    const formatted = Number(value).toFixed(2);
    return descriptor.unit ? `${formatted} ${descriptor.unit}`.trim() : formatted;
  }
  if (descriptor.type === "string") {
    const text = String(value || "").trim();
    return text || "—";
  }
  return value ?? "—";
}

function formatIgnition(value) {
  if (value === null || value === undefined) return "Indisponível";
  return value ? "Ligada" : "Desligada";
}

function formatIoState(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return value;
}

function formatDynamicValue(key, value, definition) {
  const descriptor = resolveTelemetryDescriptor(key);
  if (descriptor) return formatByDescriptor(key, value);
  if (value === null || value === undefined || value === "") return "—";
  if (definition?.type === "boolean") return value ? "Sim" : "Não";
  if (definition?.type === "percent") {
    return Number.isFinite(Number(value)) ? `${Number(value)}%` : String(value);
  }
  if (definition?.type === "number") {
    if (!Number.isFinite(Number(value))) return String(value);
    const formatted = Number(value).toFixed(2);
    return definition.unit ? `${formatted} ${definition.unit}`.trim() : formatted;
  }
  return value;
}

function normalizeAddressDisplay(value) {
  if (!value) return "Endereço indisponível";
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || "Endereço indisponível";
  }
  if (value && typeof value === "object") {
    const withFormatted = value.formatted || value.formattedAddress || value.formatted_address;
    if (withFormatted && typeof withFormatted === "string") {
      const formatted = withFormatted.trim();
      if (formatted) return formatted;
    }
  }
  try {
    const formatted = formatAddress(value);
    return formatted && formatted !== "—" ? formatted : "Endereço indisponível";
  } catch (_error) {
    return "Endereço indisponível";
  }
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
  const definition = resolveEventDefinition(
    entry.eventType || entry.eventDescription,
    "pt-BR",
    t,
    entry.protocol,
    entry,
  );
  const label = definition?.label || entry.eventDescription || t("reportsAnalytic.event.generic");
  return label;
}

function resolveCriticalityLabel(entry, t) {
  const severity = entry.severity ? String(entry.severity).toLowerCase() : null;
  const known = new Set(["critical", "high", "medium", "low", "info"]);
  if (severity && known.has(severity)) return t(`severity.${severity}`);
  if (entry.isCritical) return t("severity.critical");
  return "—";
}

function normalizeColumnLabel(column) {
  if (!column) return column;
  const baseLabel = resolveSensorLabel({ name: column.label || column.labelPt, key: column.key });
  const label = resolveReportColumnLabel(column.key, baseLabel);
  const tooltip = resolveReportColumnTooltip(column.key, column.label || column.labelPt || label);
  return {
    ...column,
    label,
    labelPt: label,
    labelPdf: column.labelPdf || label,
    fullLabel: tooltip,
  };
}

export default function ReportsAnalytic() {
  const { t } = useTranslation();
  const { selectedVehicleId, selectedVehicle } = useVehicleSelection({ syncQuery: true });
  const { data, loading, error, generate, exportPdf, exportXlsx, exportCsv } = useAnalyticReport();

  const [from, setFrom] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [typeFilter, setTypeFilter] = useState("all");
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [geofenceFilter, setGeofenceFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [activePopup, setActivePopup] = useState(null);
  const [topBarVisible, setTopBarVisible] = useState(true);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfColumns, setPdfColumns] = useState([]);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportFormat, setExportFormat] = useState("pdf");
  const lastQueryRef = useRef(null);

  const entries = data?.entries || [];
  const meta = data?.meta || null;

  const baseColumns = useMemo(
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
        key: "ignition",
        label: resolveReportColumnLabel("ignition", t("reportsAnalytic.columns.ignition")),
        fullLabel: resolveReportColumnTooltip("ignition", t("reportsAnalytic.columns.ignition")),
        width: 100,
        minWidth: 90,
      },
      {
        key: "geozoneInside",
        label: resolveReportColumnLabel("geozoneInside", t("reportsAnalytic.columns.geozoneInside")),
        fullLabel: resolveReportColumnTooltip("geozoneInside", t("reportsAnalytic.columns.geozoneInside")),
        width: 130,
        minWidth: 120,
      },
      {
        key: "digitalInput2",
        label: resolveReportColumnLabel("digitalInput2", t("reportsAnalytic.columns.input2")),
        fullLabel: resolveReportColumnTooltip("digitalInput2", t("reportsAnalytic.columns.input2")),
        width: 100,
        minWidth: 90,
      },
      {
        key: "digitalInput4",
        label: resolveReportColumnLabel("digitalInput4", t("reportsAnalytic.columns.input4")),
        fullLabel: resolveReportColumnTooltip("digitalInput4", t("reportsAnalytic.columns.input4")),
        width: 100,
        minWidth: 90,
      },
      {
        key: "digitalInput5",
        label: resolveReportColumnLabel("digitalInput5", t("reportsAnalytic.columns.input5")),
        fullLabel: resolveReportColumnTooltip("digitalInput5", t("reportsAnalytic.columns.input5")),
        width: 100,
        minWidth: 90,
      },
      {
        key: "digitalOutput1",
        label: resolveReportColumnLabel("digitalOutput1", t("reportsAnalytic.columns.output1")),
        fullLabel: resolveReportColumnTooltip("digitalOutput1", t("reportsAnalytic.columns.output1")),
        width: 100,
        minWidth: 90,
      },
      {
        key: "digitalOutput2",
        label: resolveReportColumnLabel("digitalOutput2", t("reportsAnalytic.columns.output2")),
        fullLabel: resolveReportColumnTooltip("digitalOutput2", t("reportsAnalytic.columns.output2")),
        width: 100,
        minWidth: 90,
      },
      {
        key: "speed",
        label: resolveReportColumnLabel("speed", t("reportsAnalytic.columns.speed")),
        fullLabel: resolveReportColumnTooltip("speed", t("reportsAnalytic.columns.speed")),
        width: 90,
        minWidth: 80,
      },
      {
        key: "vehicleVoltage",
        label: resolveReportColumnLabel("vehicleVoltage", t("reportsAnalytic.columns.voltage")),
        fullLabel: resolveReportColumnTooltip("vehicleVoltage", t("reportsAnalytic.columns.voltage")),
        width: 120,
        minWidth: 100,
      },
      {
        key: "geozoneId",
        label: resolveReportColumnLabel("geozoneId", t("reportsAnalytic.columns.geozoneId")),
        fullLabel: resolveReportColumnTooltip("geozoneId", t("reportsAnalytic.columns.geozoneId")),
        width: 120,
        minWidth: 100,
      },
    ],
    [t],
  );

  const extraColumns = useMemo(
    () => [
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
        width: 160,
        minWidth: 120,
      },
      {
        key: "jamming",
        label: resolveReportColumnLabel("jamming", t("reportsAnalytic.columns.jamming")),
        fullLabel: resolveReportColumnTooltip("jamming", t("reportsAnalytic.columns.jamming")),
        width: 100,
        minWidth: 90,
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

  const dynamicColumns = useMemo(() => {
    if (entries.length) {
      const schema = buildPositionsSchema(entries);
      return schema.map((column) => {
        const normalized = normalizeColumnLabel(column);
        return {
          ...normalized,
          width: normalized.width ?? Math.min(240, Math.max(120, normalized.label.length * 7)),
        };
      });
    }
    return FALLBACK_COLUMNS.map(normalizeColumnLabel);
  }, [entries]);

  const availableColumns = useMemo(() => {
    const merged = [...baseColumns, ...extraColumns, ...dynamicColumns];
    const seen = new Set();
    const deduped = [];
    merged.forEach((column) => {
      if (!column?.key || seen.has(column.key)) return;
      seen.add(column.key);
      deduped.push(column);
    });
    return deduped.map((column) => ({
      ...column,
      defaultVisible: EURO_ANALYTIC_PRESET_KEYS.includes(column.key),
    }));
  }, [baseColumns, dynamicColumns, extraColumns]);

  const columnDefinitionMap = useMemo(
    () => new Map(availableColumns.map((column) => [column.key, column])),
    [availableColumns],
  );

  const defaultPrefs = useMemo(
    () => buildColumnPreset(availableColumns, EURO_ANALYTIC_PRESET_KEYS),
    [availableColumns],
  );
  const [columnPrefs, setColumnPrefs] = useState(() => loadColumnPreferences(COLUMN_STORAGE_KEY, defaultPrefs));

  useEffect(() => {
    setColumnPrefs((prev) => mergeColumnPreferences(defaultPrefs, prev));
  }, [defaultPrefs]);

  const visibleColumns = useMemo(
    () => resolveVisibleColumns(availableColumns, columnPrefs),
    [availableColumns, columnPrefs],
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

  const buildQueryParams = useCallback(
    () => ({
      vehicleId: selectedVehicleId,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      page,
      limit: pageSize,
      type: typeFilter,
      geofence: geofenceFilter,
      criticalOnly: criticalOnly ? "true" : "false",
      search: search.trim() || undefined,
    }),
    [criticalOnly, from, geofenceFilter, page, pageSize, search, selectedVehicleId, to, typeFilter],
  );

  const fetchReport = useCallback(async () => {
    if (!selectedVehicleId) return;
    const params = buildQueryParams();
    lastQueryRef.current = params;
    await generate(params);
  }, [buildQueryParams, generate, selectedVehicleId]);

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

  const handlePageSizeChange = async (value) => {
    const normalized = Number(value) || DEFAULT_PAGE_SIZE;
    setPageSize(normalized);
    setPage(1);
    if (!hasGenerated || !selectedVehicleId) return;
    const params = { ...buildQueryParams(), page: 1, limit: normalized };
    lastQueryRef.current = params;
    await generate(params);
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
        const ignitionLabel = formatIgnition(entry.ignition);
        const audit =
          entry.userName
            ? `${entry.userName}${entry.auditAction ? ` · ${entry.auditAction}` : ""}`
            : entry.auditSummary || "—";
        const row = {
          key: entry.id || `${entry.type}-${entry.occurredAt}`,
          occurredAt: formatDateTime(entry.occurredAt),
          event: entry.type === "command_response" && commandResult ? `${eventLabel} (${commandResult})` : eventLabel,
          address: normalizeAddressDisplay(entry.address),
          rawAddress: entry.address,
          lat: entry.latitude ?? entry.lat ?? null,
          lng: entry.longitude ?? entry.lng ?? null,
          criticality: resolveCriticalityLabel(entry, t),
          speed: formatSpeed(entry.speed),
          ignition: ignitionLabel,
          ioSummary: entry.ioSummary || "—",
          geofence: entry.geofence || "—",
          geozoneInside: formatBoolean(entry.geozoneInside, t("common.yes"), t("common.no")),
          geozoneId: entry.geozoneId ?? entry.geofence ?? "—",
          jamming: formatBoolean(entry.jamming, t("common.yes"), t("common.no")),
          vehicleVoltage: formatVehicleVoltage(entry.vehicleVoltage),
          digitalInput2: formatIoState(entry.digitalInput2),
          digitalInput4: formatIoState(entry.digitalInput4),
          digitalInput5: formatIoState(entry.digitalInput5),
          digitalOutput1: formatIoState(entry.digitalOutput1),
          digitalOutput2: formatIoState(entry.digitalOutput2),
          audit,
        };

        const attributes = entry?.attributes && typeof entry.attributes === "object" ? entry.attributes : {};
        const keys = new Set([...Object.keys(entry || {}), ...Object.keys(attributes)]);
        keys.forEach((key) => {
          if (["attributes", "protocol"].includes(key)) return;
          if (row[key] !== undefined) return;
          const definition = columnDefinitionMap.get(key);
          const sourceValue = key in entry ? entry[key] : attributes[key];
          row[key] = formatDynamicValue(key, sourceValue, definition);
        });

        return row;
      }),
    [columnDefinitionMap, entries, t],
  );

  const resolveExportPayload = async () => {
    if (!selectedVehicleId) {
      return null;
    }
    const baseColumnsToExport = pdfColumns.length ? pdfColumns : visibleColumns.map((col) => col.key);
    const allowedExport = new Set(availableColumns.map((column) => column.key));
    const columnsToExport = baseColumnsToExport.filter((key) => allowedExport.has(key));
    const columnDefinitionsPayload = availableColumns.map((column) => ({
      key: column.key,
      labelPt: column.label,
      labelPdf: column.labelPdf || column.label,
      weight: column.weight,
      width: column.width,
      type: column.type,
      unit: column.unit,
      group: column.group,
      defaultVisible: column.defaultVisible,
    }));
    return {
      columnsToExport,
      payload: {
        vehicleId: selectedVehicleId,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        columns: columnsToExport,
        availableColumns: availableColumns.map((column) => column.key),
        columnDefinitions: columnDefinitionsPayload,
        type: typeFilter,
        geofence: geofenceFilter,
        criticalOnly: criticalOnly ? "true" : "false",
        search: search.trim() || undefined,
      },
    };
  };

  const handleExportPdf = async () => {
    const resolvedPayload = await resolveExportPayload();
    if (!resolvedPayload) return;
    setExportingPdf(true);
    try {
      const blob = await exportPdf(resolvedPayload.payload);
      if (!(blob instanceof Blob) || blob.size === 0) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const plate = selectedVehicle?.plate || selectedVehicle?.name || "veiculo";
      link.href = url;
      link.download = `relatorio-analitico-${String(plate).replace(/\s+/g, "-")}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setPdfModalOpen(false);
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExportXlsx = async () => {
    const resolvedPayload = await resolveExportPayload();
    if (!resolvedPayload) return;
    setExportingXlsx(true);
    try {
      const blob = await exportXlsx(resolvedPayload.payload);
      if (!(blob instanceof Blob) || blob.size === 0) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const plate = selectedVehicle?.plate || selectedVehicle?.name || "veiculo";
      link.href = url;
      link.download = `relatorio-analitico-${String(plate).replace(/\s+/g, "-")}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setPdfModalOpen(false);
    } finally {
      setExportingXlsx(false);
    }
  };

  const handleExportCsv = async () => {
    const resolvedPayload = await resolveExportPayload();
    if (!resolvedPayload) return;
    setExportingCsv(true);
    try {
      const blob = await exportCsv(resolvedPayload.payload);
      if (!(blob instanceof Blob) || blob.size === 0) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const plate = selectedVehicle?.plate || selectedVehicle?.name || "veiculo";
      link.href = url;
      link.download = `relatorio-analitico-${String(plate).replace(/\s+/g, "-")}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setPdfModalOpen(false);
    } finally {
      setExportingCsv(false);
    }
  };

  const openPdfModal = (format = "pdf") => {
    setPdfColumns(visibleColumns.map((column) => column.key));
    setExportFormat(format);
    setPdfModalOpen(true);
  };

  const columnsForSelection = useMemo(
    () => availableColumns.map((column) => ({ key: column.key, label: column.label })),
    [availableColumns],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <section className="card flex flex-col gap-4 p-0">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <header className="space-y-2 px-6 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-white/50">{t("reportsAnalytic.title")}</p>
              </div>
              <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                <label className="flex items-center gap-2 rounded-md border border-white/15 bg-[#0d1117] px-3 py-2 text-xs font-semibold text-white/80 transition hover:border-white/30">
                  <span className="whitespace-nowrap">{t("reportsAnalytic.pagination.pageSize")}</span>
                  <select
                    value={pageSize}
                    onChange={(event) => handlePageSizeChange(Number(event.target.value))}
                    className="rounded bg-transparent text-white outline-none"
                  >
                    {PAGE_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option} className="bg-[#0d1117] text-white">
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={loading || !selectedVehicleId}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
                >
                  {loading ? t("reportsAnalytic.loading") : t("reportsAnalytic.generate")}
                </button>
                <button
                  type="button"
                  onClick={() => openPdfModal("pdf")}
                  disabled={loading || exportingPdf || exportingXlsx || exportingCsv || !selectedVehicleId}
                  className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-white/80 hover:border-white/30 disabled:opacity-60"
                >
                  {exportingPdf ? "Exportando…" : "Exportar PDF"}
                </button>
                <button
                  type="button"
                  onClick={() => openPdfModal("xlsx")}
                  disabled={loading || exportingPdf || exportingXlsx || exportingCsv || !selectedVehicleId}
                  className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-white/80 hover:border-white/30 disabled:opacity-60"
                >
                  {exportingXlsx ? "Exportando…" : "Exportar Excel"}
                </button>
                <button
                  type="button"
                  onClick={() => openPdfModal("csv")}
                  disabled={loading || exportingPdf || exportingXlsx || exportingCsv || !selectedVehicleId}
                  className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-white/80 hover:border-white/30 disabled:opacity-60"
                >
                  {exportingCsv ? "Exportando…" : "Exportar CSV (Excel)"}
                </button>
                <button
                  type="button"
                  onClick={() => setActivePopup("columns")}
                  className="flex h-10 w-10 items-center justify-center rounded-md border border-white/15 bg-[#0d1117] text-white/60 transition hover:border-white/30 hover:text-white"
                  title="Selecionar colunas"
                  aria-label="Selecionar colunas"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <line x1="9" y1="4" x2="9" y2="20" />
                    <line x1="15" y1="4" x2="15" y2="20" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => setTopBarVisible((visible) => !visible)}
                  className={`flex h-10 items-center justify-center rounded-md border border-white/15 px-3 text-sm font-medium text-white/70 transition hover:border-white/30 hover:text-white ${topBarVisible ? "bg-white/5" : "bg-[#0d1117]"}`}
                  title={topBarVisible ? "Ocultar filtros" : "Mostrar filtros"}
                  aria-label={topBarVisible ? "Ocultar filtros" : "Mostrar filtros"}
                >
                  {topBarVisible ? "Ocultar filtros" : "Mostrar filtros"}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
              <p className="text-sm text-white/70">{t("reportsAnalytic.subtitle")}</p>
              <div className="flex items-center gap-2 text-xs text-white/70">
                <span className="whitespace-nowrap">
                  {t("reportsAnalytic.pagination.pageInfo", { current: currentPage, total: totalPages })} • {t("reportsAnalytic.pagination.total", { count: totalItems })}
                </span>
              </div>
            </div>
          </header>

          {topBarVisible ? (
            <div className="space-y-3 px-6 pb-6">
              <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-2 xl:grid-cols-12">
                <div className="xl:col-span-4">
                  <VehicleSelector
                    label="Veículo"
                    placeholder="Busque por placa, nome ou ID"
                    className="text-sm"
                  />
                </div>
                <label className="text-sm xl:col-span-2">
                  <span className="block text-xs uppercase tracking-wide text-white/60">Início</span>
                  <input
                    type="datetime-local"
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary/40 focus:outline-none"
                  />
                </label>
                <label className="text-sm xl:col-span-2">
                  <span className="block text-xs uppercase tracking-wide text-white/60">Fim</span>
                  <input
                    type="datetime-local"
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary/40 focus:outline-none"
                  />
                </label>
                <label className="text-sm xl:col-span-2">
                  <span className="block text-xs uppercase tracking-wide text-white/60">{t("reportsAnalytic.filters.type")}</span>
                  <select
                    value={typeFilter}
                    onChange={(event) => setTypeFilter(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary/40 focus:outline-none"
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
                <label className="text-sm xl:col-span-2">
                  <span className="block text-xs uppercase tracking-wide text-white/60">{t("reportsAnalytic.filters.geofence")}</span>
                  <select
                    value={geofenceFilter}
                    onChange={(event) => setGeofenceFilter(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary/40 focus:outline-none"
                  >
                    <option value="all">{t("reportsAnalytic.filters.geofenceAll")}</option>
                    <option value="inside">{t("reportsAnalytic.filters.geofenceInside")}</option>
                    <option value="outside">{t("reportsAnalytic.filters.geofenceOutside")}</option>
                  </select>
                </label>
                <label className="text-sm xl:col-span-4">
                  <span className="block text-xs uppercase tracking-wide text-white/60">{t("reportsAnalytic.filters.search")}</span>
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t("reportsAnalytic.filters.searchPlaceholder")}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary/40 focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-white/60 xl:col-span-2 xl:mt-6">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-white/30 bg-transparent accent-primary"
                    checked={criticalOnly}
                    onChange={(event) => setCriticalOnly(event.target.checked)}
                  />
                  {t("reportsAnalytic.filters.criticalOnly")}
                </label>
              </div>
            </div>
          ) : null}
        </form>
      </section>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error.message || t("reportsAnalytic.loadError")}
        </div>
      )}

      <section className="flex-1 min-h-0 rounded-2xl border border-white/10 bg-[#0b0f17]">
        <MonitoringTable
          rows={rows}
          columns={visibleColumnsWithWidths}
          loading={loading}
          emptyText={hasGenerated ? t("reportsAnalytic.empty") : t("reportsAnalytic.emptyBefore")}
          liveGeocode={false}
          columnWidths={columnPrefs?.widths}
          onColumnWidthChange={handleColumnWidthChange}
        />
      </section>

      <div className="flex items-center justify-between">
        <button
          type="button"
          className="rounded-lg border border-border px-3 py-2 text-xs text-white/70 hover:bg-white/10 disabled:opacity-50"
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
          className="rounded-lg border border-border px-3 py-2 text-xs text-white/70 hover:bg-white/10 disabled:opacity-50"
          onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
          disabled={currentPage >= totalPages || loading}
        >
          {t("reportsAnalytic.pagination.next")}
        </button>
      </div>

      {activePopup === "columns" && (
        <MonitoringColumnSelector
          columns={availableColumns}
          columnPrefs={columnPrefs}
          defaultPrefs={defaultPrefs}
          onApply={handleApplyColumns}
          onRestore={handleRestoreColumns}
          onClose={() => setActivePopup(null)}
        />
      )}

      {pdfModalOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setPdfModalOpen(false)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0f141c] p-6 text-sm text-white/80 shadow-3xl"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-white">
                  {exportFormat === "xlsx"
                    ? "Colunas do Excel"
                    : exportFormat === "csv"
                      ? "Colunas do CSV (Excel)"
                      : "Colunas do PDF"}
                </div>
                <p className="text-xs text-white/60">Escolha as colunas para exportação.</p>
              </div>
              <button
                type="button"
                onClick={() => setPdfModalOpen(false)}
                className="h-9 w-9 rounded-lg border border-white/10 bg-white/5 text-white/70 transition hover:border-white/30 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {columnsForSelection.map((column) => (
                <label
                  key={column.key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2 hover:border-white/30"
                >
                  <span className="text-white/80">{column.label}</span>
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={pdfColumns.includes(column.key)}
                    onChange={(event) => {
                      setPdfColumns((prev) =>
                        event.target.checked
                          ? [...new Set([...prev, column.key])]
                          : prev.filter((key) => key !== column.key),
                      );
                    }}
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-white/10 px-3 py-2 text-[11px] font-semibold text-white/80 hover:border-white/30"
                onClick={() => setPdfModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-md border border-primary/40 bg-primary/20 px-3 py-2 text-[11px] font-semibold text-white hover:border-primary/60"
                onClick={
                  exportFormat === "xlsx"
                    ? handleExportXlsx
                    : exportFormat === "csv"
                      ? handleExportCsv
                      : handleExportPdf
                }
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
