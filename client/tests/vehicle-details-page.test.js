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

mock.module("../src/lib/tenant-context.jsx", {
  useTenant: () => ({
    tenantId: "client-1",
    user: { role: "admin", clientId: "client-1", activeMirrorOwnerClientId: null },
  }),
});

mock.module("../src/lib/hooks/useTraccarDevices.js", {
  useTraccarDevices: () => ({
    getDevicePosition: () => null,
    getDeviceStatus: () => "offline",
    getDeviceLastSeen: () => "—",
    getDeviceCoordinates: () => "—",
  }),
});

mock.module("../src/lib/coreApi.js", {
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

mock.module("../src/lib/safe-api.js", {
  default: {
    get: async () => ({ data: {} }),
  },
});

mock.module("../src/components/ui/ConfirmDialogProvider.jsx", {
  useConfirmDialog: () => ({ confirmDelete: async () => true }),
});

mock.module("../src/lib/hooks/useAdminGeneralAccess.js", {
  default: () => ({ isAdminGeneral: true }),
});

mock.module("../src/lib/hooks/usePageToast.js", {
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

  const editButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "Editar",
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
});
