import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { __resetTraccarCoherenceCache, ensureTraccarRegistryConsistency } from "../services/traccar-coherence.js";

afterEach(() => {
  __resetTraccarCoherenceCache();
});

describe("traccar-coherence", () => {
  it("não força refresh quando API e banco estão alinhados", async () => {
    const result = await ensureTraccarRegistryConsistency({
      dbConfigured: () => true,
      loadDbDevices: async () => [{ id: 1, uniqueId: "DEV-1" }],
      loadApiDevices: () => [{ id: 1, uniqueId: "DEV-1" }],
      refreshApiDevices: async () => {
        throw new Error("não deveria sincronizar");
      },
    });

    assert.equal(result.checked, true);
    assert.equal(result.refreshed, false);
  });

  it("refaz sincronização quando há divergência entre API e banco", async () => {
    let refreshCount = 0;
    const result = await ensureTraccarRegistryConsistency({
      dbConfigured: () => true,
      loadDbDevices: async () => [
        { id: 1, uniqueId: "DEV-1" },
        { id: 2, uniqueId: "DEV-2" },
      ],
      loadApiDevices: () => [{ id: 2, uniqueId: "DEV-2" }],
      refreshApiDevices: async () => {
        refreshCount += 1;
      },
    });

    assert.equal(result.checked, true);
    assert.equal(result.refreshed, true);
    assert.deepEqual(result.missingInApi, ["1"]);
    assert.deepEqual(result.missingInDb, []);
    assert.deepEqual(result.uniqueMismatch, ["DEV-1"]);
    assert.equal(refreshCount, 1);
  });
});
