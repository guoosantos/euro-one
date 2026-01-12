import assert from "node:assert/strict";
import test from "node:test";

import { buildOverridesDto } from "../services/xdm/xdm-utils.js";

test("buildOverridesDto monta payload com value aninhado", () => {
  const payload = buildOverridesDto({ "8236818": 75299 });
  assert.deepEqual(payload, { "8236818": { value: "75299" } });
});
