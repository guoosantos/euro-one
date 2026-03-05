import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import { formatAddress as formatAddressString } from "../../lib/format-address.js";
import { FALLBACK_ADDRESS } from "../../lib/utils/geocode.js";
import ProtocolStatusRenderer from "./ProtocolStatusRenderer.jsx";
import { resolveEventDefinitionFromPayload } from "../../lib/event-translations.js";
import {
  getIgnition,
  isOnline,
  resolveVehicleDisplayName,
  resolveVehicleInfo,
} from "../../lib/monitoring-helpers.js";
import useTrips from "../../lib/hooks/useTrips.js";
import useReportsRoute from "../../lib/hooks/useReportsRoute.js";
import safeApi from "../../lib/safe-api.js";
import { API_ROUTES } from "../../lib/api-routes.js";
import useAlerts from "../../lib/hooks/useAlerts.js";
import { usePermissionGate } from "../../lib/permissions/permission-gate.js";
import { createVehicleMarkerIcon } from "../../lib/map/vehicleMarkerIcon.js";
import { canInteractWithMap } from "../../lib/map/mapSafety.js";
import { ENABLED_MAP_LAYERS, MAP_LAYER_FALLBACK } from "../../lib/mapLayers.js";
import { buildOverlayShapes, distanceToRouteMeters, findContainingGeofence } from "../../lib/itinerary-overlay.js";
import { filterCommandsBySearch, mergeCommands, resolveCommandSendError } from "../../pages/commands-helpers.js";
import { useTenant } from "../../lib/tenant-context.jsx";
import usePageToast from "../../lib/hooks/usePageToast.js";
import PageToast from "../ui/PageToast.jsx";
import AutocompleteSelect from "../ui/AutocompleteSelect.jsx";
import useAdminGeneralAccess from "../../lib/hooks/useAdminGeneralAccess.js";
import CommandSendModal from "../commands/CommandSendModal.jsx";
import {
  isDisembarkedActionLabel,
  isDisembarkedStatus,
  isEmbarkedConfirmedStatus,
  translateItineraryStatusLabel,
} from "../../lib/itinerary-status.js";

const resolveTraccarDeviceId = (device) => {
  const candidates = [
    device?.traccarId,
    device?.traccar_id,
    device?.deviceId,
    device?.device_id,
    device?.id,
  ];
  const numeric = candidates
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value) && value > 0);
  return numeric ?? null;
};

const resolveApiErrorMessage = (error, fallback) => {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  const response = error?.response?.data || {};
  const message =
    response?.message ||
    response?.error?.message ||
    error?.message ||
    null;
  return message || fallback;
};

const CONFIRMED_OVERLAY_STATUSES = new Set(["CONFIRMED", "EMBARKED_CONFIRMED"]);

const isConfirmedOverlayStatus = (status) =>
  CONFIRMED_OVERLAY_STATUSES.has(String(status || "").toUpperCase());

