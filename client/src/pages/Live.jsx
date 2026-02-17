import React, { useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "../components/ui/PageHeader.jsx";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { getApiBaseUrl } from "../lib/api.js";
import useDevices from "../lib/hooks/useDevices";
import Loading from "../components/Loading.jsx";
import ErrorMessage from "../components/ErrorMessage.jsx";

const HLS_CDN = "https://cdn.jsdelivr.net/npm/hls.js@1.5.7/dist/hls.min.js";

function resolveApiUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = getApiBaseUrl().replace(/\/$/, "");
  if (path.startsWith("/api/")) return `${base.replace(/\/api$/, "")}${path}`;
  return `${base}/${path.replace(/^\//, "")}`;
}

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
      if (hls) hls.destroy();
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

function LiveStreamCard({ session, deviceLabel, onStop }) {
  const playbackUrl = resolveApiUrl(session?.playbackUrl);
  const videoRef = useHls(playbackUrl);
  const isActive = session?.status === "active";

  return (
    <article className="rounded-2xl border border-border bg-layer p-4">
      <header className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-sm font-semibold">{deviceLabel}</div>
          <div className="text-xs opacity-60">Canal {session?.channel ?? "-"}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${isActive ? "text-emerald-400" : "text-white/60"}`}>
            {isActive ? "Ao vivo" : "Parado"}
          </span>
          {isActive && (
            <button
              type="button"
              onClick={() => onStop(session)}
              className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-white/5"
            >
              Parar
            </button>
          )}
        </div>
      </header>

      <div className="mt-3 overflow-hidden rounded-xl border border-border/50 bg-black">
        {playbackUrl ? (
          <video ref={videoRef} controls autoPlay muted playsInline className="aspect-video w-full bg-black" />
        ) : (
          <div className="flex aspect-video items-center justify-center text-sm opacity-60">
            URL de stream indisponível.
          </div>
        )}
      </div>

      <div className="mt-2 text-xs opacity-60">
        Sessão: {session?.id} | Pacotes: {session?.packetCount || 0}
      </div>
    </article>
  );
}

export default function LivePage() {
  const { devices: allDevices } = useDevices();
  const devices = useMemo(() => (Array.isArray(allDevices) ? allDevices : []), [allDevices]);
  const [ntDevices, setNtDevices] = useState([]);
  const [health, setHealth] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ deviceId: "", channel: 1 });

  async function fetchStatus({ silent = false } = {}) {
    if (!silent) {
      setLoading(true);
    }
    setError(null);

    const [healthResult, devicesResult] = await Promise.all([
      safeApi.get(API_ROUTES.nt407.health, {
        suppressForbidden: true,
        forbiddenFallbackData: { ok: false, listener: null, sessions: null, totals: null },
      }),
      safeApi.get(API_ROUTES.nt407.devices, {
        suppressForbidden: true,
        forbiddenFallbackData: { devices: [] },
      }),
    ]);

    if (healthResult.error || devicesResult.error) {
      setError(healthResult.error || devicesResult.error);
      setLoading(false);
      return;
    }

    const deviceList = Array.isArray(devicesResult.data)
      ? devicesResult.data
      : Array.isArray(devicesResult.data?.devices)
      ? devicesResult.data.devices
      : [];

    setHealth(healthResult.data || null);
    setNtDevices(deviceList);
    setForm((prev) => ({
      ...prev,
      deviceId: prev.deviceId || (deviceList[0]?.id ? String(deviceList[0].id) : ""),
    }));
    setLoading(false);
  }

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(() => {
      fetchStatus({ silent: true });
    }, 15_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mergedDevices = useMemo(() => {
    if (!ntDevices.length) return devices;
    const byId = new Map();
    devices.forEach((device) => {
      const id = String(device?.id ?? device?.deviceId ?? "");
      if (id) byId.set(id, device);
    });
    return ntDevices.map((ntDevice) => {
      const id = String(ntDevice?.id ?? "");
      return byId.get(id) || ntDevice;
    });
  }, [devices, ntDevices]);

  function deviceLabel(deviceId) {
    const found = mergedDevices.find((device) => String(device?.id ?? device?.deviceId ?? "") === String(deviceId));
    if (!found) return `Dispositivo ${deviceId}`;
    return found.name || found.uniqueId || found.id;
  }

  async function handleStartLive(event) {
    event.preventDefault();
    if (!form.deviceId) return;

    setActionLoading(true);
    setError(null);

    const { data, error: requestError } = await safeApi.post(API_ROUTES.nt407.liveStart, {
      deviceId: form.deviceId,
      channel: Number(form.channel) || 1,
      dataType: 0,
      streamType: 0,
    });

    if (requestError) {
      setError(requestError);
      setActionLoading(false);
      return;
    }

    const live = data?.live || data;
    if (live?.id) {
      setSessions((prev) => [live, ...prev.filter((item) => item.id !== live.id)]);
    }

    setActionLoading(false);
  }

  async function handleStopLive(session) {
    if (!session?.id) return;
    setActionLoading(true);
    setError(null);

    const { data, error: requestError } = await safeApi.post(API_ROUTES.nt407.liveStop, {
      liveId: session.id,
      deviceId: session.deviceId,
      channel: session.channel,
    });

    if (requestError) {
      setError(requestError);
      setActionLoading(false);
      return;
    }

    const stopped = data?.live || session;
    setSessions((prev) => prev.map((item) => (item.id === stopped.id ? { ...item, ...stopped } : item)));
    setActionLoading(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader />

      <section className="card space-y-4">
        <div className="grid gap-3 text-xs md:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="opacity-70">Listener</div>
            <div className="mt-1 text-sm font-semibold">
              {health?.listener?.host || "-"}:{health?.listener?.tcpPort || "-"}
              {health?.listener?.udpPort ? ` (UDP ${health.listener.udpPort})` : ""}
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="opacity-70">Terminais online</div>
            <div className="mt-1 text-sm font-semibold">{health?.sessions?.terminalsOnline ?? 0}</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="opacity-70">Lives ativas</div>
            <div className="mt-1 text-sm font-semibold">{health?.sessions?.liveSessions ?? 0}</div>
          </div>
        </div>

        <form className="grid gap-3 md:grid-cols-4" onSubmit={handleStartLive}>
          <label className="space-y-1 text-xs">
            <span className="opacity-70">Dispositivo</span>
            <select
              value={form.deviceId}
              onChange={(event) => setForm((prev) => ({ ...prev, deviceId: event.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-layer px-3 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">Selecione</option>
              {ntDevices.map((device) => {
                const id = String(device?.id || "");
                if (!id) return null;
                return (
                  <option key={id} value={id}>
                    {deviceLabel(id)} ({device.terminalId || device.uniqueId || "sem terminal"})
                  </option>
                );
              })}
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="opacity-70">Canal</span>
            <input
              type="number"
              min={1}
              max={8}
              value={form.channel}
              onChange={(event) => setForm((prev) => ({ ...prev, channel: event.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-layer px-3 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <div className="flex items-end gap-2 md:col-span-2">
            <button
              type="submit"
              disabled={!form.deviceId || actionLoading}
              className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Iniciar live
            </button>
            <button
              type="button"
              onClick={() => fetchStatus()}
              className="h-10 rounded-lg border border-border px-4 text-sm hover:bg-white/5"
            >
              Atualizar status
            </button>
          </div>
        </form>

        {loading && <Loading message="Carregando status NT407..." />}
        {error && <ErrorMessage error={error} fallback="Não foi possível carregar o módulo Live NT407." />}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {sessions.map((session) => (
          <LiveStreamCard
            key={session.id}
            session={session}
            deviceLabel={deviceLabel(session.deviceId)}
            onStop={handleStopLive}
          />
        ))}
        {!sessions.length && !loading && (
          <div className="card text-sm opacity-70">
            Nenhuma sessão iniciada nesta tela. Inicie uma live para abrir o stream.
          </div>
        )}
      </section>
    </div>
  );
}
