import React, { useEffect, useMemo, useRef, useState } from "react";

const MIN_COLUMN_WIDTH = 60;
const MAX_COLUMN_WIDTH = 420;
const DEFAULT_MIN_WIDTH = 60;

export default function MonitoringTable({
  rows,
  columns,
  loading,
  selectedDeviceId,
  onSelect,
  emptyText,
  columnWidths: externalWidths,
  onColumnWidthChange,
  onRowClick,
}) {
  const baseWidths = useMemo(
    () => (
      columns.reduce((acc, col) => {
        if (col.width) acc[col.key] = col.width;
        return acc;
      }, {})
    ),
    [columns],
  );

  const [columnWidths, setColumnWidths] = useState({ ...baseWidths, ...(externalWidths || {}) });
  const liveWidthsRef = useRef(columnWidths);
  const containerRef = useRef(null);
  const rowRefs = useRef(new Map());

  useEffect(() => {
    liveWidthsRef.current = columnWidths;
  }, [columnWidths]);

  useEffect(() => {
    setColumnWidths((prev) => {
      const next = { ...baseWidths, ...(externalWidths || {}), ...prev };

      const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
      const hasDiff = Array.from(keys).some((key) => prev[key] !== next[key]);

      return hasDiff ? next : prev;
    });
  }, [baseWidths, externalWidths]);

  useEffect(() => {
    if (!selectedDeviceId) return;
    const rowEl = rowRefs.current.get(selectedDeviceId);
    if (rowEl && containerRef.current) {
      rowEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }
  }, [selectedDeviceId]);

  const getColumnMinWidth = (key) => {
    const columnConfig = columns.find((col) => col.key === key);
    const declaredMin = columnConfig?.minWidth ?? DEFAULT_MIN_WIDTH;
    return Math.max(MIN_COLUMN_WIDTH, declaredMin);
  };

  const startResize = (key, event) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = event.currentTarget.parentElement.getBoundingClientRect().width;
    const minWidth = getColumnMinWidth(key);

    const handleMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const unclamped = Math.round(startWidth + delta);
      const clampedWidth = Math.max(minWidth, Math.min(unclamped, MAX_COLUMN_WIDTH));

      setColumnWidths(prev => {
        if (prev[key] === clampedWidth) return prev;
        const updated = { ...prev, [key]: clampedWidth };
        liveWidthsRef.current = updated;
        return updated;
      });
    };

    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      const storedWidth = liveWidthsRef.current?.[key] || startWidth;
      const finalWidth = Math.max(minWidth, Math.min(Math.round(storedWidth), MAX_COLUMN_WIDTH));
      onColumnWidthChange?.(key, finalWidth);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const getWidthStyle = (key) => {
    const width = columnWidths[key];
    const minWidth = getColumnMinWidth(key);

    const clampedWidth = width ? Math.max(Math.min(width, MAX_COLUMN_WIDTH), minWidth) : null;

    if (!clampedWidth) return { minWidth };

    return { width: clampedWidth, minWidth };
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
    <div ref={containerRef} className="h-full w-full overflow-auto bg-[#0b0f17]">

      <table className="min-w-full table-fixed border-collapse text-left">

        <thead className="sticky top-0 z-10 border-b border-white/10 bg-[#0f141c] shadow-sm">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={getWidthStyle(col.key)}

                className="relative border-r border-white/5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/60 last:border-r-0"
                title={col.label}
              >
                <div className="flex items-center justify-between gap-2 pr-2">

                  <span className="truncate whitespace-nowrap overflow-hidden text-ellipsis">{col.label}</span>


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
              ref={(el) => {
                if (!row.deviceId) return;
                if (el) rowRefs.current.set(row.deviceId, el);
                else rowRefs.current.delete(row.deviceId);
              }}
              onClick={() => {
                onSelect?.(row.deviceId, row);
                onRowClick?.(row);
              }}
              className={`group cursor-pointer border-l-2 border-transparent transition-colors hover:bg-white/[0.03] ${selectedDeviceId === row.deviceId ? "border-primary bg-primary/5" : ""} ${row.isNearby ? "bg-cyan-500/5" : ""}`}
            >
              {columns.map((col) => {
                let cellValue = col.render ? col.render(row) : row[col.key];

                if (col.key === "address" || col.key === "endereco") {
                  let addr = row.address || row.position?.address;

                  if (typeof addr === "object" && addr !== null) {
                    addr = addr.formattedAddress || addr.address;
                  }

                  if (!addr || addr === "[object Object]") {
                    if (Number.isFinite(row.lat) && Number.isFinite(row.lng)) {
                      cellValue = `${Number(row.lat).toFixed(4)}, ${Number(row.lng).toFixed(4)}`;
                    } else {
                      cellValue = "—";
                    }
                  } else {
                    cellValue = addr;
                  }
                } else if (typeof cellValue === "object" && cellValue !== null && !React.isValidElement(cellValue)) {
                  if (cellValue.formattedAddress) {
                    cellValue = cellValue.formattedAddress;
                  } else if (cellValue.address) {
                    cellValue = cellValue.address;
                  } else {
                    cellValue = "";
                  }
                }

                const isElement = React.isValidElement(cellValue);
                const tooltipValue = col.tooltipValue
                  ? col.tooltipValue(row)
                  : col.key === "vehicle"
                    ? row.deviceName
                    : typeof cellValue === "string" || typeof cellValue === "number"
                      ? String(cellValue)
                      : undefined;
                const contentClass = isElement
                  ? "flex items-center gap-1 overflow-visible"
                  : "truncate whitespace-nowrap overflow-hidden text-ellipsis";

                return (
                  <td
                    key={`${row.key}-${col.key}`}
                    style={getWidthStyle(col.key)}

                    className="border-r border-white/5 px-2 py-1 text-[11px] leading-tight text-white/80 last:border-r-0"
                  >
                    <div
                      className={contentClass}
                      title={tooltipValue}
                    >
                      {cellValue}
                    </div>
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
