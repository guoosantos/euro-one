import React, { useEffect, useMemo, useRef, useState } from "react";
import useDevices from "../lib/hooks/useDevices";

const HLS_CDN = "https://cdn.jsdelivr.net/npm/hls.js@1.5.7/dist/hls.min.js";

function useHls(url) {
  const videoRef = useRef(null);

  useEffect(() => {
    let hls;
    async function setup() {
      if (!url || !videoRef.current) return;
      if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
        videoRef.current.src = url;
        return;
      }
      if (!window.Hls) {
        await loadHlsScript();
      }
      if (window.Hls && window.Hls.isSupported()) {
        hls = new window.Hls();
        hls.loadSource(url);
        hls.attachMedia(videoRef.current);
      } else {
        videoRef.current.src = url;
      }
    }
    setup();
    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [url]);

  return videoRef;
}

const scriptPromise = {};
function loadHlsScript() {
  if (scriptPromise.instance) return scriptPromise.instance;
  scriptPromise.instance = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = HLS_CDN;
    script.async = true;
    script.onload = () => resolve(window.Hls);
    script.onerror = reject;
    document.body.appendChild(script);
  });
  return scriptPromise.instance;
}

function LiveStreamCard({ stream }) {
  const videoRef = useHls(stream.url);
  return (
    <article className="rounded-2xl border border-border bg-layer p-4">
      <header className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-sm font-semibold">{stream.title}</div>
          <div className="text-xs opacity-60">{stream.deviceName}</div>
        </div>
        <span className={`text-xs font-medium ${stream.online ? "text-emerald-400" : "text-red-300"}`}>
          {stream.online ? "Ao vivo" : "Offline"}
        </span>
      </header>
      <div className="mt-3 overflow-hidden rounded-xl border border-border/50 bg-black">
        {stream.url ? (
          <video ref={videoRef} controls autoPlay muted playsInline className="aspect-video w-full bg-black" />
        ) : (
          <div className="flex aspect-video items-center justify-center text-sm opacity-60">
            Nenhum stream configurado para este dispositivo.
          </div>
        )}
      </div>
      {stream.url && (
        <p className="mt-2 text-xs opacity-60">URL: {stream.url}</p>
      )}
    </article>
  );
}

export default function Live() {
  const { devices: deviceList } = useDevices();
  const devices = useMemo(() => (Array.isArray(deviceList) ? deviceList : []), [deviceList]);
  const [customUrl, setCustomUrl] = useState("");
  const [customStreams, setCustomStreams] = useState([]);

  const streams = useMemo(() => {
    const detected = devices
      .map((device) => {
        const attributes = device?.attributes || {};
        const candidates = [
          attributes.streamUrl,
          attributes.videoUrl,
          attributes.hlsUrl,
          device.streamUrl,
          device.videoUrl,
        ];
        const url = candidates.find(Boolean);
        if (!url) return null;
        return {
          id: device.id ?? device.deviceId ?? device.uniqueId,
          title: device.name ?? device.uniqueId ?? device.id,
          deviceName: device.name ?? device.uniqueId ?? device.id,
          url,
          online: true,
        };
      })
      .filter(Boolean);
    return [...detected, ...customStreams];
  }, [devices, customStreams]);

  function handleAddStream(event) {
    event.preventDefault();
    if (!customUrl) return;
    setCustomStreams((prev) => [
      ...prev,
      {
        id: `manual-${prev.length + 1}`,
        title: `Stream manual ${prev.length + 1}`,
        deviceName: "Fonte externa",
        url: customUrl,
        online: true,
      },
    ]);
    setCustomUrl("");
  }

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <header>
          <h2 className="text-lg font-semibold">Streams ao vivo</h2>
          <p className="text-xs opacity-70">
            O Euro One detecta automaticamente URLs de streaming nos atributos dos dispositivos Traccar (streamUrl, videoUrl).
            Também é possível informar manualmente um endpoint RTSP/HLS.
          </p>
        </header>
        <form className="flex flex-col gap-3 md:flex-row" onSubmit={handleAddStream}>
          <input
            type="text"
            value={customUrl}
            onChange={(event) => setCustomUrl(event.target.value)}
            placeholder="https://servidor/stream.m3u8"
            className="flex-1 rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            Adicionar stream manual
          </button>
        </form>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {streams.map((stream) => (
          <LiveStreamCard key={stream.id} stream={stream} />
        ))}
        {!streams.length && (
          <div className="card text-sm opacity-60">
            Nenhum stream configurado. Configure a URL nos atributos do dispositivo no Traccar ou adicione manualmente acima.
          </div>
        )}
      </section>
    </div>
  );
}
