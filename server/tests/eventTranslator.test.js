import assert from "node:assert/strict";
import test from "node:test";
import { translateDiagnosticEvent } from "../../shared/eventTranslator.js";

test("translateDiagnosticEvent resolve eventos diagnósticos e fallback", () => {
  const match = translateDiagnosticEvent({ payload: { attributes: { fun_id: 0, war_id: 164 } } });
  assert.equal(match?.label_ptBR, "Sincronização NTP concluída.");
  assert.equal(match?.raw_code, "fun_id=0,war_id=164");
  assert.equal(match?.category, "diagnostic");
  assert.equal(match?.fallback_used, false);

  const template = translateDiagnosticEvent({ payload: { attributes: { fun_id: 20, war_id: 12 } } });
  assert.equal(template?.label_ptBR, "Bits 24–31 do registro de falhas: x=12");

  const unknown = translateDiagnosticEvent({ payload: { attributes: { fun_id: 0, war_id: 999 } } });
  assert.equal(unknown?.label_ptBR, "Evento desconhecido (fun_id=0, war_id=999)");
  assert.equal(unknown?.fallback_used, true);
});

test("translateDiagnosticEvent reconhece posições sem evento", () => {
  const positionOnly = translateDiagnosticEvent({ payload: { latitude: -19.9, longitude: -43.9 } });
  assert.equal(positionOnly?.label_ptBR, "Posição registrada");
});

test("translateDiagnosticEvent usa payload para identificar fun_id/war_id", () => {
  const fromPayload = translateDiagnosticEvent({
    rawCode: "164",
    payload: { attributes: { fun_id: 0, war_id: 164 } },
  });
  assert.equal(fromPayload?.label_ptBR, "Sincronização NTP concluída.");
});

test("translateDiagnosticEvent resolve código numérico puro com catálogo diagnóstico", () => {
  const byRaw = translateDiagnosticEvent({ rawCode: "164" });
  assert.equal(byRaw?.label_ptBR, "Sincronização NTP concluída.");
  assert.equal(byRaw?.raw_code, "fun_id=0,war_id=164");
});

test("translateDiagnosticEvent usa template diagnóstico quando só existe fun_id numérico", () => {
  const template = translateDiagnosticEvent({ rawCode: "20" });
  assert.equal(template?.label_ptBR, "Bits 24–31 do registro de falhas");
  assert.equal(template?.raw_code, "fun_id=20,war_id=x");
});

test("translateDiagnosticEvent lê código numérico do payload", () => {
  const fromPayloadEvent = translateDiagnosticEvent({ payload: { attributes: { event: 164 } } });
  assert.equal(fromPayloadEvent?.label_ptBR, "Sincronização NTP concluída.");
});
