import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "event-config-"));
process.env.EVENT_CONFIG_PATH = path.join(tempDir, "event-config.json");

const { getEventConfig, updateEventConfig, resetEventConfigCache } = await import("../services/event-config.js");

const storagePath = process.env.EVENT_CONFIG_PATH;

function resetStorage() {
  fs.writeFileSync(storagePath, JSON.stringify({}, null, 2));
  resetEventConfigCache();
}

test("getEventConfig semeia entradas padrão do catálogo", () => {
  resetStorage();
  const catalog = [
    { id: "1", name: "Evento 1", defaultSeverity: "info" },
    { id: "deviceOnline", name: "Equipamento online", defaultSeverity: "warning" },
  ];
  const config = getEventConfig({ clientId: "c1", protocol: "gt06", catalogEvents: catalog });
  assert.equal(config["1"].severity, "info");
  assert.equal(config["1"].active, true);
  assert.equal(config["1"].displayName, null);
  assert.equal(config.deviceOnline.severity, "warning");
});

test("updateEventConfig persiste overrides e aceita ids não mapeados", () => {
  resetStorage();
  const catalog = [{ id: "1", name: "Evento 1", defaultSeverity: "info" }];
  const updated = updateEventConfig({
    clientId: "c1",
    protocol: "gt06",
    items: [
      { id: "1", displayName: "Customizado", severity: "critical", active: false },
      { id: "999", displayName: "NÃO MAPEADO (999)", severity: "warning", active: true },
    ],
    catalogEvents: catalog,
  });
  assert.equal(updated["1"].displayName, "Customizado");
  assert.equal(updated["1"].severity, "critical");
  assert.equal(updated["1"].active, false);
  assert.equal(updated["999"].displayName, "NÃO MAPEADO (999)");
});
