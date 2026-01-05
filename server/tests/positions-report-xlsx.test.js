import assert from "node:assert/strict";
import test from "node:test";
import { generatePositionsReportXlsx } from "../utils/positions-report-xlsx.js";

function readZipEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset < buffer.length - 4) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = buffer.slice(nameStart, nameEnd).toString("utf8");
    const data = buffer.slice(dataStart, dataEnd);
    entries.set(name, data);
    offset = dataEnd;
  }
  return entries;
}

test("gera XLSX com cabeçalho, freeze pane e autoFilter", async () => {
  const buffer = await generatePositionsReportXlsx({
    rows: [
      { gpsTime: "2024-01-01T10:00:00Z", address: "Rua A", speed: 50 },
      { gpsTime: "2024-01-01T11:00:00Z", address: "Rua B", speed: 60 },
    ],
    columns: ["gpsTime", "address", "speed"],
    meta: {
      from: "2024-01-01T00:00:00Z",
      to: "2024-01-02T00:00:00Z",
      generatedAt: "2024-01-02T00:00:00Z",
      vehicle: { name: "Veículo 1", plate: "ABC1234", customer: "Cliente", status: "Ativo" },
    },
    options: { includeLogo: false },
  });

  const entries = readZipEntries(Buffer.from(buffer));
  assert.ok(entries.has("[Content_Types].xml"), "content types ausente");
  assert.ok(entries.has("xl/worksheets/sheet1.xml"), "sheet1 ausente");

  const sheetXml = entries.get("xl/worksheets/sheet1.xml").toString("utf8");
  assert.ok(sheetXml.includes("RELATÓRIO DE POSIÇÕES"), "título ausente");
  assert.ok(sheetXml.includes("<pane"), "freeze pane ausente");
  assert.ok(sheetXml.includes("<autoFilter"), "autoFilter ausente");
});
