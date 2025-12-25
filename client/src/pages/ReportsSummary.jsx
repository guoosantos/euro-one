import React, { useMemo, useState } from "react";
import useVehicles, { normalizeVehicleDevices } from "../lib/hooks/useVehicles.js";
import useReportsSummary from "../lib/hooks/useReportsSummary";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";
import VehicleSelector from "../components/VehicleSelector.jsx";
import useVehicleSelection from "../lib/hooks/useVehicleSelection.js";

export default function ReportsSummary() {
  const {
    vehicles,
    vehicleOptions,
    loading: loadingVehicles,
    error: vehiclesError,
  } = useVehicles({ includeUnlinked: true });
  const {
    selectedVehicleId: vehicleId,
    selectedTelemetryDeviceId: deviceIdFromStore,
    selectedVehicle,
  } = useVehicleSelection({ syncQuery: true });
  const { data, loading, error, generate } = useReportsSummary();

  const [from, setFrom] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [fetching, setFetching] = useState(false);
  const [formError, setFormError] = useState("");
  const [feedback, setFeedback] = useState(null);

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => String(vehicle.id) === String(vehicleId)) || null,
    [vehicleId, vehicles],
  );
  const deviceId = deviceIdFromStore || selectedVehicle?.primaryDeviceId || "";
  const deviceUnavailable = Boolean(vehicleId) && !deviceId;
  const vehicleByDeviceId = useMemo(() => {
    const map = new Map();
    vehicles.forEach((vehicle) => {
      normalizeVehicleDevices(vehicle).forEach((device) => {
        const key = toDeviceKey(device?.id ?? device?.deviceId ?? device?.uniqueId ?? device?.traccarId);
        if (key) map.set(String(key), vehicle);
      });
    });
    return map;
  }, [vehicles]);

  const summary = Array.isArray(data?.summary) ? data.summary : Array.isArray(data) ? data : [];
  const lastGeneratedAt = data?.__meta?.generatedAt;

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
      await generate({
        deviceId,
        vehicleId: vehicleId || vehicleByDeviceId.get(String(deviceId))?.id,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      });
      setFeedback({ type: "success", message: "Relatório de resumo criado com sucesso." });
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError?.message ?? "Erro ao gerar relatório de resumo." });
    } finally {
      setFetching(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <header>
          <h2 className="text-lg font-semibold">Resumo de utilização</h2>
          <p className="text-xs opacity-70">Métricas agregadas de velocidade, distância e tempo em movimento.</p>
        </header>

        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-4">
          <VehicleSelector className="text-sm md:col-span-2" />

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

      <section className="card space-y-4">
        <header className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Resumo</h3>
          <span className="text-xs opacity-60">{summary.length} registros</span>
        </header>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide opacity-60">
              <tr>
                <th className="py-2 pr-6">Período</th>
                <th className="py-2 pr-6">Distância</th>
                <th className="py-2 pr-6">Tempo em movimento</th>
                <th className="py-2 pr-6">Velocidade média</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-sm opacity-60">
                    Processando resumo…
                  </td>
                </tr>
              )}
              {!loading && !summary.length && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-sm opacity-60">
                    {lastGeneratedAt
                      ? "Nenhum registro encontrado para o período selecionado."
                      : "Gere um relatório para visualizar o resumo."}
                  </td>
                </tr>
              )}
              {summary.map((item) => (
                <tr key={`${item.periodStart}-${item.periodEnd}`} className="hover:bg-white/5">
                  <td className="py-2 pr-6 text-white/80">{formatDate(item.periodStart)} → {formatDate(item.periodEnd)}</td>
                  <td className="py-2 pr-6 text-white/70">{formatDistance(item.distance)}</td>
                  <td className="py-2 pr-6 text-white/70">{formatDuration(item.drivingTime)}</td>
                  <td className="py-2 pr-6 text-white/70">{formatSpeed(item.averageSpeed)}</td>
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

function formatDistance(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "0");
  return `${(number / 1000).toFixed(1)} km`;
}

function formatDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const hours = Math.floor(number / 3600);
  const minutes = Math.floor((number % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatSpeed(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0 km/h";
  return `${(number * 1.852).toFixed(1)} km/h`;
}

function validateFields({ deviceId, from, to }) {
  if (!deviceId) return "Selecione um veículo com equipamento vinculado para gerar o relatório.";
  if (!from || !to) return "Preencha as datas de início e fim.";
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return "Datas inválidas.";
  if (fromDate > toDate) return "A data inicial deve ser anterior à final.";
  return "";
}
