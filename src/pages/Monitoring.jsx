import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCcw } from "lucide-react";

import LeafletMap from "../components/LeafletMap";
import FleetPopup from "../components/FleetPopup";
import { useFleetDevices, FLEET_STATUS_LABELS } from "../lib/useFleetDevices";

const statusLabels = {
  ...FLEET_STATUS_LABELS,
  all: "Todos",
};

export default function Monitoring() {
  const { devices, summary, isLoading, isFetching, refetch, source, lastUpdated } = useFleetDevices();
  const [statusFilter, setStatusFilter] = useState("all");

  const filteredTable = useMemo(() => {
    if (statusFilter === "all") return devices;
    return devices.filter((item) => item.status === statusFilter);
  }, [devices, statusFilter]);

  const markers = useMemo(
    () =>
      filteredTable
        .filter((vehicle) => Number.isFinite(vehicle.lat) && Number.isFinite(vehicle.lng))
        .map((vehicle) => ({
          id: vehicle.id,
          lat: vehicle.lat,
          lng: vehicle.lng,
          status: vehicle.status,
          speed: vehicle.speed,
          ignition: vehicle.ignition,
          course: vehicle.course,
          label: `${vehicle.name} · ${vehicle.plate ?? vehicle.id}`,
          popup: <FleetPopup device={vehicle} />,
        })),
    [filteredTable],
  );

  const badgeTone = source === "realtime" ? "border-emerald-400/40 text-emerald-200" : "border-white/10 text-white/60";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/60">
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ${badgeTone}`}>
          {source === "realtime" ? "Dados ao vivo" : "Dados de demonstração"}
          {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
        </span>
        <div className="flex items-center gap-3">
          {lastUpdated && <span>Atualizado em {formatTime(lastUpdated)}</span>}
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-white/70 transition hover:border-primary/60 hover:text-white"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
            Atualizar
          </button>
        </div>
      </div>

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
            {["all", "online", "alert", "offline", "blocked"].map((status) => (
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
                {statusLabels[status] ?? status}
              </button>
            ))}
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-2">
          <LeafletMap markers={markers} autoFit fullscreen={false} height={420} />
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
          <div className="text-xs text-white/50">
            {isLoading ? "Carregando telemetria…" : `${filteredTable.length} veículos exibidos`}
          </div>
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
                <th className="py-2 pr-4">Satélites</th>
                <th className="py-2 pr-4">Odom.</th>
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
                  <td className="py-3 pr-4 text-white/60">{vehicle.plate ?? "—"}</td>
                  <td className="py-3 pr-4 text-white/70">{statusLabels[vehicle.status] ?? vehicle.status}</td>
                  <td className="py-3 pr-4 text-white/60">{formatTime(vehicle.lastUpdate)}</td>
                  <td className="py-3 pr-4 text-white/60">{vehicle.address ?? "—"}</td>
                  <td className="py-3 pr-4 text-white/70">{valueOrDash(vehicle.speed, "km/h")}</td>
                  <td className="py-3 pr-4 text-white/70">{vehicle.ignition ? "Ligada" : "Desligada"}</td>
                  <td className="py-3 pr-4 text-white/70">{valueOrDash(vehicle.battery, "%")}</td>
                  <td className="py-3 pr-4 text-white/70">{valueOrDash(vehicle.signal, "dBm")}</td>
                  <td className="py-3 pr-4 text-white/70">{vehicle.satellites ?? "—"}</td>
                  <td className="py-3 pr-4 text-white/70">{valueOrDash(vehicle.odometer, "km")}</td>
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
  if (typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString();
  }
  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return value;
  }
}

function valueOrDash(value, unit) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  if (unit) {
    const numeric = Number(value);
    return `${Math.round(numeric)} ${unit}`;
  }
  return value;
}
