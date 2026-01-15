import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
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
import { resolveEventDefinitionFromPayload } from "../../lib/event-translations.js";
import { getIgnition, pickSpeed } from "../../lib/monitoring-helpers.js";
import useTrips from "../../lib/hooks/useTrips.js";
import useReportsRoute from "../../lib/hooks/useReportsRoute.js";
import safeApi from "../../lib/safe-api.js";
import { API_ROUTES } from "../../lib/api-routes.js";
import useAlerts from "../../lib/hooks/useAlerts.js";
import { createVehicleMarkerIcon } from "../../lib/map/vehicleMarkerIcon.js";
import { ENABLED_MAP_LAYERS, MAP_LAYER_FALLBACK } from "../../lib/mapLayers.js";
import { filterCommandsBySearch, mergeCommands, resolveCommandSendError } from "../../pages/commands-helpers.js";

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

  const defaultRange = useMemo(() => buildDateRange(24), []);
  const [tripsRange, setTripsRange] = useState(() => ({
    from: formatDatetimeLocal(defaultRange.from),
    to: formatDatetimeLocal(defaultRange.to),
  }));
  const [eventsRange, setEventsRange] = useState(() => ({
    from: formatDatetimeLocal(defaultRange.from),
    to: formatDatetimeLocal(defaultRange.to),
  }));
  const [commandsRange, setCommandsRange] = useState(() => ({
    from: formatDatetimeLocal(defaultRange.from),
    to: formatDatetimeLocal(defaultRange.to),
  }));
  const reportRange = useMemo(() => ({
    from: toISOStringSafe(defaultRange.from),
    to: toISOStringSafe(defaultRange.to),
  }), [defaultRange]);
  const tripsQuery = useMemo(
    () => ({
      from: toISOStringSafe(tripsRange.from),
      to: toISOStringSafe(tripsRange.to),
    }),
    [tripsRange.from, tripsRange.to],
  );
  const { trips, loading: tripsLoading, error: tripsError } = useTrips({
    deviceId: deviceIdForReports,
    from: tripsQuery.from,
    to: tripsQuery.to,
    limit: 10,
    enabled: Boolean(deviceIdForReports),
  });
  const eventsQuery = useMemo(
    () => ({
      from: toISOStringSafe(eventsRange.from),
      to: toISOStringSafe(eventsRange.to),
    }),
    [eventsRange.from, eventsRange.to],
  );
  const commandsQuery = useMemo(
    () => ({
      from: toISOStringSafe(commandsRange.from),
      to: toISOStringSafe(commandsRange.to),
    }),
    [commandsRange.from, commandsRange.to],
  );
  const fetchCommandsHistory = useCallback(() => {
    if (!vehicleId) {
      setCommands([]);
      return Promise.resolve();
    }
    let isActive = true;
    setCommandsLoading(true);
    const from = commandsQuery.from || reportRange.from;
    const to = commandsQuery.to || reportRange.to;
    return safeApi
      .get(API_ROUTES.commandsHistory, {
        params: { vehicleId, from, to, pageSize: 8, page: 1 },
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
      })
      .finally(() => {
        isActive = false;
      });
  }, [commandsQuery.from, commandsQuery.to, reportRange.from, reportRange.to, vehicleId]);

  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [commands, setCommands] = useState([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [activeTripIndex, setActiveTripIndex] = useState(0);
  const [isTripPlaying, setIsTripPlaying] = useState(false);
  const [tripSpeed, setTripSpeed] = useState(8);
  const [tripFollow, setTripFollow] = useState(true);
  const [showTripDetails, setShowTripDetails] = useState(false);
  const [itineraryStatus, setItineraryStatus] = useState(null);
  const [itineraryLoading, setItineraryLoading] = useState(false);
  const [itineraryHistory, setItineraryHistory] = useState([]);
  const [itineraryHistoryLoading, setItineraryHistoryLoading] = useState(false);
  const [itineraryList, setItineraryList] = useState([]);
  const [itineraryListLoading, setItineraryListLoading] = useState(false);
  const [itineraryActionLoading, setItineraryActionLoading] = useState(null);
  const [itineraryQuery, setItineraryQuery] = useState("");
  const [alertStatus, setAlertStatus] = useState("pending");
  const [handlingDrafts, setHandlingDrafts] = useState({});
  const [activeAlertId, setActiveAlertId] = useState(null);
  const { data: routeData, loading: routeLoading, error: routeError, generate: generateRoute } = useReportsRoute();
  const [commandModalOpen, setCommandModalOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState("");
  const [commandOptions, setCommandOptions] = useState([]);
  const [commandOptionsLoading, setCommandOptionsLoading] = useState(false);
  const [commandOptionsError, setCommandOptionsError] = useState(null);
  const [selectedCommandKey, setSelectedCommandKey] = useState("");
  const [commandParams, setCommandParams] = useState({});
  const [commandSending, setCommandSending] = useState(false);
  const [commandSendError, setCommandSendError] = useState(null);

  const alertParams = useMemo(
    () => ({
      status: alertStatus,
      vehicleId: vehicleId || undefined,
    }),
    [alertStatus, vehicleId],
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
    const from = eventsQuery.from || reportRange.from;
    const to = eventsQuery.to || reportRange.to;
    safeApi
      .get(API_ROUTES.events, {
        params: { deviceIds: [deviceIdForReports], from, to, limit: 12 },
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
  }, [deviceIdForReports, eventsQuery.from, eventsQuery.to, reportRange.from, reportRange.to]);

  useEffect(() => {
    void fetchCommandsHistory();
  }, [fetchCommandsHistory]);

  const fetchItineraryStatus = useCallback(() => {
    if (!vehicleId) {
      setItineraryStatus(null);
      return Promise.resolve();
    }
    let isActive = true;
    setItineraryLoading(true);
    return safeApi
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
        isActive = false;
      });
  }, [vehicleId]);

  useEffect(() => {
    void fetchItineraryStatus();
  }, [fetchItineraryStatus]);

  const fetchItineraryHistory = useCallback(() => {
    if (!vehicleId) {
      setItineraryHistory([]);
      return Promise.resolve();
    }
    let isActive = true;
    setItineraryHistoryLoading(true);
    return safeApi
      .get(API_ROUTES.itineraryEmbarkVehicleHistory(vehicleId))
      .then(({ data, error }) => {
        if (!isActive) return;
        if (error) {
          setItineraryHistory([]);
          return;
        }
        const list = Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data?.history)
          ? data.history
          : Array.isArray(data)
          ? data
          : [];
        setItineraryHistory(list.slice(0, 12));
      })
      .catch(() => {
        if (isActive) setItineraryHistory([]);
      })
      .finally(() => {
        if (isActive) setItineraryHistoryLoading(false);
        isActive = false;
      });
  }, [vehicleId]);

  useEffect(() => {
    void fetchItineraryHistory();
  }, [fetchItineraryHistory]);

  useEffect(() => {
    if (!safeVehicle?.client?.id && !safeVehicle?.clientId && !safeVehicle?.client_id) {
      setItineraryList([]);
      return;
    }
    let isActive = true;
    setItineraryListLoading(true);
    safeApi
      .get(API_ROUTES.itineraries, {
        params: {
          clientId: safeVehicle?.client?.id || safeVehicle?.clientId || safeVehicle?.client_id || undefined,
        },
      })
      .then(({ data, error }) => {
        if (!isActive) return;
        if (error) {
          setItineraryList([]);
          return;
        }
        const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        setItineraryList(list);
      })
      .catch(() => {
        if (isActive) setItineraryList([]);
      })
      .finally(() => {
        if (isActive) setItineraryListLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [safeVehicle?.client?.id, safeVehicle?.clientId, safeVehicle?.client_id]);

  useEffect(() => {
    if (!commandModalOpen) return;
    if (!device?.protocol) {
      setCommandOptions([]);
      setCommandOptionsError(new Error("Dispositivo sem protocolo configurado."));
      return;
    }
    let isActive = true;
    const load = async () => {
      setCommandOptionsLoading(true);
      setCommandOptionsError(null);
      try {
        const [protocolResponse, customResponse] = await Promise.all([
          safeApi.get(API_ROUTES.protocolCommands(device.protocol)),
          safeApi.get(API_ROUTES.commandsCustom, {
            params: {
              deviceId: device?.traccarId || device?.id || undefined,
              protocol: device?.protocol || undefined,
              clientId: safeVehicle?.client?.id || safeVehicle?.clientId || undefined,
            },
          }),
        ]);
        if (protocolResponse?.error) throw protocolResponse.error;
        if (customResponse?.error) throw customResponse.error;
        if (!isActive) return;
        const protocolCommands = Array.isArray(protocolResponse?.data?.commands) ? protocolResponse.data.commands : [];
        const customCommands = Array.isArray(customResponse?.data?.data) ? customResponse.data.data : [];
        const merged = mergeCommands(protocolCommands, customCommands, { deviceProtocol: device.protocol });
        setCommandOptions(merged);
      } catch (error) {
        if (!isActive) return;
        setCommandOptions([]);
        setCommandOptionsError(error instanceof Error ? error : new Error("Erro ao carregar comandos"));
      } finally {
        if (isActive) setCommandOptionsLoading(false);
      }
    };
    void load();
    return () => {
      isActive = false;
    };
  }, [commandModalOpen, device?.protocol, device?.traccarId, device?.id, safeVehicle?.client?.id, safeVehicle?.clientId]);

  const itinerarySummary = useMemo(() => {
    const items = Array.isArray(itineraryStatus?.items) ? itineraryStatus.items : [];
    const counts = { geofences: 0, routes: 0, targets: 0 };
    items.forEach((item) => {
      const type = String(item?.type || "").toLowerCase();
      if (type === "route") {
        counts.routes += 1;
        return;
      }
      if (type === "target") {
        counts.targets += 1;
        return;
      }
      if (type) {
        counts.geofences += 1;
      }
    });
    return {
      counts,
      lastEmbarkAt: itineraryStatus?.lastEmbarkAt || itineraryStatus?.lastActionAt || itineraryStatus?.updatedAt || null,
      statusLabel:
        itineraryStatus?.status ||
        itineraryStatus?.statusLabel ||
        itineraryStatus?.xdmStatusLabel ||
        itineraryStatus?.state ||
        "—",
      itineraryName: itineraryStatus?.itineraryName || itineraryStatus?.name || "—",
    };
  }, [itineraryStatus]);

  const latestHistoryByItinerary = useMemo(() => {
    const map = new Map();
    itineraryHistory.forEach((entry) => {
      const id = entry?.itineraryId ? String(entry.itineraryId) : null;
      if (!id) return;
      const current = map.get(id);
      const entryTime = new Date(entry.sentAt || entry.createdAt || entry.at || 0).getTime();
      const currentTime = current ? new Date(current.sentAt || current.createdAt || current.at || 0).getTime() : 0;
      if (!current || entryTime > currentTime) {
        map.set(id, entry);
      }
    });
    return map;
  }, [itineraryHistory]);

  useEffect(() => {
    if (!selectedTrip) return;
    const from = selectedTrip.startTime || selectedTrip.start || selectedTrip.from;
    const to = selectedTrip.endTime || selectedTrip.end || selectedTrip.to;
    const deviceId = selectedTrip.deviceId || selectedTrip.device_id || deviceIdForReports;
    if (!from || !to || !deviceId) return;
    void generateRoute({ deviceId, from, to }).catch(() => {});
  }, [deviceIdForReports, generateRoute, selectedTrip]);

  const routePoints = useMemo(() => {
    const positions = Array.isArray(routeData?.positions)
      ? routeData.positions
      : Array.isArray(routeData?.data)
      ? routeData.data
      : [];
    return positions
      .map((point, index) => {
        const normalized = normalizeLatLng(point);
        if (!normalized) return null;
        return { ...point, ...normalized, index };
      })
      .filter(Boolean);
  }, [routeData]);

  useEffect(() => {
    if (!routePoints.length) {
      setActiveTripIndex(0);
      setIsTripPlaying(false);
      return;
    }
    setActiveTripIndex(0);
    setIsTripPlaying(false);
  }, [routePoints.length]);

  useEffect(() => {
    if (!isTripPlaying || routePoints.length < 2) return undefined;
    const intervalMs = Math.max(200, Math.round(900 / Math.max(0.5, tripSpeed)));
    const interval = setInterval(() => {
      setActiveTripIndex((current) => {
        if (current + 1 >= routePoints.length) {
          setIsTripPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, intervalMs);
    return () => clearInterval(interval);
  }, [isTripPlaying, routePoints.length, tripSpeed]);

  const tripEventSummaries = useMemo(() => {
    const summary = new Map();
    routePoints.forEach((point) => {
      const definition = resolveEventDefinitionFromPayload(point);
      const label = definition?.label || "Posição registrada";
      const key = definition?.type || label;
      const current = summary.get(key) || { label, count: 0 };
      summary.set(key, { ...current, count: current.count + 1 });
    });
    return Array.from(summary.values()).sort((a, b) => b.count - a.count);
  }, [routePoints]);

  const activeTripPoint = routePoints[activeTripIndex] || null;
  const satelliteLayer = useMemo(() => {
    return (
      ENABLED_MAP_LAYERS.find((layer) => layer.key === "google-satellite") ||
      ENABLED_MAP_LAYERS.find((layer) => layer.key === "satellite") ||
      ENABLED_MAP_LAYERS.find((layer) => layer.key === "google-hybrid") ||
      MAP_LAYER_FALLBACK
    );
  }, []);

  useEffect(() => {
    if (!selectedTrip) return;
    const match = trips.find(
      (trip) => String(trip?.id || trip?.startTime) === String(selectedTrip?.id || selectedTrip?.startTime),
    );
    if (!match) {
      setSelectedTrip(null);
    }
  }, [selectedTrip, trips]);

  const handleSendCommand = useCallback(async () => {
    if (!selectedCommand) return;
    if (!vehicleId) {
      setCommandSendError("Veículo inválido para envio de comando.");
      return;
    }
    const traccarId = Number(device?.traccarId ?? device?.id);
    if (!Number.isFinite(traccarId)) {
      setCommandSendError("Equipamento sem Traccar ID válido.");
      return;
    }
    if (selectedCommand.kind !== "custom" && !device?.protocol) {
      setCommandSendError("Dispositivo sem protocolo definido.");
      return;
    }
    const commandKey = getCommandKey(selectedCommand);
    if (!commandKey) {
      setCommandSendError("Selecione um comando válido.");
      return;
    }
    setCommandSending(true);
    setCommandSendError(null);
    try {
      const payloadBase = {
        vehicleId,
        deviceId: traccarId,
        ...(safeVehicle?.client?.id ? { clientId: safeVehicle.client.id } : {}),
      };
      let response = null;
      if (selectedCommand.kind === "custom") {
        response = await safeApi.post(API_ROUTES.commandsSend, {
          ...payloadBase,
          customCommandId: selectedCommand.id,
        });
      } else {
        response = await safeApi.post(API_ROUTES.commandsSend, {
          ...payloadBase,
          protocol: device.protocol,
          commandKey,
          commandName: selectedCommand.name || commandKey,
          params: commandParams || {},
        });
      }
      if (response?.error) {
        throw response.error;
      }
      setCommandModalOpen(false);
      setSelectedCommandKey("");
      setCommandParams({});
      await fetchCommandsHistory();
    } catch (error) {
      const message = resolveCommandSendError(error, "Erro ao enviar comando");
      setCommandSendError(message);
    } finally {
      setCommandSending(false);
    }
  }, [
    commandParams,
    device?.id,
    device?.protocol,
    device?.traccarId,
    fetchCommandsHistory,
    safeVehicle?.client?.id,
    selectedCommand,
    vehicleId,
  ]);

  const handleEmbarkItinerary = useCallback(
    async (itineraryId) => {
      if (!vehicleId || !itineraryId) return;
      setItineraryActionLoading(itineraryId);
      try {
        const response = await safeApi.post(`${API_ROUTES.itineraries}/${itineraryId}/embark`, {
          vehicleIds: [vehicleId],
          clientId: safeVehicle?.client?.id || safeVehicle?.clientId || undefined,
        });
        if (response?.error) throw response.error;
      } catch (error) {
        console.warn("Falha ao embarcar itinerário", error);
      } finally {
        setItineraryActionLoading(null);
        await fetchItineraryStatus();
        await fetchItineraryHistory();
      }
    },
    [fetchItineraryHistory, fetchItineraryStatus, safeVehicle?.client?.id, safeVehicle?.clientId, vehicleId],
  );

  const handleDisembarkItinerary = useCallback(
    async (itineraryId) => {
      if (!vehicleId || !itineraryId) return;
      setItineraryActionLoading(itineraryId);
      try {
        const response = await safeApi.post(API_ROUTES.itineraryDisembark(itineraryId), {
          vehicleIds: [vehicleId],
          clientId: safeVehicle?.client?.id || safeVehicle?.clientId || undefined,
        });
        if (response?.error) throw response.error;
      } catch (error) {
        console.warn("Falha ao desembarcar itinerário", error);
      } finally {
        setItineraryActionLoading(null);
        await fetchItineraryStatus();
        await fetchItineraryHistory();
      }
    },
    [fetchItineraryHistory, fetchItineraryStatus, safeVehicle?.client?.id, safeVehicle?.clientId, vehicleId],
  );

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

  const filteredCommandOptions = useMemo(
    () => filterCommandsBySearch(commandOptions, commandSearch),
    [commandOptions, commandSearch],
  );
  const selectedCommand = useMemo(
    () => filteredCommandOptions.find((command) => getCommandKey(command) === selectedCommandKey) || null,
    [filteredCommandOptions, selectedCommandKey],
  );
  const filteredItineraries = useMemo(() => {
    const query = itineraryQuery.trim().toLowerCase();
    if (!query) return itineraryList;
    return itineraryList.filter((itinerary) => {
      const name = String(itinerary?.name || "").toLowerCase();
      const description = String(itinerary?.description || "").toLowerCase();
      return name.includes(query) || description.includes(query);
    });
  }, [itineraryList, itineraryQuery]);

  useEffect(() => {
    setCommandParams({});
    setCommandSendError(null);
  }, [selectedCommandKey]);

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
            <Detail
              label="Velocidade"
              value={position?.speed != null ? `${Number(position.speed).toFixed(0)} km/h` : "—"}
            />
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
        <Section title="Trajetos / Replay">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-white/60">Replay compacto dos últimos trajetos do veículo.</p>
            <Link
              to={`/trips?vehicleId=${encodeURIComponent(vehicleId || "")}&from=${encodeURIComponent(
                tripsQuery.from || reportRange.from,
              )}&to=${encodeURIComponent(tripsQuery.to || reportRange.to)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-primary/50 bg-primary/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white transition hover:border-primary/80"
            >
              Abrir em Trajetos
            </Link>
          </div>

          <div className="mt-3 grid gap-3 rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/70 lg:grid-cols-[1.4fr_repeat(2,1fr)]">
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">Veículo</p>
              <p className="mt-1 truncate text-sm font-semibold text-white">{safeVehicle.plate || safeVehicle.name || "—"}</p>
            </div>
            <label className="space-y-1 text-[11px] text-white/60">
              <span>De</span>
              <input
                type="datetime-local"
                value={tripsRange.from}
                onChange={(event) => setTripsRange((current) => ({ ...current, from: event.target.value }))}
                className="w-full rounded-md border border-white/10 bg-white/10 px-2 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="space-y-1 text-[11px] text-white/60">
              <span>Até</span>
              <input
                type="datetime-local"
                value={tripsRange.to}
                onChange={(event) => setTripsRange((current) => ({ ...current, to: event.target.value }))}
                className="w-full rounded-md border border-white/10 bg-white/10 px-2 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
              />
            </label>
          </div>

          {tripsLoading && <p className="text-xs text-white/60">Carregando trajetos...</p>}
          {tripsError && <p className="text-xs text-red-300">Erro ao carregar trajetos.</p>}
          <div className="mt-3 overflow-x-auto rounded-lg border border-white/10">
            <table className="min-w-full text-xs text-white/70">
              <thead className="bg-white/5 text-[10px] uppercase tracking-[0.12em] text-white/50">
                <tr>
                  <th className="px-3 py-2 text-left">Início</th>
                  <th className="px-3 py-2 text-left">Fim</th>
                  <th className="px-3 py-2 text-left">Duração</th>
                  <th className="px-3 py-2 text-left">Distância</th>
                  <th className="px-3 py-2 text-left">Vel. média</th>
                  <th className="px-3 py-2 text-left">Origem</th>
                  <th className="px-3 py-2 text-left">Destino</th>
                </tr>
              </thead>
              <tbody>
                {!tripsLoading && trips.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-white/50">
                      Nenhum trajeto encontrado no período. Ajuste as datas e tente novamente.
                    </td>
                  </tr>
                )}
                {trips.map((trip) => {
                  const isSelected = selectedTrip?.id === trip.id && selectedTrip?.startTime === trip.startTime;
                  return (
                    <tr
                      key={`${trip.id || trip.startTime}-${trip.endTime}`}
                      className={`cursor-pointer border-t border-white/5 transition hover:bg-white/5 ${
                        isSelected ? "bg-primary/10" : ""
                      }`}
                      onClick={() => setSelectedTrip(trip)}
                    >
                      <td className="px-3 py-2 text-white">{trip.startTime ? new Date(trip.startTime).toLocaleString() : "—"}</td>
                      <td className="px-3 py-2 text-white/70">{trip.endTime ? new Date(trip.endTime).toLocaleString() : "—"}</td>
                      <td className="px-3 py-2 text-white/70">{trip.duration != null ? formatDuration(trip.duration) : "—"}</td>
                      <td className="px-3 py-2 text-white/70">
                        {trip.distance != null ? `${Number(trip.distance).toFixed(1)} km` : "—"}
                      </td>
                      <td className="px-3 py-2 text-white/70">
                        {trip.averageSpeed ?? trip.avgSpeed ?? trip.speed
                          ? `${Number(trip.averageSpeed ?? trip.avgSpeed ?? trip.speed).toFixed(0)} km/h`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-white/60">{formatDisplayValue(trip.startAddress || trip.startLocation)}</td>
                      <td className="px-3 py-2 text-white/60">{formatDisplayValue(trip.endAddress || trip.endLocation)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 space-y-3 rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-white">Replay do trajeto</p>
                <p className="text-[11px] text-white/50">
                  {selectedTrip ? "Selecione um ponto para acompanhar o replay." : "Selecione um trajeto na lista para iniciar o replay."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsTripPlaying((current) => !current)}
                  disabled={!routePoints.length}
                  className="rounded-md border border-white/10 bg-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white disabled:cursor-not-allowed disabled:text-white/30"
                >
                  {isTripPlaying ? "Pausar" : "Reproduzir"}
                </button>
                <button
                  type="button"
                  onClick={() => setTripFollow((current) => !current)}
                  className={`rounded-md border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                    tripFollow
                      ? "border-emerald-400/70 bg-emerald-500/20 text-emerald-100"
                      : "border-white/10 bg-white/10 text-white/60"
                  }`}
                >
                  {tripFollow ? "Seguindo veículo" : "Seguir veículo"}
                </button>
                <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/10 px-2 py-2 text-[11px] text-white/60">
                  <span>Velocidade</span>
                  <select
                    value={tripSpeed}
                    onChange={(event) => setTripSpeed(Number(event.target.value))}
                    className="rounded-md border border-white/10 bg-[#0f141c] px-2 py-1 text-[11px] text-white"
                  >
                    {[1, 4, 8, 16].map((value) => (
                      <option key={value} value={value}>
                        {value}x
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(220px,1fr)]">
              <MiniReplayMap
                points={routePoints}
                activeIndex={activeTripIndex}
                vehicle={safeVehicle}
                follow={tripFollow}
                tileLayer={satelliteLayer}
              />
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Eventos do trajeto</p>
                <div className="space-y-2">
                  {tripEventSummaries.length === 0 ? (
                    <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/50">
                      Nenhum evento registrado no período selecionado.
                    </div>
                  ) : (
                    tripEventSummaries.slice(0, 6).map((item) => (
                      <div key={item.label} className="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
                        <span className="truncate">{item.label}</span>
                        <span className="text-white/50">{item.count}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {routeLoading && <p className="text-xs text-white/60">Carregando trajeto...</p>}
            {routeError && <p className="text-xs text-red-300">{routeError.message}</p>}

            {routePoints.length > 0 && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/60">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>
                      Ponto atual: <span className="text-white">{activeTripIndex + 1}/{routePoints.length}</span>
                    </span>
                    <span>
                      Horário: <span className="text-white">{resolvePointTime(activeTripPoint)}</span>
                    </span>
                    <span>
                      Velocidade: <span className="text-white">{resolvePointSpeed(activeTripPoint)}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveTripIndex((current) => Math.max(0, current - 1))}
                      disabled={activeTripIndex <= 0}
                      className="rounded-md border border-white/10 px-3 py-2 text-[11px] text-white/70 disabled:cursor-not-allowed disabled:text-white/30"
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTripIndex((current) => Math.min(routePoints.length - 1, current + 1))}
                      disabled={activeTripIndex >= routePoints.length - 1}
                      className="rounded-md border border-white/10 px-3 py-2 text-[11px] text-white/70 disabled:cursor-not-allowed disabled:text-white/30"
                    >
                      Próximo
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(routePoints.length - 1, 0)}
                  value={Math.min(activeTripIndex, routePoints.length - 1)}
                  onChange={(event) => setActiveTripIndex(Number(event.target.value))}
                  className="w-full accent-primary"
                />
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setShowTripDetails((current) => !current)}
                    className="text-[11px] uppercase tracking-[0.12em] text-white/60"
                  >
                    {showTripDetails ? "Ocultar detalhes do trajeto" : "Detalhes do trajeto"}
                  </button>
                </div>
                {showTripDetails && (
                  <div className="max-h-56 overflow-y-auto rounded-md border border-white/10">
                    <table className="min-w-full text-xs text-white/70">
                      <thead className="bg-white/5 text-[10px] uppercase tracking-[0.12em] text-white/50">
                        <tr>
                          <th className="px-3 py-2 text-left">Horário</th>
                          <th className="px-3 py-2 text-left">Evento</th>
                          <th className="px-3 py-2 text-left">Velocidade</th>
                        </tr>
                      </thead>
                      <tbody>
                        {routePoints.slice(0, 40).map((point) => {
                          const definition = resolveEventDefinitionFromPayload(point);
                          return (
                            <tr key={`${point.id || point.index}-${point.fixTime || point.deviceTime || point.serverTime}`} className="border-t border-white/5">
                              <td className="px-3 py-2">{resolvePointTime(point)}</td>
                              <td className="px-3 py-2">{definition?.label || "Posição registrada"}</td>
                              <td className="px-3 py-2">{resolvePointSpeed(point)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </Section>
      );
    }

    if (activeTab === "events") {
      const eventsWithDefinition = events.map((event) => {
        const definition = resolveEventDefinitionFromPayload(event);
        const label = definition?.label || event?.eventLabel || event?.type || event?.eventType || "Evento";
        const description =
          event?.description ||
          event?.eventDescription ||
          event?.attributes?.message ||
          event?.attributes?.description ||
          event?.eventCategory ||
          event?.category ||
          "—";
        const severity = definition?.severity || event?.severity || event?.eventSeverity || "—";
        return {
          ...event,
          __label: label,
          __description: description,
          __severity: severity,
          __time:
            event?.fixTime ||
            event?.deviceTime ||
            event?.eventTime ||
            event?.time ||
            event?.serverTime ||
            null,
        };
      });
      const eventTypeOptions = Array.from(new Set(eventsWithDefinition.map((event) => event.__label).filter(Boolean)));
      const filteredEvents =
        eventTypeFilter === "all"
          ? eventsWithDefinition
          : eventsWithDefinition.filter((event) => String(event.__label) === String(eventTypeFilter));
      return (
        <Section title="Eventos">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-white/60">Eventos recentes vinculados ao veículo.</p>
            <Link
              to={`/events?vehicleId=${encodeURIComponent(vehicleId || "")}&from=${encodeURIComponent(
                eventsQuery.from || reportRange.from,
              )}&to=${encodeURIComponent(eventsQuery.to || reportRange.to)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-primary/50 bg-primary/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white transition hover:border-primary/80"
            >
              Abrir em Eventos
            </Link>
          </div>
          <div className="mt-3 grid gap-3 rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/70 sm:grid-cols-3">
            <label className="space-y-1 text-[11px] text-white/60">
              <span>De</span>
              <input
                type="datetime-local"
                value={eventsRange.from}
                onChange={(event) => setEventsRange((current) => ({ ...current, from: event.target.value }))}
                className="w-full rounded-md border border-white/10 bg-white/10 px-2 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="space-y-1 text-[11px] text-white/60">
              <span>Até</span>
              <input
                type="datetime-local"
                value={eventsRange.to}
                onChange={(event) => setEventsRange((current) => ({ ...current, to: event.target.value }))}
                className="w-full rounded-md border border-white/10 bg-white/10 px-2 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="space-y-1 text-[11px] text-white/60">
              <span>Tipo</span>
              <select
                value={eventTypeFilter}
                onChange={(event) => setEventTypeFilter(event.target.value)}
                className="w-full rounded-md border border-white/10 bg-white/10 px-2 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
              >
                <option value="all">Todos</option>
                {eventTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {eventsLoading && <p className="text-xs text-white/60">Carregando eventos...</p>}
          <div className="mt-3 overflow-x-auto rounded-lg border border-white/10">
            <table className="min-w-full text-xs text-white/70">
              <thead className="bg-white/5 text-[10px] uppercase tracking-[0.12em] text-white/50">
                <tr>
                  <th className="px-3 py-2 text-left">Hora GPS</th>
                  <th className="px-3 py-2 text-left">Tipo</th>
                  <th className="px-3 py-2 text-left">Descrição</th>
                  <th className="px-3 py-2 text-left">Severidade</th>
                  <th className="px-3 py-2 text-left">Endereço</th>
                </tr>
              </thead>
              <tbody>
                {!eventsLoading && filteredEvents.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-white/50">
                      Nenhum evento no período selecionado. Ajuste o filtro para visualizar outros eventos.
                    </td>
                  </tr>
                )}
                {filteredEvents.map((event, index) => (
                  <tr
                    key={String(event.id || event.eventId || `${event.type || "event"}-${index}`)}
                    className="border-t border-white/5"
                  >
                    <td className="px-3 py-2 text-white/70">
                      {event.__time ? new Date(event.__time).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-white">{formatDisplayValue(event.__label)}</td>
                    <td className="px-3 py-2 text-white/60">{formatDisplayValue(event.__description)}</td>
                    <td className="px-3 py-2 text-white/60">{formatDisplayValue(event.__severity)}</td>
                    <td className="px-3 py-2 text-white/60">{formatAddressString(event.address || event.shortAddress)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CommandSendModal
            isOpen={commandModalOpen}
            onClose={() => setCommandModalOpen(false)}
            commands={filteredCommandOptions}
            loading={commandOptionsLoading}
            error={commandOptionsError}
            search={commandSearch}
            onSearchChange={setCommandSearch}
            selectedKey={selectedCommandKey}
            onSelectCommand={setSelectedCommandKey}
            selectedCommand={selectedCommand}
            params={commandParams}
            onParamChange={(key, value) =>
              setCommandParams((current) => ({
                ...current,
                [key]: value,
              }))
            }
            onSubmit={handleSendCommand}
            sending={commandSending}
            sendError={commandSendError}
          />
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
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCommandModalOpen(true)}
                className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80 transition hover:border-white/30"
              >
                Enviar comando
              </button>
              <Link
                to={`/commands?vehicleId=${encodeURIComponent(vehicleId || "")}&from=${encodeURIComponent(
                  commandsQuery.from || reportRange.from,
                )}&to=${encodeURIComponent(commandsQuery.to || reportRange.to)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-primary/50 bg-primary/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white transition hover:border-primary/80"
              >
                Abrir em Comandos
              </Link>
            </div>
          </div>
          <div className="mt-3 grid gap-3 rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/70 sm:grid-cols-2">
            <label className="space-y-1 text-[11px] text-white/60">
              <span>De</span>
              <input
                type="datetime-local"
                value={commandsRange.from}
                onChange={(event) => setCommandsRange((current) => ({ ...current, from: event.target.value }))}
                className="w-full rounded-md border border-white/10 bg-white/10 px-2 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="space-y-1 text-[11px] text-white/60">
              <span>Até</span>
              <input
                type="datetime-local"
                value={commandsRange.to}
                onChange={(event) => setCommandsRange((current) => ({ ...current, to: event.target.value }))}
                className="w-full rounded-md border border-white/10 bg-white/10 px-2 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
              />
            </label>
          </div>

          {commandsLoading && <p className="text-xs text-white/60">Carregando comandos...</p>}
          <div className="mt-3 overflow-x-auto rounded-lg border border-white/10">
            <table className="min-w-full text-xs text-white/70">
              <thead className="bg-white/5 text-[10px] uppercase tracking-[0.12em] text-white/50">
                <tr>
                  <th className="px-3 py-2 text-left">Enviado em</th>
                  <th className="px-3 py-2 text-left">Respondido em</th>
                  <th className="px-3 py-2 text-left">Comando</th>
                  <th className="px-3 py-2 text-left">Quem enviou</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {!commandsLoading && commands.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-white/50">
                      Nenhum comando registrado no período selecionado.
                    </td>
                  </tr>
                )}
                {commands.map((command) => (
                  <tr key={command.id || command.createdAt} className="border-t border-white/5">
                    <td className="px-3 py-2">{command.createdAt ? new Date(command.createdAt).toLocaleString() : "—"}</td>
                    <td className="px-3 py-2">{command.respondedAt ? new Date(command.respondedAt).toLocaleString() : "—"}</td>
                    <td className="px-3 py-2 text-white">{formatDisplayValue(command.type || command.commandName || "Comando")}</td>
                    <td className="px-3 py-2">{formatDisplayValue(command.createdBy || command.userName || "—")}</td>
                    <td className="px-3 py-2">{formatDisplayValue(command.status || "—")}</td>
                    <td className="px-3 py-2">{formatDisplayValue(command.result || command.response || "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      );
    }

    if (activeTab === "itinerary") {
      return (
        <Section title="Itinerário">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-white/60">Gestão compacta dos itinerários do veículo.</p>
            <Link
              to={`/itineraries?vehicleId=${encodeURIComponent(vehicleId || "")}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-primary/50 bg-primary/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white transition hover:border-primary/80"
            >
              Abrir em Itinerários
            </Link>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="flex-1 text-[11px] text-white/60">
              <span className="block">Buscar itinerário</span>
              <input
                value={itineraryQuery}
                onChange={(event) => setItineraryQuery(event.target.value)}
                className="mt-1 w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
                placeholder="Filtrar por nome ou descrição"
              />
            </label>
          </div>
          {itineraryLoading && <p className="text-xs text-white/60">Carregando itinerário...</p>}
          {itineraryStatus && (
            <div className="mt-2 grid gap-3 rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/70 sm:grid-cols-2">
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">Status atual</p>
                <p className="mt-1 text-sm font-semibold text-white">{itinerarySummary.itineraryName}</p>
                <p className="text-[11px] text-white/50">{itinerarySummary.statusLabel}</p>
              </div>
              <div className="space-y-1">
                <Detail label="Última ação" value={itinerarySummary.lastEmbarkAt ? new Date(itinerarySummary.lastEmbarkAt).toLocaleString() : "—"} />
                <Detail label="Rotas" value={itinerarySummary.counts.routes} />
                <Detail label="Cercas" value={itinerarySummary.counts.geofences} />
                <Detail label="Alvos" value={itinerarySummary.counts.targets} />
              </div>
            </div>
          )}
          <div className="mt-3 space-y-2">
            <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Itinerários do cliente</p>
            {itineraryListLoading && <p className="text-xs text-white/60">Carregando itinerários...</p>}
            {!itineraryListLoading && filteredItineraries.length === 0 && (
              <p className="text-xs text-white/50">Nenhum itinerário disponível para este cliente.</p>
            )}
            <div className="space-y-2">
              {filteredItineraries.map((itinerary) => {
                const historyEntry = latestHistoryByItinerary.get(String(itinerary.id));
                const isCurrent = String(itineraryStatus?.itineraryId || "") === String(itinerary.id);
                const statusLabel =
                  historyEntry?.statusLabel ||
                  historyEntry?.status ||
                  (isCurrent ? itineraryStatus?.statusLabel || itineraryStatus?.xdmStatusLabel : null) ||
                  "—";
                const isPending = statusLabel === "PENDENTE";
                const isConcluded = statusLabel === "CONCLUÍDO";
                const isLoading = itineraryActionLoading === itinerary.id;
                return (
                  <div key={itinerary.id} className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-white">{itinerary.name || "Itinerário"}</p>
                        <p className="text-[11px] text-white/50">{itinerary.description || "Sem descrição"}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.12em] ${
                            isConcluded
                              ? "bg-emerald-500/20 text-emerald-200"
                              : isPending
                                ? "bg-amber-500/20 text-amber-200"
                                : "bg-white/10 text-white/60"
                          }`}
                        >
                          {statusLabel}
                        </span>
                        {isCurrent ? (
                          <>
                            <button
                              type="button"
                              disabled={isLoading}
                              onClick={() => handleEmbarkItinerary(itinerary.id)}
                              className="rounded-md border border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/70 hover:border-white/30"
                            >
                              Atualizar
                            </button>
                            <button
                              type="button"
                              disabled={isLoading}
                              onClick={() => handleDisembarkItinerary(itinerary.id)}
                              className="rounded-md border border-red-400/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-red-200 hover:border-red-300/70"
                            >
                              Desembarcar
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={isLoading}
                            onClick={() => handleEmbarkItinerary(itinerary.id)}
                            className="rounded-md border border-primary/60 bg-primary/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white hover:border-primary/80"
                          >
                            Embarcar
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 grid gap-2 text-[11px] text-white/50 sm:grid-cols-2">
                      <span>
                        Enviado em:{" "}
                        {historyEntry?.sentAt ? new Date(historyEntry.sentAt).toLocaleString() : "—"}
                      </span>
                      <span>
                        Recebido em:{" "}
                        {historyEntry?.receivedAtDevice || historyEntry?.receivedAt
                          ? new Date(historyEntry.receivedAtDevice || historyEntry.receivedAt).toLocaleString()
                          : "—"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Histórico de operações</p>
            {itineraryHistoryLoading && <p className="text-xs text-white/60">Carregando histórico...</p>}
            {!itineraryHistoryLoading && itineraryHistory.length === 0 && (
              <p className="text-xs text-white/50">Nenhuma ação recente registrada.</p>
            )}
            <ul className="space-y-2">
              {itineraryHistory.map((item) => (
                <li key={item.id || item.createdAt || item.timestamp} className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white">{formatDisplayValue(item.actionLabel || item.action || item.statusLabel || "Ação")}</span>
                    <span className="text-white/50">
                      {item.sentAt ? new Date(item.sentAt).toLocaleString() : "—"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-white/50">
                    {formatDisplayValue(item.sentByName || item.userName || item.user || item.updatedBy || "Sistema")}
                  </p>
                  <p className="mt-1 text-[11px] text-white/50">
                    Recebido em:{" "}
                    {item.receivedAtDevice || item.receivedAt
                      ? new Date(item.receivedAtDevice || item.receivedAt).toLocaleString()
                      : "—"}
                  </p>
                </li>
              ))}
            </ul>
          </div>
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

          {alertsLoading && <p className="text-xs text-white/60">Carregando alertas...</p>}
          {!alertsLoading && vehicleAlerts.length === 0 && (
            <p className="text-xs text-white/50">Sem dados para exibir.</p>
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
                onOpenHandle={() => setActiveAlertId(alert.id)}
              />
            ))}
          </div>
          <AlertHandleModal
            isOpen={Boolean(activeAlertId)}
            alert={vehicleAlerts.find((item) => item.id === activeAlertId) || null}
            draft={activeAlertId ? handlingDrafts[activeAlertId] || {} : {}}
            onClose={() => setActiveAlertId(null)}
            onDraftChange={(field, value) =>
              setHandlingDrafts((current) => ({
                ...current,
                [activeAlertId]: {
                  ...(current[activeAlertId] || {}),
                  [field]: value,
                },
              }))
            }
            onHandle={async () => {
              if (!activeAlertId) return;
              const draft = handlingDrafts[activeAlertId] || {};
              await safeApi.patch(API_ROUTES.alertHandle(activeAlertId), {
                isOk: draft?.isOk ?? null,
                action: draft?.action ?? "",
                cause: draft?.cause ?? "",
                notes: draft?.notes ?? "",
              });
              setHandlingDrafts((current) => {
                const next = { ...current };
                delete next[activeAlertId];
                return next;
              });
              setActiveAlertId(null);
              refreshAlerts?.();
            }}
          />
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
      <span className="max-w-[65%] truncate text-right text-white">{formatDisplayValue(value)}</span>
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
      <p className="mt-1 text-sm text-white">{formatDisplayValue(value)}</p>
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

function AlertCard({ alert, draft, onDraftChange, onOpenHandle }) {
  const isPending = alert.status === "pending";
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">
            {formatDisplayValue(alert.eventLabel || "Alerta")}
          </p>
          <p className="text-[11px] text-white/50">
            {alert.createdAt ? new Date(alert.createdAt).toLocaleString() : "—"} •
            {" "}
            {formatDisplayValue(alert.severity || "—")}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.12em] ${
          isPending ? "bg-amber-500/20 text-amber-200" : "bg-emerald-500/20 text-emerald-200"
        }`}>
          {isPending ? "Pendente" : "Tratado"}
        </span>
      </div>
      <p className="mt-2 text-[11px] text-white/50">{formatDisplayValue(alert.address || "Endereço indisponível")}</p>

      {isPending ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-white/50">
            Aguardando tratativa obrigatória.
          </p>
          <button
            type="button"
            onClick={onOpenHandle}
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

function AlertHandleModal({ alert, draft, isOpen, onClose, onDraftChange, onHandle }) {
  if (!isOpen || !alert) return null;
  const isValid =
    draft?.isOk !== null &&
    draft?.isOk !== undefined &&
    Boolean(draft?.action?.trim()) &&
    Boolean(draft?.cause?.trim()) &&
    Boolean(draft?.notes?.trim());

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 px-4 py-6">
      <div className="w-full max-w-2xl rounded-xl border border-white/10 bg-[#0f141c] p-5 text-white shadow-2xl">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-white/50">Tratativa obrigatória</p>
            <h3 className="text-lg font-semibold text-white">{formatDisplayValue(alert.eventLabel || "Alerta")}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/70 hover:text-white"
          >
            Fechar
          </button>
        </div>
        <div className="mt-4 grid gap-3 text-xs text-white/70">
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
            O que foi feito? *
            <textarea
              value={draft.action || ""}
              onChange={(event) => onDraftChange("action", event.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white"
              rows={2}
            />
          </label>
          <label className="text-[10px] uppercase tracking-[0.12em] text-white/50">
            O que causou? *
            <textarea
              value={draft.cause || ""}
              onChange={(event) => onDraftChange("cause", event.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white"
              rows={2}
            />
          </label>
          <label className="text-[10px] uppercase tracking-[0.12em] text-white/50">
            Observação *
            <textarea
              value={draft.notes || ""}
              onChange={(event) => onDraftChange("notes", event.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white"
              rows={2}
            />
          </label>
          <div className="grid gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">Data/Hora do alerta</p>
            <p className="text-sm text-white">{alert.createdAt ? new Date(alert.createdAt).toLocaleString() : "—"}</p>
            <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">Data/Hora da tratativa</p>
            <p className="text-sm text-white">{new Date().toLocaleString()}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!isValid}
            onClick={onHandle}
            className={`rounded-lg border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] ${
              isValid
                ? "border-primary/60 bg-primary/20 text-white"
                : "border-white/10 bg-white/5 text-white/40"
            }`}
          >
            Salvar tratativa
          </button>
        </div>
      </div>
    </div>
  );
}

function CommandSendModal({
  isOpen,
  onClose,
  commands,
  loading,
  error,
  search,
  onSearchChange,
  selectedKey,
  onSelectCommand,
  selectedCommand,
  params,
  onParamChange,
  onSubmit,
  sending,
  sendError,
}) {
  if (!isOpen) return null;
  const hasCommands = Array.isArray(commands) && commands.length > 0;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 px-4 py-6">
      <div className="w-full max-w-2xl rounded-xl border border-white/10 bg-[#0f141c] p-5 text-white shadow-2xl">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-white/50">Enviar comando</p>
            <h3 className="text-lg font-semibold text-white">Selecione o comando</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/70 hover:text-white"
          >
            Fechar
          </button>
        </div>

        <div className="mt-4 space-y-3 text-xs text-white/70">
          <label className="space-y-1 text-[11px] text-white/60">
            <span>Buscar comando</span>
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
              placeholder="Filtrar por nome ou descrição"
            />
          </label>

          <label className="space-y-1 text-[11px] text-white/60">
            <span>Comando</span>
            <select
              value={selectedKey || ""}
              onChange={(event) => onSelectCommand(event.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
            >
              <option value="">Selecione</option>
              {commands.map((command) => {
                const key = getCommandKey(command);
                return (
                  <option key={key} value={key}>
                    {command.name || command.description || key}
                  </option>
                );
              })}
            </select>
          </label>

          {loading && <p className="text-xs text-white/60">Carregando comandos...</p>}
          {error && <p className="text-xs text-red-300">{error.message || "Erro ao carregar comandos."}</p>}
          {!loading && !error && !hasCommands && (
            <p className="text-xs text-white/50">Nenhum comando disponível para este protocolo.</p>
          )}

          {selectedCommand?.parameters?.length ? (
            <div className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Parâmetros</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {selectedCommand.parameters.map((param, index) => {
                  const paramKey = resolveParamKey(param, index);
                  const label = resolveParamLabel(param, index);
                  const value = params?.[paramKey] ?? "";
                  const type = String(param?.type || "text").toLowerCase();
                  const inputType = type === "number" || type === "int" ? "number" : "text";
                  if (type === "boolean") {
                    return (
                      <label key={paramKey} className="space-y-1 text-[11px] text-white/60">
                        <span>{label}</span>
                        <select
                          value={String(value)}
                          onChange={(event) => onParamChange(paramKey, event.target.value === "true")}
                          className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
                        >
                          <option value="">Selecione</option>
                          <option value="true">Sim</option>
                          <option value="false">Não</option>
                        </select>
                      </label>
                    );
                  }
                  return (
                    <label key={paramKey} className="space-y-1 text-[11px] text-white/60">
                      <span>{label}</span>
                      <input
                        type={inputType}
                        value={value}
                        onChange={(event) => onParamChange(paramKey, event.target.value)}
                        className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          {sendError && <p className="text-xs text-red-300">{sendError}</p>}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={sending || !selectedKey}
            className={`rounded-lg border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] ${
              sending || !selectedKey
                ? "border-white/10 bg-white/5 text-white/40"
                : "border-primary/60 bg-primary/20 text-white"
            }`}
          >
            {sending ? "Enviando..." : "Confirmar envio"}
          </button>
        </div>
      </div>
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

function formatDisplayValue(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.trim() ? value : "—";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (Array.isArray(value)) {
    const filtered = value.map((item) => formatDisplayValue(item)).filter((item) => item !== "—");
    return filtered.length ? filtered.join(", ") : "—";
  }
  return "—";
}

function getCommandKey(command) {
  return command?.code || command?.id || "";
}

function resolveParamKey(param, index) {
  return param?.key || param?.id || param?.name || `param_${index}`;
}

function resolveParamLabel(param, index) {
  const label = typeof param?.label === "string" ? param.label.trim() : "";
  if (label) return label;
  const name = typeof param?.name === "string" ? param.name.trim() : "";
  if (name) return name;
  return `Parâmetro ${Number.isFinite(index) ? index + 1 : 1}`;
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

function buildDateRange(hours = 24) {
  const now = new Date();
  const from = new Date(now.getTime() - hours * 60 * 60 * 1000);
  return { from, to: now };
}

function formatDatetimeLocal(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

function toISOStringSafe(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function normalizeLatLng(point) {
  if (!point) return null;
  const lat = Number(point.lat ?? point.latitude ?? point.lat_deg ?? point.latitudeDeg);
  const lng = Number(point.lng ?? point.lon ?? point.longitude ?? point.lon_deg ?? point.longitudeDeg);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function resolvePointTime(point) {
  const raw = point?.fixTime || point?.deviceTime || point?.serverTime || point?.time;
  if (!raw) return "—";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

function resolvePointSpeed(point) {
  const raw = point?.speed ?? point?.attributes?.speed ?? point?.attributes?.sp;
  if (!Number.isFinite(Number(raw))) return "—";
  return `${Math.round(Number(raw))} km/h`;
}

function MiniReplayMap({ points = [], activeIndex = 0, vehicle, follow = true, tileLayer }) {
  if (!points.length) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-lg border border-white/10 bg-[#0f141c] text-xs text-white/50">
        Selecione um trajeto para visualizar o mapa.
      </div>
    );
  }

  const safeIndex = Math.min(Math.max(activeIndex, 0), points.length - 1);
  const activePoint = points[safeIndex] || points[0];
  const positions = points.map((point) => [point.lat, point.lng]);
  const center = [activePoint.lat, activePoint.lng];
  const markerIcon = createVehicleMarkerIcon({
    bearing: activePoint.heading || 0,
    color: "#60a5fa",
    label: vehicle?.plate || vehicle?.name || "",
    plate: vehicle?.plate,
    iconType: vehicle?.iconType,
  });
  const activeLayer = tileLayer || MAP_LAYER_FALLBACK;

  return (
    <div className="relative h-[280px] w-full overflow-hidden rounded-lg border border-white/10 bg-[#0f141c]">
      <MapContainer center={center} zoom={15} className="h-full w-full" scrollWheelZoom={false}>
        <TileLayer
          attribution={activeLayer.attribution}
          url={activeLayer.url}
          subdomains={activeLayer.subdomains ?? "abc"}
          maxZoom={activeLayer.maxZoom ?? 19}
        />
        <MapFollowController center={center} activeIndex={safeIndex} follow={follow} />
        <Polyline positions={positions} color="#2563eb" weight={4} />
        <Marker position={center} icon={markerIcon || undefined} />
      </MapContainer>
    </div>
  );
}

function MapFollowController({ center, activeIndex, follow }) {
  const map = useMap();
  useEffect(() => {
    if (!follow || !map || !center) return;
    map.setView(center, map.getZoom(), { animate: true });
  }, [activeIndex, center, follow, map]);
  return null;
}
