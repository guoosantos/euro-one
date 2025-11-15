import React, { useMemo, useState } from "react";
import useDevices from "../lib/hooks/useDevices";
import useReportsRoute from "../lib/hooks/useReportsRoute";

export default function ReportsRoute() {
  const { devices: deviceList } = useDevices();
  const devices = useMemo(() => (Array.isArray(deviceList) ? deviceList : []), [deviceList]);
  const { data, loading, error, generate } = useReportsRoute();

  const [deviceId, setDeviceId] = useState("");
  const [from, setFrom] = useState(() => new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [fetching, setFetching] = useState(false);

  const points = Array.isArray(data?.positions) ? data.positions : Array.isArray(data) ? data : [];

  async function handleSubmit(event) {
    event.preventDefault();
    if (!deviceId) return;
    setFetching(true);
    try {
      await generate({ deviceId, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
    } finally {
      setFetching(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <header>
          <h2 className="text-lg font-semibold">Relatório de rota</h2>
          <p className="text-xs opacity-70">Extrai todos os pontos percorridos no intervalo informado.</p>
        </header>

        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-4">
          <label className="text-sm md:col-span-2">
            <span className="block text-xs uppercase tracking-wide opacity-60">Dispositivo</span>
            <select
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
              required
            >
              <option value="" disabled>
                Selecione um dispositivo
              </option>
              {devices.map((device) => (
                <option key={device.id ?? device.uniqueId} value={device.id ?? device.uniqueId}>
                  {device.name ?? device.uniqueId ?? device.id}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide opacity-60">Início</span>
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide opacity-60">Fim</span>
            <input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <div className="md:col-span-4 flex items-center gap-3">
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
              disabled={fetching || loading || !deviceId}
            >
              {fetching ? "Gerando…" : "Gerar"}
            </button>
          </div>
        </form>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error.message}</div>
        )}
      </section>

      <section className="card space-y-4">
        <header className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Pontos encontrados</h3>
          <span className="text-xs opacity-60">{points.length} registros</span>
        </header>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide opacity-60">
              <tr>
                <th className="py-2 pr-6">Horário</th>
                <th className="py-2 pr-6">Latitude</th>
                <th className="py-2 pr-6">Longitude</th>
                <th className="py-2 pr-6">Velocidade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-sm opacity-60">
                    Processando rota…
                  </td>
                </tr>
              )}
              {!loading && !points.length && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-sm opacity-60">
                    Gere um relatório para visualizar os pontos percorridos.
                  </td>
                </tr>
              )}
              {points.map((point) => (
                <tr key={`${point.deviceId}-${point.fixTime}-${point.latitude}-${point.longitude}`} className="hover:bg-white/5">
                  <td className="py-2 pr-6 text-white/80">{formatDate(point.fixTime || point.serverTime)}</td>
                  <td className="py-2 pr-6 text-white/70">{formatCoordinate(point.latitude)}</td>
                  <td className="py-2 pr-6 text-white/70">{formatCoordinate(point.longitude)}</td>
                  <td className="py-2 pr-6 text-white/70">{formatSpeed(point.speed)}</td>
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
  } catch (_error) {
    return String(value);
  }
}

function formatCoordinate(value) {
  if (value === null || value === undefined) return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toFixed(5);
}

function formatSpeed(value) {
  if (value === null || value === undefined) return "0 km/h";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return `${(number * 1.852).toFixed(1)} km/h`;
}
