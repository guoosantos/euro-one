import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Columns3 } from "lucide-react";

import Button from "../ui/Button.jsx";
import Input from "../ui/Input.jsx";
import Select from "../ui/Select.jsx";
import AddressCell from "../ui/AddressCell.jsx";
import api from "../lib/api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import useDevices from "../lib/hooks/useDevices.js";
import useVehicles, { normalizeVehicleDevices } from "../lib/hooks/useVehicles.js";
import { translateEventType } from "../lib/event-translations.js";
import { useTranslation } from "../lib/i18n.js";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";
import { getSeverityBadgeClassName, resolveSeverityLabel } from "../lib/severity-badge.js";

const EVENT_TABS = ["Relatório", "Severidade"];
const EVENT_TYPES = [
  "all",
  "deviceOnline",
  "deviceOffline",
  "deviceUnknown",
  "deviceInactive",
  "deviceMoving",
  "deviceStopped",
  "ignitionOn",
  "ignitionOff",
  "tripStart",
  "tripStop",
  "geofenceEnter",
  "geofenceExit",
  "alarm",
  "sos",
  "powerCut",
  "powerDisconnected",
  "lowBattery",
  "jamming",
  "towing",
  "tampering",
  "door",
  "speeding",
  "overspeed",
  "speedLimit",
  "fuelUp",
  "fuelDrop",
  "maintenance",
  "driverChanged",
  "harshAcceleration",
  "harshBraking",
  "harshCornering",
  "crash",
  "idle",
  "parking",
  "commandResult",
  "textMessage",
  "media",
];
const SEVERITY_LEVELS = [
  { value: "info", label: "Informativa" },
  { value: "warning", label: "Alerta" },
  { value: "critical", label: "Crítica" },
  { value: "high", label: "Alta" },
  { value: "medium", label: "Moderada" },
  { value: "low", label: "Baixa" },
];

const DEFAULT_COLUMNS = [
  { id: "time", label: "Hora GPS", defaultVisible: true, width: 140, minWidth: 120 },
  { id: "device", label: "Veículo", defaultVisible: true, width: 180, minWidth: 160 },
  { id: "type", label: "Tipo", defaultVisible: true, width: 190, minWidth: 160 },
  { id: "description", label: "Descrição", defaultVisible: true, width: 220, minWidth: 180 },
  { id: "severity", label: "Severidade", defaultVisible: true, width: 130, minWidth: 120 },
  { id: "address", label: "Endereço", defaultVisible: true, width: 360, minWidth: 240 },
  { id: "speed", label: "Velocidade", defaultVisible: false, width: 120 },
  { id: "ignition", label: "Ignição", defaultVisible: false, width: 110 },
  { id: "battery", label: "Bateria", defaultVisible: false, width: 110 },
  { id: "latitude", label: "Lat", defaultVisible: false, width: 120 },
  { id: "longitude", label: "Lng", defaultVisible: false, width: 120 },
];
const COLUMNS_STORAGE_KEY = "events:columns:v1";
const COLUMN_WIDTHS_STORAGE_KEY = "events:columns:widths:v1";
const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 800;
const DEFAULT_COLUMN_WIDTH = 140;
const PAGE_SIZE_OPTIONS = [20, 50, 100, 500, 1000, 5000];
const DEFAULT_PAGE_SIZE = 100;

const SEVERITY_LABELS = {
  info: "Informativa",
  informativa: "Informativa",
  warning: "Alerta",
  alerta: "Alerta",
  low: "Baixa",
  baixa: "Baixa",
  medium: "Moderada",
  moderate: "Moderada",
  moderada: "Moderada",
  media: "Moderada",
  "média": "Moderada",
  high: "Alta",
  alta: "Alta",
  critical: "Crítica",
  critica: "Crítica",
  "crítica": "Crítica",
};

const CRITICAL_EVENT_TYPES = new Set(["deviceoffline", "deviceinactive", "deviceunknown", "powercut", "powerdisconnected"]);
const MODERATE_EVENT_TYPES = new Set([
  "ignitionon",
  "ignitionoff",
  "devicemoving",
  "devicestopped",
  "tripstart",
  "tripstop",
]);
const LOW_EVENT_TYPES = new Set(["deviceonline"]);
const UNAVAILABLE_ADDRESSES = new Set(["Endereço não disponível", "Endereco nao disponivel", "Endereço indisponível"]);
const POWER_DISCONNECTED_TYPES = new Set([
  "powerdisconnected",
  "powerdisconnect",
  "externalpowerdisconnected",
  "externalpowerdisconnect",
  "powercut",
]);

function cleanAddress(address) {
  if (!address) return null;
  const text = String(address).trim();
  return UNAVAILABLE_ADDRESSES.has(text) ? null : text;
}

function resolveVehicleLabel(candidateList = []) {
  for (const raw of candidateList) {
    if (!raw) continue;
    const text = String(raw).trim();
    if (!text) continue;
    const hasLetters = /[a-zA-Z]/.test(text);
    if (!hasLetters) continue;
    return text;
  }
  return "—";
}

