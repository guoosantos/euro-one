import assert from "node:assert/strict";
import test from "node:test";

import { buildOverridesDto, normalizeGeozoneGroupIdResponse } from "../services/xdm/xdm-utils.js";

test("buildOverridesDto monta payload com value aninhado", () => {
  const payload = buildOverridesDto({ "8236818": 75299 });
  assert.deepEqual(payload, { "8236818": { value: 75299 } });
});

test("normalizeGeozoneGroupIdResponse aceita formatos diferentes", () => {
  const samples = [
    75299,
    "75299",
    { id: 75299 },
    { created: 75299 },
    { created: { id: 75299 } },
    { data: { id: 75299 } },
    { body: { created: { id: "75299" } } },
  ];

  samples.forEach((sample) => {
    assert.equal(normalizeGeozoneGroupIdResponse(sample), 75299);
  });
});
