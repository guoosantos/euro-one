import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import useDevices from "../lib/hooks/useDevices";
import { useTranslation } from "../lib/i18n.js";
import useReports from "../lib/hooks/useReports.js";
import { formatAddress } from "../lib/format-address.js";
import { formatDateTime, pickCoordinate } from "../lib/monitoring-helpers.js";

export default function Trips() {
  const { locale } = useTranslation();
  const navigate = useNavigate();
  const { devices: deviceList } = useDevices();
  const devices = useMemo(() => (Array.isArray(deviceList) ? deviceList : []), [deviceList]);
  const { data, loading, error, generateTripsReport } = useReports();

  const [deviceId, setDeviceId] = useState("");
  const [from, setFrom] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [fetching, setFetching] = useState(false);
  const [formError, setFormError] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [selectedTrip, setSelectedTrip] = useState(null);

  const trips = Array.isArray(data?.trips) ? data.trips : Array.isArray(data) ? data : [];
  const lastGeneratedAt = data?.__meta?.generatedAt;

  const deviceNameById = useMemo(() => {
    const map = new Map();
    devices.forEach((device) => {
      map.set(device.id ?? device.uniqueId, device.name ?? device.uniqueId ?? device.id);
    });
    return map;
  }, [devices]);

  async function handleSubmit(event) {
    event.preventDefault();
    setFeedback(null);
    const validationMessage = validateFields({ deviceId, from, to });
    if (validationMessage) {
      setFormError(validationMessage);
      return;
    }
    setFormError("");
    setFetching(true);
    try {
      await generateTripsReport({ deviceId, from: new Date(from).toISOString(), to: new Date(to).toISOString(), type: "all" });
      setFeedback({ type: "success", message: "Relatório de viagens criado com sucesso." });
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError?.message ?? "Erro ao gerar relatório de viagens." });
    } finally {
      setFetching(false);
    }
  }

  const handleOpenRoute = (trip) => {
    const id = trip?.deviceId ?? deviceId;
    if (!id || !trip?.startTime || !trip?.endTime) return;
    const search = new URLSearchParams({ deviceId: String(id), from: trip.startTime, to: trip.endTime });
    navigate(`/reports/route?${search.toString()}`);
  };

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <header>
          <h2 className="text-lg font-semibold">Relatório de viagens</h2>
          <p className="text-xs opacity-70">Visão macro das viagens realizadas pelo veículo.</p>
        </header>

        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-4">
          <label className="text-sm md:col-span-2">
            <span className="block text-xs uppercase tracking-wide opacity-60">Veículo / dispositivo</span>
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

        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error.message}</div>}
        {formError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{formError}</div>}
        {feedback && feedback.type === "success" && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">{feedback.message}</div>
        )}
        {lastGeneratedAt && <p className="text-xs text-white/60">Última geração: {formatDate(lastGeneratedAt)}</p>}
      </section>

      <section className="card space-y-4">
        <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Viagens</h3>
            <p className="text-xs opacity-70">Cada linha representa uma viagem consolidada.</p>
          </div>
          <span className="text-xs opacity-60">{trips.length} registros</span>
        </header>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide opacity-60">
              <tr>
                <th className="py-2 pr-6">Veículo</th>
                <th className="py-2 pr-6">Início</th>
                <th className="py-2 pr-6">Fim</th>
                <th className="py-2 pr-6">Duração</th>
                <th className="py-2 pr-6">Distância</th>
                <th className="py-2 pr-6">Vel. média</th>
                <th className="py-2 pr-6">Vel. máx.</th>
                <th className="py-2 pr-6">Local de início</th>
                <th className="py-2 pr-6">Local de fim</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading && (
                <tr>
                  <td colSpan={9} className="py-4 text-center text-sm opacity-60">
                    Processando viagens…
                  </td>
                </tr>
              )}
              {!loading && !trips.length && (
                <tr>
                  <td colSpan={9} className="py-4 text-center text-sm opacity-60">
                    {lastGeneratedAt
                      ? "Nenhuma viagem encontrada para o período selecionado."
                      : "Gere um relatório para visualizar as viagens."}
                  </td>
                </tr>
              )}
              {trips.map((trip) => (
                <tr
                  key={`${trip.deviceId}-${trip.startTime}-${trip.endTime}`}
                  className={`cursor-pointer hover:bg-white/5 ${selectedTrip === trip ? "bg-white/5" : ""}`}
                  onClick={() => setSelectedTrip(trip)}
                >
                  <td className="py-2 pr-6 text-white">{trip.deviceName || deviceNameById.get(trip.deviceId) || "—"}</td>
                  <td className="py-2 pr-6 text-white/80">{formatDateTime(parseDate(trip.startTime), locale)}</td>
                  <td className="py-2 pr-6 text-white/80">{formatDateTime(parseDate(trip.endTime), locale)}</td>
                  <td className="py-2 pr-6 text-white/70">{formatDuration(trip.duration)}</td>
                  <td className="py-2 pr-6 text-white/70">{formatDistance(trip.distance)}</td>
                  <td className="py-2 pr-6 text-white/70">{formatSpeed(trip.averageSpeed)}</td>
                  <td className="py-2 pr-6 text-white/70">{formatSpeed(trip.maxSpeed)}</td>
                  <td className="py-2 pr-6 text-white/70">{formatLocation(trip.startAddress, trip.startLat, trip.startLon)}</td>
                  <td className="py-2 pr-6 text-white/70">{formatLocation(trip.endAddress, trip.endLat, trip.endLon)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedTrip && (
        <section className="card space-y-3">
          <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="text-lg font-semibold">Detalhes da viagem</h4>
              <p className="text-xs opacity-70">Resumo baseado nos dados retornados pelo backend.</p>
            </div>
            <button
              type="button"
              className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
              onClick={() => handleOpenRoute(selectedTrip)}
            >
              Abrir pontos da rota
            </button>
          </header>

          <dl className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <SummaryItem label="Veículo" value={selectedTrip.deviceName || deviceNameById.get(selectedTrip.deviceId) || "—"} />
            <SummaryItem
              label="Início"
              value={formatDateTime(parseDate(selectedTrip.startTime), locale)}
            />
            <SummaryItem label="Fim" value={formatDateTime(parseDate(selectedTrip.endTime), locale)} />
            <SummaryItem label="Duração" value={formatDuration(selectedTrip.duration)} />
            <SummaryItem label="Distância" value={formatDistance(selectedTrip.distance)} />
            <SummaryItem label="Velocidade média" value={formatSpeed(selectedTrip.averageSpeed)} />
            <SummaryItem label="Velocidade máxima" value={formatSpeed(selectedTrip.maxSpeed)} />
            <SummaryItem
              label="Local de início"
              value={formatLocation(selectedTrip.startAddress, selectedTrip.startLat, selectedTrip.startLon)}
            />
            <SummaryItem
              label="Local de fim"
              value={formatLocation(selectedTrip.endAddress, selectedTrip.endLat, selectedTrip.endLon)}
            />
          </dl>
        </section>
      )}
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

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function validateFields({ deviceId, from, to }) {
  if (!deviceId) return "Selecione um dispositivo para gerar o relatório.";
  if (!from || !to) return "Preencha as datas de início e fim.";
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return "Datas inválidas.";
  if (fromDate > toDate) return "A data inicial deve ser anterior à final.";
  return "";
}

function formatDuration(durationSeconds) {
  const number = Number(durationSeconds);
  if (!Number.isFinite(number)) return "—";
  const hours = Math.floor(number / 3600);
  const minutes = Math.floor((number % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatDistance(distanceMeters) {
  const number = Number(distanceMeters);
  if (!Number.isFinite(number)) return "—";
  const km = number / 1000;
  return `${km.toFixed(2)} km`;
}

function formatSpeed(speed) {
  const number = Number(speed);
  if (!Number.isFinite(number)) return "—";
  return `${Math.round(number)} km/h`;
}

function formatLocation(address, lat, lon) {
  if (address) return formatAddress(address);
  const latitude = pickCoordinate([lat]);
  const longitude = pickCoordinate([lon]);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  }
  return "—";
}

function SummaryItem({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-white/60">{label}</dt>
      <dd className="mt-1 text-base font-semibold text-white">{value ?? "—"}</dd>
    </div>
  );
}
