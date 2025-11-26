import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { filterValidPositionIds } from "../routes/core.js";

describe("filterValidPositionIds", () => {
  it("removes falsy and zero ids", () => {
    const ids = new Set([0, "0", null, undefined, "123", 456]);
    const result = filterValidPositionIds(ids);
    assert.deepEqual(result.sort(), ["123", "456"]);
  });
});
