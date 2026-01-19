import test from "node:test";
import assert from "node:assert";

import {
  translateEventType,
  getEventSeverity,
  listKnownEventTypes,
  normalizeEventType,
  resolveEventDefinition,
  resolveEventDefinitionFromPayload,
} from "../src/lib/event-translations.js";

test("translateEventType retorna rótulos localizados com normalização", () => {
  assert.strictEqual(translateEventType("ignitionOn", "pt-BR"), "Ignição ligada");
  assert.strictEqual(translateEventType("OVERSPEED", "pt-BR"), "Excesso de velocidade");
  assert.strictEqual(translateEventType("overspeed", "en-US"), "Excesso de velocidade");
});

test("translateEventType usa fallback translator quando chave não existe", () => {
  const fallback = (key) => (key === "events.customalert" ? "Alerta customizado" : key);
  assert.strictEqual(translateEventType("customAlert", "pt-BR", fallback), "Alerta customizado");
  assert.strictEqual(translateEventType("", "pt-BR", fallback), "Evento");
});

test("translateEventType aplica catálogo IOTM com fallback por protocolo", () => {
  assert.strictEqual(translateEventType("1", "pt-BR", null, "iotm"), "Ignição ligada");
  assert.strictEqual(translateEventType("164", "pt-BR", null, "iotm"), "Sincronização NTP concluída.");
});

test("translateEventType sinaliza eventos não mapeados", () => {
  assert.strictEqual(translateEventType("999", "pt-BR", null, "gt06"), "NÃO MAPEADO (999)");
});

test("resolveEventDefinition usa rótulo de catálogo quando disponível", () => {
  const definition = resolveEventDefinition("1", "pt-BR", null, "iotm");
  assert.strictEqual(definition.label, "Ignição ligada");
  assert.ok(definition.isNumeric);
});

test("resolveEventDefinitionFromPayload aplica fallback de posição para eventos genéricos", () => {
  const basePayload = { latitude: -23.55, longitude: -46.63, attributes: {} };
  const noEvent = resolveEventDefinitionFromPayload(basePayload, "pt-BR");
  assert.strictEqual(noEvent.label, "Posição");

  const defaultEvent = resolveEventDefinitionFromPayload(
    { ...basePayload, attributes: { event: "0" } },
    "pt-BR",
  );
  assert.strictEqual(defaultEvent.label, "Posição");

  const deviceEvent = resolveEventDefinitionFromPayload(
    { ...basePayload, attributes: { event: "255" } },
    "pt-BR",
  );
  assert.strictEqual(deviceEvent.label, "Posição");
});

test("getEventSeverity prioriza mapeamento conhecido e aplica padrão", () => {
  assert.strictEqual(getEventSeverity("sos"), "critical");
  assert.strictEqual(getEventSeverity("harshBraking"), "medium");
  assert.strictEqual(getEventSeverity("unknownType", "low"), "low");
});

test("normalizeEventType remove caracteres especiais", () => {
  assert.strictEqual(normalizeEventType("GeoFence Enter"), "geofenceenter");
  assert.strictEqual(normalizeEventType(null), "");
});

test("listKnownEventTypes expõe catálogo sem incluir genérico", () => {
  const types = listKnownEventTypes();
  assert.ok(Array.isArray(types));
  assert.ok(types.length > 5);
  assert.ok(!types.includes("generic"));
  assert.ok(types.includes("overspeed"));
});
