import test from "node:test";
import assert from "node:assert";
import { requestApp } from "./app-request.js";

import { resetUserPreferences } from "../../server/models/user-preferences.js";
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

  ensureTestUser({ id: "user-1", role: "admin", clientId: "client-1", attributes: {} });

  return { serverApp, signSession };
};

test.beforeEach(() => {
  resetUserPreferences("user-1");
});

test("GET /api/user/preferences retorna payload padrão", async () => {
  const { signSession, serverApp } = await ensureServer();
  const token = signSession({ id: "user-1", role: "admin" });

  const response = await requestApp(serverApp, {
    url: "/api/user/preferences",
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();

  assert.strictEqual(response.status, 200);
  assert.strictEqual(body.preferences.userId, "user-1");
  assert.strictEqual(body.preferences.monitoringTableColumns, null);
});

test("PUT /api/user/preferences persiste colunas e filtros", async () => {
  const { signSession, serverApp } = await ensureServer();
  const token = signSession({ id: "user-1", role: "admin" });
  const payload = {
    monitoringTableColumns: { visible: { speed: false, plate: true }, order: ["plate", "speed"] },
    monitoringDefaultFilters: { mode: "online" },
  };

  const response = await requestApp(serverApp, {
    method: "PUT",
    url: "/api/user/preferences",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: payload,
  });
  const body = await response.json();

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(body.preferences.monitoringTableColumns.visible.speed, false);
  assert.deepStrictEqual(body.preferences.monitoringTableColumns.order, ["plate", "speed"]);
  assert.deepStrictEqual(body.preferences.monitoringDefaultFilters.mode, "online");
});
