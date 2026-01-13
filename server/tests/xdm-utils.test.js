import assert from "node:assert/strict";
import test from "node:test";

import { buildSettingsOverridesModified, normalizeGeozoneGroupIdResponse } from "../services/xdm/xdm-utils.js";

test("buildSettingsOverridesModified monta payload como dicionário de overrides", () => {
  const payload = buildSettingsOverridesModified({ "8236818": 75299 });
  assert.deepEqual(payload, { "8236818": { value: 75299 } });
});

test("buildSettingsOverridesModified mantém null como value null", () => {
  const payload = buildSettingsOverridesModified({ "8236818": null });
  assert.deepEqual(payload, { "8236818": { value: null } });
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
