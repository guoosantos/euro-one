import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildInternalCode, extractInternalSequence, normalizePrefix } from "../utils/internal-code.js";

describe("internal code helpers", () => {
  it("normalizes prefix and builds internal code", () => {
    assert.equal(normalizePrefix("10"), 10);
    assert.equal(buildInternalCode(10, 1), "1000001");
    assert.equal(buildInternalCode("20", 12), "2000012");
  });

  it("extracts sequence only from numeric codes", () => {
    assert.equal(extractInternalSequence("1000005", 10), 5);
    assert.equal(extractInternalSequence("10-5", 10), null);
    assert.equal(extractInternalSequence("abc", 10), null);
  });
});
