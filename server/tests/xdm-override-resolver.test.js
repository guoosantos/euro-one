import assert from "node:assert/strict";
import test from "node:test";

test("resolveGeozoneGroupOverrideElementId não explode com storage não inicializado", async () => {
  const originalEnv = {
    XDM_GEOZONE_GROUP_OVERRIDE_ID: process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY: process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY,
    XDM_CONFIG_NAME: process.env.XDM_CONFIG_NAME,
    XDM_CONFIG_ID: process.env.XDM_CONFIG_ID,
    XDM_DEALER_ID: process.env.XDM_DEALER_ID,
  };

  process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID = "geoGroup";
  process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY = "geoGroup";
  process.env.XDM_CONFIG_NAME = "Config Teste";
  process.env.XDM_CONFIG_ID = "";
  process.env.XDM_DEALER_ID = "123";

  try {
    const storageModule = await import("../services/storage.js");
    storageModule.__resetStorageForTests();

    const { resolveGeozoneGroupOverrideElementId } = await import(
      `../services/xdm/xdm-override-resolver.js?test=${Date.now()}`
    );

    let caught = null;
    try {
      await resolveGeozoneGroupOverrideElementId({ correlationId: "test-override-resolver" });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught);
    assert.ok(!String(caught?.message || "").includes("Storage não inicializado"));
  } finally {
    process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID = originalEnv.XDM_GEOZONE_GROUP_OVERRIDE_ID;
    process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY = originalEnv.XDM_GEOZONE_GROUP_OVERRIDE_KEY;
    process.env.XDM_CONFIG_NAME = originalEnv.XDM_CONFIG_NAME;
    process.env.XDM_CONFIG_ID = originalEnv.XDM_CONFIG_ID;
    process.env.XDM_DEALER_ID = originalEnv.XDM_DEALER_ID;
  }
});
