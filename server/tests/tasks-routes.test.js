import assert from "node:assert/strict";
import express from "express";
import { afterEach, describe, it } from "node:test";

import { errorHandler } from "../middleware/error-handler.js";
import tasksRoutes, { __resetTasksRouteMocks, __setTasksRouteMocks } from "../routes/tasks.js";

const user = { id: "user-1", role: "admin", clientId: "tenant-1" };

function buildApp({ listTasks } = {}) {
  const listCalls = [];
  const listTasksMock = listTasks
    ? async (params) => {
        listCalls.push(params);
        return listTasks(params);
      }
    : async (params) => {
        listCalls.push(params);
        return [];
      };

  __setTasksRouteMocks({
    authenticate: (req, _res, next) => {
      req.user = user;
      next();
    },
    resolveClientId: (_req, provided) => provided ?? user.clientId,
    resolveClientIdMiddleware: (req, _res, next) => {
      req.clientId = req.query?.clientId ?? user.clientId;
      next();
    },
    listTasks: listTasksMock,
  });

  const app = express();
  app.use(express.json());
  app.use("/api/core", tasksRoutes);
  app.use(errorHandler);
  return { app, listCalls };
}

async function callApp(app, path, options = {}) {
  const server = app.listen(0);
  const url = new URL(path, `http://127.0.0.1:${server.address().port}`);
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  server.close();
  return { status: response.status, data };
}

afterEach(() => {
  __resetTasksRouteMocks();
});

describe("Tasks routes", () => {
  it("rejeita clientId inválido", async () => {
    const { app, listCalls } = buildApp();

    const { status, data } = await callApp(app, "/api/core/tasks?clientId=invalid");

    assert.equal(status, 400);
    assert.equal(data.message, "clientId inválido");
    assert.equal(listCalls.length, 0);
  });

  it("rejeita datas inválidas", async () => {
    const { app, listCalls } = buildApp();
    const clientId = "0e4779cf-1234-4c12-9cb2-2bbbf12e2fb9";

    const { status, data } = await callApp(app, `/api/core/tasks?clientId=${clientId}&from=not-a-date`);

    assert.equal(status, 400);
    assert.equal(data.message, "Parâmetro from inválido");
    assert.equal(listCalls.length, 0);
  });

  it("lista tasks com clientId válido", async () => {
    const clientId = "0e4779cf-1234-4c12-9cb2-2bbbf12e2fb9";
    const task = { id: "task-1", clientId };
    const { app, listCalls } = buildApp({ listTasks: async () => [task] });

    const { status, data } = await callApp(app, `/api/core/tasks?clientId=${clientId}`);

    assert.equal(status, 200);
    assert.deepEqual(data.tasks, [task]);
    assert.equal(listCalls.length, 1);
  });
});
