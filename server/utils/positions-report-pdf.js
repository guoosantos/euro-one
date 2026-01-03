import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.resolve(__dirname, "..", "..", "assets", "templates", "PAPEL_DE_PAREDE_EURO.docx");
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

let cachedTemplateImage = null;

function findZipEntry(buffer, predicate) {
  const signature = 0x06054b50;
  const minOffset = Math.max(0, buffer.length - 65557);
  let eocdOffset = -1;

  for (let i = buffer.length - 22; i >= minOffset; i -= 1) {
    if (buffer.readUInt32LE(i) === signature) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("DOCX inválido: diretório central ausente.");
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  let cursor = centralDirOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;

    const compression = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + fileNameLength;
    const fileName = buffer.slice(nameStart, nameEnd).toString("utf8");

    if (predicate(fileName)) {
      const localHeaderSignature = buffer.readUInt32LE(localHeaderOffset);
      if (localHeaderSignature !== 0x04034b50) {
        throw new Error("DOCX inválido: cabeçalho local ausente.");
      }
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      const compressed = buffer.slice(dataStart, dataEnd);
      if (compression === 0) {
        return compressed;
      }
      if (compression === 8) {
        return zlib.inflateRawSync(compressed);
      }
      throw new Error(`DOCX inválido: compressão ${compression} não suportada.`);
    }

    cursor = nameEnd + extraLength + commentLength;
  }

  return null;
}

function parseJpegDimensions(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

function parsePng(buffer) {
  const signature = buffer.slice(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    throw new Error("PNG inválido: assinatura não reconhecida.");
  }
  let offset = 8;
  let width = null;
  let height = null;
  let bitDepth = 8;
  let colorType = null;
  const chunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.slice(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (type === "IHDR") {
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer.readUInt8(dataStart + 8);
      colorType = buffer.readUInt8(dataStart + 9);
    }
    if (type === "IDAT") {
      chunks.push(buffer.slice(dataStart, dataEnd));
    }
    if (type === "IEND") break;
    offset = dataEnd + 4;
  }

  if (!width || !height) {
    throw new Error("PNG inválido: dimensões ausentes.");
  }
  if (colorType !== 2) {
    throw new Error("PNG inválido: apenas RGB sem alpha é suportado.");
  }
  if (bitDepth !== 8) {
    throw new Error("PNG inválido: apenas 8 bits por componente é suportado.");
  }

  return {
    width,
    height,
    bitDepth,
    colorType,
    data: Buffer.concat(chunks),
  };
}

async function loadTemplateImage() {
  if (cachedTemplateImage) return cachedTemplateImage;
  let docx = null;
  try {
    docx = await fs.readFile(TEMPLATE_PATH);
  } catch (error) {
    console.warn("[reports/positions] template DOCX ausente", error?.message || error);
    cachedTemplateImage = null;
    return null;
  }
  const imageBuffer = findZipEntry(docx, (name) => name.startsWith("word/media/"));
  if (!imageBuffer) {
    cachedTemplateImage = null;
    return null;
  }

  const extension = imageBuffer.slice(0, 4).toString("hex") === "89504e47" ? "png" : "jpg";
  if (extension === "png") {
    const parsed = parsePng(imageBuffer);
    cachedTemplateImage = { type: "png", ...parsed };
    return cachedTemplateImage;
  }

  const dims = parseJpegDimensions(imageBuffer);
  if (!dims) {
    throw new Error("JPEG inválido: não foi possível detectar dimensões.");
  }
  cachedTemplateImage = { type: "jpg", width: dims.width, height: dims.height, data: imageBuffer };
  return cachedTemplateImage;
}

function escapePdfText(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function truncateText(text, maxChars) {
  const raw = String(text || "");
  if (raw.length <= maxChars) return raw;
  if (maxChars <= 1) return raw.slice(0, 1);
  return `${raw.slice(0, maxChars - 1)}…`;
}

const COLUMN_DEFS = {
  gpsTime: { label: "GPS Time", weight: 1.4 },
  deviceTime: { label: "Device Time", weight: 1.4 },
  serverTime: { label: "Server Time", weight: 1.4 },
  latitude: { label: "Latitude", weight: 1 },
  longitude: { label: "Longitude", weight: 1 },
  address: { label: "Address", weight: 2.6 },
  speed: { label: "Speed", weight: 0.9 },
  direction: { label: "Direction", weight: 0.9 },
  ignition: { label: "Ignition", weight: 0.9 },
  vehicleState: { label: "Vehicle State", weight: 1.4 },
  batteryLevel: { label: "Battery Level", weight: 1.1 },
  rssi: { label: "RSSI", weight: 0.8 },
  satellites: { label: "Satellites", weight: 0.9 },
  geofence: { label: "Geofence", weight: 1.2 },
  accuracy: { label: "Accuracy", weight: 0.9 },
  commandResponse: { label: "Command Response", weight: 2.2 },
};

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
  if (key === "ignition") return value ? "Ligado" : "Desligado";
  return String(value);
}

function buildPdf({ pages, fontObject, imageObject }) {
  const objects = [];
  const offsets = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };

  const fontRef = addObject(fontObject);
  const imageRef = imageObject ? addObject(imageObject) : null;
  const pagesRef = addObject("<< /Type /Pages /Kids [] /Count 0 >>");
  const catalogRef = addObject(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`);

  const pageRefs = [];
  pages.forEach((page) => {
    const contentLength = Buffer.byteLength(page.content, "binary");
    const contentsRef = addObject(`<< /Length ${contentLength} >>\nstream\n${page.content}\nendstream`);
    const resources = [
      "/Font << /F1 " + fontRef + " 0 R >>",
      imageRef ? `/XObject << /Bg ${imageRef} 0 R >>` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const pageRef = addObject(
      `<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${A4_WIDTH} ${A4_HEIGHT}] /Resources << ${resources} >> /Contents ${contentsRef} 0 R >>`,
    );
    pageRefs.push(pageRef);
  });

  const kids = pageRefs.map((ref) => `${ref} 0 R`).join(" ");
  objects[pagesRef - 1] = `<< /Type /Pages /Kids [${kids}] /Count ${pageRefs.length} >>`;

  let pdf = "%PDF-1.4\n";
  objects.forEach((obj) => {
    offsets.push(pdf.length);
    pdf += `${offsets.length} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += "xref\n";
  pdf += `0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += "trailer\n";
  pdf += `<< /Size ${objects.length + 1} /Root ${catalogRef} 0 R >>\n`;
  pdf += "startxref\n";
  pdf += `${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "binary");
}

