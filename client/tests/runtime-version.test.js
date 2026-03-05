import test from "node:test";
import assert from "node:assert/strict";

import { fetchRuntimeVersion, normalizeRuntimeVersion } from "../src/lib/runtime-version.js";

test("normalizeRuntimeVersion sanitiza campos esperados", () => {
  const payload = normalizeRuntimeVersion({
    builtAt: "2026-03-05T20:00:00.000Z",
    gitSha: " abc123 ",
    hotfix: " run-01 ",
    baseBuildAt: "2026-03-05T03:22:03.000Z",
    baseCanonicalArchive: " /tmp/base.tgz ",
    baseCanonicalSha256: " deadbeef ",
  });

  assert.equal(payload.builtAt, "2026-03-05T20:00:00.000Z");
  assert.equal(payload.gitSha, "abc123");
  assert.equal(payload.hotfix, "run-01");
  assert.equal(payload.baseBuildAt, "2026-03-05T03:22:03.000Z");
  assert.equal(payload.baseCanonicalArchive, "/tmp/base.tgz");
  assert.equal(payload.baseCanonicalSha256, "deadbeef");
});

test("fetchRuntimeVersion usa /version.json quando responde 200", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        builtAt: "2026-03-05T20:00:00.000Z",
        gitSha: "abc123",
        hotfix: "main-00h22",
      }),
    };
  };

  try {
    const payload = await fetchRuntimeVersion();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/version.json");
    assert.equal(calls[0].options?.cache, "no-store");
    assert.equal(payload.gitSha, "abc123");
    assert.equal(payload.hotfix, "main-00h22");
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchRuntimeVersion faz fallback com nocache quando a primeira tentativa falha", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      throw new Error("network down");
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        builtAt: "2026-03-05T20:01:00.000Z",
        gitSha: "def456",
        hotfix: "fallback",
      }),
    };
  };

  try {
    const payload = await fetchRuntimeVersion();
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "/version.json");
    assert.match(calls[1].url, /^\/version\.json\?nocache=\d+$/);
    assert.equal(payload.gitSha, "def456");
  } finally {
    global.fetch = originalFetch;
  }
});

