import assert from "node:assert/strict";
import http from "node:http";
import { after, before, it } from "node:test";
import { once } from "node:events";

import app from "../app.js";
import { signSession } from "../middleware/auth.js";

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

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

let xdmServer;
let server;
let baseUrl;

before(async () => {
  xdmServer = await createMockServer();
  const { port } = xdmServer.address();
  const xdmBaseUrl = `http://127.0.0.1:${port}`;

  process.env.XDM_AUTH_URL = `${xdmBaseUrl}/oauth/token`;
  process.env.XDM_BASE_URL = xdmBaseUrl;
  process.env.XDM_CLIENT_ID = "client";
  process.env.XDM_CLIENT_SECRET = "secret";
  process.env.XDM_DEALER_ID = "123";
  process.env.XDM_CONFIG_NAME = "Config XDM";
  process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY = "geoGroup";
  process.env.XDM_DIAGNOSTICS_ENABLED = "true";

  server = app.listen(0);
  await once(server, "listening");
  const { port: appPort } = server.address();
  baseUrl = `http://127.0.0.1:${appPort}`;
});

after(() => {
  if (server) server.close();
  if (xdmServer) xdmServer.close();
});

it("GET /api/admin/xdm/diagnostics retorna tokenOk true", async () => {
  const token = signSession({ id: "admin-1", role: "admin", clientId: "client-1" });
  const response = await fetch(`${baseUrl}/api/admin/xdm/diagnostics`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.tokenOk, true);
  assert.equal(body.clientId, "client");
  assert.equal(body.overrideKey, "geoGroup");
});
