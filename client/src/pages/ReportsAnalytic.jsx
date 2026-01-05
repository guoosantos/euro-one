import React, { useCallback, useEffect, useMemo, useState } from "react";

import VehicleSelector from "../components/VehicleSelector.jsx";
import MonitoringTable from "../components/monitoring/MonitoringTable.jsx";
import useVehicleSelection from "../lib/hooks/useVehicleSelection.js";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { useTranslation } from "../lib/i18n.js";
import { formatAddress } from "../lib/format-address.js";

const PAGE_SIZE_OPTIONS = [100, 250, 500, 1000];

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatSpeed(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (!Number.isFinite(Number(value))) return String(value);
  return `${Number(value)} km/h`;
}

function formatBoolean(value, yesLabel, noLabel) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  return value ? yesLabel : noLabel;
}

function resolveCommandStatusLabel(status, t) {
  if (!status) return t("reportsAnalytic.status.pending");
  const normalized = String(status).toUpperCase();
  if (normalized === "RESPONDED") return t("reportsAnalytic.status.success");
  if (normalized === "ERROR") return t("reportsAnalytic.status.failure");
  if (normalized === "SENT" || normalized === "PENDING") return t("reportsAnalytic.status.pending");
  if (normalized === "TIMEOUT") return t("reportsAnalytic.status.timeout");
  if (normalized === "UNSUPPORTED") return t("reportsAnalytic.status.unsupported");
  return status;
}

function resolveEventLabel(entry, t) {
  if (entry.type === "position") return t("reportsAnalytic.event.position");
  if (entry.type === "command") {
    const name = entry.commandName || t("reportsAnalytic.commandFallback");
    return t("reportsAnalytic.event.commandSent", { name });
  }
  if (entry.type === "command_response") {
    const name = entry.commandName || t("reportsAnalytic.commandFallback");
    return t("reportsAnalytic.event.commandResponse", { name });
  }
  const eventName = entry.eventType || entry.eventDescription || t("reportsAnalytic.event.generic");
  return eventName;
}

