import React, { useMemo, useState } from "react";
import useDevices from "../lib/hooks/useDevices";
import { useReports } from "../lib/hooks/useReports";

export default function Reports() {
  const { devices: deviceList } = useDevices();
  const devices = useMemo(() => (Array.isArray(deviceList) ? deviceList : []), [deviceList]);
  const { data, loading, error, generateTripsReport, downloadTripsCsv } = useReports();

  const [deviceId, setDeviceId] = useState("");
  const [from, setFrom] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));

  async function handleGenerate(event) {
    event.preventDefault();
    if (!deviceId) return;
    await generateTripsReport({ deviceId, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
  }

  async function handleDownload() {
    if (!deviceId) return;
    await downloadTripsCsv({ deviceId, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
  }

  const trips = Array.isArray(data) ? data : Array.isArray(data?.trips) ? data.trips : [];

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <header>
          <h2 className="text-lg font-semibold">Relatórios de viagens</h2>
          <p className="text-xs opacity-70">Selecione o veículo e o período para gerar relatórios detalhados.</p>
        </header>

        <form onSubmit={handleGenerate} className="grid gap-4 md:grid-cols-4">
          <label className="text-sm md:col-span-2">
            <span className="block text-xs uppercase tracking-wide opacity-60">Veículo</span>
            <select
              required
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
            >
              <option value="" disabled>
                Selecione um dispositivo
              </option>
              {devices.map((device) => (
                <option key={device.id ?? device.deviceId ?? device.uniqueId} value={device.id ?? device.deviceId ?? device.uniqueId}>
                  {device.name ?? device.uniqueId ?? device.id}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide opacity-60">De</span>
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide opacity-60">Até</span>
            <input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <div className="flex items-center gap-2 md:col-span-4">
            <button
              type="submit"
              disabled={loading || !deviceId}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
            >
              {loading ? "Gerando…" : "Gerar relatório"}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={loading || !deviceId}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-white/10 disabled:opacity-60"
            >
              Exportar CSV
            </button>
          </div>
        </form>

        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error.message}</div>}
      </section>

      <section className="card space-y-4">
        <header className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Últimas viagens</h3>
          <span className="text-xs opacity-60">{trips.length} registros</span>
        </header>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider opacity-60">
              <tr>
                <th className="py-2 pr-6">Início</th>
                <th className="py-2 pr-6">Fim</th>
                <th className="py-2 pr-6">Duração</th>
                <th className="py-2 pr-6">Distância</th>
                <th className="py-2 pr-6">Vel. média</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-sm opacity-60">
                    Processando relatório…
                  </td>
                </tr>
              )}
              {!loading && !trips.length && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-sm opacity-60">
                    Gere um relatório para visualizar as viagens.
                  </td>
                </tr>
              )}
              {trips.map((trip) => (
                <tr key={`${trip.deviceId}-${trip.startTime}-${trip.endTime}`} className="hover:bg-white/5">
                  <td className="py-2 pr-6 text-white/80">{formatDate(trip.startTime)}</td>
                  <td className="py-2 pr-6 text-white/80">{formatDate(trip.endTime)}</td>
                  <td className="py-2 pr-6 text-white/70">{formatDuration(trip.duration)}</td>
                  <td className="py-2 pr-6 text-white/70">{formatDistance(trip.distance)}</td>
                  <td className="py-2 pr-6 text-white/70">{formatSpeed(trip.averageSpeed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return String(value);
  }
}

function formatDuration(seconds) {
  if (!seconds) return "—";
  const total = Number(seconds);
  if (!Number.isFinite(total)) return "—";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatDistance(distance) {
  if (!distance) return "0 km";
  const value = Number(distance);
  if (!Number.isFinite(value)) return "—";
  return `${(value / 1000).toFixed(1)} km`;
}

function formatSpeed(speed) {
  if (!speed) return "0 km/h";
  const value = Number(speed);
  if (!Number.isFinite(value)) return "—";
  return `${(value * 1.852).toFixed(1)} km/h`;
}
