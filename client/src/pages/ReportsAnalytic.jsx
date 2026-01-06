import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import VehicleSelector from "../components/VehicleSelector.jsx";
import MonitoringTable from "../components/monitoring/MonitoringTable.jsx";
import MonitoringColumnSelector from "../components/monitoring/MonitoringColumnSelector.jsx";
import useVehicleSelection from "../lib/hooks/useVehicleSelection.js";
import useAnalyticReport from "../lib/hooks/useAnalyticReport.js";
import { useTranslation } from "../lib/i18n.js";
import { formatAddress } from "../lib/format-address.js";
import { geocodeAddress } from "../lib/geocode.js";
import { resolveEventDefinition } from "../lib/event-translations.js";
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
import buildPositionsSchema from "../../../shared/buildPositionsSchema.js";
import { positionsColumns, resolveColumnLabel } from "../../../shared/positionsColumns.js";
import { resolveTelemetryDescriptor } from "../../../shared/telemetryDictionary.js";
import { resolveSensorLabel } from "../i18n/sensors.ptBR.js";

const PAGE_SIZE_OPTIONS = [20, 50, 100, 500, 1000, 5000];
const DEFAULT_PAGE_SIZE = 100;
const COLUMN_STORAGE_KEY = "reports:analytic:columns:v2";
const DEFAULT_RADIUS_METERS = 100;

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

function parseCoordinateQuery(raw) {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;
  const match = cleaned.match(/(-?\d+(?:\.\d+)?)\s*,?\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, address: cleaned };
}

function formatSpeed(value) {
  if (value === null || value === undefined || value === "") return "—";
  return `${value} km/h`;
}

function formatDistance(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (Number.isFinite(Number(value))) return `${Number(value).toFixed(2)} km`;
  return String(value);
}

function formatDirection(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(0)}°`;
}

function formatHdop(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(2);
}

function formatAccuracy(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(0)} m`;
}

