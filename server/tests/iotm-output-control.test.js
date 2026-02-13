import assert from "node:assert/strict";
import test from "node:test";

import { buildIotmOutputPayload } from "../utils/iotm-output-control.js";

test("buildIotmOutputPayload cria payload para saída 2 ON por 10s", () => {
  const payload = buildIotmOutputPayload({ output: 2, action: "on", durationMs: 10000 });
  assert.equal(payload?.type, "custom");
  assert.equal(payload?.attributes?.data, "010003E8");
});

test("buildIotmOutputPayload cria payload para saída 2 OFF", () => {
  const payload = buildIotmOutputPayload({ output: 2, action: "off", durationMs: 0 });
  assert.equal(payload?.type, "custom");
  assert.equal(payload?.attributes?.data, "01010000");
});
