import assert from "node:assert/strict";
import { after, before, it } from "node:test";

import app from "../app.js";
import { signSession } from "../middleware/auth.js";
import { requestApp } from "./app-request.js";

let originalFetch;

before(async () => {
  const xdmBaseUrl = "http://xdm.local";

  process.env.XDM_AUTH_URL = `${xdmBaseUrl}/oauth/token`;
  process.env.XDM_BASE_URL = xdmBaseUrl;
  process.env.XDM_CLIENT_ID = "client";
  process.env.XDM_CLIENT_SECRET = "secret";
  process.env.XDM_DEALER_ID = "123";
  process.env.XDM_CONFIG_NAME = "Config XDM";
  process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID = "1234";
  process.env.XDM_DIAGNOSTICS_ENABLED = "true";

  originalFetch = global.fetch;
  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === "/oauth/token" && String(init.method || "GET").toUpperCase() === "POST") {
      return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };
});

after(() => {
  if (originalFetch) {
    global.fetch = originalFetch;
  }
});

it("GET /api/admin/xdm/diagnostics retorna tokenOk true", async () => {
  const token = signSession({ id: "admin-1", role: "admin", clientId: "client-1" });
  const response = await requestApp(app, {
    url: "/api/admin/xdm/diagnostics",
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.tokenOk, true);
  assert.equal(body.clientId, "client");
  assert.equal(body.overrideId, "1234");
  assert.equal(body.overrideIdValid, true);
});
