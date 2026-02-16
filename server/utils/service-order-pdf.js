import { collectServiceOrderMedia } from "../services/service-order-workflow.js";
import {
  REPORT_PDF_BRAND_COLOR,
  buildReportPdfThemeBaseCss,
  getReportPdfChromium,
  getReportPdfFontData,
  getReportPdfLogoDataUrl,
  resolveReportPdfFontFaces,
} from "./positions-report-pdf.js";

const APP_TIMEZONE = "America/Sao_Paulo";
const PDF_CACHE_TTL_MS = 5 * 60 * 1000;
const PDF_CACHE_MAX_ITEMS = 80;
const pdfCache = new Map();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseApiDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  let normalized = raw;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(normalized)) {
    normalized = normalized.replace(" ", "T");
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(normalized)) {
    normalized = `${normalized}Z`;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTime(value) {
  const date = parseApiDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: APP_TIMEZONE,
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toText(value, fallback = "—") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function formatStatusLabel(value) {
  return toText(value).replaceAll("_", " ");
}

function isUuidLike(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return UUID_REGEX.test(text);
}

function resolveRegisteredEquipmentCode(entry) {
  if (!entry || typeof entry !== "object") return null;
  const attributes = entry?.attributes && typeof entry.attributes === "object" ? entry.attributes : {};
  const candidates = [
    entry?.equipmentCode,
    entry?.displayId,
    entry?.internalCode,
    entry?.code,
    attributes?.internalCode,
    attributes?.codigoInterno,
    attributes?.equipmentCode,
    entry?.uniqueId,
    entry?.imei,
    entry?.serial,
    entry?.equipmentId,
    entry?.id,
  ];
  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (!text || isUuidLike(text)) continue;
    return text;
  }
  return null;
}

function formatEquipmentModelAndId(entry, index) {
  const model = String(entry?.model || entry?.name || "").trim();
  const code = resolveRegisteredEquipmentCode(entry);
  if (model && code) {
    if (model.localeCompare(code, "pt-BR", { sensitivity: "base" }) === 0) return code;
    return `${model} ${code}`;
  }
  if (code) return code;
  if (model) return `${model} Código não cadastrado`;
  return `Equipamento ${index + 1} Código não cadastrado`;
}

function formatMediaLabel(entry, index) {
  const title = String(entry?.title || "").trim();
  if (title) return title;
  return `Mídia ${index + 1}`;
}

function formatBindingLabel(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return "Não verificado";
  if (normalized === "LINKED") return "Vinculado";
  if (normalized === "NOT_LINKED") return "Não vinculado";
  if (normalized === "MISSING_IDENTIFIER") return "Sem identificador";
  if (normalized === "NOT_FOUND") return "Equipamento não encontrado";
  if (normalized === "CLIENT_MISMATCH") return "Cliente divergente";
  return normalized;
}

function buildKeyValueRows(item) {
  return [
    { label: "OS", value: item?.osInternalId || String(item?.id || "").slice(0, 8) || "—" },
    { label: "Cliente", value: item?.clientName || "—" },
    { label: "Status", value: formatStatusLabel(item?.status) },
    { label: "Tipo", value: toText(item?.type) },
    { label: "Data/hora início", value: formatDateTime(item?.startAt) },
    { label: "Data/hora fim", value: formatDateTime(item?.endAt) },
    { label: "Técnico", value: toText(item?.technicianName) },
    { label: "Responsável", value: toText(item?.responsibleName) },
    { label: "Telefone", value: toText(item?.responsiblePhone) },
    { label: "KM", value: item?.km ? `${item.km} km` : "—" },
    { label: "Serial", value: toText(item?.serial) },
    { label: "Ref. externa", value: toText(item?.externalRef) },
    { label: "Placa", value: toText(item?.vehicle?.plate) },
    { label: "Veículo", value: toText(item?.vehicle?.name || item?.vehicle?.model) },
    { label: "Marca", value: toText(item?.vehicle?.brand) },
    { label: "Chassi", value: toText(item?.vehicle?.chassis) },
    { label: "Renavam", value: toText(item?.vehicle?.renavam) },
  ];
}

function buildHtml({ item, mediaItems, exportedBy, logoDataUrl, fontFaces }) {
  const equipmentRows = Array.isArray(item?.equipmentsData) ? item.equipmentsData : [];
  const checklistRows = Array.isArray(item?.checklistItems) ? item.checklistItems : [];
  const mediaRows = Array.isArray(mediaItems) ? mediaItems : [];
  const keyValueRows = buildKeyValueRows(item);
  const osLabel = item?.osInternalId || String(item?.id || "").slice(0, 8) || "—";
  const equipmentCount = equipmentRows.length;
  const mediaCount = mediaRows.length;
  const unresolvedCount = Number(item?.equipmentBindingSummary?.unresolvedCount || 0);

  const equipmentTableRows = equipmentRows.length
    ? equipmentRows
        .map((entry, index) => {
          const modelAndId = formatEquipmentModelAndId(entry, index);
          return `
            <tr>
              <td>${escapeHtml(modelAndId)}</td>
              <td>${escapeHtml(toText(entry?.installLocation))}</td>
              <td>${escapeHtml(formatBindingLabel(entry?.bindingStatus))}</td>
              <td>${escapeHtml(toText(entry?.linkedVehicleId))}</td>
            </tr>
          `;
        })
        .join("")
    : `
      <tr>
        <td colspan="4">Nenhum equipamento informado.</td>
      </tr>
    `;

  const checklistTableRows = checklistRows.length
    ? checklistRows
        .map((entry) => {
          return `
            <tr>
              <td>${escapeHtml(toText(entry?.item))}</td>
              <td>${escapeHtml(toText(entry?.before))}</td>
              <td>${escapeHtml(toText(entry?.after))}</td>
            </tr>
          `;
        })
        .join("")
    : `
      <tr>
        <td colspan="3">Nenhum checklist registrado.</td>
      </tr>
    `;

  const mediaTableRows = mediaRows.length
    ? mediaRows
        .map((entry, index) => {
          const targetId =
            entry?.targetType === "EQUIPMENT" && isUuidLike(entry?.targetId)
              ? "Código não cadastrado"
              : toText(entry?.targetId);
          return `
            <tr>
              <td>${escapeHtml(formatMediaLabel(entry, index))}</td>
              <td>${escapeHtml(toText(entry?.origin))}</td>
              <td>${escapeHtml(toText(entry?.phase))}</td>
              <td>${escapeHtml(toText(entry?.targetType))}</td>
              <td>${escapeHtml(targetId)}</td>
              <td>${escapeHtml(toText(entry?.type))}</td>
              <td>${escapeHtml(toText(entry?.status))}</td>
            </tr>
          `;
        })
        .join("")
    : `
      <tr>
        <td colspan="7">Nenhuma mídia registrada nesta OS.</td>
      </tr>
    `;

  const kvGridRows = keyValueRows
    .map(
      (entry) => `
      <div class="kv-item">
        <span>${escapeHtml(entry.label)}</span>
        ${escapeHtml(toText(entry.value))}
      </div>
    `,
    )
    .join("");

  const baseCss = buildReportPdfThemeBaseCss({
    fontFaces,
    pageMargin: "16mm 10mm 16mm 10mm",
  });

  return `
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <style>
      ${baseCss}
      .report {
        padding: 0;
        gap: 12px;
      }
      .header {
        border-radius: 16px;
        padding: 14px 16px;
        background: linear-gradient(135deg, ${REPORT_PDF_BRAND_COLOR} 0%, #012a58 100%);
        color: #ffffff;
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 10px 14px;
        align-items: center;
      }
      .logo img {
        height: 36px;
        object-fit: contain;
      }
      .logo.fallback {
        border: 1px solid rgba(255,255,255,0.35);
        border-radius: 10px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        padding: 8px 10px;
      }
      .title {
        font-size: 17px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .subtitle {
        font-size: 11px;
        color: rgba(255,255,255,0.9);
        margin-top: 2px;
      }
      .meta-row {
        margin-top: 6px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .layout-grid {
        display: grid;
        gap: 10px;
      }
      .kv-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px 14px;
      }
      .kv-item {
        font-size: 11px;
        color: #0f172a;
      }
      .kv-item span {
        display: block;
        font-size: 9px;
        font-weight: 700;
        color: #64748b;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        margin-bottom: 2px;
      }
      .address-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }
      .address-card {
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 10px;
        background: #f8fafc;
        font-size: 11px;
      }
      .address-card span {
        display: block;
        font-size: 9px;
        font-weight: 700;
        color: #64748b;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        margin-bottom: 3px;
      }
      .section {
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        padding: 12px;
        background: #ffffff;
      }
      .section-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
      .section-note {
        font-size: 9px;
        color: #64748b;
      }
      .summary-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 8px;
      }
      .summary-chip {
        border-radius: 999px;
        border: 1px solid rgba(0, 31, 63, 0.14);
        background: rgba(0, 31, 63, 0.08);
        color: ${REPORT_PDF_BRAND_COLOR};
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        padding: 4px 8px;
      }
      .muted {
        color: #64748b;
      }
      tr {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      td, th {
        font-size: 10px;
      }
    </style>
  </head>
  <body>
    <div class="report">
      <div class="header">
        ${
          logoDataUrl
            ? `<div class="logo"><img src="${logoDataUrl}" alt="Euro One" /></div>`
            : '<div class="logo fallback">EURO ONE</div>'
        }
        <div>
          <div class="title">Ordem de Serviço</div>
          <div class="subtitle">OS ${escapeHtml(osLabel)} • Exportado em ${escapeHtml(formatDateTime(new Date().toISOString()))}</div>
          <div class="meta-row">
            <div class="badge">Cliente: ${escapeHtml(toText(item?.clientName))}</div>
            <div class="badge">Status: ${escapeHtml(formatStatusLabel(item?.status))}</div>
            <div class="badge">Exportado por: ${escapeHtml(toText(exportedBy))}</div>
          </div>
        </div>
      </div>

      <div class="layout-grid">
        <section class="card">
          <div class="section-head">
            <div class="section-title">Dados da OS</div>
            <div class="section-note">Fonte: cadastro operacional da OS</div>
          </div>
          <div class="kv-grid">
            ${kvGridRows}
          </div>
        </section>

        <section class="card">
          <div class="section-head">
            <div class="section-title">Endereços</div>
            <div class="section-note">Partida, serviço e retorno</div>
          </div>
          <div class="address-grid">
            <div class="address-card">
              <span>Partida</span>
              ${escapeHtml(toText(item?.addressStart))}
            </div>
            <div class="address-card">
              <span>Serviço</span>
              ${escapeHtml(toText(item?.address))}
            </div>
            <div class="address-card">
              <span>Retorno</span>
              ${escapeHtml(toText(item?.addressReturn))}
            </div>
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <div class="section-title">Checklist</div>
            <div class="section-note">${checklistRows.length} item(ns)</div>
          </div>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Antes</th>
                  <th>Depois</th>
                </tr>
              </thead>
              <tbody>
                ${checklistTableRows}
              </tbody>
            </table>
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <div class="section-title">Vínculos de equipamentos</div>
            <div class="section-note">Status de vínculo com o veículo da OS</div>
          </div>
          <div class="summary-row">
            <span class="summary-chip">Equipamentos: ${equipmentCount}</span>
            <span class="summary-chip">Pendentes: ${unresolvedCount}</span>
          </div>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Modelo + ID</th>
                  <th>Local instalação</th>
                  <th>Status vínculo</th>
                  <th>Veículo vinculado</th>
                </tr>
              </thead>
              <tbody>
                ${equipmentTableRows}
              </tbody>
            </table>
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <div class="section-title">Mídias listadas</div>
            <div class="section-note">${mediaCount} item(ns)</div>
          </div>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Título</th>
                  <th>Origem</th>
                  <th>Fase</th>
                  <th>Alvo tipo</th>
                  <th>Alvo ID</th>
                  <th>Tipo</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${mediaTableRows}
              </tbody>
            </table>
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <div class="section-title">Observações</div>
          </div>
          <div class="muted">${escapeHtml(toText(item?.notes, "Sem observações."))}</div>
        </section>
      </div>
    </div>
  </body>
</html>
  `;
}

function buildPdfCacheKey(item) {
  const mediaHash = collectServiceOrderMedia(item)
    .map((entry) => `${entry?.origin || ""}|${entry?.phase || ""}|${entry?.targetId || ""}|${entry?.src || ""}`)
    .join(";");
  return [
    String(item?.id || ""),
    String(item?.updatedAt || ""),
    String(item?.status || ""),
    String(item?.equipmentBindingSummary?.linkedCount || 0),
    String(item?.equipmentBindingSummary?.unresolvedCount || 0),
    mediaHash,
  ].join("::");
}

function clearExpiredCacheEntries(now = Date.now()) {
  for (const [key, value] of pdfCache.entries()) {
    if (!value || now - value.createdAt > PDF_CACHE_TTL_MS) {
      pdfCache.delete(key);
    }
  }
}

function cachePdfBuffer(key, buffer) {
  clearExpiredCacheEntries();
  pdfCache.set(key, { buffer, createdAt: Date.now() });
  if (pdfCache.size <= PDF_CACHE_MAX_ITEMS) return;
  const entries = Array.from(pdfCache.entries()).sort((a, b) => (a[1]?.createdAt || 0) - (b[1]?.createdAt || 0));
  while (entries.length && pdfCache.size > PDF_CACHE_MAX_ITEMS) {
    const [oldestKey] = entries.shift();
    pdfCache.delete(oldestKey);
  }
}

async function renderPdfFromHtml(html) {
  let browser = null;
  try {
    const chromium = await getReportPdfChromium();
    try {
      browser = await chromium.launch({
        headless: true,
        args: ["--disable-dev-shm-usage"],
      });
    } catch (launchError) {
      browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });
    }
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const bytes = await page.pdf({
      format: "A4",
      landscape: false,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#64748b;padding:0 10mm 6mm;text-align:right;">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>',
      margin: { top: "18mm", right: "10mm", bottom: "16mm", left: "10mm" },
    });
    return Buffer.from(bytes);
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

export async function generateServiceOrderPdf({ item, exportedBy = "Sistema", forceRefresh = false } = {}) {
  if (!item || typeof item !== "object") {
    const error = new Error("OS inválida para exportação.");
    error.code = "INVALID_SERVICE_ORDER";
    error.status = 400;
    throw error;
  }

  const cacheKey = buildPdfCacheKey(item);
  if (!forceRefresh) {
    clearExpiredCacheEntries();
    const cached = pdfCache.get(cacheKey);
    if (cached?.buffer) {
      return cached.buffer;
    }
  }

  try {
    const mediaItems = collectServiceOrderMedia(item);
    const fontData = getReportPdfFontData();
    const fontFaces = resolveReportPdfFontFaces(fontData);
    const logoDataUrl = await getReportPdfLogoDataUrl();
    const html = buildHtml({
      item,
      mediaItems,
      exportedBy,
      logoDataUrl,
      fontFaces,
    });
    const buffer = await renderPdfFromHtml(html);
    cachePdfBuffer(cacheKey, buffer);
    return buffer;
  } catch (error) {
    const normalized = new Error(error?.message || "Falha ao gerar PDF da OS.");
    normalized.code = error?.code || "SERVICE_ORDER_PDF_ERROR";
    normalized.status = error?.status || error?.statusCode || 500;
    normalized.cause = error;
    throw normalized;
  }
}
