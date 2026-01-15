import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "event-config-"));
process.env.EVENT_CONFIG_PATH = path.join(tempDir, "event-config.json");

const { getEventConfig, updateEventConfig, resolveEventConfiguration, resetEventConfigCache } = await import(
  "../services/event-config.js",
);

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
  assert.equal(config["1"].customName, null);
  assert.equal(config.deviceOnline.severity, "warning");
});

test("updateEventConfig persiste overrides e aceita ids não mapeados", () => {
  resetStorage();
  const catalog = [{ id: "1", name: "Evento 1", defaultSeverity: "info" }];
  const updated = updateEventConfig({
    clientId: "c1",
    protocol: "gt06",
    items: [
      { id: "1", customName: "Customizado", severity: "critical", active: false },
    { id: "999", customName: "Evento desconhecido (999)", severity: "warning", active: true },
    ],
    catalogEvents: catalog,
  });
  assert.equal(updated["1"].displayName, "Customizado");
  assert.equal(updated["1"].customName, "Customizado");
  assert.equal(updated["1"].severity, "critical");
  assert.equal(updated["1"].active, false);
  assert.equal(updated["999"].displayName, "Evento desconhecido (999)");
});

test("resolveEventConfiguration aplica customName em eventos de diagnóstico", () => {
  resetStorage();
  const catalog = [
    { id: "fun_id=0,war_id=1", name: "Diagnóstico 1", defaultSeverity: "info" },
    { id: "5", name: "Evento 5", defaultSeverity: "warning" },
  ];
  updateEventConfig({
    clientId: "c1",
    protocol: "iotm",
    items: [{ id: "fun_id=0,war_id=1", customName: "Diagnóstico customizado", severity: "critical", active: false }],
    catalogEvents: catalog,
  });

  const resolved = resolveEventConfiguration({
    clientId: "c1",
    protocol: "iotm",
    eventId: "1",
    payload: { attributes: { fun_id: 0, war_id: 1 } },
    catalogEvents: catalog,
  });

  assert.equal(resolved.label, "Diagnóstico customizado");
  assert.equal(resolved.severity, "critical");
  assert.equal(resolved.active, false);
});
