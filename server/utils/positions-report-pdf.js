import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import { positionsColumnMap, positionsColumns, resolveColumnLabel } from "../../shared/positionsColumns.js";
import { resolveTelemetryDescriptor } from "../../shared/telemetryDictionary.js";
import { formatFullAddress } from "./address.js";

const BRAND_COLOR = "#001F3F";
const LOGO_URL = "https://eurosolucoes.tech/wp-content/uploads/2024/10/logo-3-2048x595.png";
const FONT_STACK = '"DejaVu Sans", "Inter", "Roboto", "Noto Sans", "Segoe UI", Arial, sans-serif';
const FONT_PATH_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const FONT_PATH_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const CONTENT_GUTTER_PX = 0;

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

function resolveStatusVariant(status) {
  const normalized = String(status || "").toUpperCase();
  if (["ENVIADO", "PENDENTE"].includes(normalized)) return "warning";
  if (["RESPONDIDO", "GERADO", "CONFIRMADO", "SUCESSO"].includes(normalized)) return "success";
  if (["ERRO", "FALHA", "NÃO RESPONDIDO", "NAO RESPONDIDO", "TIMEOUT"].includes(normalized)) return "danger";
  if (["CANCELADO", "CANCELADA"].includes(normalized)) return "neutral";
  return "neutral";
}

function buildActionSummary(action) {
  const details = action?.details || {};
  const summary =
    details.command ||
    details.report ||
    details.itinerary ||
    details.summary ||
    details.description ||
    action?.summary ||
    "";
  const clean = String(summary || "").trim();
  const label = String(action?.actionLabel || "").trim();
  if (!clean || clean.toLowerCase() === label.toLowerCase()) return "—";
  return clean;
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

function formatCoordinate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric.toFixed(5);
}

function resolveRowCoordinate(row, keys) {
  for (const key of keys) {
    const resolved = formatCoordinate(row?.[key]);
    if (resolved !== null) return resolved;
  }
  return null;
}

function formatAddressWithLatLng(value, row) {
  const address = normalizeAddress(value);
  const lat = resolveRowCoordinate(row, ["latitude", "lat", "addressLat"]);
  const lng = resolveRowCoordinate(row, ["longitude", "lng", "addressLng"]);
  if (!lat || !lng) return address;
  const coords = `(${lat}, ${lng})`;
  if (!address || address === "—") return coords;
  return `${address} ${coords}`;
}

function normalizeSeverityToken(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "info";
  if (["informativa", "info"].includes(normalized)) return "info";
  if (["alerta", "warning"].includes(normalized)) return "warning";
  if (["critica", "crítica", "critical"].includes(normalized)) return "critical";
  if (["alta", "high"].includes(normalized)) return "high";
  if (["moderada", "media", "média", "medium", "moderate"].includes(normalized)) return "medium";
  if (["baixa", "low"].includes(normalized)) return "low";
  return normalized;
}

function buildSeverityBadge(value) {
  if (!value) return "—";
  const label = String(value);
  const token = normalizeSeverityToken(label);
  const labels = {
    info: "Informativa",
    warning: "Alerta",
    low: "Baixa",
    medium: "Moderada",
    high: "Alta",
    critical: "Crítica",
  };
  const display = labels[token] || label;
  return `<span class="severity-badge severity-badge--${token}">${escapeHtml(display)}</span>`;
}

