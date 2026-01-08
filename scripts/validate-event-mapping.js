import fs from "node:fs";
import path from "node:path";
import { resolveEventDefinition } from "../client/src/lib/event-translations.js";

const DEFAULT_CSV_PATH = path.resolve(process.cwd(), "positions.csv");
const DISALLOWED_LABELS = new Set(["Posição registrada", "Evento do dispositivo"]);

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

function isDisallowedLabel(label, code) {
  if (!label) return true;
  if (DISALLOWED_LABELS.has(label)) return true;
  if (/^evento desconhecido/i.test(label)) return true;
  if (/^evento\s+(iotm\s+)?\d+/i.test(label)) return true;
  if (/evento do dispositivo/i.test(label)) return true;
  if (code && label === "Posição registrada") return true;
  return false;
}

function main() {
  const filePath = path.resolve(process.cwd(), process.argv[2] || DEFAULT_CSV_PATH);
  if (!fs.existsSync(filePath)) {
    console.error(`Arquivo não encontrado: ${filePath}`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(csvContent);
  const results = [];
  const failures = [];
  const seen = new Set();

  rows.forEach((row) => {
    const attributes = parseAttributes(row?.attributes || row?.Attributes || "");
    const code = findEventCode(row, attributes);
    if (!code || !isNumeric(code)) return;
    const protocol = findProtocol(row, attributes);
    const key = `${code}|${protocol || "unknown"}`;
    if (seen.has(key)) return;
    seen.add(key);

    const payload = {
      event: code,
      protocol,
      attributes,
      position: {
        attributes,
        protocol,
      },
    };
    const definition = resolveEventDefinition(code, "pt-BR", null, protocol, payload);
    const label = definition?.label || "";

    results.push({ code, protocol: protocol || "-", label });
    if (isDisallowedLabel(label, code)) {
      failures.push({ code, protocol: protocol || "-", label: label || "(vazio)" });
    }
  });

  if (!results.length) {
    console.error("Nenhum evento numérico encontrado no CSV.");
    process.exit(1);
  }

  console.table(results);

  if (failures.length) {
    console.error("Falhas de mapeamento encontradas:");
    console.table(failures);
    process.exit(1);
  }
}

main();
