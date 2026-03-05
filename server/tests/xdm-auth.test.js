import assert from "node:assert/strict";
import test from "node:test";

import XdmClient from "../services/xdm/xdm-client.js";

function withEnv(pairs, fn) {
  const previous = {};
  Object.keys(pairs).forEach((key) => {
    previous[key] = process.env[key];
    if (pairs[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = pairs[key];
    }
  });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Object.keys(pairs).forEach((key) => {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
      });
    });
}

test("XdmClient mapeia invalid_client com mensagem clara", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(JSON.stringify({ error: "invalid_client", error_description: "Client not allowed" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });

  await withEnv(
    {
      XDM_AUTH_URL: "http://xdm.local/oauth/token",
      XDM_BASE_URL: "http://xdm.local",
      XDM_CLIENT_ID: "client",
      XDM_CLIENT_SECRET: "secret",
    },
    async () => {
      const client = new XdmClient();
      await assert.rejects(
        () => client.getToken({ correlationId: "test-invalid-client" }),
        (error) => {
          assert.equal(error?.code, "invalid_client");
          assert.match(String(error?.message), /invalid_client/i);
          return true;
        },
      );
    },
  ).finally(() => {
    global.fetch = originalFetch;
  });
});
