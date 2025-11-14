import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import LeafletMap from "../components/LeafletMap";
import { useTenant } from "../lib/tenant-context";
import { useDevices } from "../lib/hooks/useDevices";
import { useLivePositions } from "../lib/hooks/useLivePositions";
import { buildFleetState } from "../lib/fleet-utils";

const statusLabels = {
  online: "Online",
  alert: "Alerta",
  offline: "Offline",
  blocked: "Bloqueado",
};

const filters = ["all", "online", "alert", "offline", "blocked"];

export default function Monitoring() {
  const { tenantId } = useTenant();
  const [statusFilter, setStatusFilter] = useState("all");

  const {
    devices,
    loading: loadingDevices,
    error: devicesError,
    fetchedAt: devicesFetchedAt,
    refresh: refreshDevices,
  } = useDevices({ tenantId, autoRefreshMs: 5 * 60 * 1000 });

  const {
    positions,
    loading: loadingPositions,
    error: positionsError,
    fetchedAt,
    refresh: refreshPositions,
  } = useLivePositions({ tenantId, refreshInterval: 30 * 1000 });

  const { table, summary } = useMemo(() => {
    const { rows, stats } = buildFleetState(devices, positions, { tenantId });
    return { table: rows, summary: stats };
  }, [devices, positions, tenantId]);

  const filteredTable = useMemo(() => {
    if (statusFilter === "all") return table;
    return table.filter((item) => item.status === statusFilter);
  }, [statusFilter, table]);

  const markers = useMemo(() => {
    return filteredTable
      .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng))
      .map((item) => ({
        lat: item.lat,
        lng: item.lng,
        label: `${item.name}${item.plate ? ` · ${item.plate}` : ""}${
          item.speed != null ? ` (${item.speed} km/h)` : ""
        }`,
      }));
  }, [filteredTable]);

  const mapCenter = useMemo(() => {
    const first = markers[0];
    return first ? [first.lat, first.lng] : undefined;
  }, [markers]);

  const ignitionCount = useMemo(
    () => filteredTable.filter((item) => item.ignition === true).length,
    [filteredTable],
  );

  const isLoading = loadingDevices || loadingPositions;
  const errorMessage = devicesError || positionsError;

  return (
    <div className="space-y-5">
      {errorMessage && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          Falha ao sincronizar telemetria em tempo real. {errorMessage.message ?? "Tente novamente em instantes."}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <StatusCard title="Online" value={isLoading ? "…" : summary.online} tone="green" />
        <StatusCard title="Em alerta" value={isLoading ? "…" : summary.alert} tone="yellow" />
        <StatusCard title="Offline" value={isLoading ? "…" : summary.offline} tone="red" />
        <StatusCard title="Bloqueados" value={isLoading ? "…" : summary.blocked} tone="purple" />
      </div>

      <div className="card space-y-4">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-medium text-white">Filtros rápidos</div>
            <div className="text-xs text-white/40">Personalize a visualização da frota</div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex flex-wrap gap-2">
              {filters.map((status) => (
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
                  {status === "all" ? "Todos" : statusLabels[status] ?? status}
                </button>
              ))}
            </div>
            <LiveIndicator
              fetchedAt={fetchedAt}
              positionsLoading={loadingPositions}
              onRefresh={() => {
                refreshPositions();
                refreshDevices();
              }}
              devicesFetchedAt={devicesFetchedAt}
            />
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-2">
          <LeafletMap markers={markers} center={mapCenter} />
          <div className="rounded-2xl border border-white/5 bg-white/5 p-4 text-sm text-white/70">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-white">Resumo inteligente</div>
              {fetchedAt && (
                <span className="text-xs text-white/40">Atualizado às {new Date(fetchedAt).toLocaleTimeString()}</span>
              )}
            </div>
            <ul className="mt-3 space-y-2">
              <li>Veículos com ignição ligada: {ignitionCount}</li>
              <li>Velocidade média: {formatAverage(filteredTable.map((item) => item.speed))} km/h</li>
              <li>Sinal médio: {formatAverage(filteredTable.map((item) => item.signal))} dBm</li>
            </ul>
            <Link to="/deliveries" className="mt-3 inline-flex items-center text-xs text-primary">
              Abrir entregas
            </Link>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="text-sm font-medium text-white">Frota em tempo real</div>
          <div className="text-xs text-white/50">
            {filteredTable.length} veículos exibidos · posição sincronizada às {fetchedAt
              ? new Date(fetchedAt).toLocaleTimeString()
              : "—"}
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
                  <td className="py-3 pr-4 text-white/60">{vehicle.address || "—"}</td>
                  <td className="py-3 pr-4 text-white/70">{formatMetric(vehicle.speed, "km/h")}</td>
                  <td className="py-3 pr-4 text-white/70">{formatIgnition(vehicle.ignition)}</td>
                  <td className="py-3 pr-4 text-white/70">{formatMetric(vehicle.battery, "%")}</td>
                  <td className="py-3 pr-4 text-white/70">{formatMetric(vehicle.signal, "dBm")}</td>
                  <td className="py-3 pr-4 text-white/70">{vehicle.alerts?.length ?? 0}</td>
                  <td className="py-3 pr-4 text-white/60">
                    <div className="flex items-center gap-2">
                      <Link className="rounded-lg bg-white/10 px-2 py-1 text-xs" to={`/trips?vehicle=${vehicle.id}`}>
                        Replay
                      </Link>
                      {Number.isFinite(vehicle.lat) && Number.isFinite(vehicle.lng) ? (
                        <a
                          className="rounded-lg bg-white/10 px-2 py-1 text-xs"
                          href={`https://www.google.com/maps/search/?api=1&query=${vehicle.lat},${vehicle.lng}`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Maps
                        </a>
                      ) : (
                        <span className="rounded-lg bg-white/5 px-2 py-1 text-xs text-white/40">Sem coordenada</span>
                      )}
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

function LiveIndicator({ fetchedAt, positionsLoading, onRefresh, devicesFetchedAt }) {
  return (
    <div className="flex items-center gap-2 text-xs text-white/50">
      <span className="flex items-center gap-1 rounded-full border border-green-400/40 bg-green-500/10 px-2 py-1 text-green-200">
        <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" /> Ao vivo
      </span>
      <span className="hidden text-white/50 md:inline">
        Posicionamento: {fetchedAt ? new Date(fetchedAt).toLocaleTimeString() : "—"}
      </span>
      <span className="hidden text-white/40 lg:inline">
        Inventário: {devicesFetchedAt ? new Date(devicesFetchedAt).toLocaleTimeString() : "—"}
      </span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={positionsLoading}
        className="rounded-full border border-white/10 px-3 py-1 text-white/60 transition hover:text-white disabled:opacity-50"
      >
        Atualizar
      </button>
    </div>
  );
}

function formatAverage(values) {
  const valid = values.map((value) => Number(value) || 0).filter((value) => Number.isFinite(value));
  if (!valid.length) return "0";
  const average = valid.reduce((total, current) => total + current, 0) / valid.length;
  return average.toFixed(1);
}

function formatMetric(value, unit) {
  if (!Number.isFinite(value)) return "—";
  return `${Math.round(Number(value) * 10) / 10}${unit ? ` ${unit}` : ""}`;
}

function formatIgnition(value) {
  if (value === null || value === undefined) return "—";
  return value ? "Ligada" : "Desligada";
}

function formatTime(value) {
  if (!value) return "—";
  try {
    const date = typeof value === "string" || typeof value === "number" ? new Date(value) : value;
    return date.toLocaleString();
  } catch (error) {
    return String(value);
  }
}
