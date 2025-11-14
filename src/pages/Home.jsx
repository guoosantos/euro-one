import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { useTenant } from "../lib/tenant-context";
import { useFleetDevices } from "../lib/useFleetDevices";
import { API } from "../lib/api";
import {
  analyticsTimeline,
  deliveries,
  events as mockEvents,
  trips,
  vehicles as mockVehicles,
} from "../mock/fleet";

function percentage(partial, total) {
  if (!total) return 0;
  return Math.round((partial / total) * 100);
}

function formatDateTime(dateLike) {
  if (!dateLike) return "—";
  try {
    return new Date(dateLike).toLocaleString();
  } catch (error) {
    return String(dateLike);
  }
}

export default function Home() {
  const { tenantId } = useTenant();
  const {
    devices,
    summary,
    source,
    lastUpdated,
    lastRealtime,
  } = useFleetDevices({ enableRealtime: true });

  const tenantVehicles = useMemo(() => {
    if (devices.length) return devices;
    return mockVehicles.filter((vehicle) => vehicle.tenantId === tenantId);
  }, [devices, tenantId]);

  const eventsQuery = useQuery({
    queryKey: ["events-home", tenantId],
    queryFn: async () => {
      const { data } = await API.events.list({ tenantId, limit: 8 });
      return data;
    },
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });

  const remoteEvents = Array.isArray(eventsQuery.data) ? eventsQuery.data : [];
  const tenantEvents = useMemo(() => {
    if (remoteEvents.length) {
      return remoteEvents.slice(0, 6).map((event) => normaliseEvent(event, tenantVehicles));
    }
    return mockEvents
      .filter((event) => event.tenantId === tenantId)
      .slice(0, 6)
      .map((event) => normaliseEvent(event, tenantVehicles));
  }, [remoteEvents, tenantVehicles, tenantId]);

  const tenantDeliveries = useMemo(
    () => deliveries.filter((delivery) => delivery.tenantId === tenantId).slice(0, 3),
    [tenantId],
  );
  const tenantTrips = useMemo(
    () => trips.filter((trip) => trip.tenantId === tenantId).slice(0, 4),
    [tenantId],
  );

  const statusCards = [
    { title: "Veículos monitorados", value: summary.total },
    {
      title: "Ativos online",
      value: summary.online,
      hint: `${percentage(summary.online, summary.total)}% em rota`,
    },
    { title: "Em alerta", value: summary.alert, hint: "Eventos críticos acionados", variant: "alert" },
    {
      title: "Câmeras operacionais",
      value: summary.live,
      hint: "Dispositivos transmitindo agora",
    },
  ];

  const dataTimestamp = lastRealtime ?? lastUpdated;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statusCards.map((card) => (
          <StatCard key={card.title} {...card} />
        ))}
      </section>

      <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
        <DataStatus source={source} />
        {dataTimestamp && (
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
            Atualizado em {formatDateTime(dataTimestamp)}
          </span>
        )}
      </div>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <header className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-white">Eventos recentes</div>
              <div className="text-xs text-white/50">Sincronizado automaticamente a cada minuto</div>
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
                {tenantEvents.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-white/40">
                      Nenhum evento nas últimas horas.
                    </td>
                  </tr>
                )}
                {tenantEvents.map((event) => (
                  <tr key={event.id} className="border-b border-white/5">
                    <td className="py-2 pr-6 text-white/70">{formatDateTime(event.timestamp)}</td>
                    <td className="py-2 pr-6 text-white/80">{event.type}</td>
                    <td className="py-2 pr-6 text-white/70">{event.vehicleName}</td>
                    <td className="py-2 pr-6">
                      <SeverityBadge severity={event.severity} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card space-y-4">
          <div>
            <div className="text-sm font-medium text-white">Entregas & SLA</div>
            <div className="text-xs text-white/50">Roteirização em tempo real</div>
          </div>
          <ul className="space-y-3 text-sm text-white/80">
            {tenantDeliveries.length === 0 && <li className="text-white/50">Nenhuma rota ativa.</li>}
            {tenantDeliveries.map((delivery) => {
              const vehicle = tenantVehicles.find((item) => String(item.id) === String(delivery.vehicleId));
              return (
                <li key={delivery.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{delivery.route}</div>
                    <span className="text-xs text-white/40">{delivery.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-white/50">
                    {delivery.completed} de {delivery.total} entregas concluídas · ETA {formatDateTime(delivery.eta)}
                  </div>
                  <div className="mt-1 text-xs text-white/40">{vehicle?.name ?? "Veículo"}</div>
                </li>
              );
            })}
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
              {tenantTrips.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-white/40">
                    Nenhum trajeto registrado.
                  </td>
                </tr>
              )}
              {tenantTrips.map((trip) => {
                const vehicle = tenantVehicles.find((item) => String(item.id) === String(trip.vehicleId));
                return (
                  <tr key={trip.id} className="border-b border-white/5">
                    <td className="py-2 pr-6 text-white/80">{vehicle?.name ?? trip.vehicleId}</td>
                    <td className="py-2 pr-6 text-white/60">{formatDateTime(trip.start)}</td>
                    <td className="py-2 pr-6 text-white/60">{formatDateTime(trip.end)}</td>
                    <td className="py-2 pr-6 text-white/80">{trip.distanceKm} km</td>
                    <td className="py-2 pr-6 text-white/80">{trip.avgSpeed} km/h</td>
                    <td className="py-2 pr-6 text-white/80">{trip.alerts}</td>
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
        </header>
        <AnalyticsChart data={analyticsTimeline} />
      </section>
    </div>
  );
}

function DataStatus({ source }) {
  const isLive = source === "realtime" || source === "socket";
  const label = isLive ? (source === "socket" ? "Streaming ao vivo" : "Dados sincronizados") : "Modo demonstração";
  const tone = isLive
    ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
    : "border-white/10 bg-white/5 text-white/60";
  return <span className={`rounded-full border px-3 py-1 ${tone}`}>{label}</span>;
}

function StatCard({ title, value, hint, variant = "default" }) {
  const palette = {
    default: "bg-[#12161f] border border-white/5",
    alert: "bg-red-500/10 border border-red-500/30",
  };

  return (
    <div className={`rounded-2xl p-4 ${palette[variant] ?? palette.default}`}>
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
    info: "bg-white/10 text-white/70 border border-white/20",
  };
  const label =
    normalized === "critical"
      ? "Crítica"
      : normalized === "high"
      ? "Alta"
      : normalized === "medium"
      ? "Média"
      : normalized === "low"
      ? "Baixa"
      : "Info";
  return <span className={`rounded-full px-3 py-1 text-xs ${palette[normalized] ?? palette.info}`}>{label}</span>;
}

function AnalyticsChart({ data }) {
  const maxDistance = Math.max(...data.map((item) => item.distance));
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-3">
        {data.map((item) => (
          <div key={item.month} className="flex items-center gap-3">
            <div className="w-12 text-sm text-white/60">{item.month}</div>
            <div className="flex-1 rounded-full bg-white/10">
              <div
                className="h-3 rounded-full bg-primary"
                style={{ width: `${Math.round((item.distance / maxDistance) * 100)}%` }}
              />
            </div>
            <div className="w-20 text-right text-xs text-white/50">{item.distance.toLocaleString()} km</div>
          </div>
        ))}
      </div>
      <div className="space-y-3">
        {data.map((item) => (
          <div key={`${item.month}-alerts`} className="flex items-center justify-between text-sm text-white/70">
            <span>{item.month}</span>
            <span>{item.alerts} alertas · {item.deliveriesOnTime}% SLA</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function normaliseEvent(event, vehicles) {
  const deviceId = resolveDeviceId(event);
  const vehicle = vehicles.find((item) => String(item.id) === String(deviceId));
  return {
    id: event.id ?? `${deviceId}-${event.time ?? event.serverTime ?? event.deviceTime ?? Math.random()}`,
    timestamp: event.time ?? event.serverTime ?? event.deviceTime ?? event.sentAt ?? event.createdAt,
    type: event.type ?? event.eventType ?? event.attributes?.type ?? "Evento",
    severity: event.severity ?? event.level ?? event.priority ?? event.attributes?.severity ?? "medium",
    vehicleName: vehicle?.name ?? event.deviceName ?? deviceId ?? "Dispositivo",
  };
}

function resolveDeviceId(event) {
  return (
    event.deviceId ??
    event.device_id ??
    event.device?.id ??
    event.device ??
    event.attributes?.deviceId ??
    event.position?.deviceId ??
    null
  );
}
