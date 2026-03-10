import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Filter, X } from "lucide-react";
import AddressCell from "../../ui/AddressCell.jsx";
import DropdownMenu from "../../ui/DropdownMenu.jsx";
import Input from "../../ui/Input.jsx";
import { useTranslation } from "../../lib/i18n.js";

const MIN_COLUMN_WIDTH = 60;
const MAX_COLUMN_WIDTH = 800;
const DEFAULT_MIN_WIDTH = 60;
const DEFAULT_COLUMN_WIDTH = 120;

const DATE_KEYS = new Set(["serverTime", "deviceTime", "gpsTime"]);
const ADDRESS_KEYS = new Set(["address", "endereco"]);
const BOOLEAN_KEYS = new Set(["valid", "ignition", "blocked"]);

const FILTER_OPERATORS = {
  string: [
    { value: "contains", label: "Contém" },
    { value: "not_contains", label: "Não contém" },
    { value: "equals", label: "Igual" },
    { value: "not_equals", label: "Diferente" },
  ],
  number: [
    { value: "equals", label: "Igual" },
    { value: "not_equals", label: "Diferente" },
    { value: "greater", label: "Maior que" },
    { value: "less", label: "Menor que" },
    { value: "between", label: "Entre" },
  ],
  date: [
    { value: "equals", label: "Igual" },
    { value: "not_equals", label: "Diferente" },
    { value: "greater", label: "Depois de" },
    { value: "less", label: "Antes de" },
    { value: "between", label: "Entre" },
  ],
  boolean: [
    { value: "equals", label: "Igual" },
    { value: "not_equals", label: "Diferente" },
  ],
};

