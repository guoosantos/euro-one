import React, { useEffect, useMemo, useState } from "react";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import useDevices from "../lib/hooks/useDevices";
import Loading from "../components/Loading.jsx";
import ErrorMessage from "../components/ErrorMessage.jsx";
import PageHeader from "../components/ui/PageHeader.jsx";

const ALERT_TYPES = [
  { key: "noSeatbelt", label: "Sem cinto" },
  { key: "fatigue", label: "Fadiga" },
  { key: "distraction", label: "Distração" },
  { key: "phone", label: "Uso de celular" },
];

const FACE_ALERTS_ENABLED = import.meta.env.VITE_ENABLE_FACE_ALERTS === "true";

export default function Face() {
  const { devices: deviceList } = useDevices();
  const devices = useMemo(() => (Array.isArray(deviceList) ? deviceList : []), [deviceList]);
  const [alerts, setAlerts] = useState([]);
  const [infoMessage, setInfoMessage] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!FACE_ALERTS_ENABLED) {
      setAlerts(buildStubAlerts(devices));
      setInfoMessage("Módulo de reconhecimento facial desativado neste ambiente.");
      setError(null);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    let timer;
    let abortController;

    async function fetchAlerts() {
      setLoading(true);
      setError(null);
      abortController?.abort();
      abortController = new AbortController();
      try {
        const { data: payload, error: requestError } = await safeApi.get(API_ROUTES.media.faceAlerts, {
          signal: abortController.signal,
          timeout: 15_000,
        });
        if (requestError) {
          if (safeApi.isAbortError(requestError)) return;
          throw requestError;
        }
        if (cancelled) return;
        const list = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.alerts)
          ? payload.alerts
          : [];
        setAlerts(list);
        setInfoMessage(typeof payload?.message === "string" ? payload.message : "");
      } catch (requestError) {
        if (cancelled) return;
        setError(requestError);
        setAlerts(buildStubAlerts(devices));
        setInfoMessage("Módulo de reconhecimento facial ainda não configurado");
      } finally {
        if (!cancelled) {
          setLoading(false);
          timer = setTimeout(fetchAlerts, 30_000);
        }
      }
    }

    fetchAlerts();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      abortController?.abort();
    };
  }, [devices]);

  const filteredAlerts = useMemo(() => {
    if (filter === "all") return alerts;
    return alerts.filter((alert) => alert?.type === filter);
  }, [alerts, filter]);

  return (
    <div className="space-y-6">
      <PageHeader
        overline="Central de vídeo"
        title="Reconhecimento facial e cabine"
        subtitle="Alertas provenientes das câmeras embarcadas Euro Vision (fadiga, distração, uso de cinto). Atualização contínua."
        rightSlot={
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="h-10 rounded-lg border border-border bg-layer px-3 text-sm focus:border-primary focus:outline-none"
          >
            <option value="all">Todos os alertas</option>
            {ALERT_TYPES.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        }
      />
      <section className="card space-y-4">
        {error && <ErrorMessage error={error} fallback="Não foi possível buscar os alertas." />}
        {infoMessage && !error && (
          <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/70">{infoMessage}</div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {loading && <Loading message="Sincronizando alertas…" />}
        {filteredAlerts.map((alert) => (
          <article key={`${alert.id}-${alert.timestamp || alert.type}`} className="rounded-2xl border border-border bg-layer p-4">
            <header className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">{alert?.driverName ?? "Motorista não identificado"}</div>
                <div className="text-xs opacity-60">{formatDevice(alert?.deviceId, devices)}</div>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${badgeClass(alert?.type)}`}>
                {translateAlert(alert?.type)}
              </span>
            </header>
            <p className="mt-2 text-xs opacity-60">{formatTimestamp(alert?.timestamp)}</p>
            <p className="mt-3 text-sm opacity-80">{alert?.description ?? "Evento registrado pela câmera"}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs opacity-70">
              <span className="rounded-full border border-border px-2 py-1">
                Confiança {Math.round((alert?.confidence ?? 0) * 100)}%
              </span>
              {alert?.duration && (
                <span className="rounded-full border border-border px-2 py-1">{formatDuration(alert.duration)}</span>
              )}
            </div>
          </article>
        ))}
        {!filteredAlerts.length && (
          <div className="card text-sm opacity-60">
            {loading ? "Sincronizando alertas…" : "Nenhum alerta com os filtros atuais."}
          </div>
        )}
      </section>
    </div>
  );
}

function buildStubAlerts(devices) {
  if (!devices.length) {
    return [];
  }
  return devices.slice(0, 4).map((device, index) => ({
    id: `stub-${device.id ?? index}`,
    deviceId: device.id ?? device.deviceId ?? device.uniqueId,
    driverName: device.name ?? device.uniqueId ?? `Motorista ${index + 1}`,
    type: ALERT_TYPES[index % ALERT_TYPES.length].key,
    description: "Alerta simulado para ambiente de homologação.",
    confidence: 0.75 + index * 0.05,
    duration: 90 + index * 15,
    timestamp: new Date(Date.now() - index * 600000).toISOString(),
  }));
}

function translateAlert(type) {
  const entry = ALERT_TYPES.find((item) => item.key === type);
  return entry ? entry.label : type;
}

function badgeClass(type) {
  switch (type) {
    case "noSeatbelt":
      return "bg-red-500/10 text-red-300";
    case "fatigue":
      return "bg-amber-500/10 text-amber-300";
    case "distraction":
      return "bg-blue-500/10 text-blue-300";
    case "phone":
      return "bg-purple-500/10 text-purple-300";
    default:
      return "bg-white/10 text-white/70";
  }
}

function formatDevice(deviceId, devices) {
  const match = devices.find((device) => String(device.id ?? device.deviceId ?? device.uniqueId) === String(deviceId));
  return match ? match.name ?? match.uniqueId ?? match.id : `Dispositivo ${deviceId}`;
}

function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return null;
  const minutes = Math.floor(value / 60);
  const remainder = Math.round(value % 60);
  return `${minutes}m ${remainder}s`;
}

function formatTimestamp(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}
