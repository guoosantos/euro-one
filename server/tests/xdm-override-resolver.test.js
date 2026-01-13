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

test("override global não vaza para targets/entry", async () => {
  const originalEnv = {
    XDM_GEOZONE_GROUP_OVERRIDE_ID: process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY: process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY,
    XDM_GEOZONE_GROUP_OVERRIDE_ID_TARGETS: process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID_TARGETS,
    XDM_GEOZONE_GROUP_OVERRIDE_ID_ENTRY: process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID_ENTRY,
  };

  process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID = "1234";
  process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY = "geoGroup";
  delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID_TARGETS;
  delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID_ENTRY;

  try {
    const { getGeozoneGroupOverrideConfigByRole } = await import(
      `../services/xdm/xdm-override-resolver.js?test=${Date.now()}`
    );

    const targetsConfig = getGeozoneGroupOverrideConfigByRole("targets");
    const entryConfig = getGeozoneGroupOverrideConfigByRole("entry");

    assert.equal(targetsConfig.overrideId, null);
    assert.equal(targetsConfig.overrideKey, "geoGroup2");
    assert.equal(entryConfig.overrideId, null);
    assert.equal(entryConfig.overrideKey, "geoGroup3");
  } finally {
    process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID = originalEnv.XDM_GEOZONE_GROUP_OVERRIDE_ID;
    process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY = originalEnv.XDM_GEOZONE_GROUP_OVERRIDE_KEY;
    process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID_TARGETS = originalEnv.XDM_GEOZONE_GROUP_OVERRIDE_ID_TARGETS;
    process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID_ENTRY = originalEnv.XDM_GEOZONE_GROUP_OVERRIDE_ID_ENTRY;
  }
});

test("fallback para template XG37 EURO usa Itinerario/Alvos/Entrada", async () => {
  const originalEnv = {
    XDM_CONFIG_NAME: process.env.XDM_CONFIG_NAME,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY_TARGETS: process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY_TARGETS,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY_ENTRY: process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY_ENTRY,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY_ITINERARY: process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY_ITINERARY,
  };

  process.env.XDM_CONFIG_NAME = "XG37 common settings V5 - EURO";
  delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY_TARGETS;
  delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY_ENTRY;
  delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY_ITINERARY;

  try {
    const { getGeozoneGroupOverrideConfigByRole } = await import(
      `../services/xdm/xdm-override-resolver.js?test=${Date.now()}`
    );

    const itineraryConfig = getGeozoneGroupOverrideConfigByRole("itinerary");
    const targetsConfig = getGeozoneGroupOverrideConfigByRole("targets");
    const entryConfig = getGeozoneGroupOverrideConfigByRole("entry");

    assert.equal(itineraryConfig.overrideKey, "Itinerario");
    assert.equal(targetsConfig.overrideKey, "Alvos");
    assert.equal(entryConfig.overrideKey, "Entrada");
  } finally {
    process.env.XDM_CONFIG_NAME = originalEnv.XDM_CONFIG_NAME;
    process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY_TARGETS = originalEnv.XDM_GEOZONE_GROUP_OVERRIDE_KEY_TARGETS;
    process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY_ENTRY = originalEnv.XDM_GEOZONE_GROUP_OVERRIDE_KEY_ENTRY;
    process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY_ITINERARY = originalEnv.XDM_GEOZONE_GROUP_OVERRIDE_KEY_ITINERARY;
  }
});