export default function MonitoringTable({
  rows = [],
  columns = [],
  loading,
  selectedDeviceId,
  onSelect,
  emptyText,
  columnWidths: externalWidths,
  onColumnWidthChange,
  onRowClick,
  sortKey,
  sortDir,
  onSortChange,
  sortableColumns = [],
  columnFilters = {},
  onColumnFilterChange,
  columnFilterOptions = {},
  filtersEnabled = true,
}) {
  const { t } = useTranslation();
  const normalizedColumns = useMemo(() => {
    const list = Array.isArray(columns) ? columns : [];
    if (list.length) return list;
    return [{ key: "placeholder", label: "—", width: DEFAULT_COLUMN_WIDTH, minWidth: DEFAULT_MIN_WIDTH, fixed: true }];
  }, [columns]);

  const sanitizeWidths = (source = {}) => Object.fromEntries(
    Object.entries(source)
      .filter(([, value]) => Number.isFinite(value) && value > 0),
  );

  const areWidthsEqual = (left = {}, right = {}) => {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if (left[key] !== right[key]) return false;
    }
    return true;
  };

  const baseWidths = useMemo(
    () => (
      normalizedColumns.reduce((acc, col) => {
        const width = Number.isFinite(col.width) && col.width > 0 ? col.width : null;
        if (width) acc[col.key] = width;
        return acc;
      }, {})
    ),
    [normalizedColumns],
  );

  const sanitizedExternalWidths = useMemo(() => sanitizeWidths(externalWidths || {}), [externalWidths]);
  const mergedBaseWidths = useMemo(
    () => ({ ...baseWidths, ...sanitizedExternalWidths }),
    [baseWidths, sanitizedExternalWidths],
  );

  const [columnWidths, setColumnWidths] = useState({ ...baseWidths, ...sanitizedExternalWidths });
  const liveWidthsRef = useRef(columnWidths);
  const containerRef = useRef(null);
  const rowRefs = useRef(new Map());
  const columnLookup = useMemo(() => (
    normalizedColumns.reduce((acc, col) => {
      acc[col.key] = col;
      return acc;
    }, {})
  ), [normalizedColumns]);
  const sortableSet = useMemo(
    () => new Set(Array.isArray(sortableColumns) ? sortableColumns : []),
    [sortableColumns],
  );
  const [filterMenu, setFilterMenu] = useState({ key: null, anchor: null });
  const activeFilterColumn = filterMenu.key ? columnLookup[filterMenu.key] : null;
  const [filterSearch, setFilterSearch] = useState("");

  const closeFilterMenu = () => setFilterMenu({ key: null, anchor: null });
  const openFilterMenu = (key, event) => {
    if (!filtersEnabled) return;
    if (typeof onColumnFilterChange !== "function") return;
    event.stopPropagation();
    setFilterMenu({ key, anchor: event.currentTarget });
  };
  const isFilterActive = (key) => {
    const filter = columnFilters?.[key];
    return Boolean(filter && (filter.value || filter.valueTo || (filter.selected && filter.selected.length)));
  };
  const activeFilterColumns = useMemo(() => {
    const next = new Set();
    normalizedColumns.forEach((column) => {
      if (isFilterActive(column.key)) {
        next.add(column.key);
      }
    });
    return next;
  }, [columnFilters, normalizedColumns]);

  useEffect(() => {
    if (!filterMenu.key) return;
    setFilterSearch("");
  }, [filterMenu.key]);

  useEffect(() => {
    liveWidthsRef.current = columnWidths;
  }, [columnWidths]);

  useEffect(() => {
    if (areWidthsEqual(liveWidthsRef.current, mergedBaseWidths)) return;
    setColumnWidths((prev) => {
      const next = { ...mergedBaseWidths, ...prev };
      return areWidthsEqual(prev, next) ? prev : next;
    });
  }, [mergedBaseWidths]);

  useEffect(() => {
    if (!selectedDeviceId) return;
    const rowEl = rowRefs.current.get(selectedDeviceId);
    if (rowEl && containerRef.current) {
      rowEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }
  }, [selectedDeviceId]);

  const getColumnMinWidth = (key) => {
    const columnConfig = columnLookup[key];
    const declaredMin = Number.isFinite(columnConfig?.minWidth) ? columnConfig.minWidth : DEFAULT_MIN_WIDTH;
    return Math.max(MIN_COLUMN_WIDTH, declaredMin);
  };

  const getDefaultWidth = (key) => {
    const columnConfig = columnLookup[key];
    const declaredWidth = Number.isFinite(columnConfig?.width) && columnConfig.width > 0
      ? columnConfig.width
      : DEFAULT_COLUMN_WIDTH;
    return declaredWidth;
  };

  const getAppliedWidth = (key) => {
    const minWidth = getColumnMinWidth(key);
    const columnConfig = columnLookup[key];
    const storedWidth = columnWidths[key];
    const declaredWidth = getDefaultWidth(key);
    const chosenWidth = Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : declaredWidth;
    const clamped = Math.max(minWidth, Math.min(chosenWidth, MAX_COLUMN_WIDTH));
    return clamped;
  };

  const startResize = (key, event) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidthRaw = event.currentTarget.parentElement?.getBoundingClientRect().width;
    const minWidth = getColumnMinWidth(key);
    const startWidth = Number.isFinite(startWidthRaw) && startWidthRaw > 0
      ? startWidthRaw
      : getAppliedWidth(key);
    const safeStartWidth = Math.max(minWidth, Math.min(startWidth, MAX_COLUMN_WIDTH));

    const handleMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const unclamped = Math.round(safeStartWidth + delta);
      const safeWidth = Number.isFinite(unclamped) ? unclamped : minWidth;
      const clampedWidth = Math.max(minWidth, Math.min(safeWidth, MAX_COLUMN_WIDTH));

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
      const storedWidth = liveWidthsRef.current?.[key];
      const safeStored = Number.isFinite(storedWidth) ? storedWidth : minWidth;
      const finalWidth = Math.max(minWidth, Math.min(Math.round(safeStored), MAX_COLUMN_WIDTH));
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

  const activeFilter = filterMenu.key ? columnFilters?.[filterMenu.key] || {} : {};
  const activeFilterType = activeFilterColumn?.filterType || "string";
  const operatorOptions = FILTER_OPERATORS[activeFilterType] || FILTER_OPERATORS.string;
  const activeOperator = activeFilter.operator || operatorOptions[0]?.value || "contains";
  const activeValues = Array.isArray(activeFilter.selected) ? activeFilter.selected : [];
  const activeSortDirection =
    filterMenu.key && sortKey === filterMenu.key && (sortDir === "asc" || sortDir === "desc")
      ? sortDir
      : null;
  const menuAnchorRef = useMemo(() => ({ current: filterMenu.anchor }), [filterMenu.anchor]);
  const rawValueOptions = filterMenu.key ? (columnFilterOptions?.[filterMenu.key] || []) : [];
  const filteredValueOptions = rawValueOptions.filter((value) => {
    if (!filterSearch) return true;
    return String(value).toLowerCase().includes(filterSearch.toLowerCase());
  });

  return (
    <div ref={containerRef} className="h-full min-h-[260px] min-w-0 w-full overflow-auto bg-[#0b0f17]">
      <table className="min-w-full w-full table-fixed border-collapse text-left" style={{ tableLayout: "fixed" }}>

        <thead className="sticky top-0 z-10 border-b border-white/10 bg-[#0f141c] shadow-sm">
          <tr>
            {normalizedColumns.map((col) => {
              const columnTitle = col.title || col.fullLabel || col.label;
              const isSortable = sortableSet.has(col.key) && typeof onSortChange === "function";
              const isActiveSort = isSortable && sortKey === col.key && sortDir;
              const sortIndicator = isActiveSort
                ? sortDir === "desc"
                  ? "↓"
                  : "↑"
                : isSortable
                  ? "↕"
                  : null;
              const allowFilter = filtersEnabled && col.key !== "actions";
              const filterActive = allowFilter && isFilterActive(col.key);
              const isHighlightedHeader = filterActive || Boolean(isActiveSort);
              const headerClassName = `relative border-r px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] last:border-r-0 ${
                isHighlightedHeader
                  ? "z-[1] border-transparent bg-primary/[0.14] text-primary shadow-[inset_2px_0_0_0_var(--primary),inset_-2px_0_0_0_var(--primary),inset_0_2px_0_0_var(--primary),inset_0_-2px_0_0_var(--primary)]"
                  : "border-white/5 text-white/60"
              }`;
              return (
              <th
                key={col.key}
                style={getWidthStyle(col.key)}

                className={headerClassName}
                title={columnTitle}
              >
                <div className="flex items-center justify-between gap-2 pr-2">

                  {isSortable ? (
                    <button
                      type="button"
                      onClick={() => onSortChange?.(col.key)}
                      className={`flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left transition ${
                        isHighlightedHeader
                          ? "border border-primary/50 bg-primary/[0.17] text-primary shadow-[inset_0_-2px_0_0_rgba(59,130,246,0.7)]"
                          : "text-white/70 hover:text-white"
                      }`}
                      title={`Ordenar por ${columnTitle}`}
                    >
                      <span className="truncate whitespace-nowrap overflow-hidden text-ellipsis">{col.label}</span>
                      {sortIndicator && (
                        <span
                          className={`text-[10px] ${
                            isActiveSort
                              ? "text-primary font-semibold"
                              : isHighlightedHeader
                                ? "text-primary/80"
                                : "text-white/40"
                          }`}
                        >
                          {sortIndicator}
                        </span>
                      )}
                    </button>
                  ) : (
                    <span className="truncate whitespace-nowrap overflow-hidden text-ellipsis" title={columnTitle}>
                      {col.label}
                    </span>
                  )}

                  {allowFilter && (
                    <button
                      type="button"
                      onClick={(event) => openFilterMenu(col.key, event)}
                      className={`flex h-6 w-6 items-center justify-center rounded-md border text-white/60 transition ${
                        filterActive ? "border-primary/50 bg-primary/20 text-white" : "border-white/10 hover:border-white/30"
                      }`}
                      title="Filtrar coluna"
                    >
                      <Filter size={12} />
                    </button>
                  )}

                  <span
                    role="separator"
                    tabIndex={0}
                    onMouseDown={(event) => startResize(col.key, event)}
                    onClick={(event) => event.stopPropagation()}
                    className="table-resize-handle ml-auto inline-flex h-5 w-1 cursor-col-resize items-center justify-center rounded bg-white/10 hover:bg-primary/40"
                    title={t("monitoring.resizeColumn")}
                  />
                </div>
              </th>
            );
            })}
          </tr>
        </thead>
        <tbody className="bg-[#0b0f17] text-xs">
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={Math.max(normalizedColumns.length, 1)}
                className="px-3 py-4 text-center text-sm text-white/50"
              >
                {loading ? t("monitoring.tableLoading") : emptyText || "—"}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => {
              const hasPendingAlert = row.hasPendingAlert || row.statusBadge === "alert";
              const rowBgClass = row.hasConjugatedAlert
                ? "bg-red-600/24 hover:bg-red-600/30"
                : hasPendingAlert
                  ? "bg-orange-500/12 hover:bg-orange-500/18"
                  : "hover:bg-white/[0.03]";
              const borderLeftClass = row.hasConjugatedAlert
                ? "border-l-red-500 shadow-[inset_2px_0_0_rgba(239,68,68,0.75)]"
                : hasPendingAlert
                  ? "border-l-orange-400 shadow-[inset_2px_0_0_rgba(251,146,60,0.75)]"
                  : "border-l-transparent shadow-none";
              const rowCellTint = row.hasConjugatedAlert
                ? "bg-red-600/20 group-hover:bg-red-600/26"
                : hasPendingAlert
                  ? "bg-orange-500/10 group-hover:bg-orange-500/14"
                  : "";
              const selectedRowClass = selectedDeviceId === row.deviceId ? "ring-1 ring-primary/45" : "";
              const nearbyRowClass = row.isNearby && !hasPendingAlert && !row.hasConjugatedAlert ? "bg-cyan-500/5" : "";
              return (
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
                className={`group cursor-pointer border-l-4 transition-colors ${borderLeftClass} ${rowBgClass} ${selectedRowClass} ${nearbyRowClass}`}
              >
                {normalizedColumns.map((col) => {
                  let cellValue = col.render ? col.render(row) : row[col.key];
                  const isFilteredColumn = activeFilterColumns.has(col.key);
                  const isSortedColumn = sortKey === col.key && (sortDir === "asc" || sortDir === "desc");
                  const isHighlightedCell = isFilteredColumn || isSortedColumn;
                  const highlightedCellClass = rowIndex === rows.length - 1
                    ? "relative z-[1] border-r border-transparent text-primary shadow-[inset_2px_0_0_0_var(--primary),inset_-2px_0_0_0_var(--primary),inset_0_-2px_0_0_var(--primary)]"
                    : "relative z-[1] border-r border-transparent text-primary shadow-[inset_2px_0_0_0_var(--primary),inset_-2px_0_0_0_var(--primary),inset_0_-1px_0_0_rgba(59,130,246,0.28)]";

                  const isAddressColumn = col.key === "address" || col.key === "endereco";

                  if (isAddressColumn && !col.render) {
                    cellValue = (
                      <AddressCell
                        address={row.address || row.rawAddress || row.position?.address}
                        loading={row.addressLoading}
                        geocodeStatus={row.geocodeStatus}
                        className="max-w-full"
                      />
                    );
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
                  const contentClass = isAddressColumn
                    ? "flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-ellipsis"
                    : React.isValidElement(displayValue)
                      ? "flex items-center gap-1 overflow-visible"
                      : "truncate whitespace-nowrap overflow-hidden text-ellipsis";

                  return (
                    <td
                      key={`${row.key}-${col.key}`}
                      style={getWidthStyle(col.key)}
                      className={`px-2 py-1 text-[11px] leading-tight last:border-r-0 ${
                        isHighlightedCell
                          ? highlightedCellClass
                          : `border-r border-white/5 text-white/80 ${rowCellTint}`
                      }`}
                    >
                      <div
                        className={`${contentClass} min-w-0 ${isHighlightedCell ? "text-primary" : ""}`}
                        title={tooltipValue}
                      >
                        <span className={isHighlightedCell ? "inline-flex max-w-full min-w-0 items-center border-b border-primary pb-[1px]" : ""}>
                          {displayValue}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
            })
          )}
        </tbody>
      </table>
      <DropdownMenu
        open={Boolean(filterMenu.key)}
        anchorRef={menuAnchorRef}
        onClose={closeFilterMenu}
        align="start"
        minWidth={280}
      >
        {filterMenu.key && (
          <div className="flex flex-col gap-3 p-3 text-xs text-white/80">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[11px] uppercase tracking-[0.12em] text-white/50">Filtro</p>
                <p className="truncate text-sm font-semibold text-white">
                  {activeFilterColumn?.label || "Coluna"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onColumnFilterChange?.(filterMenu.key, null)}
                className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-white/60 hover:border-white/30"
              >
                <X size={12} />
                Limpar
              </button>
            </div>

            {sortableSet.has(filterMenu.key) && typeof onSortChange === "function" && (
              <div
                className={`rounded-lg border px-2 py-2 ${
                  activeSortDirection
                    ? "border-primary/75 bg-primary/[0.18] shadow-[inset_0_1px_0_0_rgba(147,197,253,0.16),inset_0_-2px_0_0_rgba(59,130,246,0.95)]"
                    : "border-white/10 bg-white/[0.02]"
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.12em]">
                  <span className={activeSortDirection ? "text-white" : "text-white/50"}>Ordenação</span>
                  {activeSortDirection ? (
                    <span className="rounded-full border border-primary/75 bg-[#1f3f66] px-2 py-0.5 text-[9px] font-semibold text-white shadow-[inset_0_-1px_0_0_rgba(147,197,253,0.92)]">
                      Ativo azul
                    </span>
                  ) : null}
                </div>
                <div
                  className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 ${
                    activeSortDirection
                      ? "border-primary/70 bg-[#0d1f36] shadow-[inset_0_-2px_0_0_rgba(59,130,246,0.95)]"
                      : "border-white/10 bg-[#0f172a]/45"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSortChange(filterMenu.key, "asc")}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition ${
                      activeSortDirection === "asc"
                        ? "border-primary bg-[#1f3f66] text-white shadow-[inset_0_-2px_0_0_rgba(147,197,253,0.95)]"
                        : "border-white/10 bg-[#111827]/75 text-white/75 hover:border-primary/60 hover:bg-[#163152] hover:text-white"
                    }`}
                  >
                    <ArrowUp size={12} />
                    Ascendente
                  </button>
                  <button
                    type="button"
                    onClick={() => onSortChange(filterMenu.key, "desc")}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition ${
                      activeSortDirection === "desc"
                        ? "border-primary bg-[#1f3f66] text-white shadow-[inset_0_-2px_0_0_rgba(147,197,253,0.95)]"
                        : "border-white/10 bg-[#111827]/75 text-white/75 hover:border-primary/60 hover:bg-[#163152] hover:text-white"
                    }`}
                  >
                    <ArrowDown size={12} />
                    Descendente
                  </button>
                  <button
                    type="button"
                    onClick={() => onSortChange(filterMenu.key, "clear")}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition ${
                      activeSortDirection
                        ? "border-primary/60 bg-[#143251] text-white/90 shadow-[inset_0_-2px_0_0_rgba(59,130,246,0.7)] hover:border-primary hover:text-white"
                        : "border-white/10 text-white/50 hover:border-white/40"
                    }`}
                  >
                    Limpar ordenação
                  </button>
                </div>
              </div>
            )}

            <label className="text-[10px] uppercase tracking-[0.12em] text-white/50">
              Condição
              <select
                value={activeOperator}
                onChange={(event) =>
                  onColumnFilterChange?.(filterMenu.key, {
                    ...activeFilter,
                    operator: event.target.value,
                  })
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white"
              >
                {operatorOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-[10px] uppercase tracking-[0.12em] text-white/50">
              Valor
              <Input
                value={activeFilter.value || ""}
                onChange={(event) =>
                  onColumnFilterChange?.(filterMenu.key, {
                    ...activeFilter,
                    value: event.target.value,
                  })
                }
                className="mt-1 text-xs"
                placeholder="Digite para filtrar"
              />
            </label>

            {activeOperator === "between" && (
              <label className="text-[10px] uppercase tracking-[0.12em] text-white/50">
                Até
                <Input
                  value={activeFilter.valueTo || ""}
                  onChange={(event) =>
                    onColumnFilterChange?.(filterMenu.key, {
                      ...activeFilter,
                      valueTo: event.target.value,
                    })
                  }
                  className="mt-1 text-xs"
                  placeholder="Valor final"
                />
              </label>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.12em] text-white/50">
                <span>Valores</span>
                <button
                  type="button"
                  onClick={() =>
                    onColumnFilterChange?.(filterMenu.key, {
                      ...activeFilter,
                      selected: [],
                    })
                  }
                  className="text-[10px] text-white/60 hover:text-white"
                >
                  Limpar seleção
                </button>
              </div>
              <Input
                value={filterSearch}
                onChange={(event) => setFilterSearch(event.target.value)}
                className="text-xs"
                placeholder="Buscar valores"
              />
              <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                {filteredValueOptions.length === 0 && (
                  <p className="text-[11px] text-white/40">Nenhum valor encontrado.</p>
                )}
                {filteredValueOptions.map((value) => {
                  const isChecked = activeValues.includes(value);
                  return (
                    <label
                      key={value}
                      className="flex items-center gap-2 rounded-md border border-white/5 px-2 py-1 text-[11px] text-white/70 hover:border-white/20"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          const next = new Set(activeValues);
                          if (isChecked) next.delete(value);
                          else next.add(value);
                          onColumnFilterChange?.(filterMenu.key, {
                            ...activeFilter,
                            selected: Array.from(next.values()),
                          });
                        }}
                      />
                      <span className="truncate">{value}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </DropdownMenu>
    </div>
  );
}
