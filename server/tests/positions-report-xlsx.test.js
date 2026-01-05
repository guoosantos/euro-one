import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { generatePositionsReportXlsx } from "../utils/positions-report-xlsx.js";

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

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("Relatório de Posições");
  assert.ok(sheet, "planilha ausente");
  assert.equal(sheet.getCell("B1").value, "RELATÓRIO DE POSIÇÕES");
  assert.ok(sheet.views?.[0]?.state === "frozen", "freeze pane ausente");
  assert.ok(sheet.autoFilter, "autoFilter ausente");
});