function resolveEventCoordinates({ event, deviceId, positionsById, positionsByDeviceId }) {
  const directLat = Number(event?.latitude);
  const directLng = Number(event?.longitude);
  if (Number.isFinite(directLat) && Number.isFinite(directLng)) {
    return { latitude: directLat, longitude: directLng };
  }

  const positionId = event?.positionId ?? event?.position?.id ?? event?.attributes?.positionId ?? null;
  const positionFromId = positionId ? positionsById.get(String(positionId)) : null;
  const positionFromEvent = !positionFromId ? event?.position || event?.attributes?.position || null : null;
  const position = positionFromId || positionFromEvent;
  const positionLat = Number(position?.latitude);
  const positionLng = Number(position?.longitude);
  if (Number.isFinite(positionLat) && Number.isFinite(positionLng)) {
    return { latitude: positionLat, longitude: positionLng };
  }

  const fallbackPosition = deviceId ? positionsByDeviceId?.[deviceId] : null;
  const fallbackLat = Number(fallbackPosition?.latitude);
  const fallbackLng = Number(fallbackPosition?.longitude);
  if (Number.isFinite(fallbackLat) && Number.isFinite(fallbackLng)) {
    return { latitude: fallbackLat, longitude: fallbackLng };
  }

  return { latitude: null, longitude: null };
}

