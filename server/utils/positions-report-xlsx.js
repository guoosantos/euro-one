import ExcelJS from "exceljs";
import { positionsColumnMap, resolveColumnLabel } from "../../shared/positionsColumns.js";
import { resolveTelemetryDescriptor } from "../../shared/telemetryDictionary.js";
import { formatAddress } from "./address.js";
import { resolvePdfColumns } from "./positions-report-pdf.js";

const BRAND_COLOR = "001F3F";
const LIGHT_FILL = "F3F6FA";
const ZEBRA_FILL = "0F172A0F";
const LOGO_URL = "https://eurosolucoes.tech/wp-content/uploads/2024/10/logo-3-2048x595.png";
const MAX_XLSX_ROWS = 20_000;
const MAX_XLSX_COLUMNS = 120;
const MAX_COLUMN_WIDTH = 60;
const MIN_COLUMN_WIDTH = 12;

let cachedLogo = null;

async function fetchLogoBuffer() {
  if (cachedLogo) return cachedLogo;
  try {
    const response = await fetch(LOGO_URL);
    if (!response.ok) throw new Error(`Falha ao buscar logo (${response.status}).`);
    const buffer = Buffer.from(await response.arrayBuffer());
    cachedLogo = { buffer, extension: "png" };
    return cachedLogo;
  } catch (error) {
    console.warn("[reports/xlsx] não foi possível carregar logo", error?.message || error);
    cachedLogo = null;
    return null;
  }
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("pt-BR");
}

function normalizeAddress(value) {
  if (!value) return "—";
  if (typeof value === "string") return formatAddress(value);
  if (value && typeof value === "object") {
    if (value.formatted) return formatAddress(value.formatted);
    if (value.formatted_address) return formatAddress(value.formatted_address);
    if (value.formattedAddress) return formatAddress(value.formattedAddress);
    if (value.address) return formatAddress(value.address);
  }
  return formatAddress(String(value));
}

