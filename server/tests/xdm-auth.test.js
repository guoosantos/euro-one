import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import XdmClient from "../services/xdm/xdm-client.js";

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
        sendJson(
          res,
          { error: "invalid_client", error_description: "Client not allowed" },
          401,
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

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

const server = await createMockServer();
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

test.after(() => server.close());

test("XdmClient mapeia invalid_client com mensagem clara", async () => {
  await withEnv(
    {
      XDM_AUTH_URL: `${baseUrl}/oauth/token`,
      XDM_BASE_URL: baseUrl,
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
  );
});