function formatCellValue(key, value, definition, row) {
  if (value === null || value === undefined || value === "") {
    if (key === "ignition" || key === "vehicleState") return "Dado não disponível";
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
  if (key === "vehicleState" && value === "—") return "Dado não disponível";
  if (key === "address") return formatAddressWithLatLng(value, row);
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

function resolveColumnLabelByKey(key, columnDefinitions, variant = "pdf", options = {}) {
  const column = columnDefinitions?.get?.(key) || positionsColumnMap.get(key);
  return resolveColumnLabel(column, variant, options);
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
  actions = [],
  entries = [],
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
  const isAnalytic = options.variant === "analytic";
  const reportTitle = options.title || (isAnalytic ? "RELATÓRIO ANALÍTICO" : "RELATÓRIO DE POSIÇÕES");
  const reportSubtitle =
    options.subtitle ||
    (isAnalytic
      ? "Linha do tempo completa do veículo com auditoria de ações (comandos, relatórios e itinerários)."
      : "Dados consolidados do veículo e posições georreferenciadas");
  const summaryTitle = options.summaryTitle || "Resumo do veículo";
  const actionsTitle = options.actionsTitle || "Ações do usuário";
  const actionsSubtitle = options.actionsSubtitle || "Comandos, relatórios e auditoria do período";

  const columnsGroup = columns?.length ? columns : [];

  const renderReportMetaHeader = () => `
      <div class="report-meta">
        <div><span>Veículo</span>${escapeHtml(meta?.vehicle?.name || "—")}</div>
        <div><span>Placa</span>${escapeHtml(meta?.vehicle?.plate || "—")}</div>
        <div><span>Cliente</span>${escapeHtml(meta?.vehicle?.customer || "—")}</div>
        <div><span>Período</span>${escapeHtml(`${formatDate(meta?.from)} → ${formatDate(meta?.to)}`)}</div>
      </div>
    `;

  const renderTable = (
    sliceRows,
    sliceIndex,
    {
      includeHeader = true,
      includePageBreak = true,
      includeMetaHeader = false,
      wrapContainer = true,
    } = {},
  ) => {
    if (!Array.isArray(sliceRows) || sliceRows.length === 0) return "";
    const labelOptions = { protocol: meta?.protocol, deviceModel: meta?.deviceModel };
    const tableHeaders = columnsGroup
      .map((key) => `<th>${escapeHtml(resolveColumnLabelByKey(key, columnDefinitions, "pdf", labelOptions))}</th>`)
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
            const formatted = formatCellValue(key, row[key], definition, row);
            const normalizedKey = String(key || "").toLowerCase();
            if (["eventseverity", "criticality", "severity"].includes(normalizedKey)) {
              if (formatted === "—") return "<td>—</td>";
              return `<td>${buildSeverityBadge(formatted)}</td>`;
            }
            return `<td>${escapeHtml(formatted)}</td>`;
          })
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");

    const pageBreak = includePageBreak && sliceIndex > 0 ? '<div class="page-break"></div>' : "";
    const headerBlock = includeHeader
      ? `
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
          <div><span>Ignição</span>${escapeHtml(meta?.vehicle?.ignition ?? "Dado não disponível")}</div>
        </div>
      </div>
    `
      : "";
    const metaHeaderBlock = includeMetaHeader ? renderReportMetaHeader() : "";
    return `
      ${pageBreak}
      ${wrapContainer ? '<div class="report-content">' : ""}
        ${headerBlock}
        ${metaHeaderBlock}
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
      ${wrapContainer ? "</div>" : ""}
    `;
  };

  const slices = chunkArray(rows, chunkSize);
  const tables = slices.map((slice, sliceIndex) => renderTable(slice, sliceIndex)).join("");
  const safeActions = Array.isArray(actions) ? actions : [];
  const safeEntries = Array.isArray(entries) ? entries : [];

  const hasActionContent = (action) => {
    if (!action || typeof action !== "object") return false;
    const title = String(action?.actionLabel || action?.actionType || "").trim();
    const status = String(action?.status || "").trim();
    const summary = buildActionSummary(action);
    const hasSummary = summary && summary !== "—";
    const hasMeta = [action?.sentAt, action?.respondedAt, action?.user, action?.ipAddress].some(Boolean);
    return Boolean(title || status || hasSummary || hasMeta);
  };

  const renderActionCard = (action) => {
    if (!hasActionContent(action)) return "";
    const statusVariant = resolveStatusVariant(action?.status);
    const statusLabel = action?.status || "—";
    const title = action?.actionLabel || action?.actionType || "Ação do usuário";
    const summary = buildActionSummary(action);
    const baseFields = [
      { label: "Enviado em", value: formatDate(action?.sentAt) },
      { label: "Respondido em", value: formatDate(action?.respondedAt) },
      { label: "Quem enviou", value: action?.user || "—" },
      { label: "Endereço IP", value: action?.ipAddress || "—" },
    ];
    return `
      <div class="timeline-item">
        <div class="action-card">
          <div class="action-head">
            <span class="action-title">${escapeHtml(title)}</span>
            <span class="action-badge action-badge--${statusVariant}">${escapeHtml(statusLabel)}</span>
          </div>
          <div class="action-summary">
            <span>O que foi feito</span>
            ${escapeHtml(summary)}
          </div>
          <div class="action-meta">
            ${baseFields
              .map(
                (field) => `
              <div>
                <span>${escapeHtml(field.label)}</span>
                ${escapeHtml(field.value || "—")}
              </div>
            `,
              )
              .join("")}
          </div>
        </div>
      </div>
    `;
  };

  const renderAnalyticHeader = () => `
    <div class="intro-card">
      <div class="intro-title-row">
        <div class="intro-logo">
          ${
            logoDataUrl
              ? `<img src="${logoDataUrl}" alt="Euro One" />`
              : `<span class="intro-logo-fallback">EURO ONE</span>`
          }
        </div>
        <div class="intro-title">${escapeHtml(reportTitle)}</div>
        <div class="intro-title-spacer"></div>
      </div>
      <div class="intro-subtitle">${escapeHtml(reportSubtitle)}</div>
      <div class="intro-grid">
        <div><span>Veículo</span>${escapeHtml(meta?.vehicle?.name || "—")}</div>
        <div><span>Placa</span>${escapeHtml(meta?.vehicle?.plate || "—")}</div>
        <div><span>Cliente</span>${escapeHtml(meta?.vehicle?.customer || "—")}</div>
        <div><span>Exportado por</span>${escapeHtml(meta?.exportedBy || "—")}</div>
        <div><span>Status</span>${escapeHtml(meta?.vehicle?.status || "—")}</div>
        <div><span>Última comunicação</span>${escapeHtml(formatDate(meta?.vehicle?.lastCommunication))}</div>
        <div><span>Período</span>${escapeHtml(`${formatDate(meta?.from)} → ${formatDate(meta?.to)}`)}</div>
      </div>
    </div>
  `;

  const renderTimeline = () => {
    const segments = [];
    let buffer = [];
    safeEntries.forEach((entry) => {
      if (entry?.type === "position" && entry.position) {
        buffer.push(entry.position);
        return;
      }
      if (buffer.length) {
        segments.push({ type: "positions", rows: buffer });
        buffer = [];
      }
      if (entry?.type === "action") {
        segments.push({ type: "action", entry });
      }
    });
    if (buffer.length) segments.push({ type: "positions", rows: buffer });

    if (!segments.length) {
      const fallbackSlices = chunkArray(rows, chunkSize);
      return fallbackSlices
        .map((slice, index) =>
          renderTable(slice, index, {
            includeHeader: false,
            includePageBreak: false,
            includeMetaHeader: false,
          }),
        )
        .filter(Boolean)
        .join("");
    }

    return segments
      .flatMap((segment) => {
        if (segment.type === "positions") {
          return chunkArray(segment.rows, chunkSize)
            .map((slice, index) =>
              renderTable(slice, index, {
                includeHeader: false,
                includePageBreak: false,
                includeMetaHeader: false,
              }),
            )
            .filter(Boolean);
        }
        const card = renderActionCard(segment.entry);
        return card ? [card] : [];
      })
      .join("");
  };

  const validActions = safeActions.filter(hasActionContent);
  const actionsSection = validActions.length
    ? `
      <div class="page-break"></div>
      <div class="section">
        <div class="section-header">
          <div class="section-title">${escapeHtml(actionsTitle)}</div>
          <div class="section-subtitle">${escapeHtml(actionsSubtitle)}</div>
        </div>
        <div class="actions-grid">
          ${validActions.map((action) => renderActionCard(action)).join("")}
        </div>
      </div>
    `
    : "";

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
        padding: 24px ${CONTENT_GUTTER_PX}px 12px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        width: 100%;
      }
      .report-content {
        display: flex;
        flex-direction: column;
        gap: 14px;
        width: 100%;
      }
      .report-content > * {
        width: 100%;
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
      .logo.small img {
        height: 28px;
        filter: none;
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
      .logo.fallback.small {
        height: 28px;
        padding: 6px 10px;
        font-size: 10px;
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
      .title.centered,
      .subtitle.centered {
        text-align: center;
      }
      .report-header {
        border-radius: 12px;
        padding: 12px 14px;
        background: linear-gradient(135deg, ${BRAND_COLOR} 0%, #012a58 100%);
        display: flex;
        flex-direction: column;
        gap: 6px;
        color: #ffffff;
      }
      .report-header-top {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 12px;
        align-items: center;
      }
      .report-header-title .title {
        font-size: 16px;
        color: #ffffff;
        letter-spacing: 0.12em;
      }
      .report-header-title .subtitle {
        color: rgba(255,255,255,0.88);
        margin-top: 2px;
      }
      .intro-card {
        border-radius: 16px;
        padding: 14px 16px 10px;
        background: linear-gradient(135deg, ${BRAND_COLOR} 0%, #012a58 100%);
        color: #ffffff;
        box-shadow: 0 10px 18px rgba(1, 42, 88, 0.24);
        width: 100%;
      }
      .intro-title-row {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 12px;
      }
      .intro-logo img {
        height: 36px;
        object-fit: contain;
        filter: drop-shadow(0 4px 8px rgba(0,0,0,0.2));
      }
      .intro-logo-fallback {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 6px 10px;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.4);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
      }
      .intro-title-spacer {
        width: 36px;
      }
      .intro-title {
        font-size: 20px;
        font-weight: 800;
        text-align: center;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .intro-subtitle {
        font-size: 12px;
        text-align: center;
        color: rgba(255, 255, 255, 0.82);
        margin-top: 4px;
      }
      .intro-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px 16px;
        font-size: 11px;
        margin-top: 12px;
      }
      .intro-grid span {
        display: block;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.7);
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: 3px;
      }
      .meta-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        padding: 14px 16px;
        border-radius: 14px;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        font-size: 11px;
        box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
        width: 100%;
      }
      .report-meta {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px 16px;
        padding: 12px 16px;
        border-radius: 12px;
        background: linear-gradient(135deg, ${BRAND_COLOR} 0%, #012a58 100%);
        color: #ffffff;
        font-size: 11px;
        width: 100%;
      }
      .report-meta span {
        display: block;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.7);
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: 3px;
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
        width: 100%;
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
      .severity-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        border: 1px solid transparent;
        padding: 1px 6px;
        font-size: 8px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        line-height: 1.1;
      }
      .severity-badge--info {
        background: #ffffff;
        border-color: #e2e8f0;
        color: #1f2937;
      }
      .severity-badge--warning {
        background: rgba(147, 51, 234, 0.18);
        border-color: rgba(147, 51, 234, 0.55);
        color: #6b21a8;
      }
      .severity-badge--low {
        background: rgba(22, 163, 74, 0.18);
        border-color: rgba(22, 163, 74, 0.6);
        color: #166534;
      }
      .severity-badge--medium {
        background: rgba(234, 179, 8, 0.2);
        border-color: rgba(234, 179, 8, 0.6);
        color: #92400e;
      }
      .severity-badge--high {
        background: rgba(249, 115, 22, 0.2);
        border-color: rgba(249, 115, 22, 0.6);
        color: #9a3412;
      }
      .severity-badge--critical {
        background: rgba(220, 38, 38, 0.2);
        border-color: rgba(220, 38, 38, 0.6);
        color: #991b1b;
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
        width: 100%;
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
      .section {
        border-radius: 16px;
        border: 1px solid #e2e8f0;
        padding: 16px;
        background: #ffffff;
      }
      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
        margin-bottom: 12px;
      }
      .section-title {
        font-size: 12px;
        font-weight: 800;
        color: ${BRAND_COLOR};
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }
      .section-subtitle {
        font-size: 10px;
        color: #64748b;
      }
      .actions-grid {
        display: grid;
        gap: 10px;
      }
      .timeline-item {
        break-inside: avoid;
        page-break-inside: avoid;
        display: block;
      }
      .action-card {
        background: #ffffff;
        border-radius: 12px;
        padding: 8px 10px;
        border: 1px solid #e2e8f0;
        page-break-inside: avoid;
        break-inside: avoid;
      }
      .action-head {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 4px;
      }
      .action-title {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: #334155;
      }
      .action-badge {
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 8px;
        letter-spacing: 0.12em;
        font-weight: 700;
        text-transform: uppercase;
        border: 1px solid transparent;
      }
      .action-badge--warning {
        background: rgba(234, 179, 8, 0.16);
        color: #92400e;
        border-color: rgba(234, 179, 8, 0.4);
      }
      .action-badge--success {
        background: rgba(16, 185, 129, 0.16);
        color: #065f46;
        border-color: rgba(16, 185, 129, 0.4);
      }
      .action-badge--danger {
        background: rgba(239, 68, 68, 0.16);
        color: #991b1b;
        border-color: rgba(239, 68, 68, 0.4);
      }
      .action-badge--neutral {
        background: rgba(148, 163, 184, 0.2);
        color: #475569;
        border-color: rgba(148, 163, 184, 0.4);
      }
      .action-summary {
        font-size: 10px;
        color: #334155;
        margin-bottom: 6px;
      }
      .action-summary span {
        display: block;
        font-size: 8px;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin-bottom: 2px;
      }
      .action-meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px 10px;
        font-size: 9px;
        color: #475569;
      }
      .action-meta span {
        display: block;
        font-size: 8px;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin-bottom: 2px;
      }
      @page {
        margin: 24mm 12mm 20mm 12mm;
      }
    </style>
  </head>
  <body>
    <div class="report">
      ${isAnalytic ? `${renderAnalyticHeader()}${renderTimeline()}` : ""}
      ${isAnalytic ? "" : tables}
      ${isAnalytic ? "" : actionsSection}
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
const PDF_CHUNK_SIZE = 250;

export async function generatePositionsReportPdf({
  rows,
  columns,
  meta,
  actions = [],
  entries = [],
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
    const isAnalytic = options?.variant === "analytic";

    const safeRows = Array.isArray(rows) ? rows : [];
    const columnMap = Array.isArray(columnDefinitions)
      ? new Map(columnDefinitions.map((column) => [column.key, column]))
      : null;
    const needsWidePage = columnsToUse.length > 30;
    const html = buildHtml({
      rows: safeRows,
      columns: columnsToUse,
      meta,
      actions,
      entries,
      logoDataUrl,
      fontData,
      columnDefinitions: columnMap,
      chunkSize: PDF_CHUNK_SIZE,
      options,
    });

    await page.setContent(html, { waitUntil: "domcontentloaded" });

    const headerMetaParts = [
      { label: "VEÍCULO", value: meta?.vehicle?.name || "—" },
      { label: "PLACA", value: meta?.vehicle?.plate || "—" },
      { label: "CLIENTE", value: meta?.vehicle?.customer || "—" },
      { label: "PERÍODO", value: `${formatDate(meta?.from)} → ${formatDate(meta?.to)}` },
    ];
    const headerMetaLine = headerMetaParts
      .map(
        (item, index) => `
          <span style="display:inline-flex; align-items:center; gap:4px; white-space:nowrap;">
            <span style="opacity:0.65; font-weight:600;">${escapeHtml(item.label)}:</span>
            <span style="font-weight:700;">${escapeHtml(item.value)}</span>
          </span>
          ${index < headerMetaParts.length - 1 ? '<span style="opacity:0.4; margin:0 6px;">|</span>' : ""}
        `,
      )
      .join("");
    // Keep header gutters aligned with .report padding (CONTENT_GUTTER_PX).
    const headerTemplate = `
      <div style="width:100%; font-family:${FONT_STACK}; padding:0 calc(12mm + ${CONTENT_GUTTER_PX}px); box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
        <div style="background-color:${BRAND_COLOR}; background:linear-gradient(135deg,${BRAND_COLOR} 0%,#012a58 100%); color:#ffffff; padding:2mm 4.5mm; border-radius:10px; display:flex; align-items:center; gap:8px; min-height:9mm; box-shadow:0 6px 12px rgba(1,42,88,0.18); -webkit-print-color-adjust:exact; print-color-adjust:exact;">
          ${
            logoDataUrl
              ? `<img src="${logoDataUrl}" style="height:12px; object-fit:contain;" />`
              : `<span style="font-size:7px; font-weight:700; letter-spacing:0.12em;">EURO ONE</span>`
          }
          <div style="font-size:8px; letter-spacing:0.08em; text-transform:uppercase; line-height:1.2; display:flex; align-items:center; gap:4px 6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; flex:1;">
            <span style="display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
              ${headerMetaLine}
            </span>
          </div>
        </div>
      </div>
    `;
    const footerTemplate = `
      <div style="width:100%; font-family:${FONT_STACK}; font-size:9px; color:#64748b; padding:0 12mm 4mm; display:flex; justify-content:space-between;">
        <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
        <span>${isAnalytic ? `Gerado em ${escapeHtml(formatDate(meta?.generatedAt))}` : "Gerado pelo Euro One"}</span>
      </div>
    `;

    const pdfOptions = {
      format: needsWidePage ? "A3" : "A4",
      landscape: true,
      scale: needsWidePage ? 0.9 : 1,
      printBackground: true,
      margin: { top: "24mm", right: "12mm", bottom: "20mm", left: "12mm" },
    };

    const pdfWithHeader = await page.pdf({
      ...pdfOptions,
      displayHeaderFooter: true,
      footerTemplate,
      headerTemplate,
    });

    const pdfWithoutHeader = await page.pdf({
      ...pdfOptions,
      displayHeaderFooter: false,
      pageRanges: "1",
    });

    const headerDoc = await PDFDocument.load(pdfWithHeader);
    if (headerDoc.getPageCount() <= 1) {
      return pdfWithoutHeader;
    }

    const firstPageDoc = await PDFDocument.load(pdfWithoutHeader);
    const mergedDoc = await PDFDocument.create();
    const [firstPage] = await mergedDoc.copyPages(firstPageDoc, [0]);
    mergedDoc.addPage(firstPage);
    const remainingPages = Array.from({ length: headerDoc.getPageCount() - 1 }, (_, index) => index + 1);
    const copiedRemaining = await mergedDoc.copyPages(headerDoc, remainingPages);
    copiedRemaining.forEach((page) => mergedDoc.addPage(page));
    return await mergedDoc.save();
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
