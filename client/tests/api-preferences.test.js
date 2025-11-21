import test from "node:test";
import assert from "node:assert";
import http from "node:http";

import app from "../server/app.js";
import { signSession } from "../server/middleware/auth.js";
import { resetUserPreferences } from "../server/models/user-preferences.js";

const token = signSession({ id: "user-1", role: "admin" });

function startTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

function closeTestServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

test.beforeEach(() => {
  resetUserPreferences("user-1");
});

test("GET /api/user/preferences retorna payload padrão", async () => {
  const server = await startTestServer();
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${base}/api/user/preferences`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(body.preferences.userId, "user-1");
    assert.strictEqual(body.preferences.monitoringTableColumns, null);
  } finally {
    await closeTestServer(server);
  }
});

test("PUT /api/user/preferences persiste colunas e filtros", async () => {
  const server = await startTestServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const payload = {
    monitoringTableColumns: { visible: { speed: false, plate: true }, order: ["plate", "speed"] },
    monitoringDefaultFilters: { mode: "online" },
  };

  try {
    const response = await fetch(`${base}/api/user/preferences`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json();

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(body.preferences.monitoringTableColumns.visible.speed, false);
    assert.deepStrictEqual(body.preferences.monitoringTableColumns.order, ["plate", "speed"]);
    assert.deepStrictEqual(body.preferences.monitoringDefaultFilters.mode, "online");
  } finally {
    await closeTestServer(server);
  }
});
