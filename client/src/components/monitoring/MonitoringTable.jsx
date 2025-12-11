import React, { useMemo } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatAddress } from "../../lib/format-address.js";
import { pickSpeed } from "../../lib/monitoring-helpers.js";

function safeAddress(value) {
  if (!value) return "Sem endereço";
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") {
        return (
          parsed.formatted_address ||
          parsed.formattedAddress ||
          parsed.address ||
          parsed.shortAddress ||
          parsed.label ||
          value
        );
      }
    } catch (error) {
      // keep string value
    }
    return value;
  }
  if (typeof value === "object") {
    return (
      value.formatted_address ||
      value.formattedAddress ||
      value.address ||
      value.shortAddress ||
      value.label ||
      value.description ||
      JSON.stringify(value)
    );
  }
  return String(value);
}

function formatLastUpdate(value) {
  if (!value) return "—";
  const isoValue = typeof value === "string" ? value : value.toISOString?.();
  if (!isoValue) return "—";
  try {
    return formatDistanceToNow(parseISO(isoValue), { addSuffix: true, locale: ptBR });
  } catch (error) {
    return "—";
  }
}

export default function MonitoringTable({
  rows,
  columns,
  selectedDeviceId,
  onSelect,
  loading,
  emptyText,
}) {
  const safeColumns = useMemo(() => columns || [], [columns]);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
      <table className="min-w-full text-left text-sm text-white/80">
        <thead className="sticky top-0 z-20 bg-[#0d121b] text-[11px] uppercase tracking-wide text-white/50">
          <tr>
            {safeColumns.map((column) => (
              <th key={column.key} className="px-4 py-3 font-semibold">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rowKey = row.key ?? row.deviceId ?? `row-${index}`;
            const isSelected = selectedDeviceId === row.deviceId;
            return (
              <tr
                key={rowKey}
                className={`h-12 border-b border-white/5 transition hover:bg-gray-800/40 ${isSelected ? "bg-gray-800/70" : ""}`}
                onClick={() => onSelect?.(row.deviceId)}
              >
                {safeColumns.map((column) => {
                  const content = column.key === "address"
                    ? safeAddress(row.address || row.position?.address || formatAddress(row.position || row.device || row.vehicle))
                    : column.key === "lastUpdate"
                    ? formatLastUpdate(row.lastUpdate)
                    : column.key === "status"
                    ? (
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${row.statusBadge?.status === "online" ? "bg-emerald-400" : row.statusBadge?.status === "alert" ? "bg-amber-400" : "bg-red-400"}`}
                          />
                          <span className="text-white/80 text-xs">{row.statusBadge?.label}</span>
                        </div>
                      )
                    : column.key === "speed"
                    ? `${pickSpeed(row.position) ?? 0} km/h`
                    : column.render?.(row);

                  return (
                    <td key={column.key} className="px-4 py-2 align-middle text-sm text-white/80">
                      {content ?? "—"}
                    </td>
                  );
                })}
              </tr>
            );
          })}

          {!loading && rows.length === 0 ? (
            <tr>
              <td colSpan={safeColumns.length} className="px-4 py-6 text-center text-sm text-white/50">
                {emptyText}
              </td>
            </tr>
          ) : null}

          {loading ? (
            <tr>
              <td colSpan={safeColumns.length} className="px-4 py-6 text-center text-sm text-white/50">
                Carregando...
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
