import React, { useMemo, useState } from "react";
import useDevices from "../lib/hooks/useDevices";
import useReportsRoute from "../lib/hooks/useReportsRoute";
import { useTranslation } from "../lib/i18n.js";
import { formatAddress } from "../lib/format-address.js";
import { formatDateTime, pickCoordinate, pickSpeed } from "../lib/monitoring-helpers.js";

export default function ReportsRoute() {
  const { t, locale } = useTranslation();
  const { devices: deviceList } = useDevices();
  const devices = useMemo(() => (Array.isArray(deviceList) ? deviceList : []), [deviceList]);
  const { data, loading, error, generate } = useReportsRoute();

  const [deviceId, setDeviceId] = useState("");
  const [from, setFrom] = useState(() => new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [fetching, setFetching] = useState(false);
  const [formError, setFormError] = useState("");
  const [feedback, setFeedback] = useState(null);

  const points = Array.isArray(data?.positions) ? data.positions : Array.isArray(data) ? data : [];
  const lastGeneratedAt = data?.__meta?.generatedAt;
  const selectedDevice = useMemo(() => devices.find((device) => (device.id ?? device.uniqueId) === deviceId), [
    deviceId,
    devices,
  ]);

  const routeSummary = useMemo(() => {
    if (!points.length) return null;
    const first = points[0];
    const last = points[points.length - 1];
    const startTime = parseDate(first.fixTime ?? first.deviceTime ?? first.serverTime);
    const endTime = parseDate(last.fixTime ?? last.deviceTime ?? last.serverTime);
    const durationMs = startTime && endTime ? endTime.getTime() - startTime.getTime() : null;

    const speeds = points
      .map((point) => pickSpeed(point))
      .filter((value) => value !== null && Number.isFinite(value));
    const averageSpeed = speeds.length ? Math.round(speeds.reduce((acc, value) => acc + value, 0) / speeds.length) : null;
    const maxSpeed = speeds.length ? Math.max(...speeds) : null;

    const totalDistanceKm = computeDistanceKm(points);

    return {
      deviceName: selectedDevice?.name || selectedDevice?.vehicle || selectedDevice?.uniqueId || "—",
      startTime,
      endTime,
      durationMs,
      totalDistanceKm,
      averageSpeed,
      maxSpeed,
      // Tempo parado/em movimento dependem do backend devolver esses campos ou um resumo dedicado.
      movementUnavailable: true,
    };
  }, [points, selectedDevice]);

  const tableColumns = useMemo(
    () => [
      {
        key: "gpsTime",
        label: "Hora GPS",
        render: (point) => formatDateTime(parseDate(point.fixTime ?? point.deviceTime ?? point.serverTime), locale),
      },
      {
        key: "latitude",
        label: "Latitude",
        render: (point) => {
          const value = pickCoordinate([point.latitude, point.lat, point.lat_deg, point.attributes?.latitude]);
          return Number.isFinite(value) ? value.toFixed(5) : "—";
        },
      },
      {
        key: "longitude",
        label: "Longitude",
        render: (point) => {
          const value = pickCoordinate([point.longitude, point.lon, point.lng, point.attributes?.longitude]);
          return Number.isFinite(value) ? value.toFixed(5) : "—";
        },
      },
      {
        key: "speed",
        label: "Velocidade (km/h)",
        render: (point) => {
          const speed = pickSpeed(point);
          return speed !== null ? `${speed} km/h` : "—";
        },
      },
      {
        key: "event",
        label: "Evento",
        render: (point) => point.event || point.attributes?.event || point.type || "—",
      },
      {
        key: "address",
        label: "Endereço",
        render: (point) => formatAddress(point.address || point.formattedAddress || point.attributes?.address) || "—",
      },
    ],
    [locale],
  );

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
      await generate({ deviceId, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
      setFeedback({ type: "success", message: "Relatório de rota criado com sucesso." });
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError?.message ?? "Erro ao gerar relatório de rota." });
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
        {formError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{formError}</div>
        )}
        {feedback && feedback.type === "success" && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
            {feedback.message}
          </div>
        )}
        {lastGeneratedAt && (
          <p className="text-xs text-white/60">Última geração: {formatDate(lastGeneratedAt)}</p>
        )}
      </section>

      {routeSummary && (
        <section className="card">
          <header className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold">Resumo da rota</h3>
              <p className="text-xs opacity-70">Dados atualizados conforme os pontos retornados pela API.</p>
            </div>
            <div className="text-xs text-white/60">
              {routeSummary.startTime && routeSummary.endTime
                ? `${formatDateTime(routeSummary.startTime, locale)} → ${formatDateTime(routeSummary.endTime, locale)}`
                : "Intervalo não informado"}
            </div>
          </header>

          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SummaryItem label="Veículo / dispositivo" value={routeSummary.deviceName} />
            <SummaryItem
              label="Distância total percorrida"
              value={routeSummary.totalDistanceKm !== null ? `${routeSummary.totalDistanceKm.toFixed(2)} km` : "—"}
            />
            <SummaryItem
              label="Duração total"
              value={routeSummary.durationMs !== null ? formatDuration(routeSummary.durationMs) : "—"}
            />
            <SummaryItem
              label="Velocidade média"
              value={routeSummary.averageSpeed !== null ? `${routeSummary.averageSpeed} km/h` : "—"}
            />
            <SummaryItem
              label="Velocidade máxima"
              value={routeSummary.maxSpeed !== null ? `${routeSummary.maxSpeed} km/h` : "—"}
            />
            {!routeSummary.movementUnavailable && (
              <SummaryItem label="Tempo parado / em movimento" value="—" />
            )}
          </dl>
        </section>
      )}

      <section className="card space-y-4">
        <header className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Pontos encontrados</h3>
          <span className="text-xs opacity-60">{points.length} registros</span>
        </header>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide opacity-60">
              <tr>
                {tableColumns.map((column) => (
                  <th key={column.key} className="py-2 pr-6">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading && (
                <tr>
                  <td colSpan={tableColumns.length} className="py-4 text-center text-sm opacity-60">
                    Processando rota…
                  </td>
                </tr>
              )}
              {!loading && !points.length && (
                <tr>
                  <td colSpan={tableColumns.length} className="py-4 text-center text-sm opacity-60">
                    {lastGeneratedAt
                      ? "Nenhum registro encontrado para o período selecionado."
                      : "Gere um relatório para visualizar os pontos percorridos."}
                  </td>
                </tr>
              )}
                {points.map((point) => (
                  <tr key={`${point.deviceId}-${point.fixTime}-${point.latitude}-${point.longitude}`} className="hover:bg-white/5">
                    {tableColumns.map((column) => (
                      <td key={column.key} className="py-2 pr-6 text-white/80">
                        {column.render ? column.render(point) : column.getValue?.(point, { t, locale })}
                      </td>
                    ))}
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

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) return "—";
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function computeDistanceKm(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const startDistance = normaliseDistance(first);
  const endDistance = normaliseDistance(last);
  if (!Number.isFinite(startDistance) || !Number.isFinite(endDistance)) return null;
  return Math.max(0, (endDistance - startDistance) / 1000);
}

function normaliseDistance(point) {
  const candidates = [point?.totalDistance, point?.distance, point?.attributes?.totalDistance, point?.attributes?.distance];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function SummaryItem({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-white/60">{label}</dt>
      <dd className="mt-1 text-base font-semibold text-white">{value ?? "—"}</dd>
    </div>
  );
}
