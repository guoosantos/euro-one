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

function resolveMediaUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = getApiBaseUrl().replace(/\/$/, "");
  if (path.startsWith("/api/")) {
    return `${base.replace(/\/api$/, "")}${path}`;
  }
  return `${base}/${path.replace(/^\//, "")}`;
}

export default function Videos() {
  const { devices: allDevices } = useDevices();
  const [videos, setVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(() => {
    const now = Date.now();
    return {
      deviceId: "",
      from: toLocalInput(now - DEFAULT_HOURS * 60 * 60 * 1000),
      to: toLocalInput(now),
      type: "",
    };
  });

  const devices = useMemo(() => (Array.isArray(allDevices) ? allDevices : []), [allDevices]);

  async function fetchVideos(currentFilters) {
    setLoading(true);
    setError(null);

    const params = {
      ...(currentFilters.deviceId ? { deviceId: currentFilters.deviceId } : {}),
      ...(currentFilters.type ? { type: currentFilters.type } : {}),
      ...(fromLocalInput(currentFilters.from) ? { from: fromLocalInput(currentFilters.from) } : {}),
      ...(fromLocalInput(currentFilters.to) ? { to: fromLocalInput(currentFilters.to) } : {}),
      limit: 500,
    };

    const { data, error: requestError } = await safeApi.get(API_ROUTES.nt407.videos, {
      params,
      timeout: 20_000,
      suppressForbidden: true,
      forbiddenFallbackData: { videos: [] },
    });

    if (requestError) {
      setError(requestError);
      setVideos([]);
      setSelectedVideo(null);
      setLoading(false);
      return;
    }

    const list = Array.isArray(data)
      ? data
      : Array.isArray(data?.videos)
      ? data.videos
      : [];
    setVideos(list);
    setSelectedVideo((prev) => list.find((item) => item.id === prev?.id) || list[0] || null);
    setLoading(false);
  }

  useEffect(() => {
    fetchVideos(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSubmit(event) {
    event.preventDefault();
    fetchVideos(filters);
  }

  const selectedVideoUrl = resolveMediaUrl(selectedVideo?.downloadUrl);

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
            <span className="opacity-70">Tipo</span>
            <input
              type="text"
              value={filters.type}
              onChange={(event) => setFilters((prev) => ({ ...prev, type: event.target.value }))}
              placeholder="fatigue, live, event..."
              className="h-10 w-full rounded-lg border border-border bg-layer px-3 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <div className="flex items-end gap-2">
            <button type="submit" className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90">
              Buscar
            </button>
            <button
              type="button"
              onClick={() => fetchVideos(filters)}
              className="h-10 rounded-lg border border-border px-4 text-sm hover:bg-white/5"
            >
              Atualizar
            </button>
          </div>
        </form>

        {loading && <Loading message="Carregando vídeos NT407..." />}
        {error && <ErrorMessage error={error} fallback="Não foi possível carregar os vídeos." />}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <div className="card overflow-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase text-white/60">
              <tr>
                <th className="px-3 py-2">Timestamp</th>
                <th className="px-3 py-2">Dispositivo</th>
                <th className="px-3 py-2">Canal</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Origem</th>
                <th className="px-3 py-2">Arquivo</th>
              </tr>
            </thead>
            <tbody>
              {videos.map((video) => {
                const deviceId = String(video?.deviceId || "");
                const device = devices.find((item) => String(item?.id ?? item?.deviceId ?? "") === deviceId);
                const isSelected = selectedVideo?.id === video.id;
                const downloadUrl = resolveMediaUrl(video.downloadUrl);

                return (
                  <tr
                    key={video.id}
                    className={`border-t border-white/5 ${isSelected ? "bg-white/10" : "hover:bg-white/5"}`}
                    onClick={() => setSelectedVideo(video)}
                  >
                    <td className="px-3 py-2">{formatTimestamp(video.startTime || video.createdAt)}</td>
                    <td className="px-3 py-2">{device?.name || device?.uniqueId || deviceId || "-"}</td>
                    <td className="px-3 py-2">{video.cameraChannel ?? "-"}</td>
                    <td className="px-3 py-2">{video.typeTag || video.eventType || video.mediaType || "-"}</td>
                    <td className="px-3 py-2">{video.source || "-"}</td>
                    <td className="px-3 py-2">
                      {downloadUrl ? (
                        <a href={downloadUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          Download
                        </a>
                      ) : (
                        <span className="opacity-60">Sem arquivo</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!videos.length && !loading && (
                <tr>
                  <td className="px-3 py-4 text-sm opacity-70" colSpan={6}>
                    Nenhum vídeo encontrado para os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card space-y-3">
          <div className="text-sm font-semibold">Player</div>
          {!selectedVideo && <div className="text-sm opacity-70">Selecione um item na tabela para visualizar.</div>}
          {selectedVideo && (
            <>
              <div className="text-xs opacity-70">
                {formatTimestamp(selectedVideo.startTime || selectedVideo.createdAt)} | Canal {selectedVideo.cameraChannel ?? "-"}
              </div>
              <div className="overflow-hidden rounded-xl border border-border/50 bg-black">
                {selectedVideoUrl ? (
                  <video key={selectedVideo.id} src={selectedVideoUrl} controls className="aspect-video w-full bg-black" />
                ) : (
                  <div className="flex aspect-video items-center justify-center text-sm text-white/60">
                    Arquivo de mídia indisponível neste registro.
                  </div>
                )}
              </div>
              {selectedVideoUrl && (
                <a href={selectedVideoUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                  Abrir arquivo em nova aba
                </a>
              )}
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
