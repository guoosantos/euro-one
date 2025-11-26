import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ensureHookResult } from "../src/lib/hooks/hook-shape.js";

describe("ensureHookResult", () => {
  it("normalises missing fields to safe defaults", () => {
    const result = ensureHookResult();
    assert.deepEqual(result.data, []);
    assert.equal(result.loading, false);
    assert.equal(result.error, null);
  });

  it("preserves extra keys and coerces loading", () => {
    const result = ensureHookResult({ data: [{ id: 1 }], loading: 0, error: undefined, fetchedAt: "now" });
    assert.deepEqual(result.data, [{ id: 1 }]);
    assert.equal(result.loading, false);
    assert.equal(result.error, null);
    assert.equal(result.fetchedAt, "now");
  });
});
