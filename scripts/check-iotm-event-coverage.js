import fs from "node:fs";
import path from "node:path";
import { getProtocolEvents } from "../server/services/protocol-catalog.js";

const DEFAULT_CSV_PATH = path.resolve(process.cwd(), "positions.csv");

const isNumeric = (value) => /^\d+$/.test(String(value || "").trim());

const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

function parseCsv(content) {
  const rows = [];
  let headers = null;
  let current = "";
  let row = [];
  let inQuotes = false;

  const flushValue = () => {
    row.push(current);
    current = "";
  };

  const flushRow = () => {
    if (!row.length && !current) return;
    if (!headers) {
      headers = row.map((header) => header.trim());
    } else {
      const entry = headers.reduce((acc, header, index) => {
        acc[header] = row[index] ?? "";
        return acc;
      }, {});
      rows.push(entry);
    }
    row = [];
  };

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      flushValue();
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      flushValue();
      flushRow();
      continue;
    }
    current += char;
  }

  if (current.length || row.length) {
    flushValue();
    flushRow();
  }

  return rows;
}

function parseAttributes(rawAttributes) {
  const text = normalizeValue(rawAttributes);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function findEventCode(row, attributes) {
  const candidateKeys = ["event", "eventcode", "eventid", "alarm"];
  const rowKeys = Object.keys(row || {});
  const candidateFromRow = rowKeys.find((key) => candidateKeys.includes(key.toLowerCase()));
  const rowValue = candidateFromRow ? row?.[candidateFromRow] : null;
  if (rowValue !== null && rowValue !== undefined && normalizeValue(rowValue)) {
    return normalizeValue(rowValue);
  }

  for (const key of candidateKeys) {
    const attrValue = attributes?.[key];
    if (attrValue !== null && attrValue !== undefined && normalizeValue(attrValue)) {
      return normalizeValue(attrValue);
    }
  }

  return null;
}

function findProtocol(row, attributes) {
  const rowKeys = Object.keys(row || {});
  const protocolKey = rowKeys.find((key) => key.toLowerCase() === "protocol");
  const rowProtocol = protocolKey ? normalizeValue(row?.[protocolKey]) : null;
  return rowProtocol || normalizeValue(attributes?.protocol) || null;
}

function main() {
  const filePath = path.resolve(process.cwd(), process.argv[2] || DEFAULT_CSV_PATH);
  if (!fs.existsSync(filePath)) {
    console.error(`Arquivo não encontrado: ${filePath}`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(csvContent);
  const seen = new Set();

  rows.forEach((row) => {
    const attributes = parseAttributes(row?.attributes || row?.Attributes || "");
    const code = findEventCode(row, attributes);
    if (!code || !isNumeric(code)) return;
    const protocol = findProtocol(row, attributes);
    if (!protocol || String(protocol).toLowerCase() !== "iotm") return;
    seen.add(String(code));
  });

  if (!seen.size) {
    console.error("Nenhum evento numérico IOTM encontrado no CSV.");
    process.exit(1);
  }

  const catalog = getProtocolEvents("iotm") || [];
  const catalogIds = new Set(catalog.map((event) => String(event?.id)));
  const missing = Array.from(seen).filter((id) => !catalogIds.has(String(id)));

  if (missing.length) {
    console.error("Eventos IOTM ausentes no catálogo:");
    console.table(missing.map((id) => ({ id })));
    process.exit(1);
  }

  console.log(`Cobertura OK. ${seen.size} eventos IOTM verificados.`);
}

main();