function formatBattery(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (Number.isFinite(Number(value))) return `${Number(value).toFixed(0)}%`;
  return String(value);
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
  if (entry?.event) return entry.event;
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
  if (definition?.label) return definition.label;
  return t("reportsAnalytic.event.position");
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
  const [addressQuery, setAddressQuery] = useState("");
  const [addressFilter, setAddressFilter] = useState(null);
  const [geocoding, setGeocoding] = useState(false);
  const [formError, setFormError] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [hideUnavailableIgnition, setHideUnavailableIgnition] = useState(false);
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

  const availableColumns = useMemo(() => {
    if (entries.length) {
      const schema = buildPositionsSchema(entries);
      return schema.map((column) => {
        const normalized = normalizeColumnLabel(column);
        return {
          ...normalized,
          defaultVisible: normalized.defaultVisible ?? true,
          width: normalized.width ?? Math.min(240, Math.max(120, normalized.label.length * 7)),
        };
      });
    }
    return FALLBACK_COLUMNS.map(normalizeColumnLabel);
  }, [entries]);

  const columnDefinitionMap = useMemo(
    () => new Map(availableColumns.map((column) => [column.key, column])),
    [availableColumns],
  );

  const defaultPrefs = useMemo(
    () => buildColumnPreset(availableColumns, EURO_PRESET_KEYS),
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
        render: column.key === "address"
          ? (row) => buildAddressWithLatLng(row.address, row.lat, row.lng)
          : column.render,
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

  const resolveAddressFilter = useCallback(async () => {
    const text = addressQuery.trim();
    if (!text) {
      setAddressFilter(null);
      return null;
    }
    const coordinates = parseCoordinateQuery(text);
    if (coordinates) {
      const filter = { ...coordinates, radius: DEFAULT_RADIUS_METERS };
      setAddressFilter(filter);
      return filter;
    }
    setGeocoding(true);
    try {
      const resolved = await geocodeAddress(text);
      if (!resolved) {
        setAddressFilter(null);
        return null;
      }
      const filter = { ...resolved, radius: DEFAULT_RADIUS_METERS };
      setAddressFilter(filter);
      return filter;
    } finally {
      setGeocoding(false);
    }
  }, [addressQuery]);

  const buildQueryParams = useCallback(
    (filter = addressFilter, pageParam = page, limitParam = pageSize) => ({
      vehicleId: selectedVehicleId,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      addressLat: filter?.lat,
      addressLng: filter?.lng,
      addressRadius: filter?.radius,
      page: pageParam,
      limit: limitParam,
    }),
    [addressFilter, from, page, pageSize, selectedVehicleId, to],
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

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFeedback(null);
    if (!selectedVehicleId) {
      setFormError("Selecione exatamente um veículo.");
      return;
    }
    if (!from || !to) {
      setFormError("Selecione o período completo.");
      return;
    }
    setFormError("");
    const resolvedFilter = await resolveAddressFilter();
    try {
      const params = buildQueryParams(resolvedFilter, 1, pageSize);
      lastQueryRef.current = params;
      setPage(1);
      await generate(params);
      setHasGenerated(true);
      setFeedback({ type: "success", message: "Relatório analítico atualizado." });
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError?.message ?? "Erro ao gerar relatório." });
    }
  };

  const handlePageSizeChange = async (value) => {
    const normalized = Number(value) || DEFAULT_PAGE_SIZE;
    setPageSize(normalized);
    setPage(1);
    if (!hasGenerated || !selectedVehicleId) return;
    const params = buildQueryParams(addressFilter, 1, normalized);
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
        const gpsTime = entry.gpsTime || entry.occurredAt || null;
        const audit =
          entry.userName
            ? `${entry.userName}${entry.auditAction ? ` · ${entry.auditAction}` : ""}`
            : entry.auditSummary || "—";
        const row = {
          key: entry.id ?? `${gpsTime}-${entry.latitude}-${entry.longitude}`,
          deviceId: entry.id ?? gpsTime ?? Math.random(),

          gpsTime: formatDateTime(gpsTime),
          deviceTime: formatDateTime(entry.deviceTime),
          serverTime: formatDateTime(entry.serverTime),
          latitude: entry.latitude != null ? entry.latitude.toFixed(6) : "—",
          longitude: entry.longitude != null ? entry.longitude.toFixed(6) : "—",
          address: normalizeAddressDisplay(entry.address),
          lat: entry.latitude,
          lng: entry.longitude,
          event: entry.type === "command_response" && commandResult ? `${eventLabel} (${commandResult})` : eventLabel,
          speed: formatSpeed(entry.speed),
          direction: formatDirection(entry.direction),
          ignition: formatIgnition(entry.ignition),
          vehicleState: entry.vehicleState || "Indisponível",
          batteryLevel: formatBattery(entry.batteryLevel),
          rssi: entry.rssi ?? "—",
          satellites: entry.satellites ?? "—",
          geofence: entry.geofence || "—",
          accuracy: formatAccuracy(entry.accuracy),
          hdop: formatHdop(entry.hdop),
          distance: formatDistance(entry.distance),
          totalDistance: formatDistance(entry.totalDistance),
          vehicleVoltage: formatVehicleVoltage(entry.vehicleVoltage),
          deviceTemp: formatByDescriptor("deviceTemp", entry.deviceTemp),
          handBrake: formatByDescriptor("handBrake", entry.handBrake),
          commandResponse: entry.commandResponse || "—",
          deviceStatusEvent: entry.deviceStatusEvent || "—",
          deviceStatus: entry.deviceStatus || "Indisponível",
          digitalInput1: formatIoState(entry.digitalInput1),
          digitalInput2: formatIoState(entry.digitalInput2),
          digitalOutput1: formatIoState(entry.digitalOutput1),
          digitalOutput2: formatIoState(entry.digitalOutput2),
          digitalInput3: formatIoState(entry.digitalInput3),
          digitalInput4: formatIoState(entry.digitalInput4),
          digitalInput5: formatIoState(entry.digitalInput5),
          digitalInput6: formatIoState(entry.digitalInput6),
          digitalInput7: formatIoState(entry.digitalInput7),
          digitalInput8: formatIoState(entry.digitalInput8),
          digitalOutput3: formatIoState(entry.digitalOutput3),
          digitalOutput4: formatIoState(entry.digitalOutput4),
          digitalOutput5: formatIoState(entry.digitalOutput5),
          digitalOutput6: formatIoState(entry.digitalOutput6),
          digitalOutput7: formatIoState(entry.digitalOutput7),
          digitalOutput8: formatIoState(entry.digitalOutput8),
          ioDetails:
            Array.isArray(entry.ioDetails) && entry.ioDetails.length
              ? entry.ioDetails
                  .map((item) => {
                    const label = item?.label || item?.key || "IO";
                    const value = item?.value ?? "—";
                    return `${label}: ${value}`;
                  })
                  .join(" • ")
              : "—",
          criticality: resolveCriticalityLabel(entry, t),
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

  const filteredRows = useMemo(() => {
    if (!hideUnavailableIgnition) return rows;
    return rows.filter((row) => row.ignition !== "Indisponível");
  }, [hideUnavailableIgnition, rows]);

  const resolveExportPayload = async () => {
    setFormError("");
    if (!selectedVehicleId) {
      setFormError("Selecione exatamente um veículo.");
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
    const resolvedFilter = addressQuery.trim() ? await resolveAddressFilter() : addressFilter;
    return {
      columnsToExport,
      payload: {
        vehicleId: selectedVehicleId,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        columns: columnsToExport,
        availableColumns: availableColumns.map((column) => column.key),
        columnDefinitions: columnDefinitionsPayload,
        addressFilter: resolvedFilter
          ? {
              lat: resolvedFilter.lat,
              lng: resolvedFilter.lng,
              radius: resolvedFilter.radius,
            }
          : null,
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
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <header className="space-y-2">
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
                disabled={loading || geocoding || !selectedVehicleId}
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
              <label
                className="flex items-center gap-2 rounded-md border border-white/15 bg-[#0d1117] px-3 py-2 text-xs font-semibold text-white/80 transition hover:border-white/30"
                title="Ocultar ignição indisponível"
              >
                <input
                  type="checkbox"
                  checked={hideUnavailableIgnition}
                  onChange={(event) => setHideUnavailableIgnition(event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="whitespace-nowrap">Disponibilidade</span>
              </label>
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
          <div className="space-y-3">
            <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-2 xl:grid-cols-12">
              <div className="xl:col-span-4">
                <VehicleSelector
                  label="Veículo"
                  placeholder="Busque por placa, nome ou ID"
                  className="text-sm"
                />
              </div>
              <label className="text-sm xl:col-span-4">
                <span className="block text-xs uppercase tracking-wide text-white/60">Endereço / Coordenada</span>
                <input
                  type="text"
                  value={addressQuery}
                  onChange={(event) => {
                    const value = event.target.value;
                    setAddressQuery(value);
                    if (!value.trim()) {
                      setAddressFilter(null);
                    }
                  }}
                  onBlur={() => {
                    if (addressQuery.trim()) {
                      resolveAddressFilter();
                    }
                  }}
                  placeholder="Rua, cidade ou lat,lng"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary/40 focus:outline-none"
                />
                {geocoding && <p className="mt-1 text-xs text-white/60">Geocodificando endereço…</p>}
                {addressFilter && (
                  <p className="mt-1 text-xs text-white/60">
                    Raio: {DEFAULT_RADIUS_METERS}m • {addressFilter.lat.toFixed(5)}, {addressFilter.lng.toFixed(5)}
                  </p>
                )}
              </label>
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
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-white/60">Filtros ocultos. Clique para ajustar os critérios.</p>
            <button
              type="button"
              onClick={() => setTopBarVisible(true)}
              className="rounded-md border border-white/15 bg-[#0d1117] px-3 py-2 text-sm font-medium text-white/70 transition hover:border-white/30 hover:text-white"
            >
              Mostrar filtros
            </button>
          </div>
        )}
        {formError && (
          <div>
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{formError}</div>
          </div>
        )}
        {feedback && (
          <div>
            <div
              className={`rounded-lg border p-3 text-sm ${
                feedback.type === "success"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                  : "border-red-500/30 bg-red-500/10 text-red-200"
              }`}
            >
              {feedback.message}
            </div>
          </div>
        )}
        {error && !feedback?.message && (
          <div>
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {error.message || t("reportsAnalytic.loadError")}
            </div>
          </div>
        )}
      </form>

      <section className="flex-1 min-h-0">
        <MonitoringTable
          rows={filteredRows}
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
