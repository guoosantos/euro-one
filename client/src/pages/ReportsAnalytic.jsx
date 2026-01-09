import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import VehicleSelector from "../components/VehicleSelector.jsx";
import MonitoringTable from "../components/monitoring/MonitoringTable.jsx";
import MonitoringColumnSelector from "../components/monitoring/MonitoringColumnSelector.jsx";
import useVehicleSelection from "../lib/hooks/useVehicleSelection.js";
import useAnalyticReport from "../lib/hooks/useAnalyticReport.js";
import { geocodeAddress } from "../lib/geocode.js";
import {
  loadColumnPreferences,
  mergeColumnPreferences,
  resolveVisibleColumns,
  saveColumnPreferences,
} from "../lib/column-preferences.js";
import { buildColumnPreset, EURO_PRESET_KEYS } from "../lib/report-column-presets.js";
import { formatAddress } from "../lib/format-address.js";
import buildPositionsSchema from "../../../shared/buildPositionsSchema.js";
import { positionsColumns, resolveColumnLabel } from "../../../shared/positionsColumns.js";
import { resolveTelemetryDescriptor } from "../../../shared/telemetryDictionary.js";
import { resolveSensorLabel } from "../i18n/sensors.ptBR.js";
import {
  buildAddressWithLatLng,
  resolveReportColumnLabel,
  resolveReportColumnTooltip,
} from "../lib/report-column-labels.js";

const COLUMN_STORAGE_KEY = "reports:analytic:columns";
const DEFAULT_RADIUS_METERS = 100;
const DEFAULT_PAGE_SIZE = 1000;
const PAGE_SIZE_OPTIONS = [20, 50, 100, 500, 1000, 5000];
const LOGO_URL = "https://eurosolucoes.tech/wp-content/uploads/2024/10/logo-3-2048x595.png";

const FALLBACK_COLUMNS = positionsColumns.map((column) => {
  const label = resolveColumnLabel(column, "pt");
  return {
    ...column,
    label: resolveSensorLabel({ name: label, key: column.key }),
  };
});

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

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatHeaderDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
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
  if (value === null || value === undefined) return "Dado não disponível";
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

function resolveReportProtocol(positions = []) {
  const list = Array.isArray(positions) ? positions : [];
  for (const position of list) {
    const protocol = position?.protocol || position?.attributes?.protocol;
    if (protocol) return protocol;
  }
  return null;
}

function normalizeColumnLabel(column, { protocol } = {}) {
  if (!column) return column;
  const description = column.descriptionPt || column.description;
  const baseLabel = description || resolveSensorLabel({ name: column.label || column.labelPt, key: column.key });
  const label = description || resolveReportColumnLabel(column.key, baseLabel, { protocol });
  const tooltip = description || resolveReportColumnTooltip(column.key, label, { protocol });
  return {
    ...column,
    label,
    labelPt: label,
    labelPdf: column.labelPdf || label,
    fullLabel: tooltip,
  };
}

function buildPdfFileName(vehicle, from, to) {
  const plate = vehicle?.plate || vehicle?.name || "vehicle";
  const safePlate = String(plate).replace(/\s+/g, "-");
  const safeFrom = String(from).replace(/[:\\s]/g, "-");
  const safeTo = String(to).replace(/[:\\s]/g, "-");
  return `analytic-report-${safePlate}-${safeFrom}-${safeTo}.pdf`;
}

function buildXlsxFileName(vehicle, from, to) {
  const plate = vehicle?.plate || vehicle?.name || "vehicle";
  const safePlate = String(plate).replace(/\s+/g, "-");
  const safeFrom = String(from).replace(/[:\\s]/g, "-");
  const safeTo = String(to).replace(/[:\\s]/g, "-");
  return `analytic-report-${safePlate}-${safeFrom}-${safeTo}.xlsx`;
}

function buildCsvFileName(vehicle, from, to, target = "positions") {
  const plate = vehicle?.plate || vehicle?.name || "vehicle";
  const safePlate = String(plate).replace(/\s+/g, "-");
  const safeFrom = String(from).replace(/[:\\s]/g, "-");
  const safeTo = String(to).replace(/[:\\s]/g, "-");
  const prefix = target === "actions" ? "analytic-actions" : "analytic-report";
  return `${prefix}-${safePlate}-${safeFrom}-${safeTo}.csv`;
}

