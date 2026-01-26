import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import { createPermissionResolver } from "../src/lib/permissions/permission-gate.js";

const tenantUser = { role: "user", clientId: "client-1" };
const useTenantHook = () => ({
  user: tenantUser,
  role: "user",
  permissionContext: {
    permissions: {
      menu: {
        page: { visible: true, access: "read" },
      },
    },
    isFull: false,
    permissionGroupId: "group-1",
  },
  permissionLoading: false,
});

const usePermissionResolver = createPermissionResolver({ useTenantHook });

function PermissionProbe() {
  const { getPermission } = usePermissionResolver();
  const permission = getPermission({ menuKey: "menu", pageKey: "page" });
  return React.createElement("div", {
    "data-level": permission.level,
    "data-access": permission.hasAccess ? "true" : "false",
  });
}

test("usePermissionResolver respeita o contexto de permissões carregado no tenant", async () => {
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

  assert.equal(container.firstChild?.getAttribute("data-level"), "READ_ONLY");
  assert.equal(container.firstChild?.getAttribute("data-access"), "true");

  root.unmount();
});
