import React, { useEffect } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, X } from "lucide-react";

import VideoMediaPlayer from "./VideoMediaPlayer.jsx";

function buildFileName(item, index) {
  const rawTitle = String(item?.title || `midia-${index + 1}`);
  const safe = rawTitle
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .toLowerCase();
  const extension = item?.type === "video" ? "mp4" : "jpg";
  return `${safe || `midia-${index + 1}`}.${extension}`;
}

export default function MediaViewerModal({ open, items, index, onClose, onChangeIndex }) {
  const currentItems = Array.isArray(items) ? items : [];
  const total = currentItems.length;
  const safeIndex = Number.isFinite(Number(index)) ? Math.max(0, Math.min(total - 1, Number(index))) : 0;
  const current = total ? currentItems[safeIndex] : null;

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
      if (event.key === "ArrowLeft" && safeIndex > 0) onChangeIndex?.(safeIndex - 1);
      if (event.key === "ArrowRight" && safeIndex < total - 1) onChangeIndex?.(safeIndex + 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onChangeIndex, onClose, open, safeIndex, total]);

  if (!open || !current) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => onClose?.()}>
      <div
        className="modal !max-w-[95vw] !w-[1100px] !max-h-[92vh] overflow-hidden border border-white/20 bg-[#0a1220]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-white">{current.title || "Mídia"}</div>
            <div className="mt-1 text-xs text-white/60">
              {safeIndex + 1} de {total}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onClose?.()}
            className="rounded-lg bg-white/10 p-2 text-white transition hover:bg-white/20"
            aria-label="Fechar visualização de mídia"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative flex h-[70vh] items-center justify-center bg-black/50 p-3">
          {current.type === "video" ? (
            <VideoMediaPlayer
              src={current.src}
              title={current.title}
              status={current.status || "READY"}
              className="h-full w-full"
            />
          ) : (
            <img src={current.src} alt={current.title || "Mídia"} className="h-full w-full rounded-lg object-contain" />
          )}

          <button
            type="button"
            onClick={() => onChangeIndex?.(Math.max(0, safeIndex - 1))}
            disabled={safeIndex <= 0}
            className="absolute left-3 rounded-full bg-black/60 p-2 text-white transition hover:bg-black/75 disabled:opacity-35"
            aria-label="Mídia anterior"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => onChangeIndex?.(Math.min(total - 1, safeIndex + 1))}
            disabled={safeIndex >= total - 1}
            className="absolute right-3 rounded-full bg-black/60 p-2 text-white transition hover:bg-black/75 disabled:opacity-35"
            aria-label="Próxima mídia"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-4 py-3">
          <a
            href={current.src}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 text-xs text-white transition hover:bg-white/20"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Abrir em nova aba
          </a>
          <a
            href={current.src}
            download={buildFileName(current, safeIndex)}
            className="inline-flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-black transition hover:bg-sky-400"
          >
            <Download className="h-3.5 w-3.5" />
            Baixar
          </a>
        </div>
      </div>
    </div>
  );
}
