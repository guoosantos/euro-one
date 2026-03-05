import React, { useEffect, useMemo, useState } from "react";

function normalizeMediaStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function parseDataUrl(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^data:([^;,]+)?((?:;[^;,=]+=[^;,]+)*)(;base64)?,([\s\S]*)$/i);
  if (!match) return null;
  const mimeType = String(match[1] || "application/octet-stream").toLowerCase();
  const isBase64 = Boolean(match[3]);
  const payload = String(match[4] || "");
  return { mimeType, isBase64, payload };
}

function decodeBase64Bytes(payload) {
  const normalized = String(payload || "").replace(/\s/g, "");
  const binary = window.atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeUrlBytes(payload) {
  const decoded = decodeURIComponent(String(payload || ""));
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

function buildVideoSourceCandidates(source) {
  const raw = typeof source === "string" ? source.trim() : "";
  if (!raw) return [];
  const parsed = parseDataUrl(raw);
  if (!parsed || !parsed.mimeType.startsWith("video/")) {
    return [{ src: raw, revoke: null }];
  }
  try {
    const bytes = parsed.isBase64 ? decodeBase64Bytes(parsed.payload) : decodeUrlBytes(parsed.payload);
    const blobUrls = [];
    const pushBlob = (mimeType) => {
      const blob = new Blob([bytes], { type: mimeType });
      blobUrls.push({
        src: URL.createObjectURL(blob),
        revoke: (url) => {
          URL.revokeObjectURL(url);
        },
      });
    };
    pushBlob(parsed.mimeType);
    if (parsed.mimeType === "video/quicktime") {
      pushBlob("video/mp4");
    }
    return blobUrls.length ? blobUrls : [{ src: raw, revoke: null }];
  } catch (_error) {
    return [{ src: raw, revoke: null }];
  }
}

export default function VideoMediaPlayer({
  src,
  title = "Vídeo",
  className = "",
  status = "READY",
  controls = true,
  preload = "metadata",
  onClick = null,
}) {
  const normalizedStatus = normalizeMediaStatus(status);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [failed, setFailed] = useState(false);
  const availableSource = typeof src === "string" ? src.trim() : "";
  const [sourceCandidates, setSourceCandidates] = useState(() => buildVideoSourceCandidates(availableSource));
  const [candidateIndex, setCandidateIndex] = useState(0);
  const activeSource = sourceCandidates[candidateIndex]?.src || availableSource;
  const canRenderPlayer = Boolean(availableSource) && normalizedStatus !== "PROCESSING" && normalizedStatus !== "ERROR";
  const showLoadingOverlay = useMemo(() => canRenderPlayer && (!hasLoaded || buffering) && !failed, [
    buffering,
    canRenderPlayer,
    failed,
    hasLoaded,
  ]);

  const wrapperClassName = `relative overflow-hidden rounded-lg border border-white/10 bg-black ${className}`.trim();

  useEffect(() => {
    const candidates = buildVideoSourceCandidates(availableSource);
    setSourceCandidates(candidates);
    setCandidateIndex(0);
    setHasLoaded(false);
    setBuffering(false);
    setFailed(false);

    return () => {
      candidates.forEach((candidate) => {
        if (typeof candidate?.revoke === "function" && candidate?.src) {
          candidate.revoke(candidate.src);
        }
      });
    };
  }, [availableSource]);

  if (!availableSource && normalizedStatus !== "PROCESSING") {
    return (
      <div className={`${wrapperClassName} flex items-center justify-center px-4 py-6 text-center text-xs text-white/60`}>
        Vídeo indisponível.
      </div>
    );
  }

  if (normalizedStatus === "PROCESSING") {
    return (
      <div className={`${wrapperClassName} flex items-center justify-center px-4 py-6 text-center text-xs text-amber-200`}>
        Vídeo em processamento.
      </div>
    );
  }

  if (normalizedStatus === "ERROR" || failed) {
    return (
      <div className={`${wrapperClassName} flex items-center justify-center px-4 py-6 text-center text-xs text-rose-200`}>
        Falha ao carregar vídeo. Tente novamente.
      </div>
    );
  }

  return (
    <div className={wrapperClassName}>
      <video
        controls={controls}
        preload={preload}
        src={activeSource}
        className="h-full w-full object-contain"
        aria-label={title}
        onLoadedData={() => {
          setHasLoaded(true);
          setBuffering(false);
          setFailed(false);
        }}
        onCanPlay={() => {
          setHasLoaded(true);
          setBuffering(false);
        }}
        onWaiting={() => {
          if (hasLoaded) setBuffering(true);
        }}
        onPlaying={() => setBuffering(false)}
        onError={() => {
          if (candidateIndex < sourceCandidates.length - 1) {
            setCandidateIndex((current) => current + 1);
            setHasLoaded(false);
            setBuffering(false);
            setFailed(false);
            return;
          }
          setFailed(true);
          setBuffering(false);
        }}
        onClick={onClick || undefined}
      />
      {showLoadingOverlay && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-xs text-white/80">
          Carregando vídeo...
        </div>
      )}
    </div>
  );
}
