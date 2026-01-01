import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { filterCommandsBySearch, isCustomCommandConfigured, mergeCommands } from "../src/pages/commands-helpers.js";

describe("mergeCommands", () => {
  it("includes protocol and custom commands while hiding invisible custom by default", () => {
    const protocol = [{ code: "engineStop", name: "Bloquear motor" }];
    const custom = [
      { id: "c1", name: "SMS pronto", kind: "SMS", payload: { message: "ok" }, visible: true },
      { id: "c2", name: "Oculto", kind: "SMS", payload: { message: "..." }, visible: false },
    ];

    const mergedVisible = mergeCommands(protocol, custom);
    assert.equal(mergedVisible.length, 2);
    assert.equal(mergedVisible[0].kind, "protocol");
    assert.equal(mergedVisible[1].kind, "custom");
    assert.equal(mergedVisible[1].customKind, "SMS");

    const mergedAll = mergeCommands([], custom, { includeHiddenCustom: true });
    assert.equal(mergedAll.length, 2);
  });

  it("treats custom commands without protocol as global and filters by selected protocol", () => {
    const custom = [
      { id: "global", name: "Sem protocolo", kind: "SMS", payload: { message: "ok" }, visible: true, protocol: null },
      { id: "match", name: "Teltonika somente", kind: "SMS", payload: { message: "ok" }, visible: true, protocol: "teltonika" },
      { id: "other", name: "Outro protocolo", kind: "SMS", payload: { message: "ok" }, visible: true, protocol: "queclink" },
    ];

    const forTeltonika = mergeCommands([], custom, { deviceProtocol: "teltonika" });
    assert.equal(forTeltonika.map((item) => item.id).join(","), "global,match");

    const forQueclink = mergeCommands([], custom, { deviceProtocol: "queclink" });
    assert.equal(forQueclink.map((item) => item.id).join(","), "global,other");

    const withoutDeviceProtocol = mergeCommands([], custom, { deviceProtocol: null });
    assert.equal(withoutDeviceProtocol.map((item) => item.id).join(","), "global");
  });
});

describe("filterCommandsBySearch", () => {
  it("matches by name or description regardless of case", () => {
    const commands = [
      { name: "Bloquear Motor", description: "padrão" },
      { name: "SMS pronto", description: "aviso rápido" },
    ];

    const filteredByName = filterCommandsBySearch(commands, "sms");
    assert.equal(filteredByName.length, 1);
    assert.equal(filteredByName[0].name, "SMS pronto");

    const filteredByDescription = filterCommandsBySearch(commands, "PADRÃO");
    assert.equal(filteredByDescription.length, 1);
    assert.equal(filteredByDescription[0].name, "Bloquear Motor");
  });
});

describe("isCustomCommandConfigured", () => {
  it("validates payload content and protocol compatibility", () => {
    const smsCommand = { kind: "custom", customKind: "SMS", payload: { message: "Oi" }, protocol: "teltonika" };
    assert.equal(isCustomCommandConfigured(smsCommand, "teltonika"), true);
    assert.equal(isCustomCommandConfigured({ ...smsCommand, payload: { message: "" } }, "teltonika"), false);
    assert.equal(isCustomCommandConfigured(smsCommand, "suntech"), false);

    const jsonCommand = { kind: "custom", customKind: "JSON", payload: { type: "customType" } };
    assert.equal(isCustomCommandConfigured(jsonCommand, "any"), true);
  });
});
