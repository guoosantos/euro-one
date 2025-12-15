import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useTranslation } from "../lib/i18n.js";
import { useTenant } from "../lib/tenant-context";
import useDevices from "../lib/hooks/useDevices";
import { useLivePositions } from "../lib/hooks/useLivePositions";
import { useEvents } from "../lib/hooks/useEvents";
import useTasks from "../lib/hooks/useTasks";
import { buildFleetState } from "../lib/fleet-utils";
import { translateEventType } from "../lib/event-translations.js";
import Card from "../ui/Card.jsx";
import TableStateRow from "../components/TableStateRow.jsx";

const COMMUNICATION_BUCKETS = [
  { key: "stale_0_1", label: "0-1h", minMinutes: 0, maxMinutes: 60 },
  { key: "stale_1_6", label: "1-6h", minMinutes: 60, maxMinutes: 360 },
  { key: "stale_6_12", label: "6-12h", minMinutes: 360, maxMinutes: 720 },
  { key: "stale_12_24", label: "12-24h", minMinutes: 720, maxMinutes: 1440 },
  { key: "stale_24_72", label: "24-72h", minMinutes: 1440, maxMinutes: 4320 },
  { key: "stale_72_10d", label: "72h-10d", minMinutes: 4320, maxMinutes: 14400 },
  { key: "stale_10d_30d", label: "10-30d", minMinutes: 14400, maxMinutes: 43200 },
  { key: "stale_30d_plus", label: "30+d", minMinutes: 43200, maxMinutes: Infinity },
];