function buildPageContent({ rows, columns, meta, pageNumber, totalPages, background }) {
  const margin = 36;
  const headerTop = A4_HEIGHT - margin;
  const content = [];

  if (background) {
    content.push(`q ${A4_WIDTH} 0 0 ${A4_HEIGHT} 0 0 cm /Bg Do Q`);
  }

  const titleSize = 16;
  const metaSize = 9;
  const bodySize = 8;

  const writeText = (text, x, y, size = bodySize) => {
    content.push(`BT /F1 ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfText(text)}) Tj ET`);
  };

  content.push("0 0 0 rg");
  writeText("POSITION REPORT", margin, headerTop - titleSize, titleSize);

  writeText(`Gerado em: ${formatDate(meta?.generatedAt)}`, margin, headerTop - 36, metaSize);
  writeText(`Período: ${formatDate(meta?.from)} → ${formatDate(meta?.to)}`, margin, headerTop - 50, metaSize);
  writeText(`Exportado por: ${meta?.exportedBy || "—"}`, margin, headerTop - 64, metaSize);

  const vehicleTop = headerTop - 90;
  const vehicleLeft = margin;
  const vehicleRight = A4_WIDTH / 2 + 10;
  writeText(`Placa: ${meta?.vehicle?.plate || "—"}`, vehicleLeft, vehicleTop, metaSize);
  writeText(`Veículo: ${meta?.vehicle?.name || "—"}`, vehicleLeft, vehicleTop - 14, metaSize);
  writeText(`Cliente: ${meta?.vehicle?.customer || "—"}`, vehicleLeft, vehicleTop - 28, metaSize);
  writeText(`Device ID: ${meta?.vehicle?.deviceId || "—"}`, vehicleRight, vehicleTop, metaSize);
  writeText(`Status atual: ${meta?.vehicle?.status || "—"}`, vehicleRight, vehicleTop - 14, metaSize);
  writeText(`Última comunicação: ${formatDate(meta?.vehicle?.lastCommunication)}`, vehicleRight, vehicleTop - 28, metaSize);
  writeText(`Ignição: ${meta?.vehicle?.ignition ?? "—"}`, vehicleRight, vehicleTop - 42, metaSize);

  const tableStartY = vehicleTop - 60;
  const tableWidth = A4_WIDTH - margin * 2;
  const totalWeight = columns.reduce((sum, key) => sum + (COLUMN_DEFS[key]?.weight || 1), 0);
  const widths = columns.map((key) => (tableWidth * (COLUMN_DEFS[key]?.weight || 1)) / totalWeight);

  const headerHeight = 16;
  const rowHeight = 14;
  content.push("0.15 0.2 0.3 rg");
  content.push(`${margin} ${tableStartY - headerHeight} ${tableWidth} ${headerHeight} re f`);

  content.push("1 1 1 rg");
  let x = margin + 4;
  columns.forEach((key, index) => {
    const label = COLUMN_DEFS[key]?.label || key;
    const maxChars = Math.floor((widths[index] - 6) / 4.5);
    writeText(truncateText(label, maxChars), x, tableStartY - 12, 7.5);
    x += widths[index];
  });

  content.push("0 0 0 rg");
  let y = tableStartY - headerHeight - 6;
  rows.forEach((row) => {
    x = margin + 4;
    columns.forEach((key, index) => {
      const rawValue = formatCellValue(key, row[key]);
      const maxChars = Math.floor((widths[index] - 6) / 4.2);
      writeText(truncateText(rawValue, maxChars), x, y, bodySize);
      x += widths[index];
    });
    y -= rowHeight;
  });

  const footerY = margin - 6;
  content.push("0 0 0 rg");
  writeText(`Página ${pageNumber} de ${totalPages}`, margin, footerY, metaSize);
  writeText("Generated by Euro One", A4_WIDTH - margin - 130, footerY, metaSize);

  return content.join("\n");
}

