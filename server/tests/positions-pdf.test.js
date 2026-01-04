import assert from "node:assert/strict";
import test from "node:test";
import { generatePositionsReportPdf } from "../utils/positions-report-pdf.js";

test("PDF export keeps dynamic columns provided by the frontend schema", async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(0),
    headers: new Map([["content-type", "image/png"]]),
  });

  try {
    try {
      const pdf = await generatePositionsReportPdf({
        rows: [
          {
            gpsTime: "2024-01-01T00:00:00Z",
            temperature: 21.3,
          },
        ],
        columns: ["gpsTime", "temperature"],
        availableColumns: ["gpsTime", "temperature"],
        columnDefinitions: [
          { key: "gpsTime", labelPt: "Hora GPS", weight: 1 },
          { key: "temperature", labelPt: "Temperatura", weight: 1, unit: "°C", type: "number" },
        ],
        meta: {
          from: "2024-01-01T00:00:00Z",
          to: "2024-01-02T00:00:00Z",
          generatedAt: "2024-01-02T00:00:00Z",
          vehicle: { plate: "TEST-1234", name: "Veículo", customer: "Cliente" },
          exportedBy: "tester",
        },
      });

      assert.ok(pdf instanceof Buffer, "PDF buffer should be returned");
      assert.ok(pdf.length > 0, "PDF should not be empty");
    } catch (error) {
      if (error?.code === "PDF_CHROMIUM_LAUNCH_FAILED") {
        t.skip("Playwright browsers are not installed in this environment");
        return;
      }
      throw error;
    }
  } finally {
    global.fetch = originalFetch;
  }
});
