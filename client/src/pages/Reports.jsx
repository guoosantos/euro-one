import React, { useEffect, useState } from "react";
import { CoreApi } from "../lib/coreApi";
import { useReports } from "../lib/hooks/useReports";
import { useTenant } from "../lib/tenant-context.jsx";

export default function Reports() {
  const { tenantId } = useTenant();
  const [vehicles, setVehicles] = useState([]);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [vehiclesError, setVehiclesError] = useState(null);
  const { data, loading, error, generateTripsReport, downloadTripsCsv } = useReports();

  const [vehicleIds, setVehicleIds] = useState([]);
  const [from, setFrom] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [formError, setFormError] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!vehicleIds.length && vehicles.length === 1) {
      setVehicleIds([vehicles[0].id]);
    }
  }, [vehicleIds.length, vehicles]);

  useEffect(() => {
    let cancelled = false;
    async function loadVehicles() {
      setLoadingVehicles(true);
      setVehiclesError(null);
      try {
        const response = await CoreApi.listVehicles(tenantId ? { clientId: tenantId } : undefined);
        if (cancelled) return;
        const list = Array.isArray(response) ? response : [];
        const withTracker = list.filter((vehicle) => (vehicle.deviceCount || vehicle.devices?.length || vehicle.device ? 1 : 0));
        setVehicles(withTracker);
      } catch (requestError) {
        if (!cancelled) {
          setVehiclesError(requestError instanceof Error ? requestError : new Error("Falha ao carregar veículos"));
        }
      } finally {
        if (!cancelled) {
          setLoadingVehicles(false);
        }
      }
    }

    loadVehicles();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  async function handleGenerate(event) {
    event.preventDefault();
    setFeedback(null);
    const validationMessage = validateFields({ vehicleIds, from, to });
    if (validationMessage) {
      setFormError(validationMessage);
      return;
    }
    setFormError("");
    try {
      await generateTripsReport({ vehicleIds, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
      setFeedback({ type: "success", message: "Relatório criado com sucesso." });
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError?.message ?? "Erro ao gerar relatório." });
    }
  }

  async function handleDownload() {
    const validationMessage = validateFields({ vehicleIds, from, to });
    if (validationMessage) {
      setFormError(validationMessage);
      return;
    }
    setFormError("");
    setDownloading(true);
    try {
      await downloadTripsCsv({ vehicleIds, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
      setFeedback({ type: "success", message: "Exportação iniciada com sucesso." });
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError?.message ?? "Erro ao exportar CSV." });
    } finally {
      setDownloading(false);
    }
  }

  const trips = Array.isArray(data?.trips) ? data.trips : Array.isArray(data) ? data : [];
  const lastGeneratedAt = data?.__meta?.generatedAt;

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <header>
          <h2 className="text-lg font-semibold">Relatórios de viagens</h2>
          <p className="text-xs opacity-70">Selecione o veículo e o período para gerar relatórios detalhados.</p>
        </header>

        <form onSubmit={handleGenerate} className="grid gap-4 md:grid-cols-4">
          <label className="text-sm md:col-span-2">
            <span className="block text-xs uppercase tracking-wide opacity-60">Veículos</span>
            <select
              multiple
              required
              value={vehicleIds}
              onChange={(event) =>
                setVehicleIds(Array.from(event.target.selectedOptions).map((option) => option.value).filter(Boolean))
              }
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
            >
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.plate || vehicle.name || vehicle.id}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-white/60">Segure Ctrl ou Cmd para selecionar mais de um veículo.</p>
            {loadingVehicles && <p className="mt-1 text-xs text-white/60">Carregando veículos…</p>}
            {vehiclesError && (
              <p className="mt-1 text-xs text-red-300">{vehiclesError.message || "Erro ao carregar veículos"}</p>
            )}
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
              disabled={loading || loadingVehicles || !vehicleIds.length}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
            >
              {loading ? "Gerando…" : "Gerar relatório"}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={loading || downloading || loadingVehicles || !vehicleIds.length}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-white/10 disabled:opacity-60"
            >
              {downloading ? "Preparando…" : "Exportar CSV"}
            </button>
          </div>
        </form>
        {formError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{formError}</div>
        )}
        {feedback && feedback.type === "success" && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
            {feedback.message}
          </div>
        )}
        {(feedback?.type === "error" || error) && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {feedback?.type === "error" ? feedback.message : error?.message}
          </div>
        )}
        {lastGeneratedAt && (
          <p className="text-xs text-white/60">Última geração: {formatDate(lastGeneratedAt)}</p>
        )}
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
                    {lastGeneratedAt
                      ? "Nenhum registro encontrado para o período selecionado."
                      : "Gere um relatório para visualizar as viagens."}
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

function validateFields({ vehicleIds, from, to }) {
  if (!Array.isArray(vehicleIds) || vehicleIds.length === 0) return "Selecione pelo menos um veículo para gerar o relatório.";
  if (!from || !to) return "Preencha as datas de início e fim.";
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return "Datas inválidas.";
  if (fromDate > toDate) return "A data inicial deve ser anterior à final.";
  return "";
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
