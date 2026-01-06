import fs from "node:fs";
import { positionsColumnMap, positionsColumns, resolveColumnLabel } from "../../shared/positionsColumns.js";
import { resolveTelemetryDescriptor } from "../../shared/telemetryDictionary.js";
import { formatFullAddress } from "./address.js";

const BRAND_COLOR = "#001F3F";
const LOGO_URL = "https://eurosolucoes.tech/wp-content/uploads/2024/10/logo-3-2048x595.png";
const FONT_STACK = '"DejaVu Sans", "Inter", "Roboto", "Noto Sans", "Segoe UI", Arial, sans-serif';
const FONT_PATH_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const FONT_PATH_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

let cachedLogoDataUrl = null;
let cachedFontRegular = null;
let cachedFontBold = null;
let cachedChromium = null;

async function loadChromium() {
  if (cachedChromium) return cachedChromium;
  try {
    const { chromium } = await import("playwright");
    cachedChromium = chromium;
    return chromium;
  } catch (error) {
    console.error(
      "[reports/pdf] Playwright não encontrado. Instale a dependência para habilitar exportação PDF.",
      error?.message || error,
    );
    const missing = new Error("Dependência Playwright ausente para gerar PDF. Rode npm run provision:playwright no ambiente.");
    missing.code = "PLAYWRIGHT_MISSING";
    missing.status = 503;
    throw missing;
  }
}

async function fetchLogoDataUrl() {
  if (cachedLogoDataUrl) return cachedLogoDataUrl;
  try {
    const response = await fetch(LOGO_URL);
    if (!response.ok) {
      throw new Error(`Falha ao buscar logo (${response.status}).`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "image/png";
    cachedLogoDataUrl = `data:${contentType};base64,${buffer.toString("base64")}`;
    return cachedLogoDataUrl;
  } catch (error) {
    console.warn("[reports/pdf] não foi possível carregar logo", error?.message || error);
    cachedLogoDataUrl = null;
    return null;
  }
}

function loadFontBase64(fontPath) {
  try {
    const buffer = fs.readFileSync(fontPath);
    return buffer.toString("base64");
  } catch (error) {
    console.warn("[reports/pdf] não foi possível ler fonte", fontPath, error?.message || error);
    return null;
  }
}

function ensureFontData() {
  if (!cachedFontRegular) {
    cachedFontRegular = loadFontBase64(FONT_PATH_REGULAR);
  }
  if (!cachedFontBold) {
    cachedFontBold = loadFontBase64(FONT_PATH_BOLD);
  }
  return {
    regular: cachedFontRegular,
    bold: cachedFontBold,
  };
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("pt-BR");
}

function normalizeAddress(value) {
  if (!value) return "—";
  if (typeof value === "string") return formatFullAddress(value);
  if (value && typeof value === "object") {
    if (value.formatted) return formatFullAddress(value.formatted);
    if (value.formatted_address) return formatFullAddress(value.formatted_address);
    if (value.formattedAddress) return formatFullAddress(value.formattedAddress);
    if (value.address) return formatFullAddress(value.address);
    try {
      return formatFullAddress(JSON.stringify(value));
    } catch (_error) {
      return "—";
    }
  }
  return formatFullAddress(String(value));
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
  if (["gpsTime", "deviceTime", "serverTime", "occurredAt"].includes(key)) return formatDate(value);
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveColumnLabelByKey(key, columnDefinitions, variant = "pdf") {
  const column = columnDefinitions?.get?.(key) || positionsColumnMap.get(key);
  return resolveColumnLabel(column, variant);
}

function chunkArray(list = [], size = 500) {
  if (!Array.isArray(list) || size <= 0) return [list || []];
  const chunks = [];
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size));
  }
  return chunks;
}

