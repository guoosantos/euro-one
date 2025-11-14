import test from "node:test";
import assert from "node:assert/strict";
import { encodeCredentials } from "../src/lib/auth-utils.js";

test("encodeCredentials returns base64 string", () => {
  const encoded = encodeCredentials("demo", "123");
  assert.equal(encoded, Buffer.from("demo:123").toString("base64"));
});

test("encodeCredentials handles missing values", () => {
  assert.equal(encodeCredentials(null, null), null);
  assert.equal(encodeCredentials("demo", undefined), Buffer.from("demo:").toString("base64"));
});
