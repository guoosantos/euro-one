import { chromium } from "playwright";
import { positionsColumnMap, positionsColumns, resolveColumnLabel } from "../../shared/positionsColumns.js";

const BRAND_COLOR = "#001F3F";
const LOGO_URL = "https://eurosolucoes.tech/wp-content/uploads/2024/10/logo-3-2048x595.png";
const FONT_STACK = '"Inter", "Roboto", "Noto Sans", "Segoe UI", Arial, sans-serif';

let cachedLogoDataUrl = null;

async function fetchLogoDataUrl() {
  if (cachedLogoDataUrl) return cachedLogoDataUrl;
  const response = await fetch(LOGO_URL);
  if (!response.ok) {
    throw new Error(`Falha ao buscar logo (${response.status}).`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "image/png";
  cachedLogoDataUrl = `data:${contentType};base64,${buffer.toString("base64")}`;
  return cachedLogoDataUrl;
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("pt-BR");
}

function formatCellValue(key, value) {
  if (value === null || value === undefined || value === "") return "—";
  if (["gpsTime", "deviceTime", "serverTime"].includes(key)) return formatDate(value);
  if (key === "speed") return Number.isFinite(Number(value)) ? `${Number(value)} km/h` : String(value);
  if (key === "direction") return Number.isFinite(Number(value)) ? `${Number(value)}°` : String(value);
  if (key === "accuracy") return Number.isFinite(Number(value)) ? `${Number(value)} m` : String(value);
  if (key === "batteryLevel") return Number.isFinite(Number(value)) ? `${Number(value)}%` : String(value);
  if (key === "ignition") return value ? "Ligada" : "Desligada";
  return String(value);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveColumnLabelByKey(key, variant = "pdf") {
  const column = positionsColumnMap.get(key);
  return resolveColumnLabel(column, variant);
}

function buildHtml({ rows, columns, meta, logoDataUrl }) {
  const tableHeaders = columns
    .map((key) => `<th>${escapeHtml(resolveColumnLabelByKey(key, "pdf"))}</th>`)
    .join("");
  const tableRows = rows
    .map((row) => {
      const cells = columns
        .map((key) => `<td>${escapeHtml(formatCellValue(key, row[key]))}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  const totalWeight = columns.reduce((sum, key) => sum + (positionsColumnMap.get(key)?.weight || 1), 0) || 1;
  const colgroup = columns
    .map((key) => {
      const weight = positionsColumnMap.get(key)?.weight || 1;
      const percent = ((weight / totalWeight) * 100).toFixed(2);
      return `<col style="width:${percent}%" />`;
    })
    .join("");

  return `
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: ${FONT_STACK};
        color: #0f172a;
        background: #ffffff;
      }
      .report {
        padding: 24px 28px 0;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-radius: 12px;
        background: ${BRAND_COLOR};
        color: #ffffff;
      }
      .header img {
        height: 40px;
        object-fit: contain;
      }
      .title {
        font-size: 18px;
        font-weight: 700;
        letter-spacing: 0.5px;
      }
      .meta-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
        margin-top: 16px;
        padding: 12px 16px;
        border-radius: 12px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        font-size: 11px;
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
        margin-top: 16px;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 14px 16px;
        background: #ffffff;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
      }
      .card-title {
        font-size: 12px;
        font-weight: 700;
        color: ${BRAND_COLOR};
        margin-bottom: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .card-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px 20px;
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
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 18px;
        font-size: 10px;
      }
      thead {
        display: table-header-group;
        background: ${BRAND_COLOR};
        color: #ffffff;
      }
      thead th {
        padding: 8px 8px;
        text-align: left;
        font-weight: 600;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      tbody td {
        padding: 8px 8px;
        border-bottom: 1px solid #e2e8f0;
        color: #1f2937;
        word-break: break-word;
      }
      tbody tr:nth-child(even) {
        background: #f8fafc;
      }
      tr {
        page-break-inside: avoid;
      }
      @page {
        margin: 16mm 12mm 20mm;
      }
    </style>
  </head>
  <body>
    <div class="report">
      <div class="header">
        <img src="${logoDataUrl}" alt="Euro One" />
        <div class="title">RELATÓRIO DE POSIÇÕES</div>
      </div>
      <div class="meta-grid">
        <div class="meta-item"><span>Gerado em</span>${escapeHtml(formatDate(meta?.generatedAt))}</div>
        <div class="meta-item"><span>Período</span>${escapeHtml(formatDate(meta?.from))} - ${escapeHtml(formatDate(meta?.to))}</div>
        <div class="meta-item"><span>Exportado por</span>${escapeHtml(meta?.exportedBy || "—")}</div>
      </div>
      <div class="card">
        <div class="card-title">Resumo do veículo</div>
        <div class="card-grid">
          <div><span>Placa</span>${escapeHtml(meta?.vehicle?.plate || "—")}</div>
          <div><span>Veículo</span>${escapeHtml(meta?.vehicle?.name || "—")}</div>
          <div><span>Cliente</span>${escapeHtml(meta?.vehicle?.customer || "—")}</div>
          <div><span>Status atual</span>${escapeHtml(meta?.vehicle?.status || "—")}</div>
          <div><span>Última comunicação</span>${escapeHtml(formatDate(meta?.vehicle?.lastCommunication))}</div>
          <div><span>Ignição</span>${escapeHtml(meta?.vehicle?.ignition ?? "—")}</div>
        </div>
      </div>
      <table>
        <colgroup>${colgroup}</colgroup>
        <thead>
          <tr>${tableHeaders}</tr>
        </thead>
        <tbody>
          ${tableRows || `<tr><td colspan=\"${columns.length}\">—</td></tr>`}
        </tbody>
      </table>
    </div>
  </body>
</html>
  `;
}

function resolveColumns(columns) {
  const requested = Array.isArray(columns) ? columns.filter((key) => positionsColumnMap.has(key)) : [];
  if (requested.length) return requested;
  return positionsColumns.map((column) => column.key);
}

export async function generatePositionsReportPdf({ rows, columns, meta }) {
  const browser = await chromium.launch({
    args: ["--font-render-hinting=medium", "--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    const logoDataUrl = await fetchLogoDataUrl();
    const columnsToUse = resolveColumns(columns);
    const html = buildHtml({ rows, columns: columnsToUse, meta, logoDataUrl });

    await page.setContent(html, { waitUntil: "networkidle" });

    return await page.pdf({
      format: "A4",
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
  } finally {
    await browser.close();
  }
}
