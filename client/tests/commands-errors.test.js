import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveCommandSendError } from "../src/pages/commands-helpers.js";

describe("resolveCommandSendError", () => {
  it("prefers backend messages when available", () => {
    const error = {
      response: { status: 409, data: { error: { message: "Equipamento vinculado sem traccarId" } } },
    };
    assert.equal(resolveCommandSendError(error), "Equipamento vinculado sem traccarId");
  });

  it("maps common statuses to actionable defaults", () => {
    const unauthorizedError = { response: { status: 403, data: {} } };
    assert.equal(
      resolveCommandSendError(unauthorizedError),
      "Dispositivo não autorizado para este cliente.",
    );

    const unavailableError = { response: { status: 502, data: {} } };
    assert.equal(resolveCommandSendError(unavailableError), "Não foi possível conectar ao Traccar.");
  });

  it("falls back to error message or provided default", () => {
    const genericError = new Error("Falha inesperada");
    assert.equal(resolveCommandSendError(genericError, "Erro ao enviar"), "Falha inesperada");

    const withoutMessage = {};
    assert.equal(resolveCommandSendError(withoutMessage, "Erro ao enviar"), "Erro ao enviar");
  });
});
