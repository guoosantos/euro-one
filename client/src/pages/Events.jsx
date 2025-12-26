import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useVehicles, { formatVehicleLabel, normalizeVehicleDevices } from "../lib/hooks/useVehicles.js";
import { useEvents } from "../lib/hooks/useEvents";
import { useTranslation } from "../lib/i18n.js";
import { translateEventType } from "../lib/event-translations.js";
import AddressCell from "../ui/AddressCell.jsx";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";
import VehicleSelector from "../components/VehicleSelector.jsx";
import useVehicleSelection from "../lib/hooks/useVehicleSelection.js";
import DataState from "../ui/DataState.jsx";

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
  const {
    vehicles,
    loading: loadingVehicles,
    error: vehiclesError,
  } = useVehicles();
  const [searchParams] = useSearchParams();
  const { selectedVehicleId, selectedTelemetryDeviceId } = useVehicleSelection({ syncQuery: true });
  const [type, setType] = useState("all");
  const [from, setFrom] = useState(() => new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [severity, setSeverity] = useState(() => searchParams.get("severity") ?? "all");
  const [notifications, setNotifications] = useState({ email: true, push: true, sms: false });

  const vehicleById = useMemo(
    () =>
      new Map(
        vehicles.map((vehicle) => [String(vehicle.id), vehicle]),
      ),
    [vehicles],
  );

  const vehicleByDeviceId = useMemo(() => {
    const map = new Map();
    vehicles.forEach((vehicle) => {
      normalizeVehicleDevices(vehicle).forEach((device) => {
        const key = toDeviceKey(device?.id ?? device?.deviceId ?? device?.uniqueId ?? device?.traccarId);
        if (key) map.set(String(key), vehicle);
      });
    });
    return map;
  }, [vehicles]);

  const selectedVehicle = selectedVehicleId ? vehicleById.get(String(selectedVehicleId)) || null : null;
  const activeDeviceId = selectedTelemetryDeviceId || selectedVehicle?.primaryDeviceId || null;
  const hasDevice = Boolean(activeDeviceId);
  const filtersEnabled = Boolean(selectedVehicleId && hasDevice);

  const { events, loading, lastUpdated, error, refresh } = useEvents({
    deviceId: selectedVehicleId === "all" ? undefined : activeDeviceId,
    types: type === "all" ? undefined : type,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
    severity: severity === "all" ? undefined : severity,
    refreshInterval: 15_000,
    enabled: filtersEnabled,
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
        device: resolveVehicleName(event, vehicles, vehicleByDeviceId),
        type: event.type ?? event.attributes?.type ?? event.event,
        time: event.serverTime ?? event.eventTime ?? event.time,
        severity: normaliseSeverity(event),
        address: event.attributes?.address || event.address,
        lat: event.latitude ?? event.lat ?? event.position?.latitude ?? event.position?.lat,
        lng: event.longitude ?? event.lon ?? event.position?.longitude ?? event.position?.lon,
        description: event.attributes?.message || event.attributes?.description || event.attributes?.type || "—",
      })),
    [filteredEvents, vehicles, vehicleByDeviceId],
  );

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Eventos em tempo real</h2>
            <p className="text-xs opacity-70">
              Filtre por veículo, tipo de evento e intervalo. Atualização automática a cada 15 segundos.
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
          <VehicleSelector className="text-sm" />

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
          {!selectedVehicleId && (
            <DataState
              tone="muted"
              state="info"
              title="Selecione um veículo"
              description="Escolha um veículo para visualizar os eventos."
            />
          )}
          {selectedVehicleId && !hasDevice && (
            <DataState
              tone="muted"
              state="warning"
              title="Sem equipamento vinculado"
              description="Associe um equipamento ao veículo para visualizar eventos."
            />
          )}
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
                    {filtersEnabled ? "Nenhum evento para o filtro selecionado." : "Selecione um veículo com equipamento vinculado para carregar eventos."}
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
                  <td className="py-2 pr-6 text-white/70">
                    <AddressCell address={row.address || row.description} lat={row.lat} lng={row.lng} />
                  </td>
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

function resolveVehicleName(event, vehicles, vehicleByDeviceId) {
  const targetVehicleId =
    event.vehicleId ||
    event.vehicle?.id ||
    event.attributes?.vehicleId ||
    event.attributes?.vehicle_id;
  if (targetVehicleId) {
    const directVehicle = vehicles.find((vehicle) => String(vehicle.id) === String(targetVehicleId));
    if (directVehicle) return formatVehicleLabel(directVehicle);
  }

  const targetDeviceId = toDeviceKey(event.deviceId ?? event.device?.id ?? event.device);
  if (targetDeviceId && vehicleByDeviceId.has(String(targetDeviceId))) {
    return formatVehicleLabel(vehicleByDeviceId.get(String(targetDeviceId)));
  }

  return event.deviceName || "—";
}

function renderNotificationSummary(notifications) {
  const enabled = Object.entries(notifications)
    .filter(([, value]) => value)
    .map(([key]) => key.toUpperCase());
  return enabled.length ? enabled.join(", ") : "desativado";
}
