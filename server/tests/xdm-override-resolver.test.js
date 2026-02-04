import assert from "node:assert/strict";
import test from "node:test";

function withMockedFetch({ templateName, categoryPayload }, fn) {
  const originalFetch = global.fetch;
  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || "GET").toUpperCase();
    const json = (payload, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

    if (url.pathname === "/oauth/token" && method === "POST") {
      return json({ access_token: "token", expires_in: 3600 });
    }
    if (url.pathname === "/api/external/v1/userTemplates/filter" && method === "POST") {
      return json({ results: [{ id: 77, name: templateName }] });
    }
    if (url.pathname === "/api/external/v1/userTemplates/77/GetTree" && method === "GET") {
      return json({ categories: [{ id: 900 }] });
    }
    if (url.pathname === "/api/external/v1/userTemplates/77/categories/900" && method === "GET") {
      return json(categoryPayload);
    }
    return json({ message: "Not Found" }, 404);
  };

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      global.fetch = originalFetch;
    });
}

function restoreEnv(originalEnv) {
  Object.keys(process.env).forEach((key) => {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  });
  Object.entries(originalEnv).forEach(([key, value]) => {
    process.env[key] = value;
  });
}

function restoreEnvKeys(originalEnv) {
  Object.entries(originalEnv).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
}

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
    restoreEnvKeys(originalEnv);
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
    restoreEnvKeys(originalEnv);
  }
});

test("fallback para template XG37 EURO usa Itinerario/Alvos/Entrada", async () => {
  const originalEnv = {
    XDM_CONFIG_NAME: process.env.XDM_CONFIG_NAME,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY_TARGETS: process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY_TARGETS,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY_ENTRY: process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY_ENTRY,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY_ITINERARY: process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY_ITINERARY,
    XDM_GEOZONE_GROUP_OVERRIDE_KEY: process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY,
    XDM_GEOZONE_GROUP_OVERRIDE_ID: process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID,
  };

  process.env.XDM_CONFIG_NAME = "XG37 common settings V5 - EURO";
  delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY_TARGETS;
  delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY_ENTRY;
  delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY_ITINERARY;
  delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY;
  delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID;

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
    restoreEnvKeys(originalEnv);
  }
});

test("env por role ignora lista de overrides", async () => {
  const originalEnv = {
    XDM_GEOZONE_GROUP_OVERRIDE_ID_ITINERARY: process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID_ITINERARY,
    XDM_GEOZONE_GROUP_OVERRIDE_ID_TARGETS: process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID_TARGETS,
    XDM_GEOZONE_GROUP_OVERRIDE_ID_ENTRY: process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID_ENTRY,
    XDM_GEOZONE_GROUP_OVERRIDE_IDS: process.env.XDM_GEOZONE_GROUP_OVERRIDE_IDS,
  };

  process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID_ITINERARY = "8236818";
  delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID_TARGETS;
  delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID_ENTRY;
  process.env.XDM_GEOZONE_GROUP_OVERRIDE_IDS = "111,222,333";

  try {
    const { getGeozoneGroupOverrideConfigByRole } = await import(
      `../services/xdm/xdm-override-resolver.js?test=${Date.now()}`
    );

    const itineraryConfig = getGeozoneGroupOverrideConfigByRole("itinerary");
    const targetsConfig = getGeozoneGroupOverrideConfigByRole("targets");

    assert.equal(itineraryConfig.overrideId, "8236818");
    assert.equal(itineraryConfig.overrideIdSource, "env-role");
    assert.equal(targetsConfig.overrideId, null);
  } finally {
    restoreEnvKeys(originalEnv);
  }
});

test("resolve overrides do XG37 EURO usa fallback por índice por role", async () => {
  const originalEnv = { ...process.env };
  const templateName = "XG37 common settings V5 - EURO";
  const categoryPayload = {
    id: 900,
    name: "Geofencing",
    elementGroupTemplate: {
      elements: [
        { id: 101, name: "Geozone Group 1" },
        { id: 102, name: "Geozone Group 2" },
        { id: 103, name: "Geozone Group 3" },
      ],
    },
    userElementGroups: [],
    subCategories: [],
  };

  const baseUrl = "http://xdm.local";

  process.env.NODE_ENV = "test";
  process.env.XDM_AUTH_URL = `${baseUrl}/oauth/token`;
  process.env.XDM_BASE_URL = baseUrl;
  process.env.XDM_CLIENT_ID = "client";
  process.env.XDM_CLIENT_SECRET = "secret";
  process.env.XDM_DEALER_ID = "10";
  process.env.XDM_CONFIG_NAME = templateName;
  delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID;
  delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY;
  delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID_TARGETS;
  delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID_ENTRY;

  try {
    await withMockedFetch({ templateName, categoryPayload }, async () => {
      const storageModule = await import("../services/storage.js");
      storageModule.__resetStorageForTests();

      const { resolveGeozoneGroupOverrideConfigs } = await import(
        `../services/xdm/xdm-override-resolver.js?test=${Date.now()}`
      );
      const configs = await resolveGeozoneGroupOverrideConfigs({ correlationId: "test-xg37-fallback" });

      assert.equal(configs.itinerary.overrideId, "101");
      assert.equal(configs.targets.overrideId, "102");
      assert.equal(configs.entry.overrideId, "103");
      assert.equal(configs.itinerary.discoveryMode, "by_index");
    });
  } finally {
    restoreEnv(originalEnv);
  }
});

test("falha ao resolver override retorna detalhes do role", async () => {
  const originalEnv = { ...process.env };
  const templateName = "XG37 common settings V5 - EURO - FAIL";
  const categoryPayload = {
    id: 900,
    name: "Geofencing",
    elementGroupTemplate: { elements: [] },
    userElementGroups: [],
    subCategories: [],
  };

  const baseUrl = "http://xdm.local";

  process.env.NODE_ENV = "test";
  process.env.XDM_AUTH_URL = `${baseUrl}/oauth/token`;
  process.env.XDM_BASE_URL = baseUrl;
  process.env.XDM_CLIENT_ID = "client";
  process.env.XDM_CLIENT_SECRET = "secret";
  process.env.XDM_DEALER_ID = "10";
  process.env.XDM_CONFIG_NAME = templateName;
  delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID;
  delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY;

  try {
    await withMockedFetch({ templateName, categoryPayload }, async () => {
      const storageModule = await import("../services/storage.js");
      storageModule.__resetStorageForTests();

      const { resolveGeozoneGroupOverrideConfigs } = await import(
        `../services/xdm/xdm-override-resolver.js?test=${Date.now()}`
      );
      let caught;
      try {
        await resolveGeozoneGroupOverrideConfigs({ correlationId: "test-xg37-failure" });
      } catch (error) {
        caught = error;
      }
      assert.ok(caught);
      assert.equal(caught.code, "XDM_OVERRIDE_VALIDATION_FAILED");
      assert.equal(caught.status, 400);
      assert.equal(caught.details?.role, "itinerary");
      assert.equal(caught.details?.configName, templateName);
      assert.ok(Array.isArray(caught.details?.attemptedOverrideKeys));
      assert.ok(Array.isArray(caught.details?.roles));
    });
  } finally {
    restoreEnv(originalEnv);
  }
});
