import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import app from "../app.js";

async function withServer(fn) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("geocode reverse retorna fallback sem 502 quando o provider falha", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    if (url && url.includes("nominatim.openstreetmap.org")) {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: "down" }),
      };
    }
    return originalFetch(input, init);
  };

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/geocode/reverse?lat=-23.55&lng=-46.63`);
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.match(payload.shortAddress, /Sem endereço/);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("geocode search retorna erro amigável sem 502 quando o provider falha", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    if (url && url.includes("nominatim.openstreetmap.org")) {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: "down" }),
      };
    }
    return originalFetch(input, init);
  };

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/geocode/search?q=Rua%20Teste&limit=5`);
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.deepEqual(payload.data, []);
      assert.ok(payload.error?.message);
    });
  } finally {
    global.fetch = originalFetch;
  }
});
