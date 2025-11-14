import { useMemo } from "react";
import { Link } from "react-router-dom";

import { useTenant } from "../lib/tenant-context";
import {
  analyticsTimeline,
  deliveries,
  events,
  summariseFleet,
  trips,
  vehicles,
} from "../mock/fleet";

function percentage(partial, total) {
  if (!total) return 0;
  return Math.round((partial / total) * 100);
}

function toLocale(dateLike) {
  try {
    return new Date(dateLike).toLocaleString();
  } catch (error) {
    return String(dateLike);
  }
}

export default function Home() {
  const { tenantId } = useTenant();

  const summary = useMemo(() => summariseFleet(tenantId), [tenantId]);
  const tenantVehicles = useMemo(() => vehicles.filter((vehicle) => vehicle.tenantId === tenantId), [tenantId]);
  const tenantEvents = useMemo(() => events.filter((event) => event.tenantId === tenantId).slice(0, 6), [tenantId]);
  const tenantDeliveries = useMemo(
    () => deliveries.filter((delivery) => delivery.tenantId === tenantId).slice(0, 3),
    [tenantId],
  );
  const tenantTrips = useMemo(() => trips.filter((trip) => trip.tenantId === tenantId).slice(0, 4), [tenantId]);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Veículos monitorados" value={summary.total} />
        <StatCard title="Ativos online" value={summary.online} hint={`${percentage(summary.online, summary.total)}% em rota`} />
        <StatCard title="Em alerta" value={summary.alert} hint="Eventos críticos acionados" variant="alert" />
        <StatCard title="Câmeras operacionais" value={summary.camerasOk} hint="Integrações Euro View" />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <header className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-white">Eventos recentes</div>
              <div className="text-xs text-white/50">Sincronizado às {new Date().toLocaleTimeString()}</div>
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
                {tenantEvents.map((event) => {
                  const vehicle = tenantVehicles.find((item) => item.id === event.deviceId);
                  return (
                    <tr key={event.id} className="border-b border-white/5">
                      <td className="py-2 pr-6 text-white/70">{toLocale(event.time)}</td>
                      <td className="py-2 pr-6 text-white/80">{event.type}</td>
                      <td className="py-2 pr-6 text-white/70">{vehicle?.name ?? event.deviceId}</td>
                      <td className="py-2 pr-6">
                        <SeverityBadge severity={event.severity} />
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
            <div className="text-sm font-medium text-white">Entregas & SLA</div>
            <div className="text-xs text-white/50">Roteirização em tempo real</div>
          </div>
          <ul className="space-y-3 text-sm text-white/80">
            {tenantDeliveries.length === 0 && <li className="text-white/50">Nenhuma rota ativa.</li>}
            {tenantDeliveries.map((delivery) => {
              const vehicle = tenantVehicles.find((item) => item.id === delivery.vehicleId);
              return (
                <li key={delivery.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{delivery.route}</div>
                    <span className="text-xs text-white/40">{delivery.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-white/50">
                    {delivery.completed} de {delivery.total} entregas concluídas · ETA {toLocale(delivery.eta)}
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
                const vehicle = tenantVehicles.find((item) => item.id === trip.vehicleId);
                return (
                  <tr key={trip.id} className="border-b border-white/5">
                    <td className="py-2 pr-6 text-white/80">{vehicle?.name ?? trip.vehicleId}</td>
                    <td className="py-2 pr-6 text-white/60">{toLocale(trip.start)}</td>
                    <td className="py-2 pr-6 text-white/60">{toLocale(trip.end)}</td>
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
  };
  const label =
    normalized === "critical"
      ? "Crítica"
      : normalized === "high"
      ? "Alta"
      : normalized === "medium"
      ? "Média"
      : "Baixa";
  return <span className={`rounded-full px-3 py-1 text-xs ${palette[normalized] ?? palette.low}`}>{label}</span>;
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
