import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { appendConditionHistory, ensureConditionHistory } from "../utils/vehicle-conditions.js";

describe("ensureConditionHistory", () => {
  it("adds default condition when history is empty", () => {
    const result = ensureConditionHistory({});
    assert.ok(Array.isArray(result.conditions));
    assert.equal(result.conditions.length, 1);
    assert.equal(result.conditions[0].condition, "Novo");
  });

  it("preserves existing condition history", () => {
    const existing = { conditions: [{ id: "c1", condition: "Usado funcionando" }] };
    const result = ensureConditionHistory(existing);
    assert.equal(result.conditions.length, 1);
    assert.equal(result.conditions[0].condition, "Usado funcionando");
  });

  it("appends a manual condition and keeps most recent first", () => {
    const base = ensureConditionHistory({});
    const result = appendConditionHistory(base, {
      condition: "Manutenção",
      note: "Troca de chicote",
    });
    assert.equal(result.conditions[0].condition, "Manutenção");
    assert.equal(result.conditions[0].note, "Troca de chicote");
    assert.equal(result.condition, "Manutenção");
  });
});