export default function VehicleDetailsDrawer({
  vehicle,
  onClose,
  variant = "drawer",
  extraTabs = [],
  baseTabs: baseTabsOverride = null,
  floating = true,
  itineraryOverlayState = null,
  onItineraryOverlayChange = () => {},
  itineraryDebugOverlayState = null,
  onItineraryDebugOverlayChange = () => {},
}) {
  const safeVehicle = vehicle || {};
  const vehicleSource = safeVehicle?.vehicle || safeVehicle;
  const { tenantId, user } = useTenant();
  const { isAdminGeneral } = useAdminGeneralAccess();
  const monitoringPermission = usePermissionGate({ menuKey: "primary", pageKey: "monitoring" });
  const commandsPermission = usePermissionGate({ menuKey: "primary", pageKey: "commands", subKey: "list" });
  const { toast, showToast } = usePageToast();
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
  const vehicleInfo = useMemo(
    () =>
      resolveVehicleInfo({
        vehicle: safeVehicle?.vehicle || safeVehicle,
        device,
        attributes:
          safeVehicle?.attributes ||
          safeVehicle?.vehicle?.attributes ||
          device?.attributes ||
          {},
      }),
    [device, safeVehicle],
  );
  const clientIdForRequests =
    safeVehicle?.client?.id ||
    safeVehicle?.clientId ||
    safeVehicle?.client_id ||
    safeVehicle?.vehicle?.clientId ||
    safeVehicle?.vehicle?.client?.id ||
    device?.clientId ||
    device?.client?.id ||
    tenantId ||
    null;
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
  const vehicleId =
    safeVehicle?.vehicle?.id ??
    safeVehicle?.id ??
    safeVehicle?.vehicleId ??
    safeVehicle?.vehicle_id ??
    safeVehicle?.device?.vehicleId ??
    device?.vehicleId ??
    device?.vehicle?.id ??
    null;
  const vehicleBrand = vehicleInfo.brand || null;
  const vehicleModel = vehicleInfo.model || null;
  const vehicleYear =
    safeVehicle?.modelYear ||
    safeVehicle?.year ||
    safeVehicle?.manufactureYear ||
    safeVehicle?.manufacturingYear ||
    null;
  const resolvedDisplayName = resolveVehicleDisplayName(vehicleInfo);
  const vehicleSummary = (() => {
    const summary = formatVehicleSummary(vehicleBrand, vehicleModel, vehicleYear);
    if (summary !== "—") return summary;
    return resolvedDisplayName;
  })();
  const vehicleNotes =
    vehicleSource.notes ||
    vehicleSource.observations ||
    vehicleSource.observacao ||
    vehicleSource.observação ||
    vehicleSource.attributes?.notes ||
    vehicleSource.attributes?.observations ||
    null;

  const [reportDeviceId, setReportDeviceId] = useState(null);
  const [reportDeviceLoading, setReportDeviceLoading] = useState(false);
  const [reportDeviceError, setReportDeviceError] = useState(null);

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
  const deviceIdForReports = useMemo(() => {
    return (
      reportDeviceId ||
      resolveTraccarDeviceId(device) ||
      resolveTraccarDeviceId({ id: safeVehicle?.principalDeviceId }) ||
      resolveTraccarDeviceId({ id: safeVehicle?.deviceId }) ||
      resolveTraccarDeviceId(devices?.[0]) ||
      null
    );
  }, [
    device,
    devices,
    reportDeviceId,
    safeVehicle?.deviceId,
    safeVehicle?.principalDeviceId,
  ]);

  const {
    trips,
    loading: tripsLoading,
    error: tripsError,
    fetchedAt: tripsFetchedAt,
    refresh: refreshTrips,
  } = useTrips({
    deviceId: deviceIdForReports,
    vehicleId: vehicleId || undefined,
    clientId: clientIdForRequests || undefined,
    from: tripsQuery.from,
    to: tripsQuery.to,
    limit: 10,
    enabled: Boolean(deviceIdForReports || vehicleId),
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
  const canSendCommands = isAdminGeneral && commandsPermission.isFull;
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
  const [eventsError, setEventsError] = useState(null);
  const [eventsFetchedAt, setEventsFetchedAt] = useState(null);
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
  const [itineraryActionType, setItineraryActionType] = useState(null);
  const [itineraryActionFeedback, setItineraryActionFeedback] = useState(null);
  const [selectedItineraryId, setSelectedItineraryId] = useState("");
  const [embarkStep, setEmbarkStep] = useState("select");
  const [pendingEmbarkItineraryId, setPendingEmbarkItineraryId] = useState(null);
  const [embarkBufferMeters, setEmbarkBufferMeters] = useState("");
  const [itineraryOverlayInfo, setItineraryOverlayInfo] = useState(null);
  const [itineraryOverlayLoading, setItineraryOverlayLoading] = useState(false);
  const [itineraryOverlayError, setItineraryOverlayError] = useState(null);
  const itineraryOverlayRequestRef = useRef(0);
  const [itineraryDebugOverlayInfo, setItineraryDebugOverlayInfo] = useState(null);
  const [itineraryDebugOverlayLoading, setItineraryDebugOverlayLoading] = useState(false);
  const [itineraryDebugOverlayError, setItineraryDebugOverlayError] = useState(null);
  const itineraryDebugOverlayRequestRef = useRef(0);
  const [alertStatus, setAlertStatus] = useState("pending");
  const [handlingDrafts, setHandlingDrafts] = useState({});
  const [activeAlertId, setActiveAlertId] = useState(null);
  const [manualHandlingDrafts, setManualHandlingDrafts] = useState({});
  const [manualHandlingOverrides, setManualHandlingOverrides] = useState({});
  const [activeManualAlertId, setActiveManualAlertId] = useState(null);
  const [vehicleManualHandlingOpen, setVehicleManualHandlingOpen] = useState(false);
  const [vehicleManualHandlingDraft, setVehicleManualHandlingDraft] = useState({ notes: "" });
  const [vehicleManualHandlingLoading, setVehicleManualHandlingLoading] = useState(false);
  const [manualVehicleEntries, setManualVehicleEntries] = useState([]);
  const { data: routeData, loading: routeLoading, error: routeError, generate: generateRoute } = useReportsRoute();
  const [commandModalOpen, setCommandModalOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState("");
  const [commandOptions, setCommandOptions] = useState([]);
  const [commandOptionsLoading, setCommandOptionsLoading] = useState(false);
  const [commandOptionsError, setCommandOptionsError] = useState(null);
  const [commandOptionsNotice, setCommandOptionsNotice] = useState(null);
  const [commandDevice, setCommandDevice] = useState(null);
  const [commandDeviceLoading, setCommandDeviceLoading] = useState(false);
  const [commandDeviceError, setCommandDeviceError] = useState(null);
  const [commandDeviceChecked, setCommandDeviceChecked] = useState(false);
  const [selectedCommandKey, setSelectedCommandKey] = useState("");
  const [commandParams, setCommandParams] = useState({});
  const [commandSending, setCommandSending] = useState(false);
  const [commandSendError, setCommandSendError] = useState(null);
  const [commandSendStatus, setCommandSendStatus] = useState("idle");
  const [commandSendMessage, setCommandSendMessage] = useState(null);
  const commandSendTimeoutRef = useRef(null);

  const filteredCommandOptions = useMemo(
    () => filterCommandsBySearch(commandOptions, commandSearch),
    [commandOptions, commandSearch],
  );
  const selectedCommand = useMemo(
    () => filteredCommandOptions.find((command) => getCommandKey(command) === selectedCommandKey) || null,
    [filteredCommandOptions, selectedCommandKey],
  );

  const resolvedCommandProtocol = useMemo(() => {
    const candidates = [
      device?.protocol,
      device?.deviceProtocol,
      device?.attributes?.protocol,
      device?.attributes?.deviceProtocol,
      device?.attributes?.device_protocol,
      position?.protocol,
      position?.attributes?.protocol,
      safeVehicle?.attributes?.protocol,
      safeVehicle?.attributes?.deviceProtocol,
      safeVehicle?.vehicle?.protocol,
      commandDevice?.protocol,
    ];
    const match = candidates.find((value) => value != null && String(value).trim());
    return match ? String(match).trim() : "";
  }, [commandDevice?.protocol, device, position, safeVehicle]);

  const commandDeviceId = useMemo(
    () => resolveTraccarDeviceId(commandDevice || device),
    [commandDevice, device],
  );

  const protocolChecked = Boolean(resolvedCommandProtocol) || commandDeviceChecked;

  useEffect(() => {
    setCommandParams({});
    setCommandSendError(null);
  }, [selectedCommandKey]);

  useEffect(() => () => {
    if (commandSendTimeoutRef.current) {
      clearTimeout(commandSendTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (commandModalOpen) return;
    if (commandSendTimeoutRef.current) {
      clearTimeout(commandSendTimeoutRef.current);
      commandSendTimeoutRef.current = null;
    }
    setCommandSendStatus("idle");
    setCommandSendMessage(null);
  }, [commandModalOpen]);

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
    enabled: Boolean(vehicleId) && monitoringPermission.hasAccess,
  });
  const manualVehicleAlerts = useMemo(() => {
    if (alertStatus !== "handled") return [];
    if (!manualVehicleEntries.length) return [];
    return manualVehicleEntries
      .map((entry) => buildManualAlertEntry(entry, safeVehicle))
      .filter(Boolean);
  }, [alertStatus, manualVehicleEntries, safeVehicle]);

  const mergedVehicleAlerts = useMemo(() => {
    const baseAlerts = Array.isArray(vehicleAlerts) ? vehicleAlerts : [];
    const withOverrides = manualHandlingOverrides && Object.keys(manualHandlingOverrides).length
      ? baseAlerts.map((alert) => {
          const override = manualHandlingOverrides[alert.id];
          if (!override || !Array.isArray(override)) return alert;
          const baseHandlings = Array.isArray(alert.handlings) ? [...alert.handlings] : [];
          const merged = [...baseHandlings];
          override.forEach((entry) => {
            if (!entry) return;
            if (merged.some((existing) => existing.id && existing.id === entry.id)) return;
            merged.push(entry);
          });
          return { ...alert, handlings: merged };
        })
      : baseAlerts;

    if (!manualVehicleAlerts.length) return withOverrides;

    const mergedMap = new Map();
    manualVehicleAlerts.forEach((alert) => {
      if (!alert) return;
      mergedMap.set(String(alert.id), alert);
    });
    withOverrides.forEach((alert) => {
      if (!alert) return;
      const key = String(alert.id);
      if (!mergedMap.has(key)) {
        mergedMap.set(key, alert);
      }
    });
    return Array.from(mergedMap.values());
  }, [manualHandlingOverrides, manualVehicleAlerts, vehicleAlerts]);

  const filteredVehicleAlerts = useMemo(
    () =>
      (mergedVehicleAlerts || []).filter(
        (alert) => alert?.requiresHandling !== false && alert?.eventActive !== false && alert?.active !== false,
      ),
    [mergedVehicleAlerts],
  );

  const eventsRequestRef = useRef(0);
  const loadEvents = useCallback(async () => {
    const requestId = eventsRequestRef.current + 1;
    eventsRequestRef.current = requestId;
    if (!deviceIdForReports) {
      if (eventsRequestRef.current === requestId) {
        setEvents([]);
        setEventsError(new Error("Dispositivo inválido para gerar eventos."));
        setEventsFetchedAt(null);
        setEventsLoading(false);
      }
      return;
    }
    setEventsLoading(true);
    setEventsError(null);
    const from = eventsQuery.from || reportRange.from;
    const to = eventsQuery.to || reportRange.to;
    try {
      const { data, error } = await safeApi.get(API_ROUTES.events, {
        params: {
          deviceIds: [deviceIdForReports],
          from,
          to,
          limit: 12,
          ...(clientIdForRequests ? { clientId: clientIdForRequests } : {}),
        },
      });
      if (eventsRequestRef.current !== requestId) return;
      if (error) {
        console.warn("[VehicleDetailsDrawer] Falha ao carregar eventos", error);
        setEvents([]);
        setEventsError(new Error(resolveApiErrorMessage(error, "Erro ao carregar eventos")));
        setEventsFetchedAt(null);
        return;
      }
      const list = Array.isArray(data?.events)
        ? data.events
        : Array.isArray(data?.data?.events)
          ? data.data.events
          : [];
      setEvents(list.slice(0, 8));
      setEventsFetchedAt(new Date());
    } catch (_error) {
      if (eventsRequestRef.current !== requestId) return;
      console.warn("[VehicleDetailsDrawer] Falha ao carregar eventos", _error);
      setEvents([]);
      setEventsError(new Error(resolveApiErrorMessage(_error, "Erro ao carregar eventos")));
      setEventsFetchedAt(null);
    } finally {
      if (eventsRequestRef.current === requestId) {
        setEventsLoading(false);
      }
    }
  }, [clientIdForRequests, deviceIdForReports, eventsQuery.from, eventsQuery.to, reportRange.from, reportRange.to]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

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

  useEffect(() => {
    setItineraryOverlayInfo(null);
    setItineraryOverlayError(null);
  }, [vehicleId]);

  const fetchItineraryOverlay = useCallback(
    async ({ silent = false } = {}) => {
      if (!vehicleId) {
        setItineraryOverlayInfo(null);
        setItineraryOverlayError(null);
        return null;
      }
      const requestId = itineraryOverlayRequestRef.current + 1;
      itineraryOverlayRequestRef.current = requestId;
      if (!silent) {
        setItineraryOverlayLoading(true);
      }
      setItineraryOverlayError(null);
      try {
        const { data, error } = await safeApi.get(API_ROUTES.itineraryOverlayConfirmed(vehicleId));
        if (itineraryOverlayRequestRef.current !== requestId) return null;
        if (error) {
          throw error;
        }
        const payload = data?.data ?? data ?? null;
        setItineraryOverlayInfo(payload);
        return payload;
      } catch (requestError) {
        if (itineraryOverlayRequestRef.current !== requestId) return null;
        setItineraryOverlayInfo(null);
        setItineraryOverlayError(requestError);
        return null;
      } finally {
        if (itineraryOverlayRequestRef.current === requestId) {
          setItineraryOverlayLoading(false);
        }
      }
    },
    [vehicleId],
  );

  useEffect(() => {
    setItineraryDebugOverlayInfo(null);
    setItineraryDebugOverlayError(null);
  }, [vehicleId]);

  const fetchItineraryDebugOverlay = useCallback(
    async ({ silent = false } = {}) => {
      if (!vehicleId) {
        setItineraryDebugOverlayInfo(null);
        setItineraryDebugOverlayError(null);
        return null;
      }
      const requestId = itineraryDebugOverlayRequestRef.current + 1;
      itineraryDebugOverlayRequestRef.current = requestId;
      if (!silent) {
        setItineraryDebugOverlayLoading(true);
      }
      setItineraryDebugOverlayError(null);
      try {
        const { data, error } = await safeApi.get(API_ROUTES.itineraryOverlayLastAttempt(vehicleId));
        if (itineraryDebugOverlayRequestRef.current !== requestId) return null;
        if (error) {
          throw error;
        }
        const payload = data?.data ?? data ?? null;
        setItineraryDebugOverlayInfo(payload);
        return payload;
      } catch (requestError) {
        if (itineraryDebugOverlayRequestRef.current !== requestId) return null;
        setItineraryDebugOverlayInfo(null);
        setItineraryDebugOverlayError(requestError);
        return null;
      } finally {
        if (itineraryDebugOverlayRequestRef.current === requestId) {
          setItineraryDebugOverlayLoading(false);
        }
      }
    },
    [vehicleId],
  );

  useEffect(() => {
    if (activeTab !== "itinerary") return;
    void fetchItineraryOverlay();
  }, [activeTab, fetchItineraryOverlay]);

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

  const overlayStatus = itineraryOverlayInfo?.status || "NONE";
  const overlayStatusMessage = itineraryOverlayInfo?.statusMessage || null;
  const overlayItinerary = itineraryOverlayInfo?.itinerary || null;
  const overlaySyncAt = overlayItinerary?.confirmedAt || overlayItinerary?.updatedAt || null;
  const overlayConfirmed = isConfirmedOverlayStatus(overlayStatus);
  const overlayActive =
    Boolean(itineraryOverlayState?.enabled) &&
    String(itineraryOverlayState?.vehicleId || "") === String(vehicleId || "");
  const debugOverlayActive =
    Boolean(itineraryDebugOverlayState?.enabled) &&
    String(itineraryDebugOverlayState?.vehicleId || "") === String(vehicleId || "");
  const debugOverlayStatus = itineraryDebugOverlayInfo?.status || itineraryDebugOverlayState?.status || "NONE";
  const debugOverlayAttemptAt =
    itineraryDebugOverlayInfo?.attemptAt || itineraryDebugOverlayState?.attemptAt || null;
  const debugOverlayItinerary = itineraryDebugOverlayInfo?.itinerary || null;

  const currentPositionPoint = useMemo(() => {
    const lat = Number(
      safeVehicle?.lat ??
        safeVehicle?.latitude ??
        position?.latitude ??
        position?.lat ??
        safeVehicle?.device?.lat ??
        safeVehicle?.device?.latitude ??
        null,
    );
    const lng = Number(
      safeVehicle?.lng ??
        safeVehicle?.lon ??
        safeVehicle?.longitude ??
        position?.longitude ??
        position?.lng ??
        safeVehicle?.device?.lng ??
        safeVehicle?.device?.longitude ??
        null,
    );
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [lat, lng];
  }, [position, safeVehicle]);

  useEffect(() => {
    void fetchItineraryHistory();
  }, [fetchItineraryHistory]);

  useEffect(() => {
    if (!overlayActive || !vehicleId) return undefined;
    const timer = setInterval(() => {
      void fetchItineraryOverlay({ silent: true });
    }, 30_000);
    return () => clearInterval(timer);
  }, [fetchItineraryOverlay, overlayActive, vehicleId]);

  useEffect(() => {
    if (!overlayActive) return;
    if (!itineraryOverlayInfo?.status) return;
    if (isConfirmedOverlayStatus(itineraryOverlayInfo.status)) return;
    onItineraryOverlayChange({ vehicleId, enabled: false, overlay: null });
    showToast("Itinerário não está mais confirmado/ativo.", "warning");
  }, [itineraryOverlayInfo?.status, onItineraryOverlayChange, overlayActive, showToast, vehicleId]);

  const fetchItineraryList = useCallback(async () => {
    setItineraryListLoading(true);
    try {
      const { data, error } = await safeApi.get(API_ROUTES.itineraries, {
        params: clientIdForRequests ? { clientId: clientIdForRequests } : undefined,
      });
      if (error) {
        setItineraryList([]);
        return;
      }
      const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      setItineraryList(list);
    } catch (_error) {
      setItineraryList([]);
    } finally {
      setItineraryListLoading(false);
    }
  }, [clientIdForRequests]);

  useEffect(() => {
    void fetchItineraryList();
  }, [fetchItineraryList]);

  useEffect(() => {
    setItineraryActionFeedback(null);
  }, [vehicleId]);

  useEffect(() => {
    setManualVehicleEntries([]);
    setVehicleManualHandlingDraft({ notes: "" });
    setVehicleManualHandlingOpen(false);
  }, [vehicleId]);

  useEffect(() => {
    setReportDeviceId(null);
    setReportDeviceError(null);
  }, [vehicleId]);

  useEffect(() => {
    if (deviceIdForReports || reportDeviceLoading) return;
    if (!vehicleId) return;
    let isActive = true;
    setReportDeviceLoading(true);
    setReportDeviceError(null);
    safeApi
      .get(API_ROUTES.core.vehicleTraccarDevice(vehicleId), {
        params: clientIdForRequests ? { clientId: clientIdForRequests } : undefined,
      })
      .then(({ data, error }) => {
        if (!isActive) return;
        if (error) throw error;
        if (data?.ok === false || data?.error) {
          throw new Error(data?.message || "Erro ao buscar device no Traccar");
        }
        const resolvedId = resolveTraccarDeviceId(data?.device || data);
        if (!resolvedId) {
          throw new Error("Dispositivo sem traccarId");
        }
        setReportDeviceId(resolvedId);
      })
      .catch((error) => {
        if (!isActive) return;
        setReportDeviceId(null);
        setReportDeviceError(error instanceof Error ? error : new Error("Erro ao buscar device no Traccar"));
      })
      .finally(() => {
        if (isActive) setReportDeviceLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [clientIdForRequests, deviceIdForReports, reportDeviceLoading, vehicleId]);

  useEffect(() => {
    setCommandDevice(null);
    setCommandDeviceError(null);
    setCommandDeviceChecked(false);
  }, [vehicleId]);

  useEffect(() => {
    const shouldLoadCommands = commandModalOpen || activeTab === "commands";
    if (!shouldLoadCommands) return;
    if (!canSendCommands) return;
    if (resolvedCommandProtocol) {
      setCommandDeviceChecked(true);
      return;
    }
    if (commandDeviceChecked || commandDeviceLoading) return;
    if (!vehicleId) {
      setCommandDeviceChecked(true);
      return;
    }
    let isActive = true;
    setCommandDeviceLoading(true);
    setCommandDeviceError(null);
    safeApi
      .get(API_ROUTES.core.vehicleTraccarDevice(vehicleId), {
        params: clientIdForRequests ? { clientId: clientIdForRequests } : undefined,
      })
      .then(({ data, error }) => {
        if (!isActive) return;
        if (error) {
          throw error;
        }
        if (data?.ok === false || data?.error) {
          throw new Error(data?.message || "Erro ao buscar device no Traccar");
        }
        const resolved = data?.device || null;
        setCommandDevice(resolved);
        setCommandDeviceChecked(true);
      })
      .catch((error) => {
        if (!isActive) return;
        setCommandDevice(null);
        setCommandDeviceError(error instanceof Error ? error : new Error("Erro ao buscar device no Traccar"));
        setCommandDeviceChecked(true);
      })
      .finally(() => {
        if (isActive) setCommandDeviceLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [
    activeTab,
    canSendCommands,
    clientIdForRequests,
    commandDeviceChecked,
    commandDeviceLoading,
    commandModalOpen,
    resolvedCommandProtocol,
    vehicleId,
  ]);

  useEffect(() => {
    const shouldLoadCommands = commandModalOpen || activeTab === "commands";
    if (!shouldLoadCommands) return;
    if (!canSendCommands) return;
    let isActive = true;
    const deviceProtocol = resolvedCommandProtocol ? String(resolvedCommandProtocol).trim() : "";
    const hasProtocol = Boolean(deviceProtocol);
    const deviceTraccarId = commandDeviceId;
    const load = async () => {
      setCommandOptionsLoading(true);
      setCommandOptionsError(null);
      setCommandOptionsNotice(null);
      try {
        const [protocolResponse, customResponse] = await Promise.all([
          hasProtocol ? safeApi.get(API_ROUTES.protocolCommands(deviceProtocol)) : Promise.resolve({ data: { commands: [] } }),
          safeApi.get(API_ROUTES.commandsCustom, {
            params: {
              ...(deviceTraccarId ? { deviceId: deviceTraccarId } : {}),
              protocol: hasProtocol ? deviceProtocol : undefined,
              clientId: clientIdForRequests || undefined,
            },
          }),
        ]);
        if (protocolResponse?.error) throw protocolResponse.error;
        if (customResponse?.error) throw customResponse.error;
        if (customResponse?.data?.error?.message) {
          throw new Error(customResponse.data.error.message);
        }
        if (!isActive) return;
        const protocolCommands = Array.isArray(protocolResponse?.data?.commands) ? protocolResponse.data.commands : [];
        const customCommands = Array.isArray(customResponse?.data?.data) ? customResponse.data.data : [];
        const merged = mergeCommands(protocolCommands, customCommands, { deviceProtocol: hasProtocol ? deviceProtocol : null });
        setCommandOptions(merged);
        if (!hasProtocol && merged.length === 0) {
          if (!protocolChecked) {
            setCommandOptionsNotice("Identificando protocolo do dispositivo...");
          } else {
            setCommandOptionsNotice(
              commandDeviceError
                ? "Não foi possível identificar o protocolo do dispositivo."
                : "Dispositivo sem protocolo configurado. Configure o protocolo para liberar comandos padrão.",
            );
          }
        }
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
  }, [
    activeTab,
    canSendCommands,
    clientIdForRequests,
    commandDeviceError,
    commandDeviceId,
    commandModalOpen,
    protocolChecked,
    resolvedCommandProtocol,
  ]);

  const itineraryStatusRaw = useMemo(
    () =>
      itineraryStatus?.status ||
      itineraryStatus?.statusLabel ||
      itineraryStatus?.xdmStatusLabel ||
      itineraryStatus?.state ||
      null,
    [itineraryStatus],
  );
  const itineraryStatusLabel = useMemo(
    () => translateItineraryStatusLabel(itineraryStatusRaw, { style: "upper", fallback: "—" }),
    [itineraryStatusRaw],
  );
  const itineraryHasConfirmedEmbark = useMemo(
    () => isEmbarkedConfirmedStatus(itineraryStatusRaw),
    [itineraryStatusRaw],
  );
  const itineraryWasDisembarked = useMemo(
    () =>
      isDisembarkedActionLabel(itineraryStatus?.lastActionLabel) ||
      isDisembarkedStatus(itineraryStatusRaw),
    [itineraryStatus?.lastActionLabel, itineraryStatusRaw],
  );

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
      statusLabel: itineraryStatusLabel,
      itineraryName: itineraryStatus?.itineraryName || itineraryStatus?.name || "—",
    };
  }, [itineraryStatus, itineraryStatusLabel]);

  const overlayShapes = useMemo(() => buildOverlayShapes(overlayItinerary), [overlayItinerary]);
  const overlayBufferMeters = useMemo(() => {
    const value = Number(overlayItinerary?.bufferMeters);
    return Number.isFinite(value) && value > 0 ? value : 200;
  }, [overlayItinerary?.bufferMeters]);
  const itineraryToleranceMeters = useMemo(() => {
    const hasItinerary =
      Boolean(overlayItinerary?.id || overlayItinerary?.name) ||
      Boolean(itineraryStatus?.itineraryId || itineraryStatus?.itineraryName || itineraryStatus?.name);
    if (!hasItinerary) return null;
    const value = Number(overlayItinerary?.bufferMeters ?? itineraryStatus?.bufferMeters);
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [
    overlayItinerary?.bufferMeters,
    overlayItinerary?.id,
    overlayItinerary?.name,
    itineraryStatus?.bufferMeters,
    itineraryStatus?.itineraryId,
    itineraryStatus?.itineraryName,
    itineraryStatus?.name,
  ]);
  const itineraryToleranceLabel = useMemo(
    () => (itineraryToleranceMeters ? `${Math.round(itineraryToleranceMeters)} m` : "—"),
    [itineraryToleranceMeters],
  );
  const routeDistance = useMemo(() => {
    if (!overlayConfirmed || !currentPositionPoint) return null;
    if (!overlayShapes.routeLines.length) return null;
    return distanceToRouteMeters(currentPositionPoint, overlayShapes.routeLines);
  }, [currentPositionPoint, overlayConfirmed, overlayShapes.routeLines]);
  const routeInside =
    overlayConfirmed &&
    routeDistance != null &&
    Number.isFinite(routeDistance) &&
    routeDistance <= overlayBufferMeters;
  const geofenceHit = useMemo(() => {
    if (!overlayConfirmed || !currentPositionPoint) return null;
    if (!overlayShapes.geofences.length) return null;
    return findContainingGeofence(currentPositionPoint, overlayShapes.geofences);
  }, [currentPositionPoint, overlayConfirmed, overlayShapes.geofences]);
  const hasCurrentPosition = Boolean(currentPositionPoint);

  const overlayStatusLabel = useMemo(() => {
    if (isConfirmedOverlayStatus(overlayStatus)) return "Confirmado";
    if (overlayStatus === "PENDING") return "Aguardando confirmação";
    if (overlayStatus === "FAILED") return "Falhou";
    if (overlayStatus === "CANCELED") return "Cancelado";
    if (overlayStatus === "FINISHED") return "Finalizado";
    return "Sem itinerário";
  }, [overlayStatus]);

  const overlayStatusClass = useMemo(() => {
    if (isConfirmedOverlayStatus(overlayStatus)) return "bg-emerald-500/15 text-emerald-200 border-emerald-400/40";
    if (overlayStatus === "PENDING") return "bg-amber-500/15 text-amber-200 border-amber-400/40";
    if (overlayStatus === "FAILED") return "bg-red-500/15 text-red-200 border-red-400/40";
    if (overlayStatus === "CANCELED") return "bg-slate-500/15 text-slate-200 border-slate-400/40";
    if (overlayStatus === "FINISHED") return "bg-slate-500/15 text-slate-200 border-slate-400/40";
    return "bg-white/10 text-white/60 border-white/10";
  }, [overlayStatus]);

  const debugStatusLabel = useMemo(() => {
    if (!debugOverlayStatus || String(debugOverlayStatus).toUpperCase() === "NONE") return "Sem tentativa";
    return translateItineraryStatusLabel(debugOverlayStatus, { style: "title", fallback: "Sem tentativa" });
  }, [debugOverlayStatus]);

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

  const selectedItinerary = useMemo(
    () => itineraryList.find((itinerary) => String(itinerary.id) === String(selectedItineraryId)) || null,
    [itineraryList, selectedItineraryId],
  );

  const selectedItineraryContext = useMemo(() => {
    if (!selectedItinerary) return null;
    const historyEntry = latestHistoryByItinerary.get(String(selectedItinerary.id)) || null;
    const isCurrent = String(itineraryStatus?.itineraryId || "") === String(selectedItinerary.id);
    const statusRaw =
      historyEntry?.statusLabel ||
      historyEntry?.status ||
      (isCurrent ? itineraryStatusRaw : null) ||
      "—";
    const statusLabel = translateItineraryStatusLabel(statusRaw, { style: "upper", fallback: "—" });
    const isPending = statusLabel === "PENDENTE";
    const isConcluded = ["CONCLUÍDO", "CONFIRMADO", "EMBARCADO"].includes(statusLabel);
    return {
      historyEntry,
      isCurrent,
      statusRaw,
      statusLabel,
      isPending,
      isConcluded,
    };
  }, [itineraryStatus?.itineraryId, itineraryStatusRaw, latestHistoryByItinerary, selectedItinerary]);

  const defaultEmbarkBufferMeters = useMemo(() => {
    if (Number.isFinite(itineraryToleranceMeters)) {
      return Math.round(itineraryToleranceMeters);
    }
    return 150;
  }, [itineraryToleranceMeters]);

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
      if (!isHandlingTripEvent(point)) return;
      const definition = resolveEventDefinitionFromPayload(point);
      const label = definition?.label || "Posição";
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
    if (!canSendCommands) {
      const message = "Você não tem permissão para enviar comandos.";
      setCommandSendError(message);
      setCommandSendStatus("error");
      setCommandSendMessage(message);
      return;
    }
    if (!selectedCommand) return;
    if (!vehicleId) {
      setCommandSendError("Veículo inválido para envio de comando.");
      return;
    }
    const traccarId = resolveTraccarDeviceId(commandDevice || device);
    if (!traccarId) {
      setCommandSendError("Equipamento sem Traccar ID válido.");
      return;
    }
    if (selectedCommand.kind !== "custom" && !resolvedCommandProtocol) {
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
    setCommandSendStatus("sending");
    setCommandSendMessage(null);
    try {
      const payloadBase = {
        vehicleId,
        deviceId: traccarId,
        ...(clientIdForRequests ? { clientId: clientIdForRequests } : {}),
      };
      let response = null;
      if (selectedCommand.kind === "custom") {
        response = await safeApi.post(API_ROUTES.commandsSend, {
          ...payloadBase,
          customCommandId: selectedCommand.id,
        });
      } else {
        const ensureObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
        const defaultParams = ensureObject(selectedCommand.defaultParams || selectedCommand.params);
        const fixedParams = ensureObject(selectedCommand.fixedParams);
        const explicitParams = ensureObject(commandParams);
        const resolvedParams = { ...defaultParams, ...explicitParams, ...fixedParams };
        response = await safeApi.post(API_ROUTES.commandsSend, {
          ...payloadBase,
          protocol: resolvedCommandProtocol,
          commandKey,
          commandName: selectedCommand.name || commandKey,
          params: resolvedParams,
        });
      }
      if (response?.error) {
        throw response.error;
      }
      setCommandSendStatus("success");
      setCommandSendMessage("Comando enviado com sucesso.");
      if (commandSendTimeoutRef.current) {
        clearTimeout(commandSendTimeoutRef.current);
      }
      commandSendTimeoutRef.current = setTimeout(() => {
        setCommandModalOpen(false);
        setSelectedCommandKey("");
        setCommandParams({});
        setCommandSendStatus("idle");
        setCommandSendMessage(null);
      }, 3000);
      await fetchCommandsHistory();
    } catch (error) {
      const message = resolveCommandSendError(error, "Erro ao enviar comando");
      setCommandSendError(message);
      setCommandSendStatus("error");
      setCommandSendMessage(message);
    } finally {
      setCommandSending(false);
    }
  }, [
    canSendCommands,
    commandParams,
    commandDevice,
    resolvedCommandProtocol,
    device,
    clientIdForRequests,
    fetchCommandsHistory,
    selectedCommand,
    vehicleId,
  ]);

  const handleEmbarkItinerary = useCallback(
    async (itineraryId, actionType = "embark", options = {}) => {
      if (!vehicleId || !itineraryId) {
        setItineraryActionFeedback({
          type: "error",
          message: "Veículo inválido para embarcar itinerário.",
        });
        return;
      }
      const bufferMetersRaw = options?.bufferMeters;
      const bufferMeters = Number.isFinite(Number(bufferMetersRaw)) && Number(bufferMetersRaw) > 0
        ? Number(bufferMetersRaw)
        : null;
      setItineraryActionLoading(itineraryId);
      setItineraryActionType(actionType);
      setItineraryActionFeedback(null);
      try {
        const response = await safeApi.post(`${API_ROUTES.itineraries}/${itineraryId}/embark`, {
          vehicleIds: [vehicleId],
          clientId: clientIdForRequests || undefined,
          ...(bufferMeters ? { bufferMeters } : {}),
        });
        if (response?.error) throw response.error;
        setItineraryActionFeedback({
          type: "success",
          message: actionType === "update" ? "Atualização do itinerário solicitada." : "Embarque solicitado com sucesso.",
        });
        if (actionType === "embark") {
          setEmbarkStep("select");
          setPendingEmbarkItineraryId(null);
          setEmbarkBufferMeters("");
        }
      } catch (error) {
        setItineraryActionFeedback({
          type: "error",
          message: resolveApiErrorMessage(
            error,
            actionType === "update"
              ? "Não foi possível atualizar o itinerário. Tente novamente."
              : "Não foi possível embarcar. Verifique permissões ou tente novamente.",
          ),
        });
      } finally {
        setItineraryActionLoading(null);
        setItineraryActionType(null);
        await fetchItineraryStatus();
        await fetchItineraryHistory();
        await fetchItineraryList();
      }
    },
    [clientIdForRequests, fetchItineraryHistory, fetchItineraryList, fetchItineraryStatus, vehicleId],
  );

  const handleDisembarkItinerary = useCallback(
    async (itineraryId) => {
      if (!vehicleId || !itineraryId) {
        setItineraryActionFeedback({
          type: "error",
          message: "Veículo inválido para desembarcar itinerário.",
        });
        return;
      }
      setItineraryActionLoading(itineraryId);
      setItineraryActionType("disembark");
      setItineraryActionFeedback(null);
      try {
        const response = await safeApi.post(API_ROUTES.itineraryDisembark(itineraryId), {
          vehicleIds: [vehicleId],
          clientId: clientIdForRequests || undefined,
        });
        if (response?.error) throw response.error;
        setItineraryActionFeedback({
          type: "success",
          message: "Desembarque solicitado com sucesso.",
        });
        setEmbarkStep("select");
        setPendingEmbarkItineraryId(null);
        setEmbarkBufferMeters("");
      } catch (error) {
        setItineraryActionFeedback({
          type: "error",
          message: resolveApiErrorMessage(error, "Não foi possível desembarcar. Verifique permissões ou tente novamente."),
        });
      } finally {
        setItineraryActionLoading(null);
        setItineraryActionType(null);
        await fetchItineraryStatus();
        await fetchItineraryHistory();
        await fetchItineraryList();
      }
    },
    [clientIdForRequests, fetchItineraryHistory, fetchItineraryList, fetchItineraryStatus, vehicleId],
  );

  const handleOverlayToggle = useCallback(
    async (nextEnabled) => {
      if (!vehicleId) return;
      if (!nextEnabled) {
        onItineraryOverlayChange({ vehicleId, enabled: false, overlay: null });
        return;
      }
      let payload = itineraryOverlayInfo;
      if (!payload || !isConfirmedOverlayStatus(payload.status) || !payload.itinerary) {
        payload = await fetchItineraryOverlay();
      }
      if (!payload || !isConfirmedOverlayStatus(payload.status) || !payload.itinerary) {
        const message = payload?.statusMessage || "Itinerário ainda não confirmado.";
        showToast(message, "warning");
        return;
      }
      onItineraryOverlayChange({ vehicleId, enabled: true, overlay: payload.itinerary });
    },
    [fetchItineraryOverlay, itineraryOverlayInfo, onItineraryOverlayChange, showToast, vehicleId],
  );

  const handleDebugOverlayToggle = useCallback(
    async (nextEnabled) => {
      if (!vehicleId) return;
      if (!nextEnabled) {
        onItineraryDebugOverlayChange({
          vehicleId,
          enabled: false,
          overlay: null,
          status: null,
          attemptAt: null,
          summary: null,
          preventAutoOverlay: false,
        });
        return;
      }
      let payload = itineraryDebugOverlayInfo;
      if (!payload) {
        payload = await fetchItineraryDebugOverlay();
      }

      const summary = {
        itineraryName:
          payload?.itinerary?.name ||
          itineraryStatus?.itineraryName ||
          itineraryStatus?.name ||
          null,
        status: payload?.status || itineraryStatusRaw || null,
        actionLabel: itineraryStatus?.lastActionLabel || null,
        hasConfirmedEmbarked: itineraryHasConfirmedEmbark,
        isDisembarked: itineraryWasDisembarked,
      };
      const preventAutoOverlay = itineraryHasConfirmedEmbark || itineraryWasDisembarked;

      onItineraryDebugOverlayChange({
        vehicleId,
        enabled: true,
        overlay: preventAutoOverlay ? null : payload?.itinerary || null,
        status: payload?.status || itineraryStatusRaw || "NONE",
        attemptAt: payload?.attemptAt || null,
        summary,
        preventAutoOverlay,
      });
    },
    [
      fetchItineraryDebugOverlay,
      itineraryDebugOverlayInfo,
      onItineraryDebugOverlayChange,
      itineraryHasConfirmedEmbark,
      itineraryStatus,
      itineraryStatusRaw,
      itineraryWasDisembarked,
      vehicleId,
    ],
  );

  const itineraryOptions = useMemo(
    () =>
      itineraryList.map((itinerary) => ({
        value: String(itinerary.id),
        label: itinerary.name || `Itinerário ${itinerary.id}`,
        description: itinerary.description || "",
        searchText: [itinerary.name, itinerary.description].filter(Boolean).join(" "),
      })),
    [itineraryList],
  );

  useEffect(() => {
    if (!selectedItineraryId) return;
    const exists = itineraryList.some((itinerary) => String(itinerary.id) === String(selectedItineraryId));
    if (!exists) {
      setSelectedItineraryId("");
    }
  }, [itineraryList, selectedItineraryId]);

  useEffect(() => {
    if (!pendingEmbarkItineraryId) return;
    if (String(pendingEmbarkItineraryId) !== String(selectedItineraryId)) {
      setPendingEmbarkItineraryId(null);
      setEmbarkStep("select");
    }
  }, [pendingEmbarkItineraryId, selectedItineraryId]);

  useEffect(() => {
    if (!selectedItineraryId) {
      setEmbarkStep("select");
      setPendingEmbarkItineraryId(null);
      setEmbarkBufferMeters("");
    }
  }, [selectedItineraryId]);

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
            <Detail label="Tolerância para Desvio de Rota" value={itineraryToleranceLabel} />
            <Detail
              label="Velocidade"
              value={position?.speed != null ? `${Number(position.speed).toFixed(0)} km/h` : "—"}
            />
            <Detail label="Última atualização" value={lastUpdateLabel} />
            <Detail label="Endereço" value={resolvedAddress} />
          </Section>
          <Section title="Itinerário (Modo teste)">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-white/80">
                <input
                  type="checkbox"
                  checked={debugOverlayActive}
                  onChange={(event) => handleDebugOverlayToggle(event.target.checked)}
                  disabled={itineraryDebugOverlayLoading}
                  className="h-4 w-4 rounded border border-white/30 bg-black/40 text-primary focus:ring-primary/60"
                />
                Ver a última tentativa de status do Itinerário
              </label>
              {debugOverlayActive ? (
                <span
                  className="rounded-full border border-fuchsia-400/40 bg-fuchsia-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-fuchsia-100"
                  title="Exibição para conferência visual. Pode não estar embarcado no equipamento."
                >
                  MODO TESTE: Última tentativa (status: {debugStatusLabel})
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-[11px] text-white/50">
              Confirmado (oficial) só aparece na aba Itinerário. Esta opção mostra a última tentativa, mesmo se falhou. Quando houver itinerário confirmado, a rota só aparece ao habilitar no mapa na aba Itinerário.
            </p>
            {itineraryDebugOverlayLoading ? (
              <p className="mt-2 text-xs text-white/50">Carregando última tentativa...</p>
            ) : null}
            {itineraryDebugOverlayError ? (
              <p className="mt-2 text-xs text-red-200/80">
                {resolveApiErrorMessage(itineraryDebugOverlayError, "Não foi possível carregar a última tentativa.")}
              </p>
            ) : null}
            {debugOverlayActive && debugOverlayItinerary ? (
              <div className="mt-2 grid gap-2 rounded-lg border border-white/10 bg-white/5 p-3 text-[11px] text-white/70 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">Itinerário</p>
                  <p className="mt-1 text-sm font-semibold text-white">{debugOverlayItinerary?.name || "—"}</p>
                  <p className="text-[11px] text-white/50">ID: {debugOverlayItinerary?.id || "—"}</p>
                </div>
                <div className="space-y-1">
                  <Detail label="Status" value={debugStatusLabel} />
                  <Detail
                    label="Tentativa em"
                    value={debugOverlayAttemptAt ? new Date(debugOverlayAttemptAt).toLocaleString() : "—"}
                  />
                </div>
              </div>
            ) : null}
            {debugOverlayActive && !debugOverlayItinerary && !itineraryDebugOverlayLoading ? (
              <p className="mt-2 text-xs text-white/50">
                Sem tentativa recente com geometria disponível.
              </p>
            ) : null}
          </Section>
          <ProtocolStatusRenderer
            device={device}
            position={position}
            protocol={resolvedCommandProtocol}
            latestPosition={latestPosition}
          />
        </>
      );
    }

    if (activeTab === "trips") {
      return (
        <Section title="Trajetos / Replay">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-white/60">Replay compacto dos últimos trajetos do veículo.</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => refreshTrips?.()}
                disabled={tripsLoading || !(deviceIdForReports || vehicleId)}
                className={`rounded-md border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] transition disabled:cursor-not-allowed disabled:text-white/30 ${
                  tripsLoading
                    ? "border-red-500/40 bg-red-500/20 text-red-100 hover:border-red-400/70"
                    : "border-white/10 bg-white/5 text-white/80 hover:border-white/30"
                }`}
              >
                {tripsLoading ? "Gerando..." : "Gerar"}
              </button>
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

          {reportDeviceLoading && <p className="text-xs text-white/50">Identificando dispositivo no Traccar...</p>}
          {reportDeviceError && <p className="text-xs text-red-300">{reportDeviceError.message}</p>}
          {tripsLoading && <p className="text-xs text-white/60">Carregando trajetos...</p>}
          {tripsError && (
            <p className="text-xs text-red-300">{tripsError.message || "Erro ao carregar trajetos."}</p>
          )}
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
                {!tripsLoading && !tripsError && tripsFetchedAt && trips.length === 0 && (
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
                      <td className="px-3 py-2 text-white/50">{formatDisplayValue(trip.startAddress || trip.startLocation)}</td>
                      <td className="px-3 py-2 text-white/50">{formatDisplayValue(trip.endAddress || trip.endLocation)}</td>
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
                      : "border-white/10 bg-white/10 text-white/70"
                  }`}
                >
                  {tripFollow ? "Seguindo veículo" : "Seguir veículo"}
                </button>
                <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/10 px-2 py-2 text-[11px] text-white/70">
                  <span>Velocidade</span>
                  <select
                    value={tripSpeed}
                    onChange={(event) => setTripSpeed(Number(event.target.value))}
                    className="rounded-md border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-white"
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
                              <td className="px-3 py-2">{definition?.label || "Posição"}</td>
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
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => loadEvents?.()}
                disabled={eventsLoading || !deviceIdForReports}
                className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80 transition hover:border-white/30 disabled:cursor-not-allowed disabled:text-white/30"
              >
                {eventsLoading ? "Gerando..." : "Gerar"}
              </button>
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
          </div>
          {reportDeviceLoading && <p className="text-xs text-white/50">Identificando dispositivo no Traccar...</p>}
          {reportDeviceError && <p className="text-xs text-red-300">{reportDeviceError.message}</p>}
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
          {eventsError && <p className="text-xs text-red-300">{eventsError.message}</p>}
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
                {!eventsLoading && !eventsError && eventsFetchedAt && filteredEvents.length === 0 && (
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
        </Section>
      );
    }

    if (activeTab === "info") {
      return (
        <Section title="Informações do veículo">
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoField label="Cliente" value={vehicleSource.client?.name || vehicleSource.clientName || "—"} />
            <InfoField label="Item" value={vehicleSource.item || vehicleSource.name || "—"} />
            <InfoField label="Tipo do veículo" value={vehicleSource.type || vehicleSource.vehicleType || "—"} />
            <InfoField label="Placa" value={vehicleSource.plate || "—"} />
            <InfoField label="Identificador" value={vehicleSource.identifier || vehicleSource.identificador || "—"} />
            <InfoField label="Modelo" value={vehicleModel || "—"} />
            <InfoField label="Marca" value={vehicleBrand || "—"} />
            <InfoField label="Chassi" value={vehicleSource.chassis || vehicleSource.chassi || "—"} />
            <InfoField label="Renavam" value={vehicleSource.renavam || "—"} />
            <InfoField label="Cor" value={vehicleSource.color || vehicleSource.cor || "—"} />
            <InfoField label="Ano Modelo" value={vehicleSource.modelYear || "—"} />
            <InfoField label="Ano de Fabricação" value={vehicleSource.manufactureYear || vehicleSource.manufacturingYear || "—"} />
            <InfoField label="Código FIPE" value={vehicleSource.fipeCode || "—"} />
            <InfoField label="Valor FIPE" value={vehicleSource.fipeValue || "—"} />
            <InfoField label="Zero Km" value={vehicleSource.zeroKm ? "Sim" : "Não"} />
            <InfoField label="Motorista" value={vehicleSource.driver?.name || vehicleSource.driverName || "—"} />
            <InfoField label="Grupo" value={vehicleSource.group?.name || vehicleSource.groupName || "—"} />
            <InfoField label="Status" value={vehicleSource.status || "—"} />
            <InfoField label="Observações" value={vehicleNotes || "Sem observações"} />
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
              {canSendCommands && (
                <button
                  type="button"
                  onClick={() => setCommandModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80 transition hover:border-white/30"
                >
                  Enviar comando
                </button>
              )}
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

          {canSendCommands && (
            <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/70">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Comandos disponíveis</p>
                <input
                  value={commandSearch}
                  onChange={(event) => setCommandSearch(event.target.value)}
                  placeholder="Buscar comando"
                  className="w-full rounded-md border border-white/10 bg-white/10 px-2 py-2 text-[11px] text-white sm:w-[220px]"
                />
              </div>
              {commandOptionsLoading && <p className="mt-2 text-xs text-white/50">Carregando comandos...</p>}
              {!commandOptionsLoading && commandOptionsError && (
                <p className="mt-2 text-xs text-red-200/80">{commandOptionsError.message}</p>
              )}
              {!commandOptionsLoading && !commandOptionsError && commandOptionsNotice && (
                <p className="mt-2 text-xs text-amber-200/80">{commandOptionsNotice}</p>
              )}
              {!commandOptionsLoading && !commandOptionsError && filteredCommandOptions.length === 0 && (
                <p className="mt-2 text-xs text-white/50">Nenhum comando disponível para este equipamento.</p>
              )}
              {filteredCommandOptions.length > 0 && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {filteredCommandOptions.map((command) => (
                    <button
                      key={getCommandKey(command)}
                      type="button"
                      onClick={() => {
                        setSelectedCommandKey(getCommandKey(command));
                        setCommandModalOpen(true);
                      }}
                      className="flex items-center justify-between rounded-md border border-white/10 bg-black/20 px-3 py-2 text-left text-[11px] text-white/70 hover:border-white/30"
                    >
                      <span className="font-semibold text-white">{command.name || command.code || command.type}</span>
                      <span className="text-white/40">Selecionar</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

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

          <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/70">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">Itinerário embarcado</p>
                <p className="mt-1 text-sm font-semibold text-white">{overlayItinerary?.name || "—"}</p>
                <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-white/50">
                  <span>ID: {overlayItinerary?.id || "—"}</span>
                  <span>
                    Última sincronização:{" "}
                    {overlaySyncAt ? new Date(overlaySyncAt).toLocaleString() : "—"}
                  </span>
                  <span>Tolerância para Desvio de Rota: {itineraryToleranceLabel}</span>
                </div>
                <div className="mt-2 inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.12em]">
                  <span className={`rounded-full border px-2 py-0.5 ${overlayStatusClass}`}>{overlayStatusLabel}</span>
                </div>
              </div>
              {overlayConfirmed ? (
                <label className="flex items-center gap-2 text-xs text-white/80">
                  <input
                    type="checkbox"
                    checked={overlayActive}
                    onChange={(event) => handleOverlayToggle(event.target.checked)}
                    disabled={!overlayConfirmed || itineraryOverlayLoading}
                    className="h-4 w-4 rounded border border-white/30 bg-black/40 text-primary focus:ring-primary/60"
                  />
                  Mostrar itinerário no mapa
                </label>
              ) : null}
            </div>
            {itineraryOverlayLoading ? (
              <p className="mt-2 text-xs text-white/50">Carregando status do itinerário...</p>
            ) : null}
            {itineraryOverlayError ? (
              <p className="mt-2 text-xs text-red-200/80">
                {resolveApiErrorMessage(itineraryOverlayError, "Não foi possível verificar o itinerário.")}
              </p>
            ) : null}
            {overlayStatus === "PENDING" ? (
              <p className="mt-2 text-xs text-amber-200/80">
                {overlayStatusMessage || "Aguardando confirmação do equipamento para exibir no mapa."}
              </p>
            ) : null}
            {overlayStatus === "NONE" ? (
              <p className="mt-2 text-xs text-white/50">
                {overlayStatusMessage || "Sem itinerário embarcado para este veículo."}
              </p>
            ) : null}
            {overlayStatus === "FAILED" ? (
              <p className="mt-2 text-xs text-red-200/80">
                {overlayStatusMessage || "Falha ao confirmar o itinerário."}
              </p>
            ) : null}
            {overlayStatus === "CANCELED" ? (
              <p className="mt-2 text-xs text-white/60">
                {overlayStatusMessage || "Itinerário cancelado."}
              </p>
            ) : null}
            {overlayStatus === "FINISHED" ? (
              <p className="mt-2 text-xs text-white/60">
                {overlayStatusMessage || "Itinerário finalizado."}
              </p>
            ) : null}
            {overlayConfirmed ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.12em] ${
                    overlayShapes.routeLines.length === 0 || !hasCurrentPosition
                      ? "bg-white/10 text-white/60"
                      : routeInside
                        ? "bg-emerald-500/20 text-emerald-200"
                        : "bg-rose-500/20 text-rose-200"
                  }`}
                >
                  ROTA:{" "}
                  {overlayShapes.routeLines.length === 0
                    ? "Sem rota"
                    : !hasCurrentPosition
                      ? "Sem posição"
                      : routeInside
                        ? "Dentro"
                        : "Desvio"}
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.12em] ${
                    overlayShapes.geofences.length === 0 || !hasCurrentPosition
                      ? "bg-white/10 text-white/60"
                      : geofenceHit
                        ? "bg-emerald-500/20 text-emerald-200"
                        : "bg-rose-500/20 text-rose-200"
                  }`}
                >
                  CERCA:{" "}
                  {overlayShapes.geofences.length === 0
                    ? "Sem cerca"
                    : !hasCurrentPosition
                      ? "Sem posição"
                      : geofenceHit
                        ? `Dentro ${geofenceHit.name ? `(${geofenceHit.name})` : ""}`
                        : "Fora"}
                </span>
              </div>
            ) : null}
          </div>

          <div className="mt-3 space-y-2">
            <label className="text-[11px] uppercase tracking-[0.12em] text-white/50">Buscar itinerário</label>
            <AutocompleteSelect
              value={selectedItineraryId}
              options={itineraryOptions}
              onChange={(value) => setSelectedItineraryId(String(value || ""))}
              placeholder={itineraryListLoading ? "Carregando itinerários..." : "Digite o nome do itinerário"}
              allowClear
              className="w-full"
              inputClassName="h-9 rounded-md px-3 text-xs"
              disabled={itineraryListLoading}
              emptyText="Nenhum itinerário encontrado."
            />
            {itineraryListLoading && <p className="text-xs text-white/60">Carregando itinerários...</p>}
          </div>

          {itineraryActionFeedback && (
            <p
              className={`mt-2 text-xs ${
                itineraryActionFeedback.type === "error" ? "text-red-200/80" : "text-emerald-200/80"
              }`}
            >
              {itineraryActionFeedback.message}
            </p>
          )}
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
                <Detail label="Tolerância para Desvio de Rota" value={itineraryToleranceLabel} />
              </div>
            </div>
          )}

          <div className="mt-3 space-y-2">
            <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Itinerário selecionado</p>
            {!selectedItinerary && (
              <p className="text-xs text-white/50">Selecione um itinerário para ver detalhes e ações.</p>
            )}
            {selectedItinerary && selectedItineraryContext && (() => {
              const { historyEntry, isCurrent, statusLabel, isPending, isConcluded } = selectedItineraryContext;
              const isLoading = String(itineraryActionLoading ?? "") === String(selectedItinerary.id ?? "");
              const actionType = isLoading ? itineraryActionType : null;
              const updateLabel = isLoading && actionType === "update" ? "Atualizando..." : "Atualizar";
              const disembarkLabel = isLoading && actionType === "disembark" ? "Desembarcando..." : "Desembarcar";
              const embarkLabel = isLoading && actionType === "embark" ? "Embarcando..." : "Embarcar";
              const showToleranceStep = embarkStep === "tolerance" && String(pendingEmbarkItineraryId || "") === String(selectedItinerary.id || "");
              return (
                <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-white">{selectedItinerary.name || "Itinerário"}</p>
                      <p className="text-[11px] text-white/50">{selectedItinerary.description || "Sem descrição"}</p>
                    </div>
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
                  </div>
                  <div className="mt-2 grid gap-2 text-[11px] text-white/50 sm:grid-cols-2">
                    <span>
                      Enviado em:{" "}
                      {historyEntry?.sentAt ? new Date(historyEntry.sentAt).toLocaleString() : "—"}
                    </span>
                    <span>
                      Recebido em:{" "}
                      {historyEntry?.deviceConfirmedAt || historyEntry?.receivedAtDevice
                        ? new Date(historyEntry.deviceConfirmedAt || historyEntry.receivedAtDevice).toLocaleString()
                        : "—"}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {isCurrent ? (
                      <>
                        <button
                          type="button"
                          disabled={isLoading}
                          onClick={() => handleEmbarkItinerary(selectedItinerary.id, "update")}
                          className="rounded-md border border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/70 hover:border-white/30"
                        >
                          {updateLabel}
                        </button>
                        <button
                          type="button"
                          disabled={isLoading}
                          onClick={() => handleDisembarkItinerary(selectedItinerary.id)}
                          className="rounded-md border border-red-400/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-red-200 hover:border-red-300/70"
                        >
                          {disembarkLabel}
                        </button>
                      </>
                    ) : showToleranceStep ? (
                      <div className="flex w-full flex-col gap-2 rounded-md border border-white/10 bg-black/20 p-3">
                        <label className="text-[11px] uppercase tracking-[0.12em] text-white/60">
                          Tolerância para Desvio de Rota (m)
                          <input
                            type="number"
                            min="10"
                            step="10"
                            value={embarkBufferMeters}
                            onChange={(event) => setEmbarkBufferMeters(event.target.value)}
                            className="mt-2 w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
                            placeholder={`${defaultEmbarkBufferMeters}`}
                          />
                        </label>
                        <p className="text-[11px] text-white/50">Ação da tolerância: BLOQUEAR por desvio de rota.</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={isLoading}
                            onClick={() => {
                              setEmbarkStep("select");
                              setPendingEmbarkItineraryId(null);
                              setEmbarkBufferMeters("");
                            }}
                            className="rounded-md border border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/70 hover:border-white/30"
                          >
                            Voltar
                          </button>
                          <button
                            type="button"
                            disabled={isLoading}
                            onClick={() => {
                              const parsed = Number(embarkBufferMeters || defaultEmbarkBufferMeters);
                              handleEmbarkItinerary(selectedItinerary.id, "embark", {
                                bufferMeters: Number.isFinite(parsed) && parsed > 0 ? parsed : defaultEmbarkBufferMeters,
                              });
                            }}
                            className="rounded-md border border-primary/60 bg-primary/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white hover:border-primary/80"
                          >
                            {embarkLabel}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => {
                          setPendingEmbarkItineraryId(selectedItinerary.id);
                          setEmbarkStep("tolerance");
                          if (!embarkBufferMeters) {
                            setEmbarkBufferMeters(String(defaultEmbarkBufferMeters));
                          }
                        }}
                        className="rounded-md border border-primary/60 bg-primary/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white hover:border-primary/80"
                      >
                        Próximo
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
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
                    {formatDisplayValue(item.itineraryName || item.itinerary?.name || "Itinerário")}
                  </p>
                  <p className="mt-1 text-[11px] text-white/50">
                    {formatDisplayValue(item.sentByName || item.userName || item.user || item.updatedBy || "Sistema")}
                  </p>
                  <p className="mt-1 text-[11px] text-white/50">
                    Recebido em:{" "}
                    {item.deviceConfirmedAt || item.receivedAtDevice
                      ? new Date(item.deviceConfirmedAt || item.receivedAtDevice).toLocaleString()
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
              <button
                type="button"
                onClick={() => {
                  if (!vehicleId) return;
                  setVehicleManualHandlingDraft({ notes: "" });
                  setVehicleManualHandlingOpen(true);
                }}
                disabled={!vehicleId}
                className="rounded-full border border-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/70 transition hover:border-white/40 disabled:opacity-50"
                title={vehicleId ? "Criar tratativa manual" : "Veículo inválido"}
              >
                Criar tratativa manual
              </button>
            </div>
          </div>

          {alertsLoading && <p className="text-xs text-white/60">Carregando alertas...</p>}
          {!alertsLoading && filteredVehicleAlerts.length === 0 && (
            <p className="text-xs text-white/50">Sem dados para exibir.</p>
          )}
          <div className="space-y-3">
            {filteredVehicleAlerts.map((alert) => (
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
                  onOpenManual={() => setActiveManualAlertId(alert.id)}
                />
            ))}
          </div>
          <AlertHandleModal
            isOpen={Boolean(activeAlertId)}
            alert={filteredVehicleAlerts.find((item) => item.id === activeAlertId) || null}
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
          <ManualHandlingModal
            isOpen={Boolean(activeManualAlertId)}
            alert={filteredVehicleAlerts.find((item) => item.id === activeManualAlertId) || null}
            draft={activeManualAlertId ? manualHandlingDrafts[activeManualAlertId] || {} : {}}
            onClose={() => setActiveManualAlertId(null)}
            onDraftChange={(field, value) =>
              setManualHandlingDrafts((current) => ({
                ...current,
                [activeManualAlertId]: {
                  ...(current[activeManualAlertId] || {}),
                  [field]: value,
                },
              }))
            }
            onHandle={async () => {
              if (!activeManualAlertId) return;
              const draft = manualHandlingDrafts[activeManualAlertId] || {};
              try {
                const response = await safeApi.post(API_ROUTES.alertHandlings(activeManualAlertId), {
                  notes: draft?.notes ?? "",
                });
                const updatedAlert = response?.data?.data;
                const manualEntries = Array.isArray(updatedAlert?.handlings)
                  ? updatedAlert.handlings.filter((entry) => entry?.type === "manual")
                  : [
                      {
                        id: `manual-${Date.now()}`,
                        type: "manual",
                        createdAt: new Date().toISOString(),
                        handledBy: user?.id ?? null,
                        handledByName: user?.name || user?.email || null,
                        notes: draft?.notes ?? "",
                      },
                    ];
                setManualHandlingOverrides((current) => ({
                  ...current,
                  [activeManualAlertId]: manualEntries,
                }));
                setManualHandlingDrafts((current) => {
                  const next = { ...current };
                  delete next[activeManualAlertId];
                  return next;
                });
                setActiveManualAlertId(null);
                refreshAlerts?.();
                showToast("Tratativa manual registrada.", "success");
              } catch (error) {
                showToast(resolveApiErrorMessage(error, "Falha ao salvar tratativa manual."), "error");
              }
            }}
          />
          <VehicleManualHandlingModal
            isOpen={vehicleManualHandlingOpen}
            vehicle={safeVehicle}
            draft={vehicleManualHandlingDraft}
            loading={vehicleManualHandlingLoading}
            onClose={() => {
              if (vehicleManualHandlingLoading) return;
              setVehicleManualHandlingOpen(false);
            }}
            onDraftChange={(value) => setVehicleManualHandlingDraft({ notes: value })}
            onHandle={async () => {
              if (!vehicleId || vehicleManualHandlingLoading) return;
              const notes = vehicleManualHandlingDraft?.notes || "";
              if (!notes.trim()) {
                showToast("Informe uma observação para salvar a tratativa.", "warning");
                return;
              }
              setVehicleManualHandlingLoading(true);
              try {
                const response = await safeApi.post(API_ROUTES.alertsManual, {
                  vehicleId,
                  notes,
                  ...(clientIdForRequests ? { clientId: clientIdForRequests } : {}),
                });
                const payload = response?.data?.data ?? response?.data ?? null;
                const fallbackEntry = {
                  id: `manual-${Date.now()}`,
                  vehicleId,
                  notes,
                  createdAt: new Date().toISOString(),
                  handledBy: user?.id ?? null,
                  handledByName: user?.name || user?.email || null,
                };
                const entry = payload?.id ? payload : fallbackEntry;
                setManualVehicleEntries((current) => [entry, ...current]);
                setVehicleManualHandlingDraft({ notes: "" });
                setVehicleManualHandlingOpen(false);
                refreshAlerts?.();
                showToast("Tratativa manual registrada.", "success");
              } catch (error) {
                showToast(resolveApiErrorMessage(error, "Falha ao salvar tratativa manual."), "error");
              } finally {
                setVehicleManualHandlingLoading(false);
              }
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
          <h2 className="text-lg font-semibold text-white">{vehicleSource.plate || vehicleSource.name || "Veículo"}</h2>
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

      <div className="relative z-10 flex items-center gap-2 overflow-x-auto border-b border-white/5 px-5 py-3 text-[11px] uppercase tracking-[0.1em] text-white/60 pointer-events-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            onPointerDown={() => setActiveTab(tab.id)}
            className={`rounded-md px-3 py-2 transition ${
              activeTab === tab.id ? "bg-primary/20 text-white border border-primary/40" : "border border-transparent hover:border-white/20"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 space-y-4 overflow-y-auto p-5 text-sm text-white/80 scroll-smooth">{renderContent()}</div>
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
        status={commandSendStatus}
        message={commandSendMessage}
      />
      <PageToast toast={toast} />
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
  const formatted = formatDisplayValue(value);
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-white/70">
      <span className="uppercase tracking-[0.12em] text-white/50">{label}</span>
      <span className="max-w-[65%] truncate text-right text-white" title={formatted}>{formatted}</span>
    </div>
  );
}

function resolveAddressLabel(address, isLoading = false) {
  const formatted = formatAddressString(address);
  if (formatted && formatted !== "—") return formatted;
  if (isLoading) return "Carregando…";
  return FALLBACK_ADDRESS;
}

function buildManualAlertEntry(entry, vehicle) {
  if (!entry) return null;
  const createdAt = entry.createdAt || new Date().toISOString();
  const vehicleLabel = vehicle?.name || vehicle?.plate || entry.vehicleLabel || null;
  const plate = vehicle?.plate || entry.plate || null;
  return {
    id: entry.id || `manual-${createdAt}`,
    status: "handled",
    createdAt,
    handledAt: createdAt,
    handledBy: entry.handledBy ?? null,
    handledByName: entry.handledByName ?? null,
    handling: null,
    handlings: [
      {
        id: entry.id || `manual-${createdAt}`,
        type: "manual",
        createdAt,
        handledBy: entry.handledBy ?? null,
        handledByName: entry.handledByName ?? null,
        notes: entry.notes ?? "",
      },
    ],
    vehicleId: entry.vehicleId ?? null,
    vehicleLabel,
    plate,
    eventLabel: "Tratativa manual",
    severity: "Manual",
    requiresHandling: true,
    eventActive: true,
    active: true,
  };
}

function InfoField({ label, value }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
      <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">{label}</p>
      <p className="mt-1 text-sm text-white">{formatDisplayValue(value)}</p>
    </div>
  );
}

function AlertCard({ alert, draft, onDraftChange, onOpenHandle, onOpenManual }) {
  const isPending = alert.status === "pending";
  const normalizedTitle = alert.normalizedEvent?.title || alert.normalizedEvent?.label || null;
  const title = formatDisplayValue(normalizedTitle || alert.eventLabel || "Alerta");
  const severity = formatDisplayValue(alert.normalizedEvent?.severity || alert.severity || "—");
  const manualEntries = Array.isArray(alert.handlings)
    ? alert.handlings.filter((entry) => entry?.type === "manual")
    : [];
  const lastManual = manualEntries.length ? manualEntries[manualEntries.length - 1] : null;
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="text-[11px] text-white/50">
            {alert.createdAt ? new Date(alert.createdAt).toLocaleString() : "—"} •
            {" "}
            {severity}
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
      <div className="mt-3 space-y-1 text-[11px] text-white/50">
        <p className="uppercase tracking-[0.12em] text-white/40">Tratativa manual</p>
        <p>{lastManual?.notes || "—"}</p>
        <p>
          {lastManual?.handledByName || "—"} • {lastManual?.createdAt ? new Date(lastManual.createdAt).toLocaleString() : "—"}
        </p>
        <button
          type="button"
          onClick={onOpenManual}
          className="mt-2 rounded-lg border border-white/15 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70 hover:border-white/40"
        >
          Adicionar tratativa
        </button>
      </div>
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
            <h3 className="text-lg font-semibold text-white">
              {formatDisplayValue(alert.normalizedEvent?.title || alert.eventLabel || "Alerta")}
            </h3>
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

function ManualHandlingModal({ alert, draft, isOpen, onClose, onDraftChange, onHandle }) {
  if (!isOpen || !alert) return null;
  const isValid = Boolean(draft?.notes?.trim());

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 px-4 py-6">
      <div className="w-full max-w-xl rounded-xl border border-white/10 bg-[#0f141c] p-5 text-white shadow-2xl">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-white/50">Tratativa manual</p>
            <h3 className="text-lg font-semibold text-white">
              {formatDisplayValue(alert.normalizedEvent?.title || alert.eventLabel || "Alerta")}
            </h3>
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
          <label className="text-[10px] uppercase tracking-[0.12em] text-white/50">
            Comentário / descrição *
            <textarea
              value={draft.notes || ""}
              onChange={(event) => onDraftChange("notes", event.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white"
              rows={4}
            />
          </label>
          <div className="grid gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">Data/Hora</p>
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

function VehicleManualHandlingModal({
  isOpen,
  vehicle,
  draft,
  loading,
  onClose,
  onDraftChange,
  onHandle,
}) {
  if (!isOpen) return null;
  const isValid = Boolean(draft?.notes?.trim());
  const vehicleLabel = vehicle?.plate || vehicle?.name || "Veículo";

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 px-4 py-6">
      <div className="w-full max-w-xl rounded-xl border border-white/10 bg-[#0f141c] p-5 text-white shadow-2xl">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-white/50">Tratativa manual</p>
            <h3 className="text-lg font-semibold text-white">{vehicleLabel}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/70 hover:text-white disabled:opacity-50"
          >
            Fechar
          </button>
        </div>
        <div className="mt-4 grid gap-3 text-xs text-white/70">
          <label className="text-[10px] uppercase tracking-[0.12em] text-white/50">
            Observação *
            <textarea
              value={draft?.notes || ""}
              onChange={(event) => onDraftChange(event.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white"
              rows={4}
            />
          </label>
          <div className="grid gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">Data/Hora</p>
            <p className="text-sm text-white">{new Date().toLocaleString()}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!isValid || loading}
            onClick={onHandle}
            className={`rounded-lg border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] ${
              isValid && !loading
                ? "border-primary/60 bg-primary/20 text-white"
                : "border-white/10 bg-white/5 text-white/40"
            }`}
          >
            {loading ? "Salvando..." : "Salvar tratativa"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatVehicleSummary(brand, model, year) {
  const brandText = brand ? String(brand).trim() : "";
  const modelText = model ? String(model).trim() : "";
  const yearText = year ? String(year).trim() : "";
  const modelIncludesBrand = brandText && modelText.toLowerCase().includes(brandText.toLowerCase());
  const parts = [
    modelIncludesBrand ? null : brandText,
    modelText,
    yearText,
  ].filter((item) => item && String(item).trim());
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

function resolvePointHeading(point) {
  const raw =
    point?.heading ??
    point?.course ??
    point?.attributes?.heading ??
    point?.attributes?.course ??
    point?.position?.heading ??
    point?.position?.course;
  const heading = Number(raw);
  return Number.isFinite(heading) ? heading : 0;
}

function resolveTripEventFlags(point) {
  const attributes = point?.attributes || point?.position?.attributes || point?.__attributes || {};
  const eventActive =
    point?.eventActive ??
    attributes?.eventActive ??
    point?.attributes?.eventActive ??
    point?.position?.eventActive ??
    null;
  const eventRequiresHandling =
    point?.eventRequiresHandling ??
    attributes?.eventRequiresHandling ??
    point?.attributes?.eventRequiresHandling ??
    point?.position?.eventRequiresHandling ??
    null;
  return { eventActive, eventRequiresHandling };
}

function isHandlingTripEvent(point) {
  const { eventActive, eventRequiresHandling } = resolveTripEventFlags(point);
  if (eventRequiresHandling !== true) return false;
  if (eventActive === false) return false;
  return true;
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
  const resolvedHeading = resolvePointHeading(activePoint);
  const ignition = getIgnition(activePoint, vehicle?.device || vehicle?.devices?.[0]);
  const ignitionColor =
    ignition === true ? "#22c55e" : ignition === false ? "#ef4444" : "#60a5fa";
  const currentPosition =
    vehicle?.position || vehicle?.device?.position || vehicle?.devices?.[0]?.position || activePoint;
  const isDeviceOnline = isOnline(currentPosition);
  const markerIcon = createVehicleMarkerIcon({
    bearing: resolvedHeading,
    color: ignitionColor,
    muted: !isDeviceOnline,
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
    if (!follow || !map || !center) return undefined;
    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      if (!canInteractWithMap(map)) return;
      map.setView(center, map.getZoom(), { animate: true });
    };

    if (map._loaded) {
      run();
    } else if (map.whenReady) {
      map.whenReady(run);
    } else {
      run();
    }

    return () => {
      cancelled = true;
    };
  }, [activeIndex, center, follow, map]);
  return null;
}
