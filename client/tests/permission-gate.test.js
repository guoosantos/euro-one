import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import { createPermissionResolver } from "../src/lib/permissions/permission-gate.js";

const setTenantIdCalls = [];
const apiClient = {
  get: async () => {
    const error = new Error("Forbidden");
    error.response = { status: 403 };
    throw error;
  },
};
const tenantUser = { role: "user", clientId: "client-1" };
const setTenantId = (value) => setTenantIdCalls.push(value);
const useTenantHook = () => ({
  user: tenantUser,
  role: "user",
  tenantId: "stale-tenant",
  setTenantId,
  activeMirrorPermissionGroupId: null,
});

const usePermissionResolver = createPermissionResolver({ apiClient, useTenantHook });

function PermissionProbe() {
  const { getPermission } = usePermissionResolver();
  const permission = getPermission({ menuKey: "menu", pageKey: "page" });
  return React.createElement("div", {
    "data-level": permission.level,
    "data-access": permission.hasAccess ? "true" : "false",
  });
}

test("usePermissionResolver corrige tenantId stale sem travar em acesso negado", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });

  const container = document.getElementById("root");
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(PermissionProbe));
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  assert.equal(setTenantIdCalls.length, 1);
  assert.equal(setTenantIdCalls[0], "client-1");
  assert.equal(container.firstChild?.getAttribute("data-level"), "FULL");

  root.unmount();
});
