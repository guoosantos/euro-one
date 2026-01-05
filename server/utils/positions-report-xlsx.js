import { positionsColumnMap, resolveColumnLabel } from "../../shared/positionsColumns.js";
import { resolveTelemetryDescriptor } from "../../shared/telemetryDictionary.js";
import { formatFullAddress } from "./address.js";
import { resolvePdfColumns } from "./positions-report-pdf.js";

const BRAND_COLOR = "001F3F";
const LIGHT_FILL = "F3F6FA";
const ZEBRA_FILL = "0F172A0F";
const LOGO_URL = "https://eurosolucoes.tech/wp-content/uploads/2024/10/logo-3-2048x595.png";
const MAX_XLSX_ROWS = 20_000;
const MAX_XLSX_COLUMNS = 120;

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

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUInt32LE(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function writeUInt16LE(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function buildZip(files) {
  const localEntries = [];
  const centralEntries = [];
  let offset = 0;

  files.forEach(({ path, data }) => {
    const nameBuffer = Buffer.from(path);
    const fileBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const crc = crc32(fileBuffer);
    const localHeader = Buffer.concat([
      writeUInt32LE(0x04034b50),
      writeUInt16LE(20),
      writeUInt16LE(0),
      writeUInt16LE(0),
      writeUInt16LE(0),
      writeUInt16LE(0),
      writeUInt32LE(crc),
      writeUInt32LE(fileBuffer.length),
      writeUInt32LE(fileBuffer.length),
      writeUInt16LE(nameBuffer.length),
      writeUInt16LE(0),
      nameBuffer,
    ]);

    localEntries.push(localHeader, fileBuffer);

    const centralHeader = Buffer.concat([
      writeUInt32LE(0x02014b50),
      writeUInt16LE(20),
      writeUInt16LE(20),
      writeUInt16LE(0),
      writeUInt16LE(0),
      writeUInt16LE(0),
      writeUInt16LE(0),
      writeUInt32LE(crc),
      writeUInt32LE(fileBuffer.length),
      writeUInt32LE(fileBuffer.length),
      writeUInt16LE(nameBuffer.length),
      writeUInt16LE(0),
      writeUInt16LE(0),
      writeUInt16LE(0),
      writeUInt16LE(0),
      writeUInt32LE(0),
      writeUInt32LE(offset),
      nameBuffer,
    ]);
    centralEntries.push(centralHeader);
    offset += localHeader.length + fileBuffer.length;
  });

  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralEntries);
  const endOfCentralDir = Buffer.concat([
    writeUInt32LE(0x06054b50),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt16LE(files.length),
    writeUInt16LE(files.length),
    writeUInt32LE(centralDirectory.length),
    writeUInt32LE(centralOffset),
    writeUInt16LE(0),
  ]);

  return Buffer.concat([...localEntries, centralDirectory, endOfCentralDir]);
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

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
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

function resolveColumnWidth(columnDefinition) {
  if (!columnDefinition) return 16;
  const width = columnDefinition.width || 120;
  return Math.min(48, Math.max(12, Math.round(width / 7)));
}

function columnNumberToName(number) {
  let name = "";
  let n = number;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function buildCell(ref, value, styleId) {
  const safeValue = escapeXml(value ?? "");
  const styleAttr = styleId !== null && styleId !== undefined ? ` s="${styleId}"` : "";
  return `<c r="${ref}" t="inlineStr"${styleAttr}><is><t>${safeValue}</t></is></c>`;
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/></font>
    <font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><sz val="11"/><color rgb="FF4B5563"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF${BRAND_COLOR}"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF${LIGHT_FILL}"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF${ZEBRA_FILL}"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellXfs count="8">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="2" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="2" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>
  </cellXfs>
</styleSheet>`;
}

function buildWorkbookXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Relatório de posições" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
}

function buildWorkbookRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
}

function buildSheetRelsXml({ includeLogo = false } = {}) {
  if (!includeLogo) return "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`;
}

function buildDrawingXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:oneCellAnchor>
    <xdr:from>
      <xdr:col>0</xdr:col>
      <xdr:colOff>0</xdr:colOff>
      <xdr:row>0</xdr:row>
      <xdr:rowOff>0</xdr:rowOff>
    </xdr:from>
    <xdr:ext cx="1710000" cy="380000"/>
    <xdr:pic>
      <xdr:nvPicPr>
        <xdr:cNvPr id="1" name="Logo"/>
        <xdr:cNvPicPr/>
      </xdr:nvPicPr>
      <xdr:blipFill>
        <a:blip r:embed="rId1"/>
        <a:stretch><a:fillRect/></a:stretch>
      </xdr:blipFill>
      <xdr:spPr>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:oneCellAnchor>
</xdr:wsDr>`;
}

function buildDrawingRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/>
</Relationships>`;
}

function buildRootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function buildContentTypesXml({ includeLogo = false } = {}) {
  const imageType = includeLogo
    ? '<Default Extension="png" ContentType="image/png"/>'
    : "";
  const drawingType = includeLogo
    ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${imageType}
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${drawingType}
</Types>`;
}

function buildSheetXml({ columns, rows, meta, columnDefinitions, includeLogo = false }) {
  const columnMap = columnDefinitions;
  const columnDefsXml = columns
    .map((key, index) => {
      const definition = columnMap.get(key) || positionsColumnMap.get(key);
      const width = resolveColumnWidth(definition);
      const colIndex = index + 1;
      return `<col min="${colIndex}" max="${colIndex}" width="${width}" customWidth="1"/>`;
    })
    .join("");

  const lastColumn = columnNumberToName(columns.length);
  const rowsXml = [];

  rowsXml.push(
    `<row r="1" ht="32" customHeight="1">
      ${includeLogo ? buildCell("A1", "", 1) : buildCell("A1", "EURO ONE", 1)}
      ${buildCell(`B1`, "RELATÓRIO DE POSIÇÕES", 1)}
    </row>`,
  );
  rowsXml.push(
    `<row r="2" ht="20" customHeight="1">
      ${buildCell(`B2`, "Dados consolidados do veículo e posições georreferenciadas", 2)}
    </row>`,
  );
  rowsXml.push(
    `<row r="3" ht="18" customHeight="1">
      ${buildCell(`B3`, `Período: ${formatDate(meta?.from)} – ${formatDate(meta?.to)} | Gerado em ${formatDate(meta?.generatedAt)}`, 3)}
    </row>`,
  );
  rowsXml.push(`<row r="4" ht="6" customHeight="1"></row>`);
  rowsXml.push(
    `<row r="5" ht="20" customHeight="1">
      ${buildCell("A5", "Resumo do veículo", 4)}
    </row>`,
  );

  const summaryRows = [
    [
      ["Veículo", meta?.vehicle?.name || "—"],
      ["Placa", meta?.vehicle?.plate || "—"],
      ["Cliente", meta?.vehicle?.customer || "—"],
    ],
    [
      ["Status atual", meta?.vehicle?.status || "—"],
      ["Última comunicação", formatDate(meta?.vehicle?.lastCommunication)],
      ["Ignição", meta?.vehicle?.ignition || "Indisponível"],
    ],
    [
      ["Exportado por", meta?.exportedBy || "—"],
      ["Período", `${formatDate(meta?.from)} – ${formatDate(meta?.to)}`],
      ["Gerado em", formatDate(meta?.generatedAt)],
    ],
  ];

  summaryRows.forEach((summaryRow, idx) => {
    const rowIndex = 6 + idx;
    const cells = [];
    let colIndex = 1;
    summaryRow.forEach(([label, value]) => {
      const labelRef = `${columnNumberToName(colIndex)}${rowIndex}`;
      const valueRef = `${columnNumberToName(colIndex + 1)}${rowIndex}`;
      cells.push(buildCell(labelRef, label, 5));
      cells.push(buildCell(valueRef, value, null));
      colIndex += 2;
    });
    rowsXml.push(`<row r="${rowIndex}" ht="18" customHeight="1">${cells.join("")}</row>`);
  });

  const headerRowIndex = 10;
  const headerCells = columns.map((key, index) => {
    const ref = `${columnNumberToName(index + 1)}${headerRowIndex}`;
    const label = resolveColumnLabelByKey(key, columnMap, "pdf");
    return buildCell(ref, label, 6);
  });
  rowsXml.push(`<row r="${headerRowIndex}" ht="24" customHeight="1">${headerCells.join("")}</row>`);

  rows.forEach((rowData, index) => {
    const rowIndex = headerRowIndex + 1 + index;
    const rowCells = columns.map((key, colIndex) => {
      const definition = columnMap.get(key) || positionsColumnMap.get(key);
      const formatted = formatCellValue(key, rowData?.[key], definition);
      const ref = `${columnNumberToName(colIndex + 1)}${rowIndex}`;
      const zebraStyle = rowIndex % 2 === 0 ? 7 : null;
      return buildCell(ref, formatted, zebraStyle);
    });
    rowsXml.push(`<row r="${rowIndex}" ht="20" customHeight="1">${rowCells.join("")}</row>`);
  });

  const merges = [
    `<mergeCell ref="B1:${lastColumn}1"/>`,
    `<mergeCell ref="B2:${lastColumn}2"/>`,
    `<mergeCell ref="B3:${lastColumn}3"/>`,
    `<mergeCell ref="A5:${lastColumn}5"/>`,
  ];

  const autoFilterEnd = headerRowIndex + rows.length;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="${headerRowIndex}" topLeftCell="A${headerRowIndex + 1}" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <cols>${columnDefsXml}</cols>
  <sheetData>
    ${rowsXml.join("\n")}
  </sheetData>
  <mergeCells count="${merges.length}">
    ${merges.join("\n")}
  </mergeCells>
  <autoFilter ref="A${headerRowIndex}:${lastColumn}${autoFilterEnd}"/>
  ${includeLogo ? '<drawing r:id="rId1"/>' : ""}
</worksheet>`;
}

export async function generatePositionsReportXlsx({
  rows,
  columns,
  meta,
  availableColumns = null,
  columnDefinitions = [],
  options = {},
}) {
  const totalRows = Array.isArray(rows) ? rows.length : 0;
  const safeColumns = resolvePdfColumns(columns, availableColumns);

  if (totalRows > MAX_XLSX_ROWS) {
    const error = new Error(`Limite de linhas para Excel excedido (${totalRows}/${MAX_XLSX_ROWS}). Utilize CSV para volumes maiores.`);
    error.code = "XLSX_ROWS_LIMIT";
    error.status = 422;
    throw error;
  }
  if (safeColumns.length > MAX_XLSX_COLUMNS) {
    const error = new Error(`Limite de colunas para Excel excedido (${safeColumns.length}/${MAX_XLSX_COLUMNS}). Reduza as colunas.`);
    error.code = "XLSX_COLUMNS_LIMIT";
    error.status = 422;
    throw error;
  }

  const columnMap = Array.isArray(columnDefinitions)
    ? new Map(columnDefinitions.map((column) => [column.key, column]))
    : new Map();

  const logo = options?.includeLogo === false ? null : await fetchLogoBuffer();
  const includeLogo = Boolean(logo?.buffer);

  const sheetXml = buildSheetXml({
    columns: safeColumns,
    rows: Array.isArray(rows) ? rows : [],
    meta,
    columnDefinitions: columnMap,
    includeLogo,
  });

  const files = [
    { path: "[Content_Types].xml", data: buildContentTypesXml({ includeLogo }) },
    { path: "_rels/.rels", data: buildRootRelsXml() },
    { path: "xl/workbook.xml", data: buildWorkbookXml() },
    { path: "xl/_rels/workbook.xml.rels", data: buildWorkbookRelsXml() },
    { path: "xl/worksheets/sheet1.xml", data: sheetXml },
    ...(includeLogo
      ? [
          { path: "xl/worksheets/_rels/sheet1.xml.rels", data: buildSheetRelsXml({ includeLogo }) },
          { path: "xl/drawings/drawing1.xml", data: buildDrawingXml() },
          { path: "xl/drawings/_rels/drawing1.xml.rels", data: buildDrawingRelsXml() },
          { path: "xl/media/logo.png", data: logo.buffer },
        ]
      : []),
    { path: "xl/styles.xml", data: buildStylesXml() },
  ];

  return buildZip(files);
}

export default generatePositionsReportXlsx;
