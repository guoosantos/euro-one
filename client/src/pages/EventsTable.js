import React from "react";

export function EventsTable({
  columns = [],
  rows = [],
  loading = false,
  error = null,
  renderCell = () => null,
  getWidthStyle = () => ({}),
  onResize = () => {},
} = {}) {
  const content = [];

  if (loading) {
    content.push(
      React.createElement(
        "tr",
        { key: "loading" },
        React.createElement(
          "td",
          { colSpan: columns.length, className: "px-3 py-4 text-center text-sm text-white/60" },
          "Carregando eventos…",
        ),
      ),
    );
  }

  if (!loading && error) {
    content.push(
      React.createElement(
        "tr",
        { key: "error" },
        React.createElement(
          "td",
          { colSpan: columns.length, className: "px-3 py-4 text-center text-sm text-red-300" },
          `Não foi possível carregar os eventos. ${error.message}`,
        ),
      ),
    );
  }

  if (!loading && !error && rows.length === 0) {
    content.push(
      React.createElement(
        "tr",
        { key: "empty" },
        React.createElement(
          "td",
          { colSpan: columns.length, className: "px-3 py-4 text-center text-sm text-white/60" },
          "Nenhum evento encontrado para o período selecionado.",
        ),
      ),
    );
  }

  rows.forEach((row) => {
    content.push(
      React.createElement(
        "tr",
        { key: row.id, className: "hover:bg-white/5" },
        columns.map((column) =>
          React.createElement(
            "td",
            {
              key: column.id,
              style: getWidthStyle(column.id),
              className: "border-r border-white/5 px-3 py-2 text-[11px] text-white/80 last:border-r-0",
            },
            renderCell(column.id, row),
          ),
        ),
      ),
    );
  });

  return React.createElement(
    "div",
    { className: "min-h-0 flex-1 overflow-auto rounded-2xl border border-white/10 bg-[#0b0f17]" },
    React.createElement(
      "table",
      { className: "w-full min-w-full table-fixed border-collapse text-left text-sm", style: { tableLayout: "fixed" } },
      React.createElement(
        "colgroup",
        null,
        columns.map((column) => React.createElement("col", { key: column.id, style: getWidthStyle(column.id) })),
      ),
      React.createElement(
        "thead",
        {
          className:
            "sticky top-0 z-10 border-b border-white/10 bg-[#0f141c] text-left text-[11px] uppercase tracking-[0.12em] text-white/60 shadow-sm",
        },
        React.createElement(
          "tr",
          null,
          columns.map((column) =>
            React.createElement(
              "th",
              {
                key: column.id,
                style: getWidthStyle(column.id),
                className: "relative border-r border-white/5 px-3 py-2 font-semibold last:border-r-0",
                title: column.label,
              },
              React.createElement(
                "div",
                { className: "flex items-center justify-between gap-2 pr-2" },
                React.createElement(
                  "span",
                  { className: "truncate whitespace-nowrap", title: column.label },
                  column.label,
                ),
                React.createElement("span", {
                  role: "separator",
                  tabIndex: 0,
                  onMouseDown: (event) => onResize(column.id, event),
                  onClick: (event) => event.stopPropagation(),
                  className:
                    "ml-auto inline-flex h-5 w-1 cursor-col-resize items-center justify-center rounded bg-white/10 hover:bg-primary/40",
                  title: "Redimensionar coluna",
                }),
              ),
            ),
          ),
        ),
      ),
      React.createElement("tbody", { className: "divide-y divide-border/40 text-xs" }, content),
    ),
  );
}

export default EventsTable;
