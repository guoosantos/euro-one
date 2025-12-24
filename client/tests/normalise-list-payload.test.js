import test from "node:test";
import assert from "node:assert/strict";

import api from "../src/lib/api.js";
import { CoreApi, normaliseListPayload } from "../src/lib/coreApi.js";

test("normaliseListPayload aceita envelopes devices e data", () => {
  const devices = [{ id: 1 }, { id: 2 }];
  assert.deepEqual(normaliseListPayload({ devices }), devices);
  assert.deepEqual(normaliseListPayload({ data: { devices } }), devices);
  assert.deepEqual(normaliseListPayload({ data: devices }), devices);
});

test("CoreApi.listDevices devolve array mesmo com payload envelopado", async () => {
  const originalRequest = api.request;
  api.request = async () => ({ data: { devices: [{ id: "abc" }] } });

  try {
    const devices = await CoreApi.listDevices();
    assert.deepEqual(devices, [{ id: "abc" }]);
  } finally {
    api.request = originalRequest;
  }
});
