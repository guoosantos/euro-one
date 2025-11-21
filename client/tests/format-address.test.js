import test from "node:test";
import assert from "node:assert";

import { formatAddress } from "../src/lib/format-address.js";

test("formatAddress compacta endereço completo com hífen e vírgulas", () => {
  const raw = "Rua A, 123 - Bairro, Cidade - UF";
  const formatted = formatAddress(raw);
  assert.strictEqual(formatted, "Rua A, 123 - Bairro, Cidade - UF");
});

test("formatAddress reduz cauda longa mantendo contexto", () => {
  const raw = "Av. Paulista, 1000, São Paulo, SP, Brasil";
  const formatted = formatAddress(raw);
  assert.strictEqual(formatted, "Av. Paulista, 1000 - SP - Brasil");
});

test("formatAddress retorna traço quando vazio", () => {
  assert.strictEqual(formatAddress(null), "—");
  assert.strictEqual(formatAddress("   "), "—");
});
