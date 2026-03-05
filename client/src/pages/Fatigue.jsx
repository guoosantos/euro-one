import React, { useEffect, useMemo, useState } from "react";
import PageHeader from "../components/ui/PageHeader.jsx";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { getApiBaseUrl } from "../lib/api.js";
import useDevices from "../lib/hooks/useDevices";
import Loading from "../components/Loading.jsx";
import ErrorMessage from "../components/ErrorMessage.jsx";

const DEFAULT_HOURS = 24;

function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function fromLocalInput(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function resolveApiUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = getApiBaseUrl().replace(/\/$/, "");
  if (path.startsWith("/api/")) return `${base.replace(/\/api$/, "")}${path}`;
  return `${base}/${path.replace(/^\//, "")}`;
}

export default function Fatigue() {
  const { devices: allDevices } = useDevices();
  const devices = useMemo(() => (Array.isArray(allDevices) ? allDevices : []), [allDevices]);
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(() => {
    const now = Date.now();
    return {
      deviceId: "",
      from: toLocalInput(now - DEFAULT_HOURS * 60 * 60 * 1000),
      to: toLocalInput(now),
      severity: "",
    };
  });

  async function fetchFatigue(currentFilters) {
    setLoading(true);
    setError(null);

    const params = {
      ...(currentFilters.deviceId ? { deviceId: currentFilters.deviceId } : {}),
      ...(currentFilters.severity ? { severity: currentFilters.severity } : {}),
      ...(fromLocalInput(currentFilters.from) ? { from: fromLocalInput(currentFilters.from) } : {}),
      ...(fromLocalInput(currentFilters.to) ? { to: fromLocalInput(currentFilters.to) } : {}),
      limit: 500,
    };

    const { data, error: requestError } = await safeApi.get(API_ROUTES.nt407.fatigue, {
      params,
      timeout: 20_000,
      suppressForbidden: true,
      forbiddenFallbackData: { fatigue: [] },
    });

    if (requestError) {
      setError(requestError);
      setEvents([]);
      setSelected(null);
      setLoading(false);
      return;
    }

    const list = Array.isArray(data)
      ? data
      : Array.isArray(data?.fatigue)
      ? data.fatigue
      : [];

    setEvents(list);
    setSelected((prev) => list.find((item) => item.id === prev?.id) || list[0] || null);
    setLoading(false);
  }

  useEffect(() => {
    fetchFatigue(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSubmit(event) {
    event.preventDefault();
    fetchFatigue(filters);
  }

  const selectedVideoUrl = resolveApiUrl(selected?.linkedVideoUrl);

  return (
    <div className="space-y-6">
      <PageHeader />

      <section className="card space-y-4">
        <form className="grid gap-3 md:grid-cols-5" onSubmit={onSubmit}>
          <label className="space-y-1 text-xs">
            <span className="opacity-70">Dispositivo</span>
            <select
              value={filters.deviceId}
              onChange={(event) => setFilters((prev) => ({ ...prev, deviceId: event.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-layer px-3 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">Todos</option>
              {devices.map((device) => {
                const id = String(device?.id ?? device?.deviceId ?? device?.uniqueId ?? "");
                if (!id) return null;
                return (
                  <option key={id} value={id}>
                    {device?.name || device?.uniqueId || id}
                  </option>
                );
              })}
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="opacity-70">De</span>
            <input
              type="datetime-local"
              value={filters.from}
              onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-layer px-3 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <label className="space-y-1 text-xs">
            <span className="opacity-70">Até</span>
            <input
              type="datetime-local"
              value={filters.to}
              onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-layer px-3 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <label className="space-y-1 text-xs">
            <span className="opacity-70">Severidade</span>
            <select
              value={filters.severity}
              onChange={(event) => setFilters((prev) => ({ ...prev, severity: event.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-layer px-3 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">Todas</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>

          <div className="flex items-end gap-2">
            <button type="submit" className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90">
              Buscar
            </button>
            <button
              type="button"
              onClick={() => fetchFatigue(filters)}
              className="h-10 rounded-lg border border-border px-4 text-sm hover:bg-white/5"
            >
              Atualizar
            </button>
          </div>
        </form>

        {loading && <Loading message="Carregando eventos de fadiga..." />}
        {error && <ErrorMessage error={error} fallback="Não foi possível carregar os eventos de fadiga." />}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="card overflow-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="text-xs uppercase text-white/60">
              <tr>
                <th className="px-3 py-2">Timestamp</th>
                <th className="px-3 py-2">Dispositivo</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Severidade</th>
                <th className="px-3 py-2">Score</th>
                <th className="px-3 py-2">Duração</th>
                <th className="px-3 py-2">Vídeo</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const isSelected = selected?.id === event.id;
                const deviceId = String(event?.deviceId || "");
                const device = devices.find((item) => String(item?.id ?? item?.deviceId ?? "") === deviceId);
                const videoUrl = resolveApiUrl(event?.linkedVideoUrl);

                return (
                  <tr
                    key={event.id}
                    className={`border-t border-white/5 ${isSelected ? "bg-white/10" : "hover:bg-white/5"}`}
                    onClick={() => setSelected(event)}
                  >
                    <td className="px-3 py-2">{formatTimestamp(event.timestamp || event.createdAt)}</td>
                    <td className="px-3 py-2">{device?.name || device?.uniqueId || deviceId || "-"}</td>
                    <td className="px-3 py-2">{event.eventType || "fatigue"}</td>
                    <td className="px-3 py-2">{event.severity || "-"}</td>
                    <td className="px-3 py-2">{Number.isFinite(Number(event.fatigueScore)) ? Number(event.fatigueScore) : "-"}</td>
                    <td className="px-3 py-2">{Number.isFinite(Number(event.durationSec)) ? `${event.durationSec}s` : "-"}</td>
                    <td className="px-3 py-2">
                      {videoUrl ? (
                        <a href={videoUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          Abrir
                        </a>
                      ) : (
                        <span className="opacity-60">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!events.length && !loading && (
                <tr>
                  <td className="px-3 py-4 text-sm opacity-70" colSpan={7}>
                    Nenhum evento de fadiga para os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card space-y-3">
          <div className="text-sm font-semibold">Player do evento</div>
          {!selected && <div className="text-sm opacity-70">Selecione um evento para abrir mídia associada.</div>}
          {selected && (
            <>
              <div className="space-y-1 text-xs opacity-80">
                <div><strong>Evento:</strong> {selected.eventType || "fatigue"}</div>
                <div><strong>Severidade:</strong> {selected.severity || "-"}</div>
                <div><strong>Score:</strong> {Number.isFinite(Number(selected.fatigueScore)) ? Number(selected.fatigueScore) : "-"}</div>
                <div><strong>Duração:</strong> {Number.isFinite(Number(selected.durationSec)) ? `${selected.durationSec}s` : "-"}</div>
                <div><strong>Timestamp:</strong> {formatTimestamp(selected.timestamp || selected.createdAt)}</div>
              </div>

              <div className="overflow-hidden rounded-xl border border-border/50 bg-black">
                {selectedVideoUrl ? (
                  <video key={selected.id} src={selectedVideoUrl} controls className="aspect-video w-full bg-black" />
                ) : (
                  <div className="flex aspect-video items-center justify-center text-sm text-white/60">
                    Evento sem vídeo vinculado.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function formatTimestamp(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}
