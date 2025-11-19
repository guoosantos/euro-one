import { useMemo } from "react";
import { Link } from "react-router-dom";

import { useTenant } from "../lib/tenant-context";
import useDevices from "../lib/hooks/useDevices";
import { useLivePositions } from "../lib/hooks/useLivePositions";
import { useEvents } from "../lib/hooks/useEvents";
import { useTrips } from "../lib/hooks/useTrips";
import { buildFleetState, parsePositionTime } from "../lib/fleet-utils";

const FALLBACK_ANALYTICS = [
  { month: "Jan", distance: 0, alerts: 0, deliveriesOnTime: 100 },
  { month: "Fev", distance: 0, alerts: 0, deliveriesOnTime: 100 },
  { month: "Mar", distance: 0, alerts: 0, deliveriesOnTime: 100 },
  { month: "Abr", distance: 0, alerts: 0, deliveriesOnTime: 100 },
  { month: "Mai", distance: 0, alerts: 0, deliveriesOnTime: 100 },
  { month: "Jun", distance: 0, alerts: 0, deliveriesOnTime: 100 },
];

export default function Home() {
  const { tenantId } = useTenant();

  const { devices, loading: loadingDevices } = useDevices({ tenantId });
  const { positions, loading: loadingPositions, fetchedAt: telemetryFetchedAt } = useLivePositions({
    tenantId,
    refreshInterval: 60 * 1000,
  });

  const { events, loading: loadingEvents, error: eventsError } = useEvents({
    tenantId,
    limit: 6,
    autoRefreshMs: 60 * 1000,
  });
  const { trips, loading: loadingTrips, error: tripsError } = useTrips({
    tenantId,
    limit: 6,
    autoRefreshMs: 5 * 60 * 1000,
  });

  const { summary, table } = useMemo(() => {
    const { rows, stats } = buildFleetState(devices, positions, { tenantId });
    return { summary: stats, table: rows };
  }, [devices, positions, tenantId]);

  const onlineVehicles = useMemo(
    () => table.filter((vehicle) => vehicle.status === "online").slice(0, 3),
    [table],
  );

  const vehicleIndex = useMemo(() => {
    const index = new Map();
    for (const item of table) {
      index.set(String(item.id), item);
    }
    return index;
  }, [table]);

  const analyticsData = useMemo(() => buildAnalytics(trips), [trips]);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Veículos monitorados"
          value={loadingDevices ? "…" : summary.total}
          hint={`Sincronizado às ${telemetryFetchedAt ? new Date(telemetryFetchedAt).toLocaleTimeString() : "—"}`}
        />
        <StatCard
          title="Ativos online"
          value={loadingPositions ? "…" : summary.online}
          hint={`${percentage(summary.online, summary.total)}% em rota`}
        />
        <StatCard
          title="Em alerta"
          value={loadingPositions ? "…" : summary.alert}
          hint="Eventos críticos em andamento"
          variant="alert"
        />
        <StatCard
          title="Rotas perigosas"
          value={table.filter((item) => Number.isFinite(item.signal)).length}
          hint="Veículos em zonas críticas"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <header className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-white">Eventos recentes</div>
              <div className="text-xs text-white/50">
                {telemetryFetchedAt ? `Atualizado às ${new Date(telemetryFetchedAt).toLocaleTimeString()}` : "Sincronizando…"}
              </div>
            </div>
            <Link to="/events" className="text-xs text-primary">
              Ver todos
            </Link>
          </header>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-white/40">
                <tr className="border-b border-white/10 text-left">
                  <th className="py-2 pr-6">Horário</th>
                  <th className="py-2 pr-6">Tipo</th>
                  <th className="py-2 pr-6">Veículo</th>
                  <th className="py-2 pr-6">Severidade</th>
                </tr>
              </thead>
              <tbody>
                {loadingEvents && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-white/40">
                      Carregando eventos…
                    </td>
                  </tr>
                )}
                {!loadingEvents && eventsError && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-red-200/80">
                      Não foi possível carregar os eventos.
                    </td>
                  </tr>
                )}
                {!loadingEvents && !eventsError && events.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-white/40">
                      Nenhum evento nas últimas horas.
                    </td>
                  </tr>
                )}
                {events.map((event) => {
                  const vehicle = resolveVehicle(event, vehicleIndex);
                  return (
                    <tr key={event.id ?? `${event.deviceId}-${event.time}`} className="border-b border-white/5">
                      <td className="py-2 pr-6 text-white/70">{formatDate(event.time ?? event.eventTime ?? event.serverTime)}</td>
                      <td className="py-2 pr-6 text-white/80">{event.type ?? event.event}</td>
                      <td className="py-2 pr-6 text-white/70">{vehicle?.name ?? vehicle?.plate ?? event.deviceName ?? "—"}</td>
                      <td className="py-2 pr-6">
                        <SeverityBadge severity={event.severity ?? event.level ?? "low"} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card space-y-4">
          <div>
            <div className="text-sm font-medium text-white">Veículos em rota</div>
            <div className="text-xs text-white/50">Telemetria ao vivo</div>
          </div>
          <ul className="space-y-3 text-sm text-white/80">
            {onlineVehicles.length === 0 && <li className="text-white/50">Nenhum veículo em movimento.</li>}
            {onlineVehicles.map((vehicle) => (
              <li key={vehicle.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{vehicle.name}</div>
                  <span className="text-xs text-white/40">{formatSpeed(vehicle.speed)}</span>
                </div>
                <div className="mt-1 text-xs text-white/50">{vehicle.address || "Localização indisponível"}</div>
                <div className="mt-1 text-xs text-white/40">
                  Atualizado {formatRelativeTime(vehicle.lastUpdate)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card">
        <header className="mb-4 flex items-center justify-between">
          <div className="text-sm font-medium text-white">Performance nas últimas viagens</div>
          <Link to="/trips" className="text-xs text-primary">
            Abrir Trajetos
          </Link>
        </header>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-white/40">
              <tr className="border-b border-white/10 text-left">
                <th className="py-2 pr-6">Veículo</th>
                <th className="py-2 pr-6">Início</th>
                <th className="py-2 pr-6">Fim</th>
                <th className="py-2 pr-6">Distância</th>
                <th className="py-2 pr-6">Vel. média</th>
                <th className="py-2 pr-6">Alertas</th>
              </tr>
            </thead>
            <tbody>
              {loadingTrips && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-white/40">
                    Carregando viagens…
                  </td>
                </tr>
              )}
              {!loadingTrips && tripsError && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-red-200/80">
                    Não foi possível carregar as viagens.
                  </td>
                </tr>
              )}
              {!loadingTrips && !tripsError && trips.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-white/40">
                    Nenhum trajeto registrado.
                  </td>
                </tr>
              )}
              {trips.map((trip) => {
                const vehicle = resolveVehicle(trip, vehicleIndex);
                return (
                  <tr key={trip.id ?? `${trip.deviceId}-${trip.start}` } className="border-b border-white/5">
                    <td className="py-2 pr-6 text-white/80">{vehicle?.name ?? vehicle?.plate ?? trip.deviceName ?? "—"}</td>
                    <td className="py-2 pr-6 text-white/60">{formatDate(trip.start ?? trip.startTime ?? trip.from)}</td>
                    <td className="py-2 pr-6 text-white/60">{formatDate(trip.end ?? trip.endTime ?? trip.to)}</td>
                    <td className="py-2 pr-6 text-white/80">{formatDistance(trip.distanceKm ?? trip.distance ?? trip.totalDistance)}</td>
                    <td className="py-2 pr-6 text-white/80">{formatSpeed(trip.avgSpeed ?? trip.averageSpeed)}</td>
                    <td className="py-2 pr-6 text-white/80">{trip.alerts ?? trip.eventCount ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <header className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-white">Analytics</div>
            <div className="text-xs text-white/50">Distância total x alertas críticos</div>
          </div>
          <span className="text-xs text-white/40">
            Baseado em {trips.length} viagens recentes
          </span>
        </header>
        <AnalyticsChart data={analyticsData.length ? analyticsData : FALLBACK_ANALYTICS} />
      </section>
    </div>
  );
}

function StatCard({ title, value, hint, variant = "default" }) {
  const palette = {
    default: "bg-[#12161f] border border-white/5",
    alert: "bg-red-500/10 border border-red-500/30",
  };

  return (
    <div className={`rounded-2xl p-4 ${palette[variant]}`}>
      <div className="text-xs text-white/50">{title}</div>
      <div className="mt-1 text-3xl font-semibold text-white">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-white/40">{hint}</div>}
    </div>
  );
}

function SeverityBadge({ severity }) {
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
      ? "Crítica"
      : normalized === "high"
      ? "Alta"
      : normalized === "medium"
      ? "Média"
      : normalized === "info"
      ? "Info"
      : "Baixa";
  return <span className={`rounded-full px-3 py-1 text-xs ${palette[normalized] ?? palette.low}`}>{label}</span>;
}

function AnalyticsChart({ data }) {
  const maxDistance = Math.max(...data.map((item) => item.distance || 0), 1);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-3">
        {data.map((item) => (
          <div key={item.month} className="flex items-center gap-3">
            <div className="w-12 text-sm text-white/60">{item.month}</div>
            <div className="flex-1 rounded-full bg-white/10">
              <div
                className="h-3 rounded-full bg-primary"
                style={{ width: `${Math.round(((item.distance || 0) / maxDistance) * 100)}%` }}
              />
            </div>
            <div className="w-20 text-right text-xs text-white/50">{formatDistance(item.distance)}</div>
          </div>
        ))}
      </div>
      <div className="space-y-3">
        {data.map((item) => (
          <div key={`${item.month}-alerts`} className="flex items-center justify-between text-sm text-white/70">
            <span>{item.month}</span>
            <span>{item.alerts ?? 0} alertas · {item.deliveriesOnTime ?? 0}% SLA</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function percentage(partial, total) {
  if (!total) return 0;
  return Math.round((partial / total) * 100);
}

function resolveVehicle(item, vehicleIndex) {
  if (!item) return null;
  const candidates = [
    item.deviceId,
    item.device?.id,
    item.vehicleId,
    item.vehicle?.id,
    item.uniqueId,
    item.device?.uniqueId,
    item.id,
  ];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const key = String(candidate);
    if (vehicleIndex.has(key)) return vehicleIndex.get(key);
  }
  return null;
}

function formatDate(value) {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString();
  } catch (error) {
    return "—";
  }
}

function formatDistance(value) {
  if (!Number.isFinite(Number(value))) return "0 km";
  const numeric = Number(value);
  const km = numeric > 1000 ? numeric / 1000 : numeric;
  return `${(Math.round(km * 10) / 10).toLocaleString()} km`;
}

function formatSpeed(value) {
  if (!Number.isFinite(Number(value))) return "—";
  const numeric = Number(value);
  const speed = numeric > 300 ? numeric * 1.852 : numeric; // fallback caso venha em nós
  return `${Math.round(speed)} km/h`;
}

function formatRelativeTime(value) {
  const timestamp = typeof value === "number" ? value : parsePositionTime({ fixTime: value });
  if (!timestamp) return "há pouco";
  const diff = Date.now() - timestamp;
  if (diff < 60 * 1000) return "há instantes";
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.round(diff / (60 * 1000));
    return `há ${minutes} min`;
  }
  const hours = Math.round(diff / (60 * 60 * 1000));
  return `há ${hours} h`;
}

function buildAnalytics(trips) {
  if (!Array.isArray(trips) || trips.length === 0) return [];
  const map = new Map();
  for (const trip of trips) {
    const timestamp = parsePositionTime({ fixTime: trip.start ?? trip.startTime ?? trip.from });
    if (!timestamp) continue;
    const date = new Date(timestamp);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const monthLabel = date.toLocaleString("pt-BR", { month: "short" });
    if (!map.has(key)) {
      map.set(key, { month: capitalize(monthLabel), distance: 0, alerts: 0, deliveriesOnTime: 100, order: timestamp });
    }
    const entry = map.get(key);
    entry.order = Math.min(entry.order, timestamp);
    const distanceValue = Number(trip.distanceKm ?? trip.distance ?? trip.totalDistance ?? 0);
    const normalizedDistance = distanceValue > 1000 ? distanceValue / 1000 : distanceValue;
    entry.distance += Number.isFinite(normalizedDistance) ? normalizedDistance : 0;
    entry.alerts += Number(trip.alerts ?? trip.eventCount ?? 0) || 0;
  }
  return Array.from(map.values())
    .sort((a, b) => a.order - b.order)
    .slice(0, 6);
}

function capitalize(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
