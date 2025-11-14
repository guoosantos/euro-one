import React, { useMemo } from "react";

import { useTenant } from "../lib/tenant-context";
import { euroViewVideos, vehicles } from "../mock/fleet";

export default function Videos() {
  const { tenantId } = useTenant();

  const list = useMemo(
    () =>
      euroViewVideos
        .filter((video) => video.tenantId === tenantId)
        .map((video) => ({
          ...video,
          vehicle: vehicles.find((item) => item.id === video.vehicleId),
        })),
    [tenantId],
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {list.map((video) => (
        <article key={video.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <img src={video.thumb} alt="Miniatura do vídeo" className="mb-3 w-full rounded-xl" />
          <div className="text-sm font-medium text-white">{video.type}</div>
          <div className="mt-1 text-xs text-white/50">
            {video.vehicle?.name ?? video.vehicleId} · {new Date(video.capturedAt).toLocaleString()}
          </div>
          <div className="mt-2 text-xs text-white/40">Duração: {video.duration}s</div>
          <button type="button" className="mt-3 rounded-xl border border-white/20 px-3 py-2 text-xs text-white/80">
            Reproduzir
          </button>
        </article>
      ))}
      {!list.length && <div className="text-sm text-white/50">Nenhum vídeo disponível.</div>}
    </div>
  );
}
