import test from "node:test";
import assert from "node:assert";
import http from "node:http";

let serverApp;
let signSession;

const ensureServer = async () => {
  process.env.TRACCAR_ADMIN_USER ??= "admin";
  process.env.TRACCAR_ADMIN_PASSWORD ??= "admin";
  process.env.TRACCAR_URL ??= "http://localhost";

  if (!serverApp || !signSession) {
    ({ default: serverApp } = await import("../../server/app.js"));
    ({ signSession } = await import("../../server/middleware/auth.js"));
  }

  return { serverApp, signSession };
};

async function startTestServer() {
  const { serverApp: app } = await ensureServer();
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

function closeTestServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("GET /api/devices retorna lista do Traccar", async () => {
  const { signSession } = await ensureServer();
  const token = signSession({ id: "user-2", role: "admin" });
  const originalFetch = global.fetch;
  const realFetch = originalFetch.bind(globalThis);
  global.fetch = async () => new Response(JSON.stringify({ devices: [{ id: 1, name: "Truck" }] }), { status: 200 });

  const server = await startTestServer();
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await realFetch(`${base}/api/devices`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json();

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(body.devices, [{ id: 1, name: "Truck" }]);
  } finally {
    global.fetch = originalFetch;
    await closeTestServer(server);
  }
});

test("GET /api/devices sinaliza indisponibilidade do Traccar", async () => {
  const { signSession } = await ensureServer();
  const token = signSession({ id: "user-2", role: "admin" });
  const originalFetch = global.fetch;
  const realFetch = originalFetch.bind(globalThis);
  global.fetch = async () => new Response(JSON.stringify({ message: "Traccar offline" }), { status: 503 });

  const server = await startTestServer();
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await realFetch(`${base}/api/devices`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json();

    assert.strictEqual(response.status, 503);
    assert.strictEqual(body.code, "TRACCAR_UNAVAILABLE");
    assert.match(body.message, /Não foi possível consultar o Traccar/);
  } finally {
    global.fetch = originalFetch;
    await closeTestServer(server);
  }
});
