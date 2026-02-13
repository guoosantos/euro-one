import test from "node:test";
import assert from "node:assert";
import { requestApp } from "./app-request.js";

import { loadCollection, saveCollection } from "../../server/services/storage.js";

let serverApp;
let signSession;

const ensureTestUser = (user) => {
  const users = loadCollection("users", []);
  const next = Array.isArray(users) ? users.filter((item) => String(item?.id) !== String(user.id)) : [];
  next.push(user);
  saveCollection("users", next);
};

const ensureServer = async () => {
  process.env.TRACCAR_ADMIN_USER ??= "admin";
  process.env.TRACCAR_ADMIN_PASSWORD ??= "admin";
  process.env.TRACCAR_URL ??= "http://localhost";

  if (!serverApp || !signSession) {
    ({ default: serverApp } = await import("../../server/app.js"));
    ({ signSession } = await import("../../server/middleware/auth.js"));
  }

  ensureTestUser({ id: "user-2", role: "admin", clientId: "client-1", attributes: {} });

  return { serverApp, signSession };
};

test("GET /api/devices retorna lista do Traccar", async () => {
  const { signSession, serverApp } = await ensureServer();
  const token = signSession({ id: "user-2", role: "admin" });
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ devices: [{ id: 1, name: "Truck" }] }), { status: 200 });

  try {
    const response = await requestApp(serverApp, {
      url: "/api/devices",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json();

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(body.devices, [{ id: 1, name: "Truck" }]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("GET /api/devices sinaliza indisponibilidade do Traccar", async () => {
  const { signSession, serverApp } = await ensureServer();
  const token = signSession({ id: "user-2", role: "admin" });
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ message: "Traccar offline" }), { status: 503 });

  try {
    const response = await requestApp(serverApp, {
      url: "/api/devices",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json();

    assert.strictEqual(response.status, 503);
    assert.strictEqual(body.code, "TRACCAR_UNAVAILABLE");
    assert.match(body.message, /Não foi possível consultar o Traccar/);
  } finally {
    global.fetch = originalFetch;
  }
});
