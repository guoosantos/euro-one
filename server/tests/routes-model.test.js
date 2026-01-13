import assert from "node:assert/strict";
import test from "node:test";

import { __resetStorageForTests } from "../services/storage.js";

test("createRoute mantém múltiplas rotas por cliente", async () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";

  try {
    __resetStorageForTests();
    const { createRoute, listRoutes } = await import(`../models/route.js?test=${Date.now()}`);

    await createRoute({ clientId: "client-1", name: "Rota A", points: [[1, 1], [2, 2]] });
    await createRoute({ clientId: "client-1", name: "Rota B", points: [[3, 3], [4, 4]] });
    await createRoute({ clientId: "client-1", name: "Rota C", points: [[5, 5], [6, 6]] });

    const routes = listRoutes({ clientId: "client-1" });
    assert.equal(routes.length, 3);
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});
