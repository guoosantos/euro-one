import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { initStorage } from "../services/storage.js";
import { clearOverrideElements, getOverrideElement } from "../models/xdm-override-element.js";
import { resolveGeozoneGroupOverrideElementId } from "../services/xdm/xdm-override-resolver.js";

let filterCalls = 0;

function sendJson(res, payload, status = 200) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

function createMockServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(404);
        res.end();
        return;
      }

      if (req.url === "/oauth/token" && req.method === "POST") {
        sendJson(res, { access_token: "token", expires_in: 3600 });
        return;
      }

      if (req.url === "/api/external/v1/AdminTemplates/filter" && req.method === "POST") {
        filterCalls += 1;
        sendJson(res, {
          results: [
            {
              id: 99,
              name: "Config XDM",
              settings: {
                groups: [
                  {
                    key: "geoGroup",
                    userElementId: 8236818,
                  },
                ],
              },
            },
          ],
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const previousEnv = {
  XDM_AUTH_URL: process.env.XDM_AUTH_URL,
  XDM_BASE_URL: process.env.XDM_BASE_URL,
  XDM_CLIENT_ID: process.env.XDM_CLIENT_ID,
  XDM_CLIENT_SECRET: process.env.XDM_CLIENT_SECRET,
  XDM_DEALER_ID: process.env.XDM_DEALER_ID,
  XDM_CONFIG_NAME: process.env.XDM_CONFIG_NAME,
  XDM_GEOZONE_GROUP_OVERRIDE_KEY: process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY,
  XDM_GEOZONE_GROUP_OVERRIDE_ID: process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID,
};

const server = await createMockServer();
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

process.env.NODE_ENV = "test";
process.env.XDM_AUTH_URL = `${baseUrl}/oauth/token`;
process.env.XDM_BASE_URL = baseUrl;
process.env.XDM_CLIENT_ID = "client";
process.env.XDM_CLIENT_SECRET = "secret";
process.env.XDM_DEALER_ID = "10";
process.env.XDM_CONFIG_NAME = "Config XDM";
process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY = "geoGroup";
delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID;

await initStorage();

test.after(() => {
  server.close();
  Object.entries(previousEnv).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
});

test("resolveGeozoneGroupOverrideElementId descobre e persiste userElementId", async () => {
  filterCalls = 0;
  clearOverrideElements();

  const first = await resolveGeozoneGroupOverrideElementId({ correlationId: "test-override-1" });
  const second = await resolveGeozoneGroupOverrideElementId({ correlationId: "test-override-2" });

  assert.equal(first.overrideId, 8236818);
  assert.equal(second.overrideId, 8236818);
  assert.equal(filterCalls, 1);

  const stored = getOverrideElement({
    dealerId: process.env.XDM_DEALER_ID,
    configName: process.env.XDM_CONFIG_NAME,
    overrideKey: "geoGroup",
  });
  assert.equal(stored?.userElementId, 8236818);
});