function normalizeEventTypeKey(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

function isPowerDisconnectedType(value) {
  return POWER_DISCONNECTED_TYPES.has(normalizeEventTypeKey(value));
}

function buildInitialColumns() {
  return DEFAULT_COLUMNS.reduce((acc, column) => {
    acc[column.id] = column.defaultVisible;
    return acc;
  }, {});
}

export default function Events() {
  const { t: translateFn, locale } = useTranslation();
  const t = translateFn || ((value) => value);
  const [searchParams] = useSearchParams();
  const { devices, positionsByDeviceId } = useDevices({ withPositions: true });
  const { vehicles } = useVehicles();

  const [activeTab, setActiveTab] = useState(EVENT_TABS[0]);
  const [activeCategoryTab, setActiveCategoryTab] = useState("Segurança");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [eventType, setEventType] = useState("all");
  const [from, setFrom] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [showColumns, setShowColumns] = useState(false);
  const [columnsVisibility, setColumnsVisibility] = useState(() => {
    try {
      const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
      if (!raw) return buildInitialColumns();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return buildInitialColumns();
      const defaults = buildInitialColumns();
      return { ...defaults, ...parsed };
    } catch (_error) {
      return buildInitialColumns();
    }
  });
  const [columnsDraft, setColumnsDraft] = useState(columnsVisibility);
  const [columnWidths, setColumnWidths] = useState(() => {
    try {
      const raw = localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
      return {};
    }
  });
  const [reportEvents, setReportEvents] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState(null);
  const [reportMeta, setReportMeta] = useState(null);
  const [reportGenerated, setReportGenerated] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [protocols, setProtocols] = useState([]);
  const [selectedProtocol, setSelectedProtocol] = useState("");
  const [protocolEvents, setProtocolEvents] = useState([]);
  const [eventSearch, setEventSearch] = useState("");
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState(null);
  const [savingConfig, setSavingConfig] = useState(false);

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

  const deviceIdByKey = useMemo(() => {
    const map = new Map();
    (Array.isArray(devices) ? devices : []).forEach((device) => {
      const candidates = [
        device?.traccarId,
        device?.id,
        device?.deviceId,
        device?.device_id,
        device?.uniqueId,
        device?.unique_id,
      ];
      const numericId = candidates
        .map((value) => Number(value))
        .find((value) => Number.isFinite(value) && value > 0);
      if (!numericId) return;
      candidates.forEach((value) => {
        const key = toDeviceKey(value);
        if (key) map.set(key, numericId);
      });
    });
    return map;
  }, [devices]);

  useEffect(() => {
    if (showColumns) {
      setColumnsDraft(columnsVisibility);
    }
  }, [columnsVisibility, showColumns]);

  useEffect(() => {
    const incomingVehicleId = searchParams.get("vehicleId");
    if (!incomingVehicleId) return;
    setSelectedVehicleId((current) => (String(current) === String(incomingVehicleId) ? current : incomingVehicleId));
  }, [searchParams]);

  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths));
    } catch (_error) {
      // ignore storage failures
    }
  }, [columnWidths]);

  const vehicleOptions = useMemo(
    () =>
      vehicles.map((vehicle) => {
        const plate = vehicle?.plate ? String(vehicle.plate).trim() : "";
        const deviceIds = normalizeVehicleDevices(vehicle)
          .map((device) => {
            const candidates = [
              device?.traccarId,
              device?.id,
              device?.deviceId,
              device?.device_id,
              device?.uniqueId,
              device?.unique_id,
            ];
            const numericId = candidates
              .map((value) => Number(value))
              .find((value) => Number.isFinite(value) && value > 0);
            if (numericId) return numericId;
            const lookupKeys = candidates.map((value) => toDeviceKey(value)).filter(Boolean);
            const mappedId = lookupKeys.map((key) => deviceIdByKey.get(key)).find((value) => value);
            return mappedId || null;
          })
          .filter(Boolean);
        return {
          id: vehicle.id,
          label: plate || "—",
          searchLabel: `${plate} ${vehicle?.name ?? ""} ${vehicle?.identifier ?? ""}`.trim().toLowerCase(),
          deviceIds: Array.from(new Set(deviceIds)),
        };
      }),
    [deviceIdByKey, vehicles],
  );

  const filteredVehicleOptions = useMemo(() => {
    const term = vehicleSearch.trim().toLowerCase();
    if (!term) return vehicleOptions;
    return vehicleOptions.filter((vehicle) => (vehicle.searchLabel || vehicle.label.toLowerCase()).includes(term));
  }, [vehicleOptions, vehicleSearch]);

  const selectedVehicle = useMemo(
    () => vehicleOptions.find((vehicle) => String(vehicle.id) === String(selectedVehicleId)) || null,
    [selectedVehicleId, vehicleOptions],
  );

  const allDeviceIds = useMemo(() => Array.from(new Set(deviceIdByKey.values())), [deviceIdByKey]);

  useEffect(() => {
    let mounted = true;
    async function loadProtocols() {
      try {
        const response = await api.get(API_ROUTES.protocols);
        const list = Array.isArray(response?.data?.protocols) ? response.data.protocols : [];
        if (mounted) setProtocols(list);
      } catch (_error) {
        if (mounted) setProtocols([]);
      }
    }
    loadProtocols();
    return () => {
      mounted = false;
    };
  }, []);

  const fetchReport = useCallback(async (pageOverride = page) => {
    setReportLoading(true);
    setReportError(null);
    try {
      const deviceIdsToQuery = selectedVehicle?.deviceIds?.length
        ? selectedVehicle.deviceIds
        : allDeviceIds;
      const shouldFilterPowerDisconnected = eventType === "powerDisconnected";
      const params = {
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
        deviceIds: deviceIdsToQuery.length ? deviceIdsToQuery : undefined,
        limit: pageSize,
        page: pageOverride,
      };

      const response = await api.get(API_ROUTES.events, { params });
      const list = Array.isArray(response?.data?.events)
        ? response.data.events
        : Array.isArray(response?.data?.data?.events)
        ? response.data.data.events
        : [];
      setReportMeta(response?.data?.meta || null);
      const selectedTypeKey = normalizeEventTypeKey(eventType);
      const filtered =
        eventType === "all"
          ? list
          : list.filter((event) => {
              const eventTypeValue = event?.type || event?.attributes?.type || event?.event;
              if (shouldFilterPowerDisconnected) {
                return isPowerDisconnectedType(eventTypeValue);
              }
              return normalizeEventTypeKey(eventTypeValue) === selectedTypeKey;
            });
      setReportEvents(filtered);
      setReportGenerated(true);
    } catch (error) {
      setReportError(error instanceof Error ? error : new Error("Erro ao carregar eventos"));
      setReportEvents([]);
      setReportMeta(null);
    } finally {
      setReportLoading(false);
    }
  }, [allDeviceIds, eventType, from, page, pageSize, selectedVehicle, to]);

  useEffect(() => {
    if (activeTab !== "Severidade" || !selectedProtocol) return;
    let mounted = true;
    async function loadProtocolEvents() {
      setConfigLoading(true);
      setConfigError(null);
      try {
        const [eventsResponse, configResponse] = await Promise.all([
          api.get(API_ROUTES.protocolEvents(selectedProtocol)),
          api.get(API_ROUTES.protocolEventConfig(selectedProtocol)),
        ]);
        const eventsList = Array.isArray(eventsResponse?.data?.events) ? eventsResponse.data.events : [];
        const savedConfig = configResponse?.data?.config || {};
        const configMap = savedConfig && typeof savedConfig === "object" ? savedConfig : {};
        const catalogIds = new Set(eventsList.map((event) => String(event?.id)));
        const rows = eventsList.map((event) => {
          const id = String(event.id);
          const configEntry = configMap?.[id] || {};
          return {
            id,
            code: id,
            defaultName: event.name,
            description: event.description,
            defaultSeverity: event.defaultSeverity ?? null,
            customName: configEntry.customName ?? configEntry.displayName ?? "",
            severity: normalizeSeverityValue(configEntry.severity ?? event.defaultSeverity ?? "info"),
            active: configEntry.active ?? true,
            category: configEntry.category ?? "",
            requiresHandling: configEntry.requiresHandling ?? false,
          };
        });
        const unmappedRows = Object.entries(configMap)
          .filter(([id]) => !catalogIds.has(String(id)))
          .map(([id, configEntry]) => ({
            id: String(id),
            code: String(id),
            defaultName: configEntry.customName || configEntry.displayName || `NÃO MAPEADO (${id})`,
            description: "",
            defaultSeverity: null,
            customName: configEntry.customName ?? configEntry.displayName ?? "",
            severity: normalizeSeverityValue(configEntry.severity ?? "warning"),
            active: configEntry.active ?? true,
            isUnmapped: true,
            category: configEntry.category ?? "",
            requiresHandling: configEntry.requiresHandling ?? false,
          }));
        if (mounted) {
          setProtocolEvents([...rows, ...unmappedRows]);
        }
      } catch (error) {
        if (mounted) {
          setConfigError(error instanceof Error ? error : new Error("Erro ao carregar eventos do protocolo"));
          setProtocolEvents([]);
        }
      } finally {
        if (mounted) setConfigLoading(false);
      }
    }
    loadProtocolEvents();
    return () => {
      mounted = false;
    };
  }, [activeTab, selectedProtocol]);

  const reportRows = useMemo(() => {
    const positionsById = new Map();
    Object.values(positionsByDeviceId || {}).forEach((position) => {
      const positionId = position?.id;
      if (positionId != null) positionsById.set(String(positionId), position);
    });
    reportEvents.forEach((event) => {
      const position = event?.position || event?.attributes?.position || null;
      const positionId = event?.positionId ?? position?.id;
      if (positionId && position) {
        positionsById.set(String(positionId), position);
      }
    });

    return reportEvents.map((event) => {
      const deviceId = toDeviceKey(event?.deviceId ?? event?.device?.id ?? event?.device);
      const vehicle = deviceId ? vehicleByDeviceId.get(String(deviceId)) : null;
      const plate = vehicle?.plate ? String(vehicle.plate).trim() : "";
      const vehicleLabel = resolveVehicleLabel([
        plate,
        vehicle?.name,
        vehicle?.identifier,
        event?.device?.name,
      ]);
      const positionFromEvent = event?.position || event?.attributes?.position || null;
      const positionFromId = event?.positionId ? positionsById.get(String(event.positionId)) : null;
      const fallbackPosition = deviceId ? positionsByDeviceId?.[deviceId] : null;
      const position = positionFromEvent || positionFromId || fallbackPosition || {};
      const { latitude, longitude } = resolveEventCoordinates({
        event,
        deviceId,
        positionsById,
        positionsByDeviceId,
      });
      const protocol =
        event?.protocol ||
        event?.attributes?.protocol ||
        position?.protocol ||
        position?.attributes?.protocol ||
        positionFromEvent?.protocol ||
        positionFromEvent?.attributes?.protocol ||
        positionFromId?.protocol ||
        positionFromId?.attributes?.protocol ||
        null;
      const rawSeverity =
        event?.severity ??
        event?.attributes?.severity ??
        event?.criticality ??
        event?.attributes?.criticality ??
        null;
      const severity = resolveEventSeverity(rawSeverity, event?.type || event?.attributes?.type || event?.event);
      return {
        id: event?.id ?? `${event?.deviceId}-${event?.serverTime || event?.eventTime || event?.time}`,
        time: event?.serverTime || event?.deviceTime || event?.eventTime || event?.time,
        device: vehicleLabel,
        type: event?.type || event?.attributes?.type || event?.event,
        description: event?.attributes?.message || event?.attributes?.description || event?.attributes?.type || "—",
        severity,
        protocol,
        address: cleanAddress(
          event?.address ||
            positionFromEvent?.address ||
            positionFromId?.address ||
            position?.address ||
            event?.attributes?.address ||
            fallbackPosition?.address ||
            null,
        ),
        speed: position?.speed ?? event?.speed ?? null,
        ignition: event?.ignition ?? position?.ignition ?? null,
        battery: event?.batteryLevel ?? position?.batteryLevel ?? null,
        latitude,
        longitude,
      };
    });
  }, [positionsByDeviceId, reportEvents, vehicleByDeviceId]);

  const totalItems = reportMeta?.totalItems ?? reportEvents.length;
  const totalPages = reportMeta?.totalPages ?? 1;
  const currentPage = reportMeta?.page ?? page;

  useEffect(() => {
    if (!reportGenerated) return;
    fetchReport(page);
  }, [fetchReport, page, reportGenerated]);

  const visibleColumns = useMemo(
    () => DEFAULT_COLUMNS.filter((column) => columnsVisibility[column.id]),
    [columnsVisibility],
  );

  const columnLookup = useMemo(() => {
    return DEFAULT_COLUMNS.reduce((acc, column) => {
      acc[column.id] = column;
      return acc;
    }, {});
  }, []);

  const getColumnMinWidth = useCallback((columnId) => {
    const column = columnLookup[columnId];
    const declared = Number.isFinite(column?.minWidth) ? column.minWidth : MIN_COLUMN_WIDTH;
    return Math.max(MIN_COLUMN_WIDTH, declared);
  }, [columnLookup]);

  const getColumnWidth = useCallback(
    (columnId) => {
      const column = columnLookup[columnId];
      const storedWidth = columnWidths[columnId];
      const baseWidth = Number.isFinite(column?.width) ? column.width : DEFAULT_COLUMN_WIDTH;
      const chosen = Number.isFinite(storedWidth) ? storedWidth : baseWidth;
      const minWidth = getColumnMinWidth(columnId);
      return Math.max(minWidth, Math.min(chosen, MAX_COLUMN_WIDTH));
    },
    [columnLookup, columnWidths, getColumnMinWidth],
  );

  const getWidthStyle = useCallback(
    (columnId) => {
      const minWidth = getColumnMinWidth(columnId);
      const width = getColumnWidth(columnId);
      return { width, minWidth, maxWidth: MAX_COLUMN_WIDTH };
    },
    [getColumnMinWidth, getColumnWidth],
  );

  const startResize = useCallback(
    (columnId, event) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidthRaw = event.currentTarget.parentElement?.getBoundingClientRect().width;
      const minWidth = getColumnMinWidth(columnId);
      const startWidth = Number.isFinite(startWidthRaw) ? startWidthRaw : getColumnWidth(columnId);
      const safeStartWidth = Math.max(minWidth, Math.min(startWidth, MAX_COLUMN_WIDTH));

      const handleMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const nextWidth = Math.round(safeStartWidth + delta);
        const clamped = Math.max(minWidth, Math.min(nextWidth, MAX_COLUMN_WIDTH));
        setColumnWidths((prev) => {
          if (prev[columnId] === clamped) return prev;
          return { ...prev, [columnId]: clamped };
        });
      };

      const handleUp = () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [getColumnMinWidth, getColumnWidth],
  );

  const filteredProtocolEvents = useMemo(() => {
    const term = eventSearch.trim().toLowerCase();
    return protocolEvents.filter((event) => {
      const matchesCategory =
        !activeCategoryTab ||
        !event.category ||
        String(event.category).toLowerCase() === String(activeCategoryTab).toLowerCase();
      if (!matchesCategory) return false;
      if (!term) return true;
      return (
        event.code?.toLowerCase().includes(term) ||
        event.defaultName?.toLowerCase().includes(term) ||
        event.customName?.toLowerCase().includes(term) ||
        event.description?.toLowerCase().includes(term)
      );
    });
  }, [activeCategoryTab, eventSearch, protocolEvents]);

  const handleCustomNameChange = (eventId, value) => {
    setProtocolEvents((current) =>
      current.map((event) => (event.id === eventId ? { ...event, customName: value } : event)),
    );
  };

  const handleSeverityChange = (eventId, value) => {
    setProtocolEvents((current) =>
      current.map((event) => (event.id === eventId ? { ...event, severity: value } : event)),
    );
  };

  const handleActiveChange = (eventId, value) => {
    setProtocolEvents((current) =>
      current.map((event) => (event.id === eventId ? { ...event, active: value } : event)),
    );
  };

  const handleCategoryChange = (eventId, value) => {
    setProtocolEvents((current) =>
      current.map((event) => (event.id === eventId ? { ...event, category: value } : event)),
    );
  };

  const handleRequiresHandlingChange = (eventId, value) => {
    setProtocolEvents((current) =>
      current.map((event) => (event.id === eventId ? { ...event, requiresHandling: value } : event)),
    );
  };

  const handleSaveConfig = async () => {
    if (!selectedProtocol) return;
    setSavingConfig(true);
    setConfigError(null);
    try {
      const items = protocolEvents.map((event) => ({
        id: event.id,
        customName: event.customName?.trim() || null,
        severity: normalizeSeverityValue(event.severity || event.defaultSeverity || "info"),
        active: typeof event.active === "boolean" ? event.active : true,
        category: event.category || null,
        requiresHandling: Boolean(event.requiresHandling),
      }));
      const response = await api.put(API_ROUTES.protocolEventConfig(selectedProtocol), { items });
      const updatedConfig = response?.data?.config || {};
      setProtocolEvents((current) =>
        current.map((event) => {
          const configEntry = updatedConfig?.[event.id];
          if (!configEntry) return event;
          return {
            ...event,
            customName: configEntry.customName ?? configEntry.displayName ?? "",
            severity: normalizeSeverityValue(configEntry.severity ?? event.defaultSeverity ?? "info"),
            active: configEntry.active ?? true,
            category: configEntry.category ?? event.category ?? "",
            requiresHandling: configEntry.requiresHandling ?? event.requiresHandling ?? false,
          };
        }),
      );
    } catch (error) {
      setConfigError(error instanceof Error ? error : new Error("Erro ao salvar configurações"));
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSaveColumns = () => {
    setColumnsVisibility(columnsDraft);
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(columnsDraft));
    } catch (_error) {
      // ignore storage failures
    }
    setShowColumns(false);
  };

  return (
    <div className="flex min-h-[calc(100vh-180px)] w-full flex-col gap-6">
      <section className="card flex min-h-0 flex-1 flex-col gap-4 p-0">
        <header className="space-y-2 px-6 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">Central de eventos</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div className="flex flex-wrap gap-2">
              {EVENT_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                    activeTab === tab
                      ? "bg-primary/20 text-white border border-primary/40"
                      : "border border-white/10 text-white/60 hover:text-white"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
            {activeTab === "Relatório" && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <label className="flex items-center gap-2 rounded-md border border-white/15 bg-[#0d1117] px-3 py-2 text-xs font-semibold text-white/80 transition hover:border-white/30">
                  <span className="whitespace-nowrap">Itens por página</span>
                  <select
                    value={pageSize}
                    onChange={(event) => {
                      const value = Number(event.target.value) || DEFAULT_PAGE_SIZE;
                      setPageSize(value);
                      setPage(1);
                      if (reportGenerated) {
                        fetchReport(1);
                      }
                    }}
                    className="rounded bg-transparent text-white outline-none"
                  >
                    {PAGE_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option} className="bg-[#0d1117] text-white">
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  onClick={() => {
                    setPage(1);
                    fetchReport(1);
                  }}
                >
                  Mostrar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSelectedVehicleId("");
                    setVehicleSearch("");
                    setEventType("all");
                    setPage(1);
                  }}
                >
                  Limpar filtros
                </Button>
                <div className="relative flex items-center">
                  <button
                    type="button"
                    className={`rounded-xl border border-white/10 p-2 text-white/70 transition hover:text-white ${
                      showColumns ? "bg-white/10" : "bg-transparent"
                    }`}
                    onClick={() => setShowColumns((open) => !open)}
                    aria-label="Colunas"
                  >
                    <Columns3 size={18} />
                  </button>
                  {showColumns && (
                    <div className="absolute right-0 top-12 z-20 w-56 rounded-xl border border-white/10 bg-[#0f141c] p-3 text-xs text-white/70 shadow-xl">
                      <p className="mb-2 text-[11px] uppercase tracking-wide text-white/50">Colunas</p>
                      <div className="space-y-2">
                        {DEFAULT_COLUMNS.map((column) => (
                          <label key={column.id} className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={columnsDraft[column.id]}
                              onChange={(event) =>
                                setColumnsDraft((current) => ({
                                  ...current,
                                  [column.id]: event.target.checked,
                                }))
                              }
                              className="rounded border-white/20 bg-transparent"
                            />
                            <span>{column.label}</span>
                          </label>
                        ))}
                      </div>
                      <div className="mt-3 flex justify-end">
                        <Button type="button" size="xs" variant="secondary" onClick={handleSaveColumns}>
                          Salvar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </header>

        {activeTab === "Relatório" && (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="mx-6 flex flex-wrap items-end gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
              <label className="flex min-w-[220px] flex-1 flex-col text-xs uppercase tracking-wide text-white/60">
                Buscar veículo
                <Input
                  value={vehicleSearch}
                  onChange={(event) => setVehicleSearch(event.target.value)}
                  placeholder="Digite placa ou nome"
                  className="mt-2"
                />
              </label>
              <label className="flex min-w-[200px] flex-1 flex-col text-xs uppercase tracking-wide text-white/60">
                Veículo
                <Select
                  value={selectedVehicleId}
                  onChange={(event) => setSelectedVehicleId(event.target.value)}
                  className="mt-2 w-full bg-layer text-sm"
                >
                  <option value="">Todos os veículos</option>
                  {filteredVehicleOptions.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex min-w-[200px] flex-1 flex-col text-xs uppercase tracking-wide text-white/60">
                Tipo de evento
                <Select
                  value={eventType}
                  onChange={(event) => setEventType(event.target.value)}
                  className="mt-2 w-full bg-layer text-sm"
                >
                  {EVENT_TYPES.map((option) => (
                    <option key={option} value={option}>
                      {option === "all" ? "Todos" : translateEventType(option, locale, t)}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex min-w-[190px] flex-1 flex-col text-xs uppercase tracking-wide text-white/60">
                De
                <input
                  type="datetime-local"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-border bg-layer px-3 py-2 text-sm"
                />
              </label>
              <label className="flex min-w-[190px] flex-1 flex-col text-xs uppercase tracking-wide text-white/60">
                Até
                <input
                  type="datetime-local"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-border bg-layer px-3 py-2 text-sm"
                />
              </label>
              {selectedVehicle && selectedVehicle.deviceIds.length === 0 && (
                <p className="w-full text-xs text-amber-200/80">Veículo sem equipamento vinculado.</p>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-white/10 bg-[#0b0f17]">
              <table className="w-full min-w-full table-fixed border-collapse text-left text-sm" style={{ tableLayout: "fixed" }}>
                <colgroup>
                  {visibleColumns.map((column) => (
                    <col key={column.id} style={getWidthStyle(column.id)} />
                  ))}
                </colgroup>
                <thead className="sticky top-0 z-10 border-b border-white/10 bg-[#0f141c] text-left text-[11px] uppercase tracking-[0.12em] text-white/60 shadow-sm">
                  <tr>
                    {visibleColumns.map((column) => (
                      <th
                        key={column.id}
                        style={getWidthStyle(column.id)}
                        className="relative border-r border-white/5 px-3 py-2 font-semibold last:border-r-0"
                        title={column.label}
                      >
                        <div className="flex items-center justify-between gap-2 pr-2">
                          <span className="truncate whitespace-nowrap" title={column.label}>
                            {column.label}
                          </span>
                          <span
                            role="separator"
                            tabIndex={0}
                            onMouseDown={(event) => startResize(column.id, event)}
                            onClick={(event) => event.stopPropagation()}
                            className="ml-auto inline-flex h-5 w-1 cursor-col-resize items-center justify-center rounded bg-white/10 hover:bg-primary/40"
                            title="Redimensionar coluna"
                          />
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40 text-xs">
                  {reportLoading && (
                    <tr>
                      <td colSpan={visibleColumns.length} className="px-3 py-4 text-center text-sm text-white/60">
                        Carregando eventos…
                      </td>
                    </tr>
                  )}
                  {!reportLoading && reportError && (
                    <tr>
                      <td colSpan={visibleColumns.length} className="px-3 py-4 text-center text-sm text-red-300">
                        Não foi possível carregar os eventos. {reportError.message}
                      </td>
                    </tr>
                  )}
                  {!reportLoading && !reportError && reportRows.length === 0 && (
                    <tr>
                      <td colSpan={visibleColumns.length} className="px-3 py-4 text-center text-sm text-white/60">
                        Nenhum evento encontrado para o período selecionado.
                      </td>
                    </tr>
                  )}
                  {reportRows.map((row) => (
                    <tr key={row.id} className="hover:bg-white/5">
                      {visibleColumns.map((column) => (
                        <td
                          key={column.id}
                          style={getWidthStyle(column.id)}
                          className="border-r border-white/5 px-3 py-2 text-[11px] text-white/80 last:border-r-0"
                        >
                          {renderColumnValue(column.id, row, locale, t)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-2 pb-4 text-xs text-white/70">
              <button
                type="button"
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 disabled:opacity-50"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage <= 1 || reportLoading}
              >
                Anterior
              </button>
              <span>
                Página {currentPage} de {totalPages} • {totalItems} itens
              </span>
              <button
                type="button"
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 disabled:opacity-50"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage >= totalPages || reportLoading}
              >
                Próxima
              </button>
            </div>
          </div>
        )}

        {activeTab === "Severidade" && (
          <div className="space-y-4 px-6 pb-6">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <label className="text-xs uppercase tracking-wide text-white/60">
                Protocolo
                <Select
                  value={selectedProtocol}
                  onChange={(event) => setSelectedProtocol(event.target.value)}
                  className="mt-2 w-full bg-layer text-sm"
                >
                  <option value="">Selecione</option>
                  {protocols.map((protocol) => (
                    <option key={protocol.id} value={protocol.id}>
                      {protocol.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="text-xs uppercase tracking-wide text-white/60">
                Buscar evento
                <Input
                  value={eventSearch}
                  onChange={(event) => setEventSearch(event.target.value)}
                  placeholder="Nome, descrição ou código"
                  className="mt-2"
                />
              </label>
            </div>

            {configError && <p className="text-xs text-red-300">{configError.message}</p>}

            {selectedProtocol && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-white/50">Eventos do protocolo</p>
                    <p className="text-xs text-white/60">
                      {configLoading ? "Carregando catálogo…" : `${filteredProtocolEvents.length} eventos`}
                    </p>
                  </div>
                  <Button type="button" onClick={handleSaveConfig} disabled={savingConfig || configLoading}>
                    {savingConfig ? "Salvando…" : "Salvar"}
                  </Button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {["Segurança", "Logística"].map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveCategoryTab(tab)}
                      className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition ${
                        activeCategoryTab === tab
                          ? "border-primary/60 bg-primary/20 text-white"
                          : "border-white/10 text-white/60 hover:text-white"
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <div className="mt-3 space-y-2">
                  <div className="hidden items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-wide text-white/60 md:grid md:grid-cols-[120px_minmax(0,1.4fr)_minmax(0,1.4fr)_150px_150px_160px_80px]">
                    <span>Código</span>
                    <span>Nome do evento</span>
                    <span>Descrição</span>
                    <span>Severidade</span>
                    <span>Categoria</span>
                    <span>Requer tratativa</span>
                    <span>Ativo</span>
                  </div>
                  {filteredProtocolEvents.map((event) => (
                    <div
                      key={event.id}
                      className="grid gap-3 rounded-2xl border border-white/10 bg-neutral-900/60 p-3 md:grid-cols-[120px_minmax(0,1.4fr)_minmax(0,1.4fr)_150px_150px_160px_80px] md:items-center"
                    >
                      <div className="text-xs text-white/70">
                        <span className="block text-[10px] uppercase tracking-wide text-white/40 md:hidden">Código</span>
                        <span>{event.code}</span>
                      </div>
                      <label className="text-xs text-white/70">
                        <span className="block text-[10px] uppercase tracking-wide text-white/40 md:hidden">Nome do evento</span>
                        <Input
                          value={event.customName ?? ""}
                          onChange={(evt) => handleCustomNameChange(event.id, evt.target.value)}
                          placeholder={event.defaultName || "Nome do evento"}
                          className="mt-1 h-9 bg-layer text-xs md:mt-0"
                        />
                      </label>
                      <div className="text-xs text-white/60">
                        <span className="block text-[10px] uppercase tracking-wide text-white/40 md:hidden">Descrição</span>
                        <p>{event.description || "—"}</p>
                      </div>
                      <label className="text-xs uppercase tracking-wide text-white/60">
                        <span className="block text-[10px] uppercase tracking-wide text-white/40 md:hidden">Severidade</span>
                        <Select
                          value={event.severity || "info"}
                          onChange={(evt) => handleSeverityChange(event.id, evt.target.value)}
                          className="mt-1 w-full bg-layer text-xs md:mt-0"
                        >
                          {SEVERITY_LEVELS.map((level) => (
                            <option key={level.value} value={level.value}>
                              {level.label}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <label className="text-xs uppercase tracking-wide text-white/60">
                        <span className="block text-[10px] uppercase tracking-wide text-white/40 md:hidden">Categoria</span>
                        <Select
                          value={event.category || ""}
                          onChange={(evt) => handleCategoryChange(event.id, evt.target.value)}
                          className="mt-1 w-full bg-layer text-xs md:mt-0"
                        >
                          <option value="">Não definida</option>
                          <option value="Segurança">Segurança</option>
                          <option value="Logística">Logística</option>
                        </Select>
                      </label>
                      <label className="text-xs uppercase tracking-wide text-white/60">
                        <span className="block text-[10px] uppercase tracking-wide text-white/40 md:hidden">Requer tratativa</span>
                        <Select
                          value={event.requiresHandling ? "yes" : "no"}
                          onChange={(evt) => handleRequiresHandlingChange(event.id, evt.target.value === "yes")}
                          className="mt-1 w-full bg-layer text-xs md:mt-0"
                        >
                          <option value="no">Não</option>
                          <option value="yes">Sim</option>
                        </Select>
                      </label>
                      <label className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-white/60">
                        <input
                          type="checkbox"
                          checked={event.active ?? true}
                          onChange={(evt) => handleActiveChange(event.id, evt.target.checked)}
                          className="rounded border-white/20 bg-transparent"
                        />
                        Ativo
                      </label>
                    </div>
                  ))}
                  {!configLoading && selectedProtocol && filteredProtocolEvents.length === 0 && (
                    <p className="text-xs text-white/60">Nenhum evento encontrado para o protocolo.</p>
                  )}
                </div>
              </div>
            )}

            {!selectedProtocol && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                Selecione um protocolo para visualizar a severidade dos eventos.
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function renderColumnValue(columnId, row, locale, t) {
  switch (columnId) {
    case "time":
      return row.time ? new Date(row.time).toLocaleString() : "—";
    case "device":
      return row.device || "—";
    case "type":
      return translateEventType(row.type || "", locale, t, row.protocol, row) || "—";
    case "description":
      return row.description || "—";
    case "severity":
      return renderSeverityBadge(row.severity);
    case "address":
      if (row.address || (Number.isFinite(row.latitude) && Number.isFinite(row.longitude))) {
        return <AddressCell address={row.address} />;
      }
      return "—";
    case "speed":
      return row.speed != null ? `${Number(row.speed).toFixed(1)} km/h` : "—";
    case "ignition":
      return row.ignition == null ? "—" : row.ignition ? "Ligada" : "Desligada";
    case "battery":
      return row.battery != null ? `${Number(row.battery).toFixed(0)}%` : "—";
    case "latitude":
      return row.latitude != null ? Number(row.latitude).toFixed(5) : "—";
    case "longitude":
      return row.longitude != null ? Number(row.longitude).toFixed(5) : "—";
    default:
      return "—";
  }
}

function normalizeSeverityValue(value, fallback = "info") {
  if (!value) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["informativa", "info"].includes(normalized)) return "info";
  if (["alerta", "warning"].includes(normalized)) return "warning";
  if (["critica", "crítica", "critical"].includes(normalized)) return "critical";
  if (["alta", "high"].includes(normalized)) return "high";
  if (["moderada", "media", "média", "medium", "moderate"].includes(normalized)) return "medium";
  if (["baixa", "low"].includes(normalized)) return "low";
  return normalized || fallback;
}

function resolveEventSeverity(rawSeverity, eventType) {
  const normalizedSeverity = String(rawSeverity || "").trim().toLowerCase();
  if (normalizedSeverity) {
    return SEVERITY_LABELS[normalizedSeverity] || normalizeTitle(normalizedSeverity);
  }

  const typeKey = String(eventType || "").trim().toLowerCase();
  if (CRITICAL_EVENT_TYPES.has(typeKey)) return "Crítica";
  if (MODERATE_EVENT_TYPES.has(typeKey)) return "Moderada";
  if (LOW_EVENT_TYPES.has(typeKey)) return "Baixa";
  return "Informativa";
}

function normalizeTitle(value) {
  if (!value) return "—";
  const cleaned = value.replace(/_/g, " ").trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : "—";
}

function renderSeverityBadge(severity) {
  if (!severity) return "—";
  const label = resolveSeverityLabel(severity);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getSeverityBadgeClassName(label)}`}
    >
      {label}
    </span>
  );
}