function formatCellValue(key, value, definition) {
  if (value === null || value === undefined || value === "") {
    if (key === "ignition" || key === "vehicleState") return "Indisponível";
    return "—";
  }
  if (key === "ioDetails" && Array.isArray(value) && value.length) {
    return value
      .map((item) => {
        const label = item?.label || item?.key || "IO";
        const val = item?.value ?? "—";
        return `${label}: ${val}`;
      })
      .join(" • ");
  }
  const descriptor = resolveTelemetryDescriptor(key);
  if (descriptor) {
    if (descriptor.type === "boolean") {
      const normalized = typeof value === "string" ? value : value ? "Ativo" : "Inativo";
      return normalized;
    }
    if (descriptor.type === "number") {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return String(value);
      const formatted = numeric.toFixed(2);
      return descriptor.unit ? `${formatted} ${descriptor.unit}`.trim() : formatted;
    }
  }
  if (["gpsTime", "deviceTime", "serverTime"].includes(key)) return formatDate(value);
  if (key === "speed") return Number.isFinite(Number(value)) ? `${Number(value)} km/h` : String(value);
  if (key === "direction") return Number.isFinite(Number(value)) ? `${Number(value)}°` : String(value);
  if (key === "accuracy") return Number.isFinite(Number(value)) ? `${Number(value)} m` : String(value);
  if (key === "distance" || key === "totalDistance") {
    return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)} km` : String(value);
  }
  if (key === "vehicleVoltage") return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)} V` : String(value);
  if (key === "hdop") return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : String(value);
  if (key === "batteryLevel") return Number.isFinite(Number(value)) ? `${Number(value)}%` : String(value);
  if (key === "ignition") return value ? "Ligada" : "Desligada";
  if (key === "vehicleState" && value === "—") return "Indisponível";
  if (key === "address") return normalizeAddress(value);
  if (definition?.type === "boolean") return value ? "Sim" : "Não";
  if (definition?.type === "percent") return Number.isFinite(Number(value)) ? `${Number(value)}%` : String(value);
  if (definition?.unit === "V") return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)} V` : String(value);
  return typeof value === "object" ? normalizeAddress(value) : String(value);
}

function resolveColumnLabelByKey(key, columnDefinitions, variant = "pdf") {
  const column = columnDefinitions?.get?.(key) || positionsColumnMap.get(key);
  return resolveColumnLabel(column, variant);
}

function computeColumnWidths(headerLabels, rows) {
  const widths = headerLabels.map((label) => Math.max(label.length, MIN_COLUMN_WIDTH));
  rows.forEach((row) => {
    row.forEach((value, idx) => {
      const length = String(value ?? "").length;
      widths[idx] = Math.max(widths[idx], length);
    });
  });
  return widths.map((width) => Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)));
}

export async function generatePositionsReportXlsx({
  rows = [],
  columns = [],
  columnDefinitions = null,
  meta = {},
  availableColumns = null,
  options = {},
} = {}) {
  const safeColumns = resolvePdfColumns(columns, availableColumns || columns).slice(0, MAX_XLSX_COLUMNS);
  const safeRows = rows.slice(0, MAX_XLSX_ROWS);
  const definitionsMap = new Map(
    (columnDefinitions || []).map((column) => [column.key, column]),
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Euro-One";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Relatório de Posições", {
    properties: { defaultRowHeight: 18 },
    views: [],
  });

  const logo = options?.includeLogo === false ? null : await fetchLogoBuffer();
  if (logo?.buffer) {
    const imageId = workbook.addImage({ buffer: logo.buffer, extension: logo.extension || "png" });
    worksheet.addImage(imageId, {
      tl: { col: 0, row: 0 },
      ext: { width: 180, height: 50 },
    });
  }

  const titleRow = worksheet.addRow([]);
  const infoRow = worksheet.addRow([]);
  const detailRow = worksheet.addRow([]);

  const headerLabels = safeColumns.map((key) => resolveColumnLabelByKey(key, definitionsMap, "pt"));
  const headerRow = worksheet.addRow(headerLabels);

  const headerRowIndex = headerRow.number;
  const totalColumns = headerLabels.length || 1;

  worksheet.mergeCells(titleRow.number, 2, titleRow.number, totalColumns);
  worksheet.mergeCells(infoRow.number, 1, infoRow.number, totalColumns);
  worksheet.mergeCells(detailRow.number, 1, detailRow.number, totalColumns);

  titleRow.getCell(2).value = "RELATÓRIO DE POSIÇÕES";
  titleRow.getCell(2).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  titleRow.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${BRAND_COLOR}` } };
  titleRow.height = 24;

  const vehicle = meta?.vehicle || {};
  const vehicleLabel = [vehicle?.name, vehicle?.plate].filter(Boolean).join(" - ") || "Veículo";
  infoRow.getCell(1).value = `Veículo: ${vehicleLabel}`;
  infoRow.getCell(1).font = { bold: true, color: { argb: "FF4B5563" } };

  const periodLabel = `Período: ${formatDate(meta?.from)} a ${formatDate(meta?.to)}`;
  detailRow.getCell(1).value = `${periodLabel} • Gerado em ${formatDate(meta?.generatedAt)}`;
  detailRow.getCell(1).font = { color: { argb: "FF4B5563" } };

  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${BRAND_COLOR}` } };
  headerRow.alignment = { vertical: "middle" };

  const dataRows = safeRows.map((row) =>
    safeColumns.map((key) => formatCellValue(key, row?.[key], definitionsMap.get(key))),
  );

  dataRows.forEach((values) => worksheet.addRow(values));

  const widths = computeColumnWidths(headerLabels, dataRows);
  worksheet.columns = widths.map((width) => ({ width }));

  worksheet.views = [{ state: "frozen", ySplit: headerRowIndex }];
  worksheet.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: headerRowIndex, column: totalColumns },
  };

  const zebraFill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${ZEBRA_FILL}` } };
  for (let rowIndex = headerRowIndex + 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    if ((rowIndex - headerRowIndex) % 2 === 0) {
      worksheet.getRow(rowIndex).fill = zebraFill;
    }
  }

  return await workbook.xlsx.writeBuffer();
}

function escapeCsvValue(value) {
  const stringValue = String(value ?? "");
  if (/[\";\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export function generatePositionsReportCsv({
  rows = [],
  columns = [],
  columnDefinitions = null,
  availableColumns = null,
} = {}) {
  const safeColumns = resolvePdfColumns(columns, availableColumns || columns);
  const definitionsMap = new Map((columnDefinitions || []).map((column) => [column.key, column]));
  const headerLabels = safeColumns.map((key) => resolveColumnLabelByKey(key, definitionsMap, "pt"));

  const lines = [];
  lines.push(headerLabels.map(escapeCsvValue).join(";"));

  rows.forEach((row) => {
    const values = safeColumns.map((key) => formatCellValue(key, row?.[key], definitionsMap.get(key)));
    lines.push(values.map(escapeCsvValue).join(";"));
  });

  const content = `\ufeff${lines.join("\n")}`;
  return Buffer.from(content, "utf8");
}

export default generatePositionsReportXlsx;
