import React, { useEffect, useMemo, useRef, useState } from "react";

const MIN_COLUMN_WIDTH = 60;
const MAX_COLUMN_WIDTH = 420;
const DEFAULT_MIN_WIDTH = 60;
const DEFAULT_COLUMN_WIDTH = 160;

const DATE_KEYS = new Set(["serverTime", "deviceTime", "gpsTime"]);
const ADDRESS_KEYS = new Set(["address", "endereco"]);
const BOOLEAN_KEYS = new Set(["valid", "ignition", "blocked"]);

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
  const columnLookup = useMemo(() => (
    columns.reduce((acc, col) => {
      acc[col.key] = col;
      return acc;
    }, {})
  ), [columns]);

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
    const columnConfig = columnLookup[key];
    const declaredMin = columnConfig?.minWidth ?? DEFAULT_MIN_WIDTH;
    return Math.max(MIN_COLUMN_WIDTH, declaredMin);
  };

  const getAppliedWidth = (key) => {
    const minWidth = getColumnMinWidth(key);
    const columnConfig = columnLookup[key];
    const declaredWidth = columnConfig?.width ?? DEFAULT_COLUMN_WIDTH;
    const width = columnWidths[key] ?? declaredWidth;
    const clamped = Math.max(minWidth, Math.min(width, MAX_COLUMN_WIDTH));
    return clamped;
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
    const minWidth = getColumnMinWidth(key);
    const clampedWidth = getAppliedWidth(key);

    return { width: clampedWidth, minWidth, maxWidth: MAX_COLUMN_WIDTH };
  };

  const formatCompactValue = (col, value) => {
    if (React.isValidElement(value)) return value;
    const appliedWidth = getAppliedWidth(col.key);
    const minWidth = getColumnMinWidth(col.key);

    if (appliedWidth <= minWidth + 20) {
      if (BOOLEAN_KEYS.has(col.key) && typeof value === "string") {
        return value.length > 3 ? value.slice(0, 3) : value;
      }

      if (DATE_KEYS.has(col.key) && typeof value === "string") {
        return value.replace(/(\d{2}\/\d{2})\/\d{4}/, "$1");
      }

      if (ADDRESS_KEYS.has(col.key) && typeof value === "string") {
        const [first, second] = value.split(",");
        if (second) return `${first.trim()} - ${second.trim().split(" ")[0] || ""}`.trim();
      }
    }

    return value;
  };

  return (
    <div ref={containerRef} className="h-full w-full overflow-auto bg-[#0b0f17]">

      <table className="min-w-full w-full table-fixed border-collapse text-left" style={{ tableLayout: "fixed" }}>

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

                  <span className="truncate whitespace-nowrap overflow-hidden text-ellipsis" title={col.label}>{col.label}</span>

                  <span
                    role="separator"
                    tabIndex={0}
                    onMouseDown={(event) => startResize(col.key, event)}
                    onClick={(event) => event.stopPropagation()}
                    className="ml-auto inline-flex h-5 w-1 cursor-col-resize items-center justify-center rounded bg-white/10 hover:bg-primary/40"
                    title="Redimensionar coluna"
                  />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-[#0b0f17] text-xs">
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-4 text-center text-sm text-white/50"
              >
                {loading ? "Carregando dados da frota..." : emptyText || "—"}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
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
                  const displayValue = formatCompactValue(col, cellValue);
                  const contentClass = React.isValidElement(displayValue)
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
                        {displayValue}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