export default function ReportsAnalytic() {
  const { t } = useTranslation();
  const { selectedVehicleId } = useVehicleSelection({ syncQuery: true });
  const [from, setFrom] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [typeFilter, setTypeFilter] = useState("all");
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [geofenceFilter, setGeofenceFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [entries, setEntries] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasGenerated, setHasGenerated] = useState(false);

  const columns = useMemo(
    () => [
      { key: "occurredAt", label: t("reportsAnalytic.columns.datetime"), width: 160, minWidth: 140, fixed: true },
      { key: "event", label: t("reportsAnalytic.columns.event"), width: 220, minWidth: 200, fixed: true },
      { key: "address", label: t("reportsAnalytic.columns.address"), width: 320, minWidth: 260 },
      { key: "speed", label: t("reportsAnalytic.columns.speed"), width: 100, minWidth: 90 },
      { key: "ignition", label: t("reportsAnalytic.columns.ignition"), width: 90, minWidth: 80 },
      { key: "input2", label: t("reportsAnalytic.columns.input2"), width: 90, minWidth: 80 },
      { key: "input4", label: t("reportsAnalytic.columns.input4"), width: 90, minWidth: 80 },
      { key: "geofence", label: t("reportsAnalytic.columns.geofence"), width: 140, minWidth: 120 },
      { key: "jamming", label: t("reportsAnalytic.columns.jamming"), width: 110, minWidth: 100 },
      { key: "vehicleVoltage", label: t("reportsAnalytic.columns.voltage"), width: 120, minWidth: 100 },
    ],
    [t],
  );

  const fetchReport = useCallback(async () => {
    if (!selectedVehicleId) return;
    setLoading(true);
    setError(null);
    try {
      const params = {
        vehicleId: selectedVehicleId,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        page,
        limit: pageSize,
        type: typeFilter,
        geofence: geofenceFilter,
        criticalOnly: criticalOnly ? "true" : "false",
        search: search.trim() || undefined,
      };
      const { data, error: requestError } = await safeApi.get(API_ROUTES.reports.analytic, { params });
      if (requestError) throw requestError;
      const payload = data?.data || data?.items || data?.entries || [];
      setEntries(Array.isArray(payload) ? payload : []);
      setMeta(data?.meta || null);
    } catch (requestError) {
      setError(requestError);
      setEntries([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, [criticalOnly, from, geofenceFilter, page, pageSize, search, selectedVehicleId, to, typeFilter]);

  useEffect(() => {
    if (!hasGenerated) return;
    fetchReport();
  }, [fetchReport, hasGenerated]);

  const handleSubmit = (event) => {
    event.preventDefault();
    setPage(1);
    setHasGenerated(true);
    fetchReport();
  };

  const totalItems = meta?.totalItems ?? entries.length;
  const totalPages = meta?.totalPages ?? 1;
  const currentPage = meta?.page ?? page;

  const rows = useMemo(
    () =>
      entries.map((entry) => {
        const commandStatus = entry.commandStatus ? resolveCommandStatusLabel(entry.commandStatus, t) : null;
        const commandResult = entry.commandResult ? `${commandStatus ? `${commandStatus} · ` : ""}${entry.commandResult}` : commandStatus;
        const eventLabel = resolveEventLabel(entry, t);
        const ignitionLabel = formatBoolean(entry.ignition, t("common.yes"), t("common.no"));
        return {
          key: entry.id || `${entry.type}-${entry.occurredAt}`,
          occurredAt: formatDateTime(entry.occurredAt),
          event: entry.type === "command_response" && commandResult ? `${eventLabel} (${commandResult})` : eventLabel,
          address: formatAddress(entry.address),
          rawAddress: entry.address,
          speed: formatSpeed(entry.speed),
          ignition: ignitionLabel,
          input2: formatBoolean(entry.input2, t("common.yes"), t("common.no")),
          input4: formatBoolean(entry.input4, t("common.yes"), t("common.no")),
          geofence: entry.geofence || "—",
          jamming: formatBoolean(entry.jamming, t("common.yes"), t("common.no")),
          vehicleVoltage: entry.vehicleVoltage ? `${entry.vehicleVoltage} V` : "—",
        };
      }),
    [entries, t],
  );

  return (
    <div className="space-y-4">
      <section className="card space-y-4">
        <header>
          <h2 className="text-lg font-semibold">{t("reportsAnalytic.title")}</h2>
          <p className="text-xs text-white/60">{t("reportsAnalytic.subtitle")}</p>
        </header>

        <form onSubmit={handleSubmit} className="filters grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <VehicleSelector />
          </div>
          <label className="text-xs text-white/60">
            {t("from")}
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="input mt-1"
              required
            />
          </label>
          <label className="text-xs text-white/60">
            {t("to")}
            <input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="input mt-1"
              required
            />
          </label>
          <label className="text-xs text-white/60">
            {t("reportsAnalytic.filters.type")}
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="input mt-1"
            >
              <option value="all">{t("reportsAnalytic.filters.all")}</option>
              <option value="position">{t("reportsAnalytic.filters.position")}</option>
              <option value="event">{t("reportsAnalytic.filters.event")}</option>
              <option value="command">{t("reportsAnalytic.filters.command")}</option>
              <option value="response">{t("reportsAnalytic.filters.response")}</option>
              <option value="audit">{t("reportsAnalytic.filters.audit")}</option>
              <option value="critical">{t("reportsAnalytic.filters.critical")}</option>
            </select>
          </label>
          <label className="text-xs text-white/60">
            {t("reportsAnalytic.filters.geofence")}
            <select
              value={geofenceFilter}
              onChange={(event) => setGeofenceFilter(event.target.value)}
              className="input mt-1"
            >
              <option value="all">{t("reportsAnalytic.filters.geofenceAll")}</option>
              <option value="inside">{t("reportsAnalytic.filters.geofenceInside")}</option>
              <option value="outside">{t("reportsAnalytic.filters.geofenceOutside")}</option>
            </select>
          </label>
          <label className="text-xs text-white/60">
            {t("reportsAnalytic.filters.search")}
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="input mt-1"
              placeholder={t("reportsAnalytic.filters.searchPlaceholder")}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-white/60 md:col-span-2 md:mt-6">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-white/30 bg-transparent"
              checked={criticalOnly}
              onChange={(event) => setCriticalOnly(event.target.checked)}
            />
            {t("reportsAnalytic.filters.criticalOnly")}
          </label>
          <div className="flex items-center gap-2 md:col-span-4">
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
              disabled={!selectedVehicleId || loading}
            >
              {loading ? t("reportsAnalytic.loading") : t("reportsAnalytic.generate")}
            </button>
            <div className="flex items-center gap-2 text-xs text-white/60">
              <span>{t("reportsAnalytic.pagination.pageSize")}</span>
              <select
                className="input py-1"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
            <span className="ml-auto text-xs text-white/50">
              {t("reportsAnalytic.pagination.total", { count: totalItems })}
            </span>
          </div>
        </form>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error.message || t("reportsAnalytic.loadError")}
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/80">{t("reportsAnalytic.timelineTitle")}</h3>
          <span className="text-xs text-white/60">
            {t("reportsAnalytic.pagination.pageInfo", { current: currentPage, total: totalPages })}
          </span>
        </header>

        <div className="h-[520px]">
          <MonitoringTable
            rows={rows}
            columns={columns}
            loading={loading}
            emptyText={hasGenerated ? t("reportsAnalytic.empty") : t("reportsAnalytic.emptyBefore")}
            liveGeocode={false}
          />
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-1 text-xs text-white/70 hover:bg-white/10 disabled:opacity-50"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPage <= 1 || loading}
          >
            {t("reportsAnalytic.pagination.prev")}
          </button>
          <div className="text-xs text-white/60">
            {t("reportsAnalytic.pagination.pageInfo", { current: currentPage, total: totalPages })}
          </div>
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-1 text-xs text-white/70 hover:bg-white/10 disabled:opacity-50"
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={currentPage >= totalPages || loading}
          >
            {t("reportsAnalytic.pagination.next")}
          </button>
        </div>
      </section>
    </div>
  );
}
