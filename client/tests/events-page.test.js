import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";

import { EventsTable } from "../src/pages/EventsTable.js";

const baseColumns = [
  { id: "time", label: "Hora GPS" },
  { id: "device", label: "Veículo" },
  { id: "type", label: "Tipo" },
  { id: "description", label: "Descrição" },
  { id: "address", label: "Endereço" },
];

describe("Events page render", () => {
  it("renderiza estado vazio sem erros", () => {
    const html = renderToString(
      React.createElement(EventsTable, {
        columns: baseColumns,
        rows: [],
        loading: false,
        error: null,
        getWidthStyle: () => ({}),
        onResize: () => {},
        renderCell: () => "—",
      }),
    );

    assert.ok(html.includes("Nenhum evento encontrado"));
  });

  it("renderiza lista com itens sem quebrar", () => {
    const rows = [
      {
        id: "1",
        time: "2025-01-01T10:00:00.000Z",
        device: "Carro 01",
        type: "ignitionOn",
        description: "Ignição ligada",
        address: "Av. Brasil, 100 - Centro, Brasil",
        latitude: -23.55,
        longitude: -46.63,
      },
    ];

    const html = renderToString(
      React.createElement(EventsTable, {
        columns: baseColumns,
        rows,
        loading: false,
        error: null,
        getWidthStyle: () => ({}),
        onResize: () => {},
        renderCell: (columnId, row) => (columnId === "device" ? row.device : row.description || "—"),
      }),
    );

    assert.ok(html.includes("Carro 01"));
    assert.ok(html.includes("Ignição ligada"));
  });
});