export default function ReportsAnalytic() {
  const { selectedVehicleId, selectedVehicle } = useVehicleSelection({ syncQuery: true });
  const { loading, error, generate, exportPdf, exportXlsx, exportCsv, fetchPage } = useAnalyticReport();

  const [from, setFrom] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [addressQuery, setAddressQuery] = useState("");
  const [addressFilter, setAddressFilter] = useState(null);
  const [geocoding, setGeocoding] = useState(false);
  const [formError, setFormError] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [topBarVisible, setTopBarVisible] = useState(true);
  const [activePopup, setActivePopup] = useState(null);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfColumns, setPdfColumns] = useState([]);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportFormat, setExportFormat] = useState("pdf");
  const [toast, setToast] = useState(null);
  const toastTimeoutRef = useRef(null);
  const [csvExportTarget, setCsvExportTarget] = useState("positions");
  const [hideUnavailableIgnition, setHideUnavailableIgnition] = useState(false);
  const lastFilterKeyRef = useRef("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [positions, setPositions] = useState([]);
  const [entries, setEntries] = useState([]);
  const [actions, setActions] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const baseQueryRef = useRef(null);
  const [lastResolvedFilter, setLastResolvedFilter] = useState(null);

  const effectivePageSize = pageSize;
  const totalPages = meta?.totalPages || 1;
  const currentPage = meta?.currentPage || page;
  const totalItems = meta?.totalItems ?? positions.length;
  const canLoadMore = Boolean(meta && meta.currentPage < meta.totalPages);
  const canGoPrev = currentPage > 1;
  const canGoNext = currentPage < totalPages;

  const reportProtocol = useMemo(() => resolveReportProtocol(positions), [positions]);

  const availableColumns = useMemo(() => {
    // Relatório usa schema baseado nas chaves/attributes recebidas; não reaproveita colunas opinadas do monitoring.
    if (positions.length) {
      const schema = buildPositionsSchema(positions, { protocol: reportProtocol });
      return schema.map((column) => {
        const normalized = normalizeColumnLabel(column, { protocol: reportProtocol });
        return {
          ...normalized,
          defaultVisible: normalized.defaultVisible ?? true,
          width: normalized.width ?? Math.min(240, Math.max(120, normalized.label.length * 7)),
        };
      });
    }
    return FALLBACK_COLUMNS.map((column) => normalizeColumnLabel(column, { protocol: reportProtocol }));
  }, [positions, reportProtocol]);

  const availableColumnKeys = useMemo(
    () => availableColumns.map((column) => column.key),
    [availableColumns],
  );

  const columnDefinitionMap = useMemo(
    () => new Map(availableColumns.map((column) => [column.key, column])),
    [availableColumns],
  );

  const defaults = useMemo(
    () => buildColumnPreset(availableColumns, EURO_PRESET_KEYS),
    [availableColumns],
  );

  const [columnPrefs, setColumnPrefs] = useState(() => loadColumnPreferences(COLUMN_STORAGE_KEY, defaults));

  useEffect(() => {
    setColumnPrefs((prev) => mergeColumnPreferences(defaults, prev));
  }, [defaults]);

  useEffect(() => {
    const positionsCount = positions.length;
    if (import.meta.env.DEV && (positionsCount > 0 || availableColumns.length === 0)) {
      console.debug("[reports/positions] positions", positionsCount, "columns", availableColumns.length);
    }
  }, [availableColumns.length, positions.length]);

  const showToast = useCallback((message, type = "success") => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3500);
  }, []);


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

  const buildPositionRow = useCallback(
    (position) => {
      const row = {
        key: position.id ?? `${position.gpsTime}-${position.latitude}-${position.longitude}`,
        deviceId: position.id ?? position.gpsTime ?? Math.random(),

        gpsTime: formatDateTime(position.gpsTime),
        deviceTime: formatDateTime(position.deviceTime),
        serverTime: formatDateTime(position.serverTime),
        latitude: position.latitude != null ? position.latitude.toFixed(6) : "—",
        longitude: position.longitude != null ? position.longitude.toFixed(6) : "—",
        address: normalizeAddressDisplay(position.address),
        lat: position.latitude,
        lng: position.longitude,
        speed: formatSpeed(position.speed),
        direction: formatDirection(position.direction),
        ignition: formatIgnition(position.ignition),
        vehicleState: position.vehicleState || "Dado não disponível",
        batteryLevel: formatBattery(position.batteryLevel),
        rssi: position.rssi ?? "—",
        satellites: position.satellites ?? "—",
        geofence: position.geofence || "—",
        accuracy: formatAccuracy(position.accuracy),
        hdop: formatHdop(position.hdop),
        distance: formatDistance(position.distance),
        totalDistance: formatDistance(position.totalDistance),
        vehicleVoltage: formatVehicleVoltage(position.vehicleVoltage),
        deviceTemp: formatByDescriptor("deviceTemp", position.deviceTemp),
        handBrake: formatByDescriptor("handBrake", position.handBrake),
        commandResponse: position.commandResponse || "—",
        deviceStatusEvent: position.deviceStatusEvent || "—",
        deviceStatus: position.deviceStatus || "Dado não disponível",
        digitalInput1: formatIoState(position.digitalInput1),
        digitalInput2: formatIoState(position.digitalInput2),
        digitalOutput1: formatIoState(position.digitalOutput1),
        digitalOutput2: formatIoState(position.digitalOutput2),
        digitalInput3: formatIoState(position.digitalInput3),
        digitalInput4: formatIoState(position.digitalInput4),
        digitalInput5: formatIoState(position.digitalInput5),
        digitalInput6: formatIoState(position.digitalInput6),
        digitalInput7: formatIoState(position.digitalInput7),
        digitalInput8: formatIoState(position.digitalInput8),
        digitalOutput3: formatIoState(position.digitalOutput3),
        digitalOutput4: formatIoState(position.digitalOutput4),
        digitalOutput5: formatIoState(position.digitalOutput5),
        digitalOutput6: formatIoState(position.digitalOutput6),
        digitalOutput7: formatIoState(position.digitalOutput7),
        digitalOutput8: formatIoState(position.digitalOutput8),
        ioDetails:
          Array.isArray(position.ioDetails) && position.ioDetails.length
            ? position.ioDetails
                .map((item) => {
                  const label = item?.label || item?.key || "IO";
                  const value = item?.value ?? "—";
                  return `${label}: ${value}`;
                })
                .join(" • ")
            : "—",
      };

      const attributes = position?.attributes && typeof position.attributes === "object" ? position.attributes : {};
      const keys = new Set([...Object.keys(position || {}), ...Object.keys(attributes)]);
      keys.forEach((key) => {
        if (key === "attributes" || key === "protocol") return;
        if (row[key] !== undefined) return;
        const definition = columnDefinitionMap.get(key);
        const sourceValue = key in position ? position[key] : attributes[key];
        row[key] = formatDynamicValue(key, sourceValue, definition);
      });

      return row;
    },
    [columnDefinitionMap],
  );

  const rows = useMemo(() => {
    const list = Array.isArray(positions) ? positions : [];
    return list.map(buildPositionRow);
  }, [buildPositionRow, positions]);


  const timelineEntries = useMemo(() => {
    if (Array.isArray(entries) && entries.length) return entries;
    const positionEntries = (positions || []).map((position) => ({
      id: position.id ?? `${position.gpsTime}-${position.latitude}-${position.longitude}`,
      type: "position",
      timestamp: position.serverTime || position.gpsTime || position.deviceTime || null,
      position,
    }));
    const actionEntries = (actions || []).map((action) => ({
      ...action,
      type: "action",
      timestamp: action.sentAt || action.respondedAt || action.timestamp || null,
    }));
    return [...positionEntries, ...actionEntries]
      .filter((entry) => entry.timestamp)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [actions, entries, positions]);

  const timelineSegments = useMemo(() => {
    const segments = [];
    let buffer = [];

    timelineEntries.forEach((entry) => {
      if (entry?.type === "position" && entry.position) {
        buffer.push(buildPositionRow(entry.position));
        return;
      }
      if (buffer.length) {
        segments.push({ type: "positions", rows: buffer });
        buffer = [];
      }
      if (entry?.type === "action") {
        segments.push({ type: "action", entry });
        return;
      }
      if (entry?.type === "io-event") {
        segments.push({ type: "io-event", entry });
      }
    });

    if (buffer.length) {
      segments.push({ type: "positions", rows: buffer });
    }

    return segments;
  }, [buildPositionRow, timelineEntries]);

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
      setLastResolvedFilter(filter);
      return filter;
    }
    setGeocoding(true);
    try {
      const resolved = await geocodeAddress(text);
      if (!resolved) {
        setAddressFilter(null);
        setLastResolvedFilter(null);
        return null;
      }
      const filter = { ...resolved, radius: DEFAULT_RADIUS_METERS };
      setAddressFilter(filter);
      setLastResolvedFilter(filter);
      return filter;
    } finally {
      setGeocoding(false);
    }
  }, [addressQuery]);

  const buildQueryParams = useCallback(
    (filter, pageParam = 1, limitParam = effectivePageSize) => ({
      vehicleId: selectedVehicleId,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      addressLat: filter?.lat,
      addressLng: filter?.lng,
      addressRadius: filter?.radius,
      page: pageParam,
      limit: limitParam,
    }),
    [effectivePageSize, from, selectedVehicleId, to],
  );

  const handleGenerate = useCallback(
    async (event) => {
      event?.preventDefault?.();
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
        const filterKey = `${resolvedFilter?.lat ?? ""}|${resolvedFilter?.lng ?? ""}|${resolvedFilter?.radius ?? ""}|${addressQuery.trim()}`;
        lastFilterKeyRef.current = filterKey;
        const params = buildQueryParams(resolvedFilter, 1, effectivePageSize);
        baseQueryRef.current = params;
        setPage(1);
        const normalized = await generate(params);
        setPositions(normalized.positions || []);
        setEntries(normalized.entries || []);
        setActions(normalized.actions || []);
        setMeta(normalized.meta);
        setHasGenerated(true);
        setFeedback({ type: "success", message: "Relatório analítico atualizado." });
      } catch (requestError) {
        setFeedback({ type: "error", message: requestError?.message ?? "Erro ao gerar relatório." });
      }
    },
    [selectedVehicleId, from, to, generate, resolveAddressFilter, addressQuery, buildQueryParams, effectivePageSize],
  );

  useEffect(() => {
    if (!hasGenerated || loading || !selectedVehicleId) return;
    const filter = addressQuery.trim() ? addressFilter : null;
    const filterKey = `${filter?.lat ?? ""}|${filter?.lng ?? ""}|${filter?.radius ?? ""}|${addressQuery.trim()}`;
    if (filterKey === lastFilterKeyRef.current) return;
    lastFilterKeyRef.current = filterKey;
    const params = buildQueryParams(filter, 1, effectivePageSize);
    baseQueryRef.current = params;
    setPage(1);
    fetchPage(params)
      .then((normalized) => {
        setPositions(normalized.positions || []);
        setEntries(normalized.entries || []);
        setActions(normalized.actions || []);
        setMeta(normalized.meta);
      })
      .catch(() => {});
  }, [addressFilter, addressQuery, buildQueryParams, effectivePageSize, fetchPage, from, hasGenerated, loading, selectedVehicleId, to]);


  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !meta || !baseQueryRef.current) return;
    if (meta.currentPage >= meta.totalPages) return;
    const nextPage = (meta.currentPage || 1) + 1;
    setLoadingMore(true);
    try {
      const params = { ...baseQueryRef.current, page: nextPage, limit: effectivePageSize };
      baseQueryRef.current = params;
      const normalized = await fetchPage(params);
      setPositions((prev) => [...prev, ...(normalized.positions || [])]);
      setEntries(normalized.entries || []);
      setActions((prev) => prev.length ? prev : (normalized.actions || []));
      setMeta(normalized.meta);
      setPage(nextPage);
    } catch (loadError) {
      setFeedback({ type: "error", message: loadError?.message || "Falha ao carregar mais registros." });
    } finally {
      setLoadingMore(false);
    }
  }, [effectivePageSize, fetchPage, loadingMore, meta]);

  const handlePageSizeChange = useCallback(
    async (value) => {
      const normalizedValue = Number(value);
      setPageSize(normalizedValue || DEFAULT_PAGE_SIZE);
      setPage(1);
      if (!hasGenerated || !selectedVehicleId) return;
      const filter = lastResolvedFilter || addressFilter;
      const params = buildQueryParams(filter, 1, normalizedValue || effectivePageSize);
      baseQueryRef.current = params;
      try {
        const normalized = await generate(params);
        setPositions(normalized.positions || []);
        setEntries(normalized.entries || []);
        setActions(normalized.actions || []);
        setMeta(normalized.meta);
      } catch (requestError) {
        setFeedback({ type: "error", message: requestError?.message || "Erro ao aplicar paginação." });
      }
    },
    [
      addressFilter,
      buildQueryParams,
      effectivePageSize,
      generate,
      hasGenerated,
      lastResolvedFilter,
      selectedVehicleId,
    ],
  );

  const resolveExportPayload = async () => {
    setFormError("");
    if (!selectedVehicleId) {
      setFormError("Selecione exatamente um veículo.");
      return null;
    }
    const baseColumnsToExport = pdfColumns.length ? pdfColumns : visibleColumns.map((col) => col.key);
    const allowedExport = new Set(availableColumnKeys.length ? availableColumnKeys : FALLBACK_COLUMNS.map((col) => col.key));
    const columnsToExport = baseColumnsToExport.filter((key) => allowedExport.has(key));
    const resolvedFilter = addressQuery.trim() ? await resolveAddressFilter() : addressFilter;
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
        availableColumns: availableColumnKeys,
        columnDefinitions: columnDefinitionsPayload,
        addressFilter: resolvedFilter
          ? {
              lat: resolvedFilter.lat,
              lng: resolvedFilter.lng,
              radius: resolvedFilter.radius,
            }
          : null,
        exportTarget: exportFormat === "csv" ? csvExportTarget : null,
      },
    };
  };

  const handleExportPdf = async () => {
    setPdfModalOpen(false);
    const resolvedPayload = await resolveExportPayload();
    if (!resolvedPayload) return;
    setExportingPdf(true);
    try {
      const blob = await exportPdf(resolvedPayload.payload);
      if (!(blob instanceof Blob) || blob.size === 0) {
        showToast("Erro ao solicitar exportação do PDF.", "error");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = buildPdfFileName(selectedVehicle, from, to);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast("Exportação do PDF solicitada com sucesso.");
    } catch (requestError) {
      showToast("Erro ao solicitar exportação do PDF.", "error");
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
      if (!(blob instanceof Blob) || blob.size === 0) {
        setFeedback({
          type: "error",
          message: "Excel não foi recebido. Tente novamente em instantes.",
        });
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = buildXlsxFileName(selectedVehicle, from, to);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setPdfModalOpen(false);
    } catch (requestError) {
      const abortedMessage =
        requestError?.aborted || requestError?.name === "TimeoutError"
          ? "A exportação demorou mais que o esperado. Tente novamente."
          : null;
      setFeedback({
        type: "error",
        message: abortedMessage || requestError?.message || "Falha ao exportar Excel.",
      });
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
      if (!(blob instanceof Blob) || blob.size === 0) {
        setFeedback({
          type: "error",
          message: "CSV não foi recebido. Tente novamente em instantes.",
        });
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = buildCsvFileName(selectedVehicle, from, to, csvExportTarget);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setPdfModalOpen(false);
    } catch (requestError) {
      const abortedMessage =
        requestError?.aborted || requestError?.name === "TimeoutError"
          ? "A exportação demorou mais que o esperado. Tente novamente."
          : null;
      setFeedback({
        type: "error",
        message: abortedMessage || requestError?.message || "Falha ao exportar CSV.",
      });
    } finally {
      setExportingCsv(false);
    }
  };

  const handleApplyColumns = (prefs) => {
    setColumnPrefs(prefs);
    saveColumnPreferences(COLUMN_STORAGE_KEY, prefs);
  };

  const handleRestoreColumns = () => {
    setColumnPrefs(defaults);
    saveColumnPreferences(COLUMN_STORAGE_KEY, defaults);
  };

  const handleColumnWidthChange = (key, width) => {
    setColumnPrefs((prev) => {
      const next = { ...prev, widths: { ...(prev?.widths || {}), [key]: width } };
      saveColumnPreferences(COLUMN_STORAGE_KEY, next);
      return next;
    });
  };

  const openPdfModal = (format = "pdf") => {
    setPdfColumns(visibleColumns.map((column) => column.key));
    setExportFormat(format);
    if (format === "csv") {
      setCsvExportTarget("positions");
    }
    setPdfModalOpen(true);
  };

  const columnsForSelection = useMemo(

    () => availableColumns.map((column) => ({ key: column.key, label: column.label })),
    [availableColumns],

  );
  const toastClassName =
    toast?.type === "error"
      ? "border-red-500/30 bg-red-500/15 text-red-100"
      : "border-emerald-500/30 bg-emerald-500/15 text-emerald-100";

  const resolveActionStatusVariant = (status) => {
    const normalized = String(status || "").toUpperCase();
    if (["ENVIADO", "PENDENTE"].includes(normalized)) return "warning";
    if (["RESPONDIDO", "GERADO", "CONFIRMADO", "SUCESSO"].includes(normalized)) return "success";
    if (["ERRO", "FALHA", "NÃO RESPONDIDO", "NAO RESPONDIDO", "TIMEOUT"].includes(normalized)) return "danger";
    if (["CANCELADO", "CANCELADA"].includes(normalized)) return "neutral";
    return "neutral";
  };

  const buildActionSummary = (entry) => {
    const details = entry?.details || {};
    const summary =
      details.command ||
      details.report ||
      details.itinerary ||
      details.summary ||
      details.description ||
      entry?.summary ||
      "";
    const clean = String(summary || "").trim();
    const label = String(entry?.actionLabel || "").trim();
    if (!clean || clean.toLowerCase() === label.toLowerCase()) return "—";
    return clean;
  };

  const renderActionCard = (entry) => {
    const resolvedRespondedAt = entry?.respondedAt ? formatDateTime(entry.respondedAt) : "—";
    const actionTitle = entry?.actionLabel || entry?.actionType || "Ação do usuário";
    const statusLabel = entry?.status || "—";
    const statusVariant = resolveActionStatusVariant(statusLabel);
    const badgeStyles = {
      warning: "border-yellow-400/40 bg-yellow-500/15 text-yellow-100",
      success: "border-emerald-400/40 bg-emerald-500/15 text-emerald-100",
      danger: "border-red-400/40 bg-red-500/15 text-red-100",
      neutral: "border-white/10 bg-white/10 text-white/60",
    };
    const baseFields = [
      { label: "Enviado em", value: formatDateTime(entry?.sentAt) },
      { label: "Respondido em", value: resolvedRespondedAt },
      { label: "Quem enviou", value: entry?.user || "—" },
      { label: "Endereço IP", value: entry?.ipAddress || "—" },
    ];
    const actionSummary = buildActionSummary(entry);

    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/80 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-white/70">{actionTitle}</span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeStyles[statusVariant]}`}
          >
            {statusLabel}
          </span>
        </div>
        <div className="mt-1 text-[13px] text-white/85">
          <span className="text-[11px] uppercase tracking-[0.18em] text-white/50">O que foi feito</span>
          <span className="ml-2 text-[13px] text-white/85">{actionSummary}</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] text-white/70">
          {baseFields.map((field) => (
            <div key={field.label} className="space-y-0.5 leading-tight">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/50">{field.label}</div>
              <div className="text-[13px] text-white/80">{field.value || "—"}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderIoEventCard = (entry) => {
    const severity = String(entry?.severity || "info").toLowerCase();
    const badgeStyles = {
      critical: "border-red-400/40 bg-red-500/15 text-red-100",
      warning: "border-yellow-400/40 bg-yellow-500/15 text-yellow-100",
      info: "border-sky-400/40 bg-sky-500/10 text-sky-100",
    };
    const severityKey =
      severity === "critical" || severity === "critica" || severity === "crítica"
        ? "critical"
        : severity === "warning" || severity === "alta" || severity === "high"
          ? "warning"
          : "info";
    const title = entry?.title || entry?.label || "Evento de Entrada";
    const statusText = entry?.statusText || (entry?.active ? "Entrada ativada" : "Veículo voltou ao normal");
    const timestamp = formatDateTime(entry?.timestamp || entry?.time || entry?.eventTime);
    const address = entry?.address || entry?.position?.address || "—";

    return (
      <div className="rounded-xl border border-white/10 bg-gradient-to-r from-[#0b2447] via-[#0e2d5a] to-[#0b2447] p-3 text-white/90 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">{title}</span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeStyles[severityKey]}`}
          >
            {entry?.severity || "Info"}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-white/70">
          <div>
            <span className="block text-[10px] uppercase tracking-[0.16em] text-white/50">Recebido em</span>
            <span className="text-[12px] text-white/80">{timestamp}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-[0.16em] text-white/50">Status</span>
            <span className="text-[12px] text-white/85">{statusText}</span>
          </div>
        </div>
        <div className="mt-2 text-[12px] text-white/70">
          <span className="block text-[10px] uppercase tracking-[0.16em] text-white/50">Local</span>
          <span className="text-[12px] text-white/80">{address}</span>
        </div>
      </div>
    );
  };

  const handlePageChange = useCallback(
    async (nextPage) => {
      if (!baseQueryRef.current || loading) return;
      const target = Math.max(1, Math.min(totalPages, nextPage));
      if (target === currentPage) return;
      setLoadingMore(true);
      try {
        const params = { ...baseQueryRef.current, page: target, limit: effectivePageSize };
        baseQueryRef.current = params;
        const normalized = await fetchPage(params);
        setPositions(normalized.positions || []);
        setEntries(normalized.entries || []);
        setActions(normalized.actions || []);
        setMeta(normalized.meta);
        setPage(target);
      } catch (loadError) {
        setFeedback({ type: "error", message: loadError?.message || "Falha ao carregar a página." });
      } finally {
        setLoadingMore(false);
      }
    },
    [currentPage, effectivePageSize, fetchPage, loading, totalPages],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#0b2e57] bg-gradient-to-r from-[#002750] via-[#003367] to-[#002750] px-4 py-2 text-white shadow-lg">
        <div className="flex items-center gap-3">
          <img src={LOGO_URL} alt="Euro One" className="h-7 w-auto object-contain" />
        </div>
        <div className="min-w-0 flex-1 text-[11px] uppercase tracking-[0.18em] text-white/80">
          <span className="inline-flex items-center gap-1 whitespace-nowrap overflow-hidden text-ellipsis">
            <span className="text-white/70">VEÍCULO:</span>
            <span className="font-semibold text-white">
              {selectedVehicle?.name || meta?.vehicle?.name || "—"}
            </span>
            <span className="text-white/40">|</span>
            <span className="text-white/70">PLACA:</span>
            <span className="font-semibold text-white">{selectedVehicle?.plate || meta?.vehicle?.plate || "—"}</span>
            <span className="text-white/40">|</span>
            <span className="text-white/70">CLIENTE:</span>
            <span className="font-semibold text-white">{meta?.vehicle?.customer || "—"}</span>
            <span className="text-white/40">|</span>
            <span className="text-white/70">PERÍODO:</span>
            <span className="font-semibold text-white">
              {formatHeaderDate(from)} → {formatHeaderDate(to)}
            </span>
          </span>
        </div>
      </div>
      <form onSubmit={handleGenerate} className="flex flex-col gap-4">
        <header className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-white/50">Relatório Analítico</p>
              </div>
              <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                <label className="flex items-center gap-2 rounded-md border border-white/15 bg-[#0d1117] px-3 py-2 text-xs font-semibold text-white/80 transition hover:border-white/30">
                  <span className="whitespace-nowrap">Itens por página</span>
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
                  {loading ? "Gerando…" : "Gerar relatório"}
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
                  {exportingCsv ? "Exportando…" : "Exportar CSV"}
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
                  title="Ocultar posições sem ignição"
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
              <p className="text-sm text-white/70">Escolha o veículo, período e filtros para gerar a linha do tempo completa.</p>
              <div className="flex items-center gap-2 text-xs text-white/70">
                <span className="whitespace-nowrap">
                  Página {currentPage} de {totalPages} • {totalItems} itens
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
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error.message}</div>
          </div>
        )}
      </form>

      <section className="flex-1 min-h-0 space-y-4">
        {timelineSegments.length ? (
          timelineSegments.map((segment, index) => {
            if (segment.type === "positions") {
              const segmentRows = hideUnavailableIgnition
                ? segment.rows.filter(
                    (row) => row.ignition !== "Dado não disponível" && row.vehicleState !== "Dado não disponível",
                  )
                : segment.rows;
              return (
                <MonitoringTable
                  key={`segment-${index}`}
                  rows={segmentRows}
                  columns={visibleColumnsWithWidths}
                  loading={loading || loadingMore}
                  emptyText="Nenhuma posição encontrada para o período selecionado."
                  columnWidths={columnPrefs?.widths}
                  onColumnWidthChange={handleColumnWidthChange}
                  liveGeocode={false}
                />
              );
            }
            if (segment.type === "action") {
              return <div key={`segment-${index}`}>{renderActionCard(segment.entry)}</div>;
            }
            if (segment.type === "io-event") {
              return <div key={`segment-${index}`}>{renderIoEventCard(segment.entry)}</div>;
            }
            return null;
          })
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-white/60">
            {hasGenerated
              ? "Nenhum registro encontrado para o período selecionado."
              : "Selecione o veículo e gere o relatório para visualizar a linha do tempo."}
          </div>
        )}
      </section>
      {hasGenerated && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={!canGoPrev || loadingMore}
              className="rounded-md border border-white/20 px-3 py-1.5 font-semibold text-white/80 hover:border-primary/40 hover:text-primary disabled:opacity-50"
            >
              Anterior
            </button>
            <button
              type="button"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={!canGoNext || loadingMore}
              className="rounded-md border border-white/20 px-3 py-1.5 font-semibold text-white/80 hover:border-primary/40 hover:text-primary disabled:opacity-50"
            >
              Próximo
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span>Ir para página</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={currentPage}
              onChange={(event) => handlePageChange(Number(event.target.value || 1))}
              className="w-20 rounded-md border border-white/15 bg-[#0d1117] px-2 py-1 text-xs text-white/80 outline-none"
            />
            <span className="text-white/50">de {totalPages}</span>
          </div>
        </div>
      )}
      {canLoadMore && (
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:border-primary/40 hover:text-primary disabled:opacity-50"
          >
            {loadingMore ? "Carregando..." : "Carregar mais"}
          </button>
        </div>
      )}

      {activePopup === "columns" && (
        <MonitoringColumnSelector
          columns={availableColumns}
          columnPrefs={columnPrefs}
          defaultPrefs={defaults}
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
                      ? "Colunas do CSV"
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
            {exportFormat === "csv" && (
              <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/70">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/60">Exportação CSV</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="csvExportTarget"
                      value="positions"
                      checked={csvExportTarget === "positions"}
                      onChange={() => setCsvExportTarget("positions")}
                      className="accent-primary"
                    />
                    <span>Posições/Eventos</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="csvExportTarget"
                      value="actions"
                      checked={csvExportTarget === "actions"}
                      onChange={() => setCsvExportTarget("actions")}
                      className="accent-primary"
                    />
                    <span>Ações do usuário</span>
                  </label>
                </div>
                <p className="mt-2 text-[11px] text-white/50">
                  Selecione o conteúdo desejado para o CSV.
                </p>
              </div>
            )}
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
                className="rounded-md border border-primary/40 bg-primary/20 px-3 py-2 text-[11px] font-semibold text-white hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={(exportFormat === "pdf" && exportingPdf) || exportingXlsx || exportingCsv}
                onClick={
                  exportFormat === "xlsx"
                    ? handleExportXlsx
                    : exportFormat === "csv"
                      ? handleExportCsv
                      : handleExportPdf
                }
              >
                {exportFormat === "pdf" && exportingPdf ? "Solicitando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[9999] rounded-xl border px-4 py-3 text-sm shadow-lg ${toastClassName}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
