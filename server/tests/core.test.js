import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { filterValidPositionIds, resolveTraccarDeviceError } from "../routes/core.js";

describe("filterValidPositionIds", () => {
  it("removes falsy and zero ids", () => {
    const ids = new Set([0, "0", null, undefined, "123", 456]);
    const result = filterValidPositionIds(ids);
    assert.deepEqual(result.sort(), ["123", "456"]);
  });
});

describe("resolveTraccarDeviceError", () => {
  it("maps Traccar 404 to not found", () => {
    const result = resolveTraccarDeviceError({ error: { code: 404 } });
    assert.equal(result.status, 404);
  });

  it("maps Traccar 401 to bad gateway", () => {
    const result = resolveTraccarDeviceError({ error: { code: 401 } });
    assert.equal(result.status, 502);
  });

  it("maps Traccar 500 to service unavailable", () => {
    const result = resolveTraccarDeviceError({ error: { code: 500 } });
    assert.equal(result.status, 503);
  });

  it("maps unknown errors to bad gateway", () => {
    const result = resolveTraccarDeviceError({ error: { code: "ETIMEDOUT" } });
    assert.equal(result.status, 502);
  });
});
