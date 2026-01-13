import assert from "node:assert/strict";
import test from "node:test";

import { buildSettingsOverridesModified, normalizeGeozoneGroupIdResponse } from "../services/xdm/xdm-utils.js";

test("buildSettingsOverridesModified monta payload com lista modified", () => {
  const payload = buildSettingsOverridesModified({ "8236818": 75299 });
  assert.deepEqual(payload, [{ userElementId: 8236818, value: 75299 }]);
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