function buildHtml({
  rows,
  columns,
  meta,
  logoDataUrl,
  fontData,
  columnDefinitions = new Map(),
  chunkSize = 500,
  options = {},
}) {
  const columnCount = Math.max(1, columns.length);
  const density = Math.max(0.45, Math.min(1, 20 / (columnCount + 6)));
  const baseFontSize = (9 * density).toFixed(2);
  const headerFontSize = (8 * density).toFixed(2);
  const cellPadding = Math.max(2, Math.round(8 * density));
  const reportTitle = options.title || "RELATÓRIO DE POSIÇÕES";
  const reportSubtitle = options.subtitle || "Dados consolidados do veículo e posições georreferenciadas";
  const summaryTitle = options.summaryTitle || "Resumo do veículo";

  const columnsGroup = columns?.length ? columns : [];

  const renderTable = (sliceRows, sliceIndex) => {
    const tableHeaders = columnsGroup
      .map((key) => `<th>${escapeHtml(resolveColumnLabelByKey(key, columnDefinitions, "pdf"))}</th>`)
      .join("");
    const totalWeight =
      columnsGroup.reduce((sum, key) => {
        return sum + (columnDefinitions?.get?.(key)?.weight || positionsColumnMap.get(key)?.weight || 1);
      }, 0) || 1;
    const colgroup = columnsGroup
      .map((key) => {
        const weight = columnDefinitions?.get?.(key)?.weight || positionsColumnMap.get(key)?.weight || 1;
        const percent = ((weight / totalWeight) * 100).toFixed(2);
        return `<col style="width:${percent}%" />`;
      })
      .join("");

    const tableRows = sliceRows
      .map((row) => {
        const cells = columnsGroup
          .map((key) => {
            const definition = columnDefinitions?.get?.(key) || positionsColumnMap.get(key);
            return `<td>${escapeHtml(formatCellValue(key, row[key], definition))}</td>`;
          })
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");

    const pageBreak = sliceIndex > 0 ? '<div class="page-break"></div>' : "";
    return `
      ${pageBreak}
      <div class="header">
        ${logoDataUrl ? `<div class="logo"><img src="${logoDataUrl}" alt="Euro One" /></div>` : '<div class="logo fallback">EURO ONE</div>'}
        <div>
          <div class="title">${escapeHtml(reportTitle)}</div>
          <div class="subtitle">${escapeHtml(reportSubtitle)}</div>
          <div class="meta-chips">
            <div class="badge">Período: ${escapeHtml(formatDate(meta?.from))} – ${escapeHtml(formatDate(meta?.to))}</div>
            <div class="badge">Gerado em ${escapeHtml(formatDate(meta?.generatedAt))}</div>
          </div>
        </div>
      </div>
      <div class="meta-grid">
        <div class="meta-item"><span>Veículo</span>${escapeHtml(meta?.vehicle?.name || "—")}</div>
        <div class="meta-item"><span>Placa</span>${escapeHtml(meta?.vehicle?.plate || "—")}</div>
        <div class="meta-item"><span>Cliente</span>${escapeHtml(meta?.vehicle?.customer || "—")}</div>
        <div class="meta-item"><span>Exportado por</span>${escapeHtml(meta?.exportedBy || "—")}</div>
      <div class="meta-item"><span>Status</span>${escapeHtml(meta?.vehicle?.status || "—")}</div>
      <div class="meta-item"><span>Última Comunicação</span>${escapeHtml(formatDate(meta?.vehicle?.lastCommunication))}</div>
    </div>
    <div class="card">
        <div class="card-title">${escapeHtml(summaryTitle)}</div>
        <div class="card-grid">
          <div><span>Placa</span>${escapeHtml(meta?.vehicle?.plate || "—")}</div>
          <div><span>Veículo</span>${escapeHtml(meta?.vehicle?.name || "—")}</div>
          <div><span>Cliente</span>${escapeHtml(meta?.vehicle?.customer || "—")}</div>
          <div><span>Status atual</span>${escapeHtml(meta?.vehicle?.status || "—")}</div>
          <div><span>Última comunicação</span>${escapeHtml(formatDate(meta?.vehicle?.lastCommunication))}</div>
          <div><span>Ignição</span>${escapeHtml(meta?.vehicle?.ignition ?? "Indisponível")}</div>
        </div>
      </div>
      <div class="table-wrapper">
        <table>
          <colgroup>${colgroup}</colgroup>
          <thead>
            <tr>${tableHeaders}</tr>
          </thead>
          <tbody>
            ${tableRows || `<tr><td colspan="${columnsGroup.length}">—</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  };

  const slices = chunkArray(rows, chunkSize);
  const tables = slices.map((slice, sliceIndex) => renderTable(slice, sliceIndex)).join("");

  const fontFaces = fontData?.regular
    ? `
    @font-face {
      font-family: 'DejaVu Sans';
      src: url('data:font/ttf;base64,${fontData.regular}') format('truetype');
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: 'DejaVu Sans';
      src: url('data:font/ttf;base64,${fontData.bold || fontData.regular}') format('truetype');
      font-weight: 700;
      font-style: normal;
    }
  `
    : "";

  return `
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <style>
      ${fontFaces}
      * { box-sizing: border-box; }
      :root {
        --cell-padding: ${cellPadding}px;
        --font-size: ${baseFontSize}px;
        --header-font-size: ${headerFontSize}px;
      }
      body {
        margin: 0;
        font-family: ${FONT_STACK};
        color: #0f172a;
        background: #ffffff;
      }
      .report {
        padding: 24px 28px 12px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .header {
        padding: 18px 20px;
        border-radius: 14px;
        background: linear-gradient(135deg, ${BRAND_COLOR} 0%, #012a58 100%);
        color: #ffffff;
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 14px 18px;
        align-items: center;
      }
      .logo img {
        height: 48px;
        object-fit: contain;
        filter: drop-shadow(0 4px 8px rgba(0,0,0,0.2));
      }
      .logo.fallback {
        height: 48px;
        display: grid;
        place-items: center;
        padding: 10px 14px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.35);
        font-weight: 700;
        letter-spacing: 1px;
      }
      .title {
        font-size: 20px;
        font-weight: 700;
        letter-spacing: 0.6px;
        text-transform: uppercase;
      }
      .subtitle {
        font-size: 12px;
        color: rgba(255,255,255,0.9);
        margin-top: 4px;
      }
      .meta-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        padding: 14px 16px;
        border-radius: 14px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        font-size: 11px;
        box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
      }
      .meta-item span {
        display: block;
        font-weight: 600;
        color: #475569;
        margin-bottom: 4px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-size: 9px;
      }
      .card {
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        padding: 16px 16px 6px;
        background: #ffffff;
        box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
      }
      .card-title {
        font-size: 13px;
        font-weight: 800;
        color: ${BRAND_COLOR};
        margin-bottom: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .card-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px 18px;
        font-size: 11px;
      }
      .card-grid span {
        display: block;
        font-weight: 600;
        color: #64748b;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: 4px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(0, 31, 63, 0.08);
        color: ${BRAND_COLOR};
        border: 1px solid rgba(0, 31, 63, 0.14);
        border-radius: 999px;
        padding: 6px 12px;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 4px;
        font-size: var(--font-size);
        table-layout: fixed;
      }
      th, td {
        word-break: break-word;
        overflow-wrap: anywhere;
        hyphens: auto;
        line-height: 1.45;
      }
      thead {
        display: table-header-group;
        background: ${BRAND_COLOR};
        color: #ffffff;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
      }
      thead th {
        padding: calc(var(--cell-padding) * 0.75) var(--cell-padding);
        text-align: left;
        font-weight: 700;
        font-size: var(--header-font-size);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        white-space: normal;
      }
      tbody td {
        padding: calc(var(--cell-padding) * 0.75) var(--cell-padding);
        border-bottom: 1px solid #e2e8f0;
        color: #1f2937;
        white-space: normal;
      }
      tbody tr:nth-child(even) {
        background: #f8fafc;
      }
      tr {
        page-break-inside: avoid;
      }
      .table-wrapper {
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        overflow: hidden;
        box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
      }
      .meta-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 4px;
      }
      .page-break {
        page-break-before: always;
      }
      @page {
        margin: 16mm 12mm 20mm;
      }
    </style>
  </head>
  <body>
    <div class="report">
      ${tables}
    </div>
  </body>
</html>
  `;
}


export function resolvePdfColumns(columns, availableColumns = null) {
  const allowed = Array.isArray(availableColumns) && availableColumns.length
    ? availableColumns
    : positionsColumns.map((column) => column.key);
  const requested = Array.isArray(columns) ? columns : [];
  const filteredRequested = requested.filter((key) => allowed.includes(key));
  if (filteredRequested.length) return filteredRequested;
  return allowed;
}

const MAX_PDF_COLUMNS = 120;
const PDF_CHUNK_SIZE = 500;

export async function generatePositionsReportPdf({
  rows,
  columns,
  meta,
  availableColumns = null,
  columnDefinitions = [],
  options = {},
}) {
  const safeColumns = resolvePdfColumns(columns, availableColumns);
  if (safeColumns.length > MAX_PDF_COLUMNS) {
    const error = new Error(`Limite de colunas para PDF excedido (${safeColumns.length}/${MAX_PDF_COLUMNS}). Reduza as colunas.`);
    error.code = "PDF_COLUMNS_LIMIT";
    error.status = 422;
    throw error;
  }
  const chromium = await loadChromium();
  let browser = null;

  try {
    const launchArgs = [
      "--font-render-hinting=medium",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ];
    try {
      browser = await chromium.launch({
        headless: true,
        args: launchArgs,
      });
    } catch (launchError) {
      const error = new Error(
        "Falha ao inicializar Chromium para gerar PDF. Verifique se o Playwright está instalado e se o host permite --no-sandbox.",
      );
      error.code = launchError?.code || "PDF_CHROMIUM_LAUNCH_FAILED";
      error.status = launchError?.status ?? 500;
      error.cause = launchError;
      console.error("[reports/pdf] erro ao abrir Chromium", launchError?.message || launchError);
      throw error;
    }

    const page = await browser.newPage();
    const logoDataUrl = await fetchLogoDataUrl();
    const fontData = ensureFontData();

    const columnsToUse = safeColumns;

    const safeRows = Array.isArray(rows) ? rows : [];
    const columnMap = Array.isArray(columnDefinitions)
      ? new Map(columnDefinitions.map((column) => [column.key, column]))
      : null;
    const needsWidePage = columnsToUse.length > 30;
    const html = buildHtml({
      rows: safeRows,
      columns: columnsToUse,
      meta,
      logoDataUrl,
      fontData,
      columnDefinitions: columnMap,
      chunkSize: PDF_CHUNK_SIZE,
      options,
    });

    await page.setContent(html, { waitUntil: "networkidle" });

    return await page.pdf({
      format: needsWidePage ? "A3" : "A4",
      landscape: true,
      scale: needsWidePage ? 0.9 : 1,
      printBackground: true,
      displayHeaderFooter: true,
      margin: { top: "16mm", right: "12mm", bottom: "20mm", left: "12mm" },
      footerTemplate: `
        <div style="width:100%; font-family:${FONT_STACK}; font-size:9px; color:#64748b; padding:0 12mm; display:flex; justify-content:space-between;">
          <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
          <span>Gerado pelo Euro One</span>
        </div>
      `,
      headerTemplate: "<div></div>",
    });
  } catch (error) {
    const normalized = new Error(error?.message || "Falha ao gerar PDF de posições.");
    normalized.code = error?.code || "POSITIONS_PDF_ERROR";
    normalized.status = error?.status ?? 500;
    normalized.cause = error;
    console.error("[reports/pdf] falha ao gerar relatório de posições", {
      message: normalized.message,
      code: normalized.code,
      status: normalized.status,
    });
    throw normalized;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.warn("[reports/pdf] falha ao fechar navegador", closeError?.message || closeError);
      }
    }
  }
}
