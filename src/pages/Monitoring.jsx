import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import LeafletMap from "../components/LeafletMap";
import { useTenant } from "../lib/tenant-context";
import { buildVehicleTable, summariseFleet, vehicles } from "../mock/fleet";

const statusLabels = {
  online: "Online",
  alert: "Alerta",
  offline: "Offline",
};

export default function Monitoring() {
  const { tenantId } = useTenant();
  const [statusFilter, setStatusFilter] = useState("all");

  const summary = useMemo(() => summariseFleet(tenantId), [tenantId]);
  const table = useMemo(() => buildVehicleTable(tenantId), [tenantId]);

  const filteredTable = useMemo(() => {
    if (statusFilter === "all") return table;
    return table.filter((item) => item.status === statusFilter);
  }, [statusFilter, table]);

  const markers = useMemo(
    () =>
      vehicles
        .filter((vehicle) => vehicle.tenantId === tenantId)
        .filter((vehicle) => (statusFilter === "all" ? true : vehicle.status === statusFilter))
        .map((vehicle) => ({
          lat: vehicle.lat,
          lng: vehicle.lng,
          label: `${vehicle.name} · ${vehicle.plate}`,
        })),
    [statusFilter, tenantId],
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <StatusCard title="Online" value={summary.online} tone="green" />
        <StatusCard title="Em alerta" value={summary.alert} tone="yellow" />
        <StatusCard title="Offline" value={summary.offline} tone="red" />
        <StatusCard title="Bloqueados" value={summary.blocked} tone="purple" />
      </div>

      <div className="card space-y-4">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-medium text-white">Filtros rápidos</div>
            <div className="text-xs text-white/40">Personalize a visualização da frota</div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {(["all", "online", "alert", "offline"]).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`rounded-full px-4 py-2 transition ${
                  statusFilter === status
                    ? "bg-primary text-white"
                    : "bg-white/5 text-white/60 hover:bg-white/10"
                }`}
              >
                {status === "all" ? "Todos" : statusLabels[status]}
              </button>
            ))}
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-2">
          <LeafletMap markers={markers} />
          <div className="rounded-2xl border border-white/5 bg-white/5 p-4 text-sm text-white/70">
            <div className="font-medium text-white">Resumo inteligente</div>
            <ul className="mt-3 space-y-2">
              <li>Veículos com ignição ligada: {filteredTable.filter((item) => item.ignition).length}</li>
              <li>Velocidade média: {average(filteredTable.map((item) => item.speed)).toFixed(1)} km/h</li>
              <li>Sinal médio: {average(filteredTable.map((item) => item.signal)).toFixed(0)} dBm</li>
            </ul>
            <Link to="/deliveries" className="mt-3 inline-flex items-center text-xs text-primary">
              Abrir entregas
            </Link>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium text-white">Frota em tempo real</div>
          <div className="text-xs text-white/50">{filteredTable.length} veículos exibidos</div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-white/40">
              <tr className="border-b border-white/10 text-left">
                <th className="py-2 pr-4">Veículo</th>
                <th className="py-2 pr-4">Placa</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Atualização</th>
                <th className="py-2 pr-4">Endereço</th>
                <th className="py-2 pr-4">Velocidade</th>
                <th className="py-2 pr-4">Ignição</th>
                <th className="py-2 pr-4">Bateria</th>
                <th className="py-2 pr-4">Sinal</th>
                <th className="py-2 pr-4">Alertas</th>
                <th className="py-2 pr-4">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredTable.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-6 text-center text-white/40">
                    Nenhum veículo corresponde aos filtros.
                  </td>
                </tr>
              )}
              {filteredTable.map((vehicle) => (
                <tr key={vehicle.id} className="border-b border-white/5">
                  <td className="py-3 pr-4 text-white/80">{vehicle.name}</td>
                  <td className="py-3 pr-4 text-white/60">{vehicle.plate}</td>
                  <td className="py-3 pr-4 text-white/70">{statusLabels[vehicle.status] ?? vehicle.status}</td>
                  <td className="py-3 pr-4 text-white/60">{formatTime(vehicle.lastUpdate)}</td>
                  <td className="py-3 pr-4 text-white/60">{vehicle.address}</td>
                  <td className="py-3 pr-4 text-white/70">{vehicle.speed ?? 0} km/h</td>
                  <td className="py-3 pr-4 text-white/70">{vehicle.ignition ? "Ligada" : "Desligada"}</td>
                  <td className="py-3 pr-4 text-white/70">{vehicle.battery}%</td>
                  <td className="py-3 pr-4 text-white/70">{vehicle.signal} dBm</td>
                  <td className="py-3 pr-4 text-white/70">{vehicle.alerts?.length ?? 0}</td>
                  <td className="py-3 pr-4 text-white/60">
                    <div className="flex items-center gap-2">
                      <Link className="rounded-lg bg-white/10 px-2 py-1 text-xs" to={`/trips?vehicle=${vehicle.id}`}>
                        Replay
                      </Link>
                      <a
                        className="rounded-lg bg-white/10 px-2 py-1 text-xs"
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                          vehicle.address ?? "",
                        )}`}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Maps
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusCard({ title, value, tone }) {
  const palette = {
    green: "border-emerald-400/30 bg-emerald-500/10",
    yellow: "border-amber-300/30 bg-amber-400/10",
    red: "border-red-400/30 bg-red-500/10",
    purple: "border-purple-400/30 bg-purple-500/10",
  };
  return (
    <div className={`rounded-2xl border p-4 text-white ${palette[tone]}`}>
      <div className="text-xs text-white/60">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((total, current) => total + (Number(current) || 0), 0) / values.length;
}

function formatTime(value) {
  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return value;
  }
}
