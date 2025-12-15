import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useDevices from "../lib/hooks/useDevices";
import { useEvents } from "../lib/hooks/useEvents";
import { useTranslation } from "../lib/i18n.js";
import { translateEventType } from "../lib/event-translations.js";
import { formatAddress } from "../lib/format-address.js";

const EVENT_TYPES = [
  "all",
  "deviceOnline",
  "deviceOffline",
  "geofenceEnter",
  "geofenceExit",
  "speedLimit",
  "alarm",
  "maintenance",
  "driverChanged",
  "harshAcceleration",
  "harshBraking",
  "harshCornering",
];

export default function Events() {
  const { locale } = useTranslation();
  const { devices: deviceList } = useDevices();
  const devices = useMemo(() => (Array.isArray(deviceList) ? deviceList : []), [deviceList]);
  const [searchParams] = useSearchParams();
  const [selectedDevice, setSelectedDevice] = useState("all");
  const [type, setType] = useState("all");
  const [from, setFrom] = useState(() => new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [severity, setSeverity] = useState(() => searchParams.get("severity") ?? "all");
  const [notifications, setNotifications] = useState({ email: true, push: true, sms: false });

  const { events, loading, lastUpdated, error, refresh } = useEvents({
    deviceId: selectedDevice === "all" ? undefined : selectedDevice,
    types: type === "all" ? undefined : type,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
    severity: severity === "all" ? undefined : severity,
    refreshInterval: 15_000,
  });

  const filteredEvents = useMemo(
    () =>
      events.filter((event) => {
        if (severity === "all") return true;
        return normaliseSeverity(event) === severity;
      }),
    [events, severity],
  );

  const rows = useMemo(
    () =>
      filteredEvents.map((event) => ({
        id: event.id ?? `${event.deviceId}-${event.time}`,
        device: resolveDeviceName(event, devices),
        type: event.type ?? event.attributes?.type ?? event.event,
        time: event.serverTime ?? event.eventTime ?? event.time,
        severity: normaliseSeverity(event),
        address: event.attributes?.address || event.address,
        description: event.attributes?.message || event.attributes?.description || event.attributes?.type || "—",
      })),
    [filteredEvents, devices],
  );

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Eventos em tempo real</h2>
            <p className="text-xs opacity-70">
              Filtre por dispositivo, tipo de evento e intervalo. Atualização automática a cada 15 segundos.
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
            onClick={refresh}
          >
            Recarregar agora
          </button>
        </header>

        <div className="grid gap-4 md:grid-cols-5">
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide opacity-60">Veículo</span>
            <select
              value={selectedDevice}
              onChange={(event) => setSelectedDevice(event.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
            >
              <option value="all">Todos</option>
              {devices.map((device) => (
                <option key={device.id ?? device.deviceId ?? device.uniqueId} value={device.id ?? device.deviceId ?? device.uniqueId}>
                  {device.name ?? device.uniqueId ?? device.id}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide opacity-60">Tipo</span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
            >
              {EVENT_TYPES.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "Todos" : translateEventType(option, locale)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide opacity-60">Severidade</span>
            <select
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
            >
              {["all", "critical", "high", "normal", "low"].map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "Todas" : option}
                </option>
              ))}
            </select>
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
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider opacity-60">
              <tr>
                <th className="py-2 pr-6">Horário</th>
                <th className="py-2 pr-6">Veículo</th>
                <th className="py-2 pr-6">Tipo</th>
                <th className="py-2 pr-6">Severidade</th>
                <th className="py-2 pr-6">Descrição</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-sm opacity-60">
                    Carregando eventos…
                  </td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-sm text-red-300">
                    Não foi possível carregar os eventos. {error.message}
                  </td>
                </tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-sm opacity-60">
                    Nenhum evento para o filtro selecionado.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-white/5">
                  <td className="py-2 pr-6 text-white/80">{formatDateTime(row.time)}</td>
                  <td className="py-2 pr-6 text-white">{row.device}</td>
                  <td className="py-2 pr-6 text-white/80">{translateEventType(row.type, locale)}</td>
                  <td className="py-2 pr-6">
                    <SeverityPill severity={row.severity} />
                  </td>
                  <td className="py-2 pr-6 text-white/70">{formatAddress(row.address) || row.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="flex flex-col gap-3 border-t border-border/40 pt-4 text-xs opacity-60 md:flex-row md:items-center md:justify-between">
          <span>
            Última atualização: {lastUpdated ? new Date(lastUpdated).toLocaleString() : "Sincronizando…"}
          </span>
          <span>Notificações: {renderNotificationSummary(notifications)}</span>
        </footer>
      </section>

      <section className="card space-y-4">
        <header>
          <h3 className="text-lg font-semibold">Configuração de alertas</h3>
          <p className="text-xs opacity-70">Defina os canais de notificação para eventos críticos.</p>
        </header>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { key: "email", label: "E-mail", description: "Envia resumo a cada evento crítico" },
            { key: "push", label: "Push", description: "Notificação instantânea no navegador" },
            { key: "sms", label: "SMS", description: "Recomendado para eventos de risco" },
          ].map((item) => (
            <label key={item.key} className="flex flex-col gap-2 rounded-2xl border border-border bg-layer p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{item.label}</span>
                <input
                  type="checkbox"
                  checked={notifications[item.key]}
                  onChange={(event) =>
                    setNotifications((prev) => ({ ...prev, [item.key]: event.target.checked }))
                  }
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
              </div>
              <p className="text-xs opacity-60">{item.description}</p>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

function formatDateTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return String(value);
  }
}

function normaliseSeverity(event) {
  const raw = event?.attributes?.alarm ?? event?.severity ?? event?.level ?? "normal";
  const normalized = String(raw).toLowerCase();
  if (normalized.includes("crit")) return "critical";
  if (normalized.includes("high") || normalized.includes("alta")) return "high";
  if (normalized.includes("low") || normalized.includes("baixa")) return "low";
  return normalized || "normal";
}

function SeverityPill({ severity }) {
  const level = String(severity || "normal").toLowerCase();
  const palettes = {
    critical: "bg-red-500/10 text-red-300 border-red-500/30",
    high: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    low: "bg-emerald-500/10 text-emerald-200 border-emerald-500/30",
    normal: "bg-white/10 text-white/70 border-white/20",
  };
  const className = palettes[level] || palettes.normal;
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${className}`}>{severity ?? "Normal"}</span>;
}

function resolveDeviceName(event, devices) {
  const targetId = event.deviceId ?? event.device?.id ?? event.device;
  if (!targetId) return event.deviceName || "—";
  const match = devices.find((device) => String(device.id ?? device.deviceId ?? device.uniqueId) === String(targetId));
  return match?.name ?? match?.attributes?.name ?? event.deviceName ?? `Veículo ${targetId}`;
}

function renderNotificationSummary(notifications) {
  const enabled = Object.entries(notifications)
    .filter(([, value]) => value)
    .map(([key]) => key.toUpperCase());
  return enabled.length ? enabled.join(", ") : "desativado";
}
