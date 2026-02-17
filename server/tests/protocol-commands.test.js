import assert from "node:assert/strict";
import test from "node:test";

import { getProtocolCommands } from "../services/protocol-catalog.js";
import { resolveCommandPayload } from "../routes/proxy.js";

test("getProtocolCommands inclui comandos fixos IOTM para saída 2", () => {
  const commands = getProtocolCommands("iotm") || [];
  assert.ok(commands.length);

  const byId = new Map(commands.map((command) => [command?.id, command]));

  const on = byId.get("iotm-output2-10s");
  assert.ok(on, "Comando Acionar Saída 2 (10 segundos) não encontrado");
  assert.equal(on?.baseCommand, "outputControl");
  assert.deepEqual(on?.fixedParams, { output: 2, action: "on", durationMs: 10000 });

  const off = byId.get("iotm-output2-off");
  assert.ok(off, "Comando Desacionar Saída 2 não encontrado");
  assert.equal(off?.baseCommand, "outputControl");
  assert.deepEqual(off?.fixedParams, { output: 2, action: "off", durationMs: 0 });
});

test("resolveCommandPayload gera payload IOTM para saída 2", () => {
  const onPayload = resolveCommandPayload({
    body: {
      protocol: "iotm",
      commandKey: "iotm-output2-10s",
      params: { output: 3, action: "off", durationMs: 2000 },
    },
  });
  assert.equal(onPayload.type, "custom");
  assert.equal(onPayload.attributes?.data, "010003E8");

  const offPayload = resolveCommandPayload({
    body: {
      protocol: "iotm",
      commandKey: "iotm-output2-off",
    },
  });
  assert.equal(offPayload.type, "custom");
  assert.equal(offPayload.attributes?.data, "01010000");
});

test("getProtocolCommands inclui comandos de live para NT407", () => {
  const commands = getProtocolCommands("nt407") || [];
  const ids = new Set(commands.map((command) => command?.id));
  assert.ok(ids.has("nt407-live-start"));
  assert.ok(ids.has("nt407-live-stop"));
});
