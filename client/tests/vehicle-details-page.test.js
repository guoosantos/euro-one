import test, { mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { JSDOM } from "jsdom";

const vehicleFixture = {
  id: "veh-1",
  plate: "ABC-1234",
  model: "Modelo X",
  type: "car",
  status: "ativo",
  clientId: "client-1",
  attributes: { vehicleAttributes: [] },
};

const mockModule = mock.module ?? ((specifier, exports) => {
  const registry = globalThis.__mockModules || (globalThis.__mockModules = new Map());
  const resolved = new URL(specifier, import.meta.url).href;
  registry.set(resolved, exports);
});

mockModule("../src/lib/tenant-context.jsx", {
  useTenant: () => ({
    tenantId: "client-1",
    user: { role: "admin", clientId: "client-1", activeMirrorOwnerClientId: null },
  }),
});

mockModule("../src/lib/hooks/useTraccarDevices.js", {
  useTraccarDevices: () => ({
    getDevicePosition: () => null,
    getDeviceStatus: () => "offline",
    getDeviceLastSeen: () => "—",
    getDeviceCoordinates: () => "—",
  }),
});

mockModule("../src/lib/coreApi.js", {
  CoreApi: {
    listVehicles: async () => [vehicleFixture],
    listDevices: async () => [],
    listChips: async () => [],
    listVehicleAttributes: async () => [],
    updateVehicle: async () => ({}),
    searchDevices: async () => ({ devices: [] }),
    searchChips: async () => ({ chips: [] }),
    linkDeviceToVehicle: async () => ({}),
    unlinkDeviceFromVehicle: async () => ({}),
    updateChip: async () => ({}),
    deleteVehicle: async () => ({}),
  },
});

mockModule("../src/lib/safe-api.js", {
  default: {
    get: async () => ({ data: {} }),
  },
});

mockModule("../src/components/ui/ConfirmDialogProvider.jsx", {
  useConfirmDialog: () => ({ confirmDelete: async () => true }),
});

mockModule("../src/lib/hooks/useAdminGeneralAccess.js", {
  default: () => ({ isAdminGeneral: true }),
});

mockModule("../src/lib/hooks/usePageToast.js", {
  usePageToast: () => ({ toast: null, showToast: () => {} }),
  default: () => ({ toast: null, showToast: () => {} }),
});

const { default: VehicleDetailsPage } = await import("../src/pages/VehicleDetailsPage.jsx");

test("VehicleDetailsPage permite abrir e salvar edição sem quebrar", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: "http://localhost/vehicles/veh-1",
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.navigator = dom.window.navigator;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(String(url), "http://localhost");
    const path = target.pathname;
    const method = String(init.method || "GET").toUpperCase();

    const json = (payload, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    if (path.endsWith("/api/core/vehicles") && method === "GET") {
      return json({ vehicles: [vehicleFixture] });
    }
    if (path.includes("/api/core/vehicles/") && method !== "GET") {
      return json({ ok: true });
    }
    if (path.endsWith("/api/core/devices")) {
      return json({ devices: [] });
    }
    if (path.endsWith("/api/core/chips")) {
      return json({ chips: [] });
    }
    if (path.endsWith("/api/core/vehicle-attributes")) {
      return json({ data: [] });
    }
    if (path.endsWith("/api/clients")) {
      return json({ clients: [] });
    }
    return json({});
  };
  globalThis.__tenantOverride = {
    tenantId: "client-1",
    user: { role: "admin", clientId: "client-1", activeMirrorOwnerClientId: null },
    role: "admin",
    tenants: [],
    permissionContext: { permissions: null, isFull: true, permissionGroupId: null },
    permissionLoading: false,
    isGlobalAdmin: true,
    setTenantId: () => {},
  };

  const container = document.getElementById("root");
  const root = createRoot(container);

  await act(async () => {
    root.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/vehicles/veh-1"] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, { path: "/vehicles/:id", element: React.createElement(VehicleDetailsPage) }),
        ),
      ),
    );
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const waitFor = async (predicate, { timeout = 250, interval = 25 } = {}) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = predicate();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    return null;
  };

  const editButton = await waitFor(() =>
    Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Editar",
    ),
  );
  assert.ok(editButton, "Botão de edição deve estar disponível");

  await act(async () => {
    editButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });

  const submitButton = container.querySelector("button[type='submit']");
  assert.ok(submitButton, "Botão de salvar deve estar disponível");

  await act(async () => {
    submitButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });

  root.unmount();
  dom.window.close();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.navigator;
  delete globalThis.__tenantOverride;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.fetch = originalFetch;
});
