import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";

async function createDiscoveryServer({ templateName, categoryPayload }) {
  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.writeHead(404);
      res.end();
      return;
    }

    if (req.url === "/oauth/token" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ access_token: "token", expires_in: 3600 }));
      return;
    }

    if (req.url === "/api/external/v1/userTemplates/filter" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results: [{ id: 77, name: templateName }] }));
      return;
    }

    if (req.url === "/api/external/v1/userTemplates/77/GetTree" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ categories: [{ id: 900 }] }));
      return;
    }

    if (req.url === "/api/external/v1/userTemplates/77/categories/900" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(categoryPayload));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
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
    process.env.XDM_CONFIG_NAME = originalEnv.XDM_CONFIG_NAME;
    process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY_TARGETS = originalEnv.XDM_GEOZONE_GROUP_OVERRIDE_KEY_TARGETS;
    process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY_ENTRY = originalEnv.XDM_GEOZONE_GROUP_OVERRIDE_KEY_ENTRY;
    process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY_ITINERARY = originalEnv.XDM_GEOZONE_GROUP_OVERRIDE_KEY_ITINERARY;
    process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY = originalEnv.XDM_GEOZONE_GROUP_OVERRIDE_KEY;
    process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID = originalEnv.XDM_GEOZONE_GROUP_OVERRIDE_ID;
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

  const server = await createDiscoveryServer({ templateName, categoryPayload });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

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
  } finally {
    server.close();
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

  const server = await createDiscoveryServer({ templateName, categoryPayload });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

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
  } finally {
    server.close();
    restoreEnv(originalEnv);
  }
});
