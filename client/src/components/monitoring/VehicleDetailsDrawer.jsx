import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Battery,
  BatteryCharging,
  Cpu,
  Gauge,
  Info,
  Lock,
  MapPin,
  Power,
  Radio,
  Route,
  Satellite,
  ShieldAlert,
  Zap,
} from "lucide-react";
import { formatAddress as formatAddressString } from "../../lib/format-address.js";
import { FALLBACK_ADDRESS } from "../../lib/utils/geocode.js";
import { resolveTelemetryDescriptor } from "../../../../shared/telemetryDictionary.js";
import { getIgnition, pickSpeed } from "../../lib/monitoring-helpers.js";
import useTrips from "../../lib/hooks/useTrips.js";
import safeApi from "../../lib/safe-api.js";
import { API_ROUTES } from "../../lib/api-routes.js";
import useAlerts from "../../lib/hooks/useAlerts.js";

export default function VehicleDetailsDrawer({
  vehicle,
  onClose,
  variant = "drawer",
  extraTabs = [],
  baseTabs: baseTabsOverride = null,
  floating = true,
}) {
  const safeVehicle = vehicle || {};
  const defaultTabs = useMemo(
    () => [
      { id: "status", label: "Status" },
      { id: "info", label: "Informações" },
      { id: "trips", label: "Trajetos" },
      { id: "events", label: "Eventos" },
      { id: "commands", label: "Comandos" },
      { id: "itinerary", label: "Itinerário" },
      { id: "alerts", label: "Alertas" },
      { id: "cameras", label: "Câmeras" },
    ],
    [],
  );

  const tabs = useMemo(() => [...(baseTabsOverride || defaultTabs), ...extraTabs], [baseTabsOverride, defaultTabs, extraTabs]);
  const [activeTab, setActiveTab] = useState(() => tabs[0]?.id || "status");

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(tabs[0]?.id || "status");
    }
  }, [activeTab, tabs]);

  const devices = Array.isArray(safeVehicle?.devices) ? safeVehicle.devices : [];
  const [selectedDeviceId, setSelectedDeviceId] = useState(
    () =>
      safeVehicle?.principalDeviceId ||
      safeVehicle?.deviceId ||
      safeVehicle?.device?.id ||
      devices[0]?.id ||
      null,
  );

  useEffect(() => {
    setSelectedDeviceId(
      safeVehicle?.principalDeviceId ||
        safeVehicle?.deviceId ||
        safeVehicle?.device?.id ||
        devices[0]?.id ||
        null,
    );
  }, [devices, safeVehicle?.device?.id, safeVehicle?.deviceId, safeVehicle?.principalDeviceId]);

  const selectedDevice = useMemo(() => {
    if (!selectedDeviceId) return null;
    return devices.find(
      (item) =>
        String(item.id) === String(selectedDeviceId) ||
        String(item.traccarId) === String(selectedDeviceId) ||
        String(item.internalId || "") === String(selectedDeviceId),
    ) || null;
  }, [devices, selectedDeviceId]);

  const fallbackDevice = safeVehicle?.device ?? {};
  const device = selectedDevice || fallbackDevice;
  const position = device?.position || safeVehicle?.position || null;
  const address = safeVehicle.address || position?.address || position?.formattedAddress || position?.fullAddress;
  const isPending = position?.geocodeStatus === "pending";
  const resolvedAddress = resolveAddressLabel(address, isPending);
  const hasCameras = Array.isArray(device?.cameras) && device.cameras.length > 0;
  const latestPosition = position?.fixTime || position?.deviceTime || position?.serverTime || safeVehicle.lastUpdate;

  const statusLabel = safeVehicle.statusLabel || (latestPosition ? "Com sinal" : "Sem comunicação");
  const lastUpdateLabel = latestPosition
    ? new Date(latestPosition).toLocaleString()
    : safeVehicle.lastSeen || "Sem última posição";
  const vehicleId = safeVehicle?.id ?? safeVehicle?.vehicleId ?? null;
  const deviceIdForReports =
    device?.traccarId || device?.id || device?.deviceId || safeVehicle?.principalDeviceId || null;
  const vehicleBrand = safeVehicle?.brand || safeVehicle?.marca || safeVehicle?.make || null;
  const vehicleModel = safeVehicle?.model || safeVehicle?.modelo || null;
  const vehicleYear =
    safeVehicle?.modelYear ||
    safeVehicle?.year ||
    safeVehicle?.manufactureYear ||
    safeVehicle?.manufacturingYear ||
    null;
  const vehicleSummary = formatVehicleSummary(vehicleBrand, vehicleModel, vehicleYear);

  const { trips, loading: tripsLoading, error: tripsError } = useTrips({
    deviceId: deviceIdForReports,
    limit: 5,
    enabled: Boolean(deviceIdForReports),
  });

  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [commands, setCommands] = useState([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [itineraryStatus, setItineraryStatus] = useState(null);
  const [itineraryLoading, setItineraryLoading] = useState(false);
  const [alertStatus, setAlertStatus] = useState("pending");
  const [alertSeverity, setAlertSeverity] = useState("");
  const [alertCategory, setAlertCategory] = useState("");
  const [alertFrom, setAlertFrom] = useState("");
  const [alertTo, setAlertTo] = useState("");
  const [handlingDrafts, setHandlingDrafts] = useState({});

  const alertParams = useMemo(
    () => ({
      status: alertStatus,
      vehicleId: vehicleId || undefined,
      severity: alertSeverity || undefined,
      category: alertCategory || undefined,
      from: alertFrom || undefined,
      to: alertTo || undefined,
    }),
    [alertCategory, alertFrom, alertSeverity, alertStatus, alertTo, vehicleId],
  );
  const { alerts: vehicleAlerts, loading: alertsLoading, refresh: refreshAlerts } = useAlerts({
    params: alertParams,
    refreshInterval: 30_000,
    enabled: Boolean(vehicleId),
  });

  useEffect(() => {
    if (!deviceIdForReports) {
      setEvents([]);
      return;
    }
    let isActive = true;
    setEventsLoading(true);
    const now = new Date();
    const from = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
    const to = now.toISOString();
    safeApi
      .get(API_ROUTES.events, {
        params: { deviceIds: [deviceIdForReports], from, to, limit: 8 },
      })
      .then(({ data, error }) => {
        if (!isActive) return;
        if (error) {
          setEvents([]);
          return;
        }
        const list = Array.isArray(data?.events)
          ? data.events
          : Array.isArray(data?.data?.events)
          ? data.data.events
          : [];
        setEvents(list.slice(0, 8));
      })
      .catch(() => {
        if (isActive) setEvents([]);
      })
      .finally(() => {
        if (isActive) setEventsLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [deviceIdForReports]);

  useEffect(() => {
    if (!vehicleId) {
      setCommands([]);
      return;
    }
    let isActive = true;
    setCommandsLoading(true);
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const to = now.toISOString();
    safeApi
      .get(API_ROUTES.commandsHistory, {
        params: { vehicleId, from, to, pageSize: 6, page: 1 },
      })
      .then(({ data, error }) => {
        if (!isActive) return;
        if (error) {
          setCommands([]);
          return;
        }
        const list = Array.isArray(data?.data?.items)
          ? data.data.items
          : Array.isArray(data?.items)
          ? data.items
          : [];
        setCommands(list.slice(0, 6));
      })
      .catch(() => {
        if (isActive) setCommands([]);
      })
      .finally(() => {
        if (isActive) setCommandsLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [vehicleId]);

  useEffect(() => {
    if (!vehicleId) {
      setItineraryStatus(null);
      return;
    }
    let isActive = true;
    setItineraryLoading(true);
    safeApi
      .get(API_ROUTES.itineraryEmbarkVehicleStatus(vehicleId))
      .then(({ data, error }) => {
        if (!isActive) return;
        if (error) {
          setItineraryStatus(null);
          return;
        }
        setItineraryStatus(data?.data ?? data ?? null);
      })
      .catch(() => {
        if (isActive) setItineraryStatus(null);
      })
      .finally(() => {
        if (isActive) setItineraryLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [vehicleId]);

  const sensorCards = useMemo(() => {
    if (!position && !device) return [];
    const attributes = {
      ...(device?.attributes || {}),
      ...(position?.attributes || {}),
    };
    const ignition = getIgnition(position, device);
    const speed = pickSpeed(position);
    const baseValues = {
      ignition,
      speed,
      batteryLevel: position?.batteryLevel ?? attributes?.batteryLevel,
      vehicleVoltage: attributes?.vehicleVoltage ?? attributes?.voltage ?? attributes?.vcc ?? null,
      rssi: attributes?.rssi ?? attributes?.signal ?? null,
    };
    const merged = { ...attributes, ...baseValues };
    const entries = Object.entries(merged)
      .map(([key, value]) => {
        if (!isValidSensorValue(value)) return null;
        const descriptor = resolveTelemetryDescriptor(key);
        const label = descriptor?.labelPt || formatSensorLabel(key);
        const formattedValue = formatSensorValue(value, descriptor);
        return {
          key,
          label,
          value: formattedValue,
          rawValue: value,
          descriptor,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.descriptor?.priority ?? 999) - (b.descriptor?.priority ?? 999));

    const latest = latestPosition ? new Date(latestPosition).toLocaleString() : null;
    return entries.map((entry) => ({
      ...entry,
      icon: resolveSensorIcon(entry.key, entry.descriptor),
      updatedAt: latest,
    }));
  }, [device, latestPosition, position]);

  const renderContent = () => {
    if (!vehicle) {
      return (
        <Section title="Detalhes do veículo">
          <p className="text-xs text-white/60">Selecione um veículo para visualizar os detalhes.</p>
        </Section>
      );
    }

    if (activeTab === "status") {
      return (
        <>
          <Section title="Resumo">
            <Detail label="Placa" value={safeVehicle.plate || "—"} />
            <Detail label="Status" value={statusLabel} />
            <Detail label="Velocidade" value={position?.speed != null ? `${position.speed} km/h` : "—"} />
            <Detail label="Última atualização" value={lastUpdateLabel} />
            <Detail label="Endereço" value={resolvedAddress} />
          </Section>
          <Section title="Sensores" muted={false}>
            {sensorCards.length ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sensorCards.map((sensor) => (
                  <SensorCard key={sensor.key} sensor={sensor} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/60">Nenhum sensor disponível para este protocolo.</p>
            )}
          </Section>
        </>
      );
    }

    if (activeTab === "trips") {
      return (
        <Section title="Trajetos recentes">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-white/60">Resumo dos últimos trajetos deste veículo.</p>
            <Link
              to={`/trips?vehicleId=${encodeURIComponent(vehicleId || "")}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-primary/50 bg-primary/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white transition hover:border-primary/80"
            >
              Abrir em Trajetos
            </Link>
          </div>
          {tripsLoading && <p className="text-xs text-white/60">Carregando trajetos...</p>}
          {tripsError && <p className="text-xs text-red-300">Erro ao carregar trajetos.</p>}
          {!tripsLoading && trips.length === 0 && (
            <p className="text-xs text-white/50">Nenhum trajeto encontrado.</p>
          )}
          <ul className="space-y-2">
            {trips.map((trip) => (
              <li key={trip.id || trip.startTime} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-white">
                    {trip.startTime ? new Date(trip.startTime).toLocaleString() : "—"} →
                    {trip.endTime ? ` ${new Date(trip.endTime).toLocaleString()}` : " —"}
                  </span>
                  <span className="text-white/50">
                    {trip.distance != null ? `${Number(trip.distance).toFixed(1)} km` : "—"} •
                    {trip.duration != null ? ` ${formatDuration(trip.duration)}` : " —"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      );
    }

    if (activeTab === "events") {
      return (
        <Section title="Eventos">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-white/60">Eventos recentes vinculados ao veículo.</p>
            <Link
              to={`/events?vehicleId=${encodeURIComponent(vehicleId || "")}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-primary/50 bg-primary/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white transition hover:border-primary/80"
            >
              Abrir em Eventos
            </Link>
          </div>
          {eventsLoading && <p className="text-xs text-white/60">Carregando eventos...</p>}
          {!eventsLoading && events.length === 0 && (
            <p className="text-xs text-white/50">Nenhum evento encontrado.</p>
          )}
          <ul className="space-y-2">
            {events.map((event) => (
              <li key={event.id} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-white">
                    {event.eventLabel || event.type || "Evento"}
                  </span>
                  <span className="text-white/50">{event.severity || event.eventSeverity || "—"}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/50">
                  <span>{event.serverTime ? new Date(event.serverTime).toLocaleString() : "—"}</span>
                  <span>{formatAddressString(event.address || event.shortAddress)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      );
    }

    if (activeTab === "info") {
      return (
        <Section title="Informações do veículo">
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoField label="Cliente" value={safeVehicle.client?.name || safeVehicle.clientName || "—"} />
            <InfoField label="Item" value={safeVehicle.item || safeVehicle.name || "—"} />
            <InfoField label="Tipo do veículo" value={safeVehicle.type || safeVehicle.vehicleType || "—"} />
            <InfoField label="Placa" value={safeVehicle.plate || "—"} />
            <InfoField label="Identificador" value={safeVehicle.identifier || safeVehicle.identificador || "—"} />
            <InfoField label="Modelo" value={safeVehicle.model || "—"} />
            <InfoField label="Marca" value={safeVehicle.brand || "—"} />
            <InfoField label="Chassi" value={safeVehicle.chassis || safeVehicle.chassi || "—"} />
            <InfoField label="Renavam" value={safeVehicle.renavam || "—"} />
            <InfoField label="Cor" value={safeVehicle.color || safeVehicle.cor || "—"} />
            <InfoField label="Ano Modelo" value={safeVehicle.modelYear || "—"} />
            <InfoField label="Ano de Fabricação" value={safeVehicle.manufactureYear || safeVehicle.manufacturingYear || "—"} />
            <InfoField label="Código FIPE" value={safeVehicle.fipeCode || "—"} />
            <InfoField label="Valor FIPE" value={safeVehicle.fipeValue || "—"} />
            <InfoField label="Zero Km" value={safeVehicle.zeroKm ? "Sim" : "Não"} />
            <InfoField label="Motorista" value={safeVehicle.driver?.name || safeVehicle.driverName || "—"} />
            <InfoField label="Grupo" value={safeVehicle.group?.name || safeVehicle.groupName || "—"} />
            <InfoField label="Status" value={safeVehicle.status || "—"} />
          </div>
        </Section>
      );
    }

    if (activeTab === "commands") {
      return (
        <Section title="Comandos">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-white/60">Últimos comandos enviados para o veículo.</p>
            <Link
              to={`/commands?vehicleId=${encodeURIComponent(vehicleId || "")}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-primary/50 bg-primary/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white transition hover:border-primary/80"
            >
              Abrir em Comandos
            </Link>
          </div>
          {commandsLoading && <p className="text-xs text-white/60">Carregando comandos...</p>}
          {!commandsLoading && commands.length === 0 && (
            <p className="text-xs text-white/50">Nenhum comando encontrado.</p>
          )}
          <ul className="space-y-2">
            {commands.map((command) => (
              <li key={command.id || command.createdAt} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-white">{command.type || command.commandName || "Comando"}</span>
                  <span className="text-white/50">{command.status || "—"}</span>
                </div>
                <div className="mt-1 text-[11px] text-white/50">
                  {command.createdAt ? new Date(command.createdAt).toLocaleString() : "—"}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      );
    }

    if (activeTab === "itinerary") {
      return (
        <Section title="Itinerário">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-white/60">Itinerário vinculado ao veículo.</p>
            <Link
              to={`/itineraries?vehicleId=${encodeURIComponent(vehicleId || "")}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-primary/50 bg-primary/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white transition hover:border-primary/80"
            >
              Abrir em Itinerários
            </Link>
          </div>
          {itineraryLoading && <p className="text-xs text-white/60">Carregando itinerário...</p>}
          {!itineraryLoading && !itineraryStatus && (
            <p className="text-xs text-white/50">Nenhum itinerário embarcado.</p>
          )}
          {itineraryStatus && (
            <div className="mt-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70">
              <Detail label="Itinerário" value={itineraryStatus.itineraryName || itineraryStatus.name || "—"} />
              <Detail label="Status" value={itineraryStatus.status || itineraryStatus.state || "—"} />
              <Detail label="Última atualização" value={itineraryStatus.updatedAt || itineraryStatus.lastSync || "—"} />
            </div>
          )}
        </Section>
      );
    }

    if (activeTab === "alerts") {
      return (
        <Section title="Alertas">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-white/60">Alertas pendentes e tratados deste veículo.</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAlertStatus("pending")}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                  alertStatus === "pending"
                    ? "border-primary/60 bg-primary/20 text-white"
                    : "border-white/10 text-white/60 hover:text-white"
                }`}
              >
                Pendentes
              </button>
              <button
                type="button"
                onClick={() => setAlertStatus("handled")}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                  alertStatus === "handled"
                    ? "border-primary/60 bg-primary/20 text-white"
                    : "border-white/10 text-white/60 hover:text-white"
                }`}
              >
                Tratados
              </button>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs uppercase tracking-wide text-white/60">
              Período inicial
              <input
                type="datetime-local"
                value={alertFrom}
                onChange={(event) => setAlertFrom(event.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white"
              />
            </label>
            <label className="text-xs uppercase tracking-wide text-white/60">
              Período final
              <input
                type="datetime-local"
                value={alertTo}
                onChange={(event) => setAlertTo(event.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white"
              />
            </label>
            <label className="text-xs uppercase tracking-wide text-white/60">
              Severidade
              <select
                value={alertSeverity}
                onChange={(event) => setAlertSeverity(event.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white"
              >
                <option value="">Todas</option>
                <option value="grave">Grave</option>
                <option value="critical">Crítica</option>
                <option value="warning">Alerta</option>
              </select>
            </label>
            <label className="text-xs uppercase tracking-wide text-white/60">
              Tipo
              <select
                value={alertCategory}
                onChange={(event) => setAlertCategory(event.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white"
              >
                <option value="">Todos</option>
                <option value="Segurança">Segurança</option>
                <option value="Logística">Logística</option>
              </select>
            </label>
          </div>

          {alertsLoading && <p className="text-xs text-white/60">Carregando alertas...</p>}
          {!alertsLoading && vehicleAlerts.length === 0 && (
            <p className="text-xs text-white/50">Nenhum alerta encontrado.</p>
          )}
          <div className="space-y-3">
            {vehicleAlerts.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                draft={handlingDrafts[alert.id] || {}}
                onDraftChange={(field, value) =>
                  setHandlingDrafts((current) => ({
                    ...current,
                    [alert.id]: {
                      ...(current[alert.id] || {}),
                      [field]: value,
                    },
                  }))
                }
                onHandle={async () => {
                  await safeApi.patch(API_ROUTES.alertHandle(alert.id), {
                    isOk: handlingDrafts[alert.id]?.isOk ?? null,
                    action: handlingDrafts[alert.id]?.action ?? "",
                    cause: handlingDrafts[alert.id]?.cause ?? "",
                    notes: handlingDrafts[alert.id]?.notes ?? "",
                  });
                  setHandlingDrafts((current) => {
                    const next = { ...current };
                    delete next[alert.id];
                    return next;
                  });
                  refreshAlerts?.();
                }}
              />
            ))}
          </div>
        </Section>
      );
    }

    if (activeTab === "cameras") {
      return (
        <Section title="Câmeras / Vídeo">
          {hasCameras ? (
            <ul className="space-y-2 text-xs text-white/70">
              {device.cameras.map((camera) => (
                <li key={camera.id} className="flex items-center justify-between rounded-md border border-white/10 px-3 py-2">
                  <span>{camera.name}</span>
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.1em]">
                    <button
                      type="button"
                      className="rounded border border-white/10 px-2 py-1 hover:border-primary/70 hover:text-white"
                    >
                      Live
                    </button>
                    <button
                      type="button"
                      className="rounded border border-white/10 px-2 py-1 hover:border-primary/70 hover:text-white"
                    >
                      Gravações
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-white/50">Nenhuma câmera associada.</p>
          )}
        </Section>
      );
    }

    const customTab = tabs.find((tab) => tab.id === activeTab);
    if (customTab?.render) {
      return customTab.render({ vehicle });
    }

    return null;
  };

  const containerClass =
    variant === "page"
      ? "relative mx-auto flex h-full w-full max-w-6xl flex-col border border-white/10 bg-[#0f141c]/90 shadow-2xl"
      : `${floating ? "fixed" : "relative"} inset-y-0 right-0 z-[9998] flex h-full w-full flex-col border-l border-white/10 bg-[#0f141c]/95 shadow-3xl backdrop-blur`;

  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-white/50">Veículo</p>
          <h2 className="text-lg font-semibold text-white">{safeVehicle.plate || safeVehicle.name || "Veículo"}</h2>
          <p className="text-xs text-white/60">{vehicleSummary}</p>
          {devices.length > 0 ? (
            <div className="mt-2">
              <label className="text-[11px] uppercase tracking-[0.12em] text-white/50">Fonte de telemetria</label>
              <select
                value={selectedDeviceId || ""}
                onChange={(event) => setSelectedDeviceId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
              >
                {devices.map((item) => (
                  <option key={item.id || item.traccarId || item.uniqueId} value={item.id || item.traccarId || ""}>
                    {item.name || item.uniqueId || item.id || item.traccarId}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="h-10 w-10 rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:border-white/30 hover:text-white"
            aria-label="Fechar detalhes"
          >
            ✕
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 overflow-x-auto border-b border-white/5 px-5 py-3 text-[11px] uppercase tracking-[0.1em] text-white/60">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-md px-3 py-2 transition ${
              activeTab === tab.id ? "bg-primary/20 text-white border border-primary/40" : "border border-transparent hover:border-white/20"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 space-y-4 overflow-y-auto p-5 text-sm text-white/80 scroll-smooth">{renderContent()}</div>
    </div>
  );
}

function Section({ title, children, muted = false }) {
  return (
    <section className={`rounded-xl border border-white/5 px-4 py-3 shadow-inner shadow-black/20 ${muted ? "bg-white/5" : "bg-white/10"}`}>
      <h3 className="text-[12px] uppercase tracking-[0.14em] text-white/60">{title}</h3>
      <div className="mt-2 space-y-2 text-sm text-white/80">{children}</div>
    </section>
  );
}

function Detail({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-white/70">
      <span className="uppercase tracking-[0.12em] text-white/50">{label}</span>
      <span className="max-w-[65%] truncate text-right text-white">{value ?? "—"}</span>
    </div>
  );
}

function resolveAddressLabel(address, isLoading = false) {
  const formatted = formatAddressString(address);
  if (formatted && formatted !== "—") return formatted;
  if (isLoading) return "Carregando…";
  return FALLBACK_ADDRESS;
}

function InfoField({ label, value }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
      <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">{label}</p>
      <p className="mt-1 text-sm text-white">{value ?? "—"}</p>
    </div>
  );
}

function SensorCard({ sensor }) {
  const Icon = sensor.icon || Info;
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center gap-2 text-sm text-white">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white/70">
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs uppercase tracking-[0.12em] text-white/50">{sensor.label}</p>
          <p className="truncate text-base font-semibold text-white">{sensor.value}</p>
        </div>
      </div>
      {sensor.updatedAt ? (
        <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-white/40">
          Última atualização • {sensor.updatedAt}
        </p>
      ) : null}
    </div>
  );
}

function AlertCard({ alert, draft, onDraftChange, onHandle }) {
  const isPending = alert.status === "pending";
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">{alert.eventLabel || "Alerta"}</p>
          <p className="text-[11px] text-white/50">
            {alert.createdAt ? new Date(alert.createdAt).toLocaleString() : "—"} • {alert.severity || "—"}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.12em] ${
          isPending ? "bg-amber-500/20 text-amber-200" : "bg-emerald-500/20 text-emerald-200"
        }`}>
          {isPending ? "Pendente" : "Tratado"}
        </span>
      </div>
      <p className="mt-2 text-[11px] text-white/50">{alert.address || "Endereço indisponível"}</p>

      {isPending ? (
        <div className="mt-3 grid gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">Está tudo OK com o veículo?</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => onDraftChange("isOk", true)}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                  draft.isOk === true
                    ? "border-emerald-400 bg-emerald-400/20 text-emerald-100"
                    : "border-white/10 text-white/60"
                }`}
              >
                Sim
              </button>
              <button
                type="button"
                onClick={() => onDraftChange("isOk", false)}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                  draft.isOk === false
                    ? "border-amber-400 bg-amber-400/20 text-amber-100"
                    : "border-white/10 text-white/60"
                }`}
              >
                Não
              </button>
            </div>
          </div>
          <label className="text-[10px] uppercase tracking-[0.12em] text-white/50">
            O que foi feito?
            <textarea
              value={draft.action || ""}
              onChange={(event) => onDraftChange("action", event.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white"
              rows={2}
            />
          </label>
          <label className="text-[10px] uppercase tracking-[0.12em] text-white/50">
            O que causou?
            <textarea
              value={draft.cause || ""}
              onChange={(event) => onDraftChange("cause", event.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white"
              rows={2}
            />
          </label>
          <label className="text-[10px] uppercase tracking-[0.12em] text-white/50">
            Observação
            <textarea
              value={draft.notes || ""}
              onChange={(event) => onDraftChange("notes", event.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white"
              rows={2}
            />
          </label>
          <button
            type="button"
            onClick={onHandle}
            className="rounded-lg border border-primary/60 bg-primary/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white"
          >
            Tratar alerta
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-1 text-[11px] text-white/50">
          <p>Tratado em: {alert.handledAt ? new Date(alert.handledAt).toLocaleString() : "—"}</p>
          <p>OK: {alert.handling?.isOk === true ? "Sim" : alert.handling?.isOk === false ? "Não" : "—"}</p>
          <p>Ação: {alert.handling?.action || "—"}</p>
          <p>Causa: {alert.handling?.cause || "—"}</p>
          <p>Observação: {alert.handling?.notes || "—"}</p>
        </div>
      )}
    </div>
  );
}

function isValidSensorValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if (typeof value === "object") return false;
  return true;
}

function formatSensorLabel(key) {
  if (!key) return "Sensor";
  return String(key)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatSensorValue(value, descriptor) {
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number") {
    const unit = descriptor?.unit || "";
    const formatted = Number.isFinite(value) ? value.toString() : "—";
    return unit ? `${formatted} ${unit}` : formatted;
  }
  return String(value);
}

function resolveSensorIcon(key, descriptor) {
  const normalized = String(key || "").toLowerCase();
  const label = String(descriptor?.labelPt || "").toLowerCase();
  if (normalized.includes("ignition") || label.includes("ignição")) return Power;
  if (normalized.includes("battery") || label.includes("bateria")) {
    return normalized.includes("charge") ? BatteryCharging : Battery;
  }
  if (normalized.includes("voltage") || normalized.includes("vcc") || normalized.includes("vbat")) return Zap;
  if (normalized.includes("speed") || label.includes("velocidade")) return Gauge;
  if (normalized.includes("rssi") || normalized.includes("signal") || label.includes("sinal")) return Radio;
  if (normalized.includes("sat") || label.includes("satélite")) return Satellite;
  if (normalized.includes("route") || normalized.includes("itinerary") || label.includes("itinerário")) return Route;
  if (normalized.includes("jam") || normalized.includes("jammer") || label.includes("jammer")) return ShieldAlert;
  if (normalized.includes("lock") || label.includes("bloqueio")) return Lock;
  if (normalized.includes("gps") || normalized.includes("address")) return MapPin;
  return Cpu;
}

function formatVehicleSummary(brand, model, year) {
  const parts = [brand, model, year].filter((item) => item && String(item).trim());
  if (!parts.length) return "—";
  return parts.join(" • ");
}

function formatDuration(value) {
  const totalSeconds = Number(value);
  if (!Number.isFinite(totalSeconds)) return "—";
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours > 0) return `${hours}h ${remainingMinutes}m`;
  return `${minutes}m`;
}