export async function generatePositionsReportPdf({ rows, columns, meta }) {
  const templateImage = await loadTemplateImage();
  let imageObject = null;

  if (templateImage) {
    if (templateImage.type === "jpg") {
      imageObject = `<< /Type /XObject /Subtype /Image /Width ${templateImage.width} /Height ${templateImage.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${templateImage.data.length} >>\nstream\n${templateImage.data.toString("binary")}\nendstream`;
    } else if (templateImage.type === "png") {
      imageObject = `<< /Type /XObject /Subtype /Image /Width ${templateImage.width} /Height ${templateImage.height} /ColorSpace /DeviceRGB /BitsPerComponent ${templateImage.bitDepth} /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent ${templateImage.bitDepth} /Columns ${templateImage.width} >> /Length ${templateImage.data.length} >>\nstream\n${templateImage.data.toString("binary")}\nendstream`;
    }
  }

  const fontObject = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  const resolvedColumns = Array.isArray(columns) ? columns.filter((key) => COLUMN_DEFS[key]) : [];
  const columnsToUse = resolvedColumns.length ? resolvedColumns : Object.keys(COLUMN_DEFS);
  const pageCapacity = 28;
  const pages = [];
  const totalPages = Math.max(1, Math.ceil(rows.length / pageCapacity));
  for (let i = 0; i < totalPages; i += 1) {
    const pageRows = rows.slice(i * pageCapacity, (i + 1) * pageCapacity);
    pages.push({
      content: buildPageContent({
        rows: pageRows,
        columns: columnsToUse,
        meta,
        pageNumber: i + 1,
        totalPages,
        background: Boolean(imageObject),
      }),
    });
  }

  return buildPdf({
    pages,
    fontObject,
    imageObject,
  });
}
