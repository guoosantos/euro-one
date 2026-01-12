import assert from "node:assert/strict";
import test from "node:test";

test("xdm-override-element não inicializa storage no import", async () => {
  const module = await import("../models/xdm-override-element.js");
  assert.equal(typeof module.getOverrideElement, "function");
  assert.equal(typeof module.upsertOverrideElement, "function");
});