export default function Home() {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const [selectedCard, setSelectedCard] = useState(null);

  const { data: devices = [], loading: loadingDevices } = useDevices();
  const { data: positions = [], loading: loadingPositions, fetchedAt: telemetryFetchedAt } = useLivePositions();
  const { events, loading: loadingEvents, error: eventsError } = useEvents({ limit: 50 });
  const { tasks } = useTasks(useMemo(() => ({ clientId: tenantId }), [tenantId]));

  const { summary, table } = useMemo(() => {
    const { rows, stats } = buildFleetState(devices, positions, { tenantId });
    return { summary: stats, table: rows };
  }, [devices, positions, tenantId]);

  const communicationBuckets = useMemo(() => buildOfflineBuckets(table), [table]);
  const routeMetrics = useMemo(() => buildRouteMetrics(table, tasks), [table, tasks]);

  const normalizedEvents = useMemo(
    () =>
      events.map((event) => {
        const severity = normalizeSeverity(event);
        const time = event.time ?? event.eventTime ?? event.serverTime;
        return { ...event, severity, __time: time ? new Date(time).toISOString() : null };
      }),
    [events],
  );

  const highSeverityEvents = useMemo(
    () => normalizedEvents.filter((event) => event.severity === "critical" || event.severity === "high"),
    [normalizedEvents],
  );

  const recentHighEvents = useMemo(() => highSeverityEvents.slice(0, 8), [highSeverityEvents]);

  const criticalByVehicle = useMemo(() => {
    const grouped = new Map();
    for (const event of highSeverityEvents) {
      const deviceKey = String(event.deviceId ?? event.device?.id ?? event.device?.deviceId ?? event.id ?? "");
      if (!deviceKey) continue;
      const existing = grouped.get(deviceKey) ?? { count: 0, events: [], deviceId: deviceKey, deviceName: event.deviceName };
      grouped.set(deviceKey, {
        ...existing,
        count: existing.count + 1,
        events: [...existing.events, event].sort((a, b) => new Date(b.__time || 0) - new Date(a.__time || 0)),
      });
    }
    return Array.from(grouped.values()).filter((item) => item.count >= 2);
  }, [highSeverityEvents]);

  const renderCommunicationSummary = (expanded = false) => (
    <Card
      title={t("home.communicationStatus")}
      subtitle={t("home.communicationStatusHint")}
      actions={expanded ? (
        <button
          type="button"
          className="text-xs font-semibold text-primary"
          onClick={() => setSelectedCard(null)}
        >
          {t("home.close")}
        </button>
      ) : null}
      className={expanded ? "xl:col-span-2" : ""}
    >
      <div className="overflow-x-auto text-sm">
        <table className="min-w-full">
          <thead className="text-white/50">
            <tr className="border-b border-white/10 text-left">
              <th className="py-2 pr-4">Faixa</th>
              <th className="py-2 pr-4">Quantidade</th>
            </tr>
          </thead>
          <tbody>
            {communicationBuckets.map((bucket) => (
              <tr
                key={bucket.label}
                className="cursor-pointer border-b border-white/5 transition hover:bg-white/5"
                onClick={() => window.open(`/monitoring?filter=${bucket.filterKey}`, "_blank")}
              >
                <td className="py-2 pr-4 text-white/80">{bucket.label}</td>
                <td className="py-2 pr-4 text-white">
                  {bucket.vehicles.length === 0 ? "Nenhum veículo" : bucket.vehicles.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );

  const renderRouteSummary = (expanded = false) => (
    <Card
      title="Veículos em rota"
      subtitle="Status dos veículos com rota ativa"
      actions={expanded ? (
        <button type="button" className="text-xs font-semibold text-primary" onClick={() => setSelectedCard(null)}>
          Fechar
        </button>
      ) : null}
      className={expanded ? "xl:col-span-2" : ""}
    >
      <div className={`grid gap-3 ${expanded ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        <Metric label="Com rota embarcada" value={routeMetrics.totalWithRoute} onClick={() => navigate("/monitoring")} />
        <Metric label="Sem sinal" value={routeMetrics.withoutSignal} onClick={() => navigate("/monitoring?filter=stale")} />
        <Metric label="Com sinal" value={routeMetrics.withSignal} onClick={() => navigate("/monitoring?filter=online")} />
        <Metric label="Bloqueados" value={routeMetrics.blocked.total} onClick={() => navigate("/monitoring")} />
        <Metric label="Bloqueado (Jammer)" value={routeMetrics.blocked.jammer} />
        <Metric label="Bloqueado (Violação)" value={routeMetrics.blocked.violation} />
        <Metric label="Bloqueado (Reconhecimento facial)" value={routeMetrics.blocked.face} />
        <Metric label="Desvio de rota" value={routeMetrics.routeDeviation} />
        <Metric label="Atraso na rota" value={routeMetrics.routeDelay} />
      </div>
    </Card>
  );

  const renderAlertSummary = (expanded = false) => (
    <Card
      title="Eventos recentes"
      subtitle={telemetryFetchedAt ? `Atualizado às ${new Date(telemetryFetchedAt).toLocaleTimeString(locale)}` : "Sincronizando"}
      actions={
        <Link to="/events?severity=critical" className="text-xs font-semibold text-primary">
          Ver todos
        </Link>
      }
      className={expanded ? "xl:col-span-2" : ""}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-white/40">
            <tr className="border-b border-white/10 text-left">
              <th className="py-2 pr-4">Horário</th>
              <th className="py-2 pr-4">Tipo</th>
              <th className="py-2 pr-4">Veículo</th>
              <th className="py-2 pr-4">Severidade</th>
              <th className="py-2 pr-4">Local</th>
            </tr>
          </thead>
          <tbody>
            {loadingEvents && <TableStateRow colSpan={5} state="loading" tone="muted" title="Carregando eventos" />}
            {!loadingEvents && eventsError && (
              <TableStateRow colSpan={5} state="error" tone="error" title="Erro ao carregar eventos" />
            )}
            {!loadingEvents && !eventsError && recentHighEvents.length === 0 && (
              <TableStateRow colSpan={5} state="empty" tone="muted" title="Nenhum evento crítico" />
            )}
            {recentHighEvents.map((event) => (
              <tr
                key={event.id ?? `${event.deviceId}-${event.__time}`}
                className="cursor-pointer border-b border-white/5 hover:bg-white/5"
                onClick={() => openTripRange(event)}
              >
                <td className="py-2 pr-4 text-white/70">{formatDate(event.__time, locale)}</td>
                <td className="py-2 pr-4 text-white/80">{translateEventType(event.type ?? event.event, locale, t)}</td>
                <td className="py-2 pr-4 text-white/70">{event.deviceName ?? event.deviceId ?? "—"}</td>
                <td className="py-2 pr-4">
                  <SeverityBadge severity={event.severity} />
                </td>
                <td className="py-2 pr-4 text-white/70">{event.attributes?.address ?? event.address ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {expanded && (
        <div className="mt-4 text-right">
          <button type="button" className="text-xs font-semibold text-primary" onClick={() => setSelectedCard(null)}>
            Fechar
          </button>
        </div>
      )}
    </Card>
  );

  const renderCriticalSummary = (expanded = false) => (
    <Card
      title="Eventos críticos"
      subtitle="Veículos com múltiplos eventos graves"
      actions={expanded ? (
        <button type="button" className="text-xs font-semibold text-primary" onClick={() => setSelectedCard(null)}>
          Fechar
        </button>
      ) : null}
      className={expanded ? "xl:col-span-2" : ""}
    >
      {criticalByVehicle.length === 0 ? (
        <TableStateRow colSpan={1} state="empty" tone="muted" title="Nenhum veículo crítico" />
      ) : (
        <div className="space-y-3">
          {criticalByVehicle.map((group) => (
            <div
              key={group.deviceId}
              className="cursor-pointer rounded-xl border border-white/10 bg-white/5 p-3 hover:border-primary/40"
              onClick={() => openTripRange(group.events[0])}
            >
              <div className="flex items-center justify-between text-sm text-white">
                <div className="font-semibold">{group.deviceName ?? group.deviceId}</div>
                <span className="rounded-full bg-red-500/20 px-3 py-1 text-[11px] font-semibold text-red-200">
                  {group.count} eventos
                </span>
              </div>
              <div className="mt-2 space-y-1 text-xs text-white/70">
                {group.events.slice(0, expanded ? 6 : 3).map((event) => (
                  <div
                    key={event.id ?? `${event.deviceId}-${event.__time}`}
                    className="flex items-center justify-between"
                    onClick={(e) => {
                      e.stopPropagation();
                      openTripRange(event);
                    }}
                  >
                    <span>{formatDate(event.__time, locale)}</span>
                    <span className="text-white/60">{translateEventType(event.type ?? event.event, locale, t)}</span>
                    <SeverityBadge severity={event.severity} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );

  const renderSummaries = () => {
    if (selectedCard === "monitored") return renderCommunicationSummary(true);
    if (selectedCard === "route") return renderRouteSummary(true);
    if (selectedCard === "alert") return renderAlertSummary(true);
    if (selectedCard === "critical") return renderCriticalSummary(true);

    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {renderCommunicationSummary()}
        {renderRouteSummary()}
        {renderAlertSummary()}
        {renderCriticalSummary()}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title={t("home.vehiclesMonitored")}
          value={loadingDevices ? "…" : summary.total}
          hint={t("home.syncedAt", {
            time: telemetryFetchedAt ? new Date(telemetryFetchedAt).toLocaleTimeString(locale) : "—",
          })}
          onClick={() => setSelectedCard("monitored")}
        />
        <StatCard
          title={t("home.inRoute")}
          value={loadingPositions ? "…" : routeMetrics.totalWithRoute}
          hint={t("home.onRouteHint", { percent: percentage(routeMetrics.totalWithRoute, summary.total) })}
          onClick={() => setSelectedCard("route")}
        />
        <StatCard
          title={t("home.inAlertTitle")}
          value={loadingPositions ? "…" : highSeverityEvents.length}
          hint={t("home.inAlertHint")}
          variant="alert"
          onClick={() => setSelectedCard("alert")}
        />
        <StatCard
          title="Eventos críticos"
          value={criticalByVehicle.length}
          hint="Veículos com múltiplos eventos graves"
          variant="alert"
          onClick={() => setSelectedCard("critical")}
        />
      </section>

      {renderSummaries()}
    </div>
  );

  function openTripRange(event) {
    const time = event.__time ? new Date(event.__time).getTime() : Date.now();
    const from = new Date(time - 3 * 60 * 60 * 1000).toISOString();
    const to = new Date(time + 3 * 60 * 60 * 1000).toISOString();
    const deviceId = event.deviceId ?? event.device?.id ?? event.device?.deviceId;
    if (!deviceId) return;
    navigate(`/trips?deviceId=${deviceId}&from=${from}&to=${to}`);
  }
}

function StatCard({ title, value, hint, variant = "default", onClick }) {
  const palette = {
    default: "bg-[#12161f] border border-white/5",
    alert: "bg-red-500/10 border border-red-500/30",
  };

  return (
    <div
      className={`rounded-2xl p-4 transition duration-200 hover:-translate-y-0.5 hover:border-primary/40 ${palette[variant]}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-white/50">{title}</div>
          <div className="mt-1 text-3xl font-semibold text-white">{value}</div>
          {hint && <div className="mt-1 text-[11px] text-white/40">{hint}</div>}
        </div>
      </div>
    </div>
  );
}

function SeverityBadge({ severity }) {
  const { t } = useTranslation();
  const normalized = String(severity ?? "").toLowerCase();

  const palette = {
    critical: "bg-red-500/20 text-red-200 border border-red-500/40",
    high: "bg-red-500/20 text-red-200 border border-red-500/40",
    medium: "bg-yellow-500/20 text-yellow-200 border border-yellow-500/40",
    low: "bg-green-500/20 text-green-200 border border-green-500/40",
    info: "bg-blue-500/20 text-blue-200 border border-blue-500/40",
  };

  const label =
    normalized === "critical"
      ? t("severity.critical")
      : normalized === "high"
      ? t("severity.high")
      : normalized === "medium"
      ? t("severity.medium")
      : normalized === "info"
      ? t("severity.info")
      : t("severity.low");

  return <span className={`rounded-full px-3 py-1 text-xs ${palette[normalized] ?? palette.low}`}>{label}</span>;
}

function Metric({ label, value, onClick }) {
  return (
    <div
      className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80 transition hover:border-primary/40"
      role={onClick ? "button" : undefined}
      onClick={onClick}
    >
      <div className="text-xs text-white/50">{label}</div>
      <div className="text-2xl font-semibold text-white">{value ?? 0}</div>
    </div>
  );
}

function buildRouteMetrics(table = [], tasks = []) {
  const activeTasks = Array.isArray(tasks)
    ? tasks.filter((task) => !String(task.status || "").toLowerCase().includes("final"))
    : [];
  const routesByVehicle = new Map();
  activeTasks.forEach((task) => {
    const key = String(task.vehicleId ?? task.deviceId ?? task.device?.id ?? task.deviceId);
    if (key) routesByVehicle.set(key, task);
  });

  let totalWithRoute = 0;
  let withoutSignal = 0;
  let withSignal = 0;
  let routeDelay = 0;
  let routeDeviation = 0;
  const blocked = { total: 0, jammer: 0, violation: 0, face: 0 };

  const now = Date.now();

  for (const vehicle of table) {
    const key = String(vehicle.id ?? vehicle.deviceId);
    if (!routesByVehicle.has(key)) continue;
    totalWithRoute += 1;
    const online = vehicle.status === "online";
    if (online) withSignal += 1;
    else withoutSignal += 1;

    const reason = String(vehicle.position?.attributes?.alarm ?? vehicle.alerts?.[0] ?? "").toLowerCase();
    const isBlocked = Boolean(vehicle.device?.blocked || vehicle.position?.blocked || vehicle.status === "blocked");
    if (isBlocked) {
      blocked.total += 1;
      if (reason.includes("jam")) blocked.jammer += 1;
      if (reason.includes("viol")) blocked.violation += 1;
      if (reason.includes("face")) blocked.face += 1;
    }

    const task = routesByVehicle.get(key);
    const startExpected = task?.startTimeExpected ? Date.parse(task.startTimeExpected) : null;
    const endExpected = task?.endTimeExpected ? Date.parse(task.endTimeExpected) : null;
    const statusText = String(task?.status || "").toLowerCase();
    if (startExpected && now > startExpected && !statusText.includes("final")) routeDelay += 1;
    if (endExpected && now > endExpected && !statusText.includes("final")) routeDeviation += 1;
  }

  return { totalWithRoute, withoutSignal, withSignal, routeDelay, routeDeviation, blocked };
}

function buildOfflineBuckets(table = []) {
  const now = Date.now();
  const offlineVehicles = table.filter((item) => item.status === "offline" || item.status === "blocked");

  const withLast = offlineVehicles.map((vehicle) => {
    const lastUpdate = vehicle.lastUpdate ? Date.parse(vehicle.lastUpdate) : null;
    const minutes = lastUpdate ? (now - lastUpdate) / (1000 * 60) : Infinity;
    return { ...vehicle, offlineMinutes: minutes };
  });

  return COMMUNICATION_BUCKETS.map((bucket) => ({
    label: bucket.label,
    filterKey: bucket.key,
    vehicles: withLast.filter(
      (vehicle) => vehicle.offlineMinutes >= bucket.minMinutes && vehicle.offlineMinutes < bucket.maxMinutes,
    ),
  }));
}

function normalizeSeverity(event) {
  const raw = event?.attributes?.alarm ?? event?.severity ?? event?.level ?? "normal";
  const normalized = String(raw).toLowerCase();
  if (normalized.includes("crit")) return "critical";
  if (normalized.includes("high") || normalized.includes("alta")) return "high";
  if (normalized.includes("low") || normalized.includes("baixa")) return "low";
  if (normalized.includes("info")) return "info";
  return "normal";
}

function percentage(value, total) {
  if (!total) return "0%";
  return `${Math.round((Number(value || 0) / total) * 100)}%`;
}

function formatDate(value, locale = "pt-BR") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(locale);
}
