import React, { useEffect, useMemo, useState } from "react";


const MIN_COLUMN_WIDTH = 80;


export default function MonitoringTable({ rows, columns, loading, selectedDeviceId, onSelect, emptyText }) {
  const baseWidths = useMemo(() => (
    columns.reduce((acc, col) => {
      if (col.width) acc[col.key] = col.width;
      return acc;
    }, {})
  ), [columns]);

  const [columnWidths, setColumnWidths] = useState(baseWidths);

  useEffect(() => {
    setColumnWidths(prev => ({ ...baseWidths, ...prev }));
  }, [baseWidths]);

  const startResize = (key, event) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = event.currentTarget.parentElement.getBoundingClientRect().width;

    const handleMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.max(MIN_COLUMN_WIDTH, Math.round(startWidth + delta));
      setColumnWidths(prev => ({ ...prev, [key]: nextWidth }));
    };

    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const getWidthStyle = (key) => {
    const width = columnWidths[key];
    if (!width) return undefined;

    return { width, minWidth: width };

  };

  if (loading && rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-white/50">
        <div className="animate-pulse">Carregando dados da frota...</div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-white/50">
        {emptyText || "Nenhum veículo encontrado."}
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto bg-[#0b0f17]">
      <table className="min-w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 border-b border-white/10 bg-[#0f141c] shadow-sm">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={getWidthStyle(col.key)}
                className="relative border-r border-white/5 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/60 last:border-r-0"
              >
                <div className="flex items-center justify-between gap-2 pr-2">

                  <span className="whitespace-nowrap">{col.label}</span>

                  {!col.fixed && (
                    <span
                      role="separator"
                      tabIndex={0}
                      onMouseDown={(event) => startResize(col.key, event)}
                      onClick={(event) => event.stopPropagation()}
                      className="ml-auto inline-flex h-5 w-1 cursor-col-resize items-center justify-center rounded bg-white/10 hover:bg-primary/40"
                    />
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-[#0b0f17] text-xs">
          {rows.map((row) => (
            <tr
              key={row.key}
              onClick={() => onSelect(row.deviceId)}
              className={`group cursor-pointer border-l-2 border-transparent transition-colors hover:bg-white/[0.03] ${selectedDeviceId === row.deviceId ? "border-primary bg-primary/5" : ""}`}
            >
              {columns.map((col) => {
                let cellValue = col.render ? col.render(row) : row[col.key];

                if (typeof cellValue === "object" && cellValue !== null && !React.isValidElement(cellValue)) {

                  if (cellValue.formattedAddress) {
                    cellValue = cellValue.formattedAddress;
                  } else if (cellValue.address) {
                    cellValue = cellValue.address;
                  } else {
                    cellValue = "";
                  }

                }

                return (
                  <td
                    key={`${row.key}-${col.key}`}
                    style={getWidthStyle(col.key)}
                    className="border-r border-white/5 px-2 py-1 text-[11px] leading-tight text-white/80 last:border-r-0"
                  >
                    <div className="truncate" title={typeof cellValue === "string" ? cellValue : undefined}>{cellValue}</div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
