import assert from "node:assert/strict";
import express from "express";
import { afterEach, describe, it } from "node:test";

import { errorHandler } from "../middleware/error-handler.js";
import crmRoutes, { __resetCrmRouteMocks, __setCrmRouteMocks } from "../routes/crm.js";

const user = { id: "user-1", role: "admin", clientId: "tenant-1" };

function stubCrmDeps() {
  const createDealCalls = [];
  const handleDealWonCalls = [];

  __setCrmRouteMocks({
    authenticate: (req, _res, next) => {
      req.user = user;
      next();
    },
    resolveClientId: () => user.clientId,
    resolveClientIdMiddleware: (req, _res, next) => {
      req.clientId = user.clientId;
      next();
    },
    listCrmClients: async () => [],
    createCrmClient: async (payload) => ({ id: "client-1", ...payload }),
    getCrmClient: async (id) => ({ id, name: "Cliente" }),
    updateCrmClient: async (id, payload) => ({ id, ...payload }),
    addCrmContact: (id, payload) => ({ id: `contact-${id}`, ...payload }),
    listCrmClientsWithUpcomingEvents: () => [],
    listCrmContacts: () => [],
    handleDealWon: (deal) => handleDealWonCalls.push(deal),
    listPipelineStages: async () => [],
    listDeals: async () => [],
    listActivities: async () => [],
    listReminders: async () => [],
    createActivity: async (payload) => ({ ...payload, id: "act-1" }),
    createReminder: async (payload) => ({ ...payload, id: "rem-1" }),
    createDeal: async (payload) => {
      createDealCalls.push(payload);
      return { id: "deal-1", ...payload };
    },
    moveDealToStage: async (id, stageId, { onWon } = {}) => {
      const deal = { id, crmClientId: user.clientId, title: "Teste", stageId };
      if (stageId === "won") {
        onWon?.(deal);
      }
      return deal;
    },
    listCrmTags: () => [],
    createCrmTag: (payload) => ({ id: "tag-1", ...payload }),
    deleteCrmTag: () => null,
  });

  return { createDealCalls, handleDealWonCalls };
}

function buildApp() {
  const { createDealCalls, handleDealWonCalls } = stubCrmDeps();
  const app = express();
  app.use(express.json());
  app.use("/api/crm", crmRoutes);
  app.use(errorHandler);
  return { app, createDealCalls, handleDealWonCalls };
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
  __resetCrmRouteMocks();
});

describe("CRM routes", () => {
  it("cria deal já associado ao tenant atual", async () => {
    const { app, createDealCalls } = buildApp();

    const { status, data } = await callApp(app, "/api/crm/deals", {
      method: "POST",
      body: JSON.stringify({ title: "Negócio", value: 5000 }),
    });

    assert.equal(status, 201);
    assert.equal(data.deal.id, "deal-1");
    assert.equal(createDealCalls[0].clientId, "tenant-1");
  });

  it("aciona automação ao mover deal para estágio ganho", async () => {
    const { app, handleDealWonCalls } = buildApp();

    const { status, data } = await callApp(app, "/api/crm/deals/deal-99/stage", {
      method: "PUT",
      body: JSON.stringify({ stageId: "won" }),
    });

    assert.equal(status, 200);
    assert.equal(data.deal.id, "deal-99");
    assert.equal(handleDealWonCalls.length, 1);
    assert.equal(handleDealWonCalls[0].id, "deal-99");
  });
});
