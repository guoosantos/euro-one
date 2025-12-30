import React, { useCallback, useEffect, useMemo, useState } from "react";

import Button from "../ui/Button.jsx";
import Input from "../ui/Input.jsx";
import Select from "../ui/Select.jsx";
import AddressCell from "../ui/AddressCell.jsx";
import api from "../lib/api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import useDevices from "../lib/hooks/useDevices.js";
import useVehicles, { formatVehicleLabel, normalizeVehicleDevices } from "../lib/hooks/useVehicles.js";
import useTraccarGroups from "../lib/hooks/useTraccarGroups.js";
import { translateEventType } from "../lib/event-translations.js";
import { useTranslation } from "../lib/i18n.js";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";

const EVENT_TABS = ["Relatório", "Criticidade"];
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
const SEVERITY_LEVELS = [
  { value: "informativa", label: "Informativa" },
  { value: "baixa", label: "Baixa" },
  { value: "moderada", label: "Moderada" },
  { value: "alta", label: "Alta" },
  { value: "critica", label: "Crítica" },
];

const DEFAULT_COLUMNS = [
  { id: "time", label: "Hora GPS", defaultVisible: true },
  { id: "device", label: "Veículo", defaultVisible: true },
  { id: "type", label: "Tipo", defaultVisible: true },
  { id: "description", label: "Descrição", defaultVisible: true },
  { id: "address", label: "Endereço", defaultVisible: true },
  { id: "speed", label: "Velocidade", defaultVisible: false },
  { id: "ignition", label: "Ignição", defaultVisible: false },
  { id: "battery", label: "Bateria", defaultVisible: false },
  { id: "latitude", label: "Lat", defaultVisible: false },
  { id: "longitude", label: "Lng", defaultVisible: false },
];

function buildInitialColumns() {
  return DEFAULT_COLUMNS.reduce((acc, column) => {
    acc[column.id] = column.defaultVisible;
    return acc;
  }, {});
}

export default function Events() {
  const { locale } = useTranslation();
  const { devices } = useDevices();
  const { vehicles } = useVehicles();
  const { groups, loading: groupsLoading } = useTraccarGroups({ autoRefreshMs: 120_000 });

  const [activeTab, setActiveTab] = useState(EVENT_TABS[0]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedDeviceIds, setSelectedDeviceIds] = useState([]);
  const [eventType, setEventType] = useState("all");
  const [from, setFrom] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [columnsVisibility, setColumnsVisibility] = useState(buildInitialColumns);
  const [reportEvents, setReportEvents] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState(null);

  const [protocols, setProtocols] = useState([]);
  const [selectedProtocol, setSelectedProtocol] = useState("");
  const [protocolEvents, setProtocolEvents] = useState([]);
  const [eventSearch, setEventSearch] = useState("");
  const [severityMap, setSeverityMap] = useState({});
  const [severityLoading, setSeverityLoading] = useState(false);
  const [severityError, setSeverityError] = useState(null);
  const [savingSeverity, setSavingSeverity] = useState(false);

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

  const deviceOptions = useMemo(() => {
    return (Array.isArray(devices) ? devices : []).map((device) => {
      const id = toDeviceKey(device?.deviceId ?? device?.traccarId ?? device?.id ?? device?.uniqueId);
      const vehicle = id ? vehicleByDeviceId.get(String(id)) : null;
      return {
        id,
        name: vehicle ? formatVehicleLabel(vehicle) : device?.name || device?.uniqueId || id,
        groupId: device?.groupId ?? null,
      };
    });
  }, [devices, vehicleByDeviceId]);

  const filteredDeviceOptions = useMemo(() => {
    if (!selectedGroupId) return deviceOptions;
    return deviceOptions.filter((device) => String(device.groupId || "") === String(selectedGroupId));
  }, [deviceOptions, selectedGroupId]);

  useEffect(() => {
    if (!selectedGroupId) return;
    setSelectedDeviceIds((current) =>
      current.filter((deviceId) => filteredDeviceOptions.some((device) => String(device.id) === String(deviceId))),
    );
  }, [filteredDeviceOptions, selectedGroupId]);

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

  const fetchReport = useCallback(async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      const deviceIdsToQuery = selectedDeviceIds.length
        ? selectedDeviceIds
        : filteredDeviceOptions.map((device) => device.id).filter(Boolean);
      const params = {
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
        deviceIds: deviceIdsToQuery.length ? deviceIdsToQuery : undefined,
        type: eventType === "all" ? undefined : eventType,
        limit: 200,
      };

      const response = await api.get(API_ROUTES.events, { params });
      const list = Array.isArray(response?.data?.events)
        ? response.data.events
        : Array.isArray(response?.data?.data?.events)
        ? response.data.data.events
        : [];
      setReportEvents(list);
    } catch (error) {
      setReportError(error instanceof Error ? error : new Error("Erro ao carregar eventos"));
      setReportEvents([]);
    } finally {
      setReportLoading(false);
    }
  }, [eventType, filteredDeviceOptions, from, selectedDeviceIds, to]);

  useEffect(() => {
    if (activeTab !== "Criticidade" || !selectedProtocol) return;
    let mounted = true;
    async function loadProtocolEvents() {
      setSeverityLoading(true);
      setSeverityError(null);
      try {
        const [eventsResponse, severityResponse] = await Promise.all([
          api.get(API_ROUTES.protocolEvents(selectedProtocol)),
          api.get(API_ROUTES.protocolEventSeverity(selectedProtocol)),
        ]);
        const eventsList = Array.isArray(eventsResponse?.data?.events) ? eventsResponse.data.events : [];
        const savedSeverity = severityResponse?.data?.severity || {};
        if (mounted) {
          setProtocolEvents(eventsList);
          setSeverityMap(savedSeverity);
        }
      } catch (error) {
        if (mounted) {
          setSeverityError(error instanceof Error ? error : new Error("Erro ao carregar eventos do protocolo"));
          setProtocolEvents([]);
          setSeverityMap({});
        }
      } finally {
        if (mounted) setSeverityLoading(false);
      }
    }
    loadProtocolEvents();
    return () => {
      mounted = false;
    };
  }, [activeTab, selectedProtocol]);

  const reportRows = useMemo(() => {
    return reportEvents.map((event) => {
      const deviceId = toDeviceKey(event?.deviceId ?? event?.device?.id ?? event?.device);
      const vehicle = deviceId ? vehicleByDeviceId.get(String(deviceId)) : null;
      const position = event?.position || {};
      return {
        id: event?.id ?? `${event?.deviceId}-${event?.serverTime || event?.eventTime || event?.time}`,
        time: event?.serverTime || event?.deviceTime || event?.eventTime || event?.time,
        device: vehicle ? formatVehicleLabel(vehicle) : event?.device?.name || event?.deviceName || deviceId || "—",
        type: event?.type || event?.attributes?.type || event?.event,
        description: event?.attributes?.message || event?.attributes?.description || event?.attributes?.type || "—",
        address: event?.address || position?.address || event?.attributes?.address || null,
        speed: position?.speed ?? event?.speed ?? null,
        ignition: event?.ignition ?? position?.ignition ?? null,
        battery: event?.batteryLevel ?? position?.batteryLevel ?? null,
        latitude: event?.latitude ?? position?.latitude ?? null,
        longitude: event?.longitude ?? position?.longitude ?? null,
      };
    });
  }, [reportEvents, vehicleByDeviceId]);

  const visibleColumns = useMemo(
    () => DEFAULT_COLUMNS.filter((column) => columnsVisibility[column.id]),
    [columnsVisibility],
  );

  const filteredProtocolEvents = useMemo(() => {
    const term = eventSearch.trim().toLowerCase();
    if (!term) return protocolEvents;
    return protocolEvents.filter((event) => {
      return (
        event.id?.toLowerCase().includes(term) ||
        event.name?.toLowerCase().includes(term) ||
        event.description?.toLowerCase().includes(term)
      );
    });
  }, [eventSearch, protocolEvents]);

  const handleSeverityChange = (eventId, value) => {
    setSeverityMap((current) => ({
      ...current,
      [eventId]: {
        severity: value,
        active: current?.[eventId]?.active ?? true,
      },
    }));
  };

  const handleActiveChange = (eventId, value) => {
    setSeverityMap((current) => ({
      ...current,
      [eventId]: {
        severity: current?.[eventId]?.severity || "informativa",
        active: value,
      },
    }));
  };

  const handleSaveSeverity = async () => {
    if (!selectedProtocol) return;
    setSavingSeverity(true);
    setSeverityError(null);
    try {
      const updates = protocolEvents.map((event) => ({
        eventId: event.id,
        severity: severityMap?.[event.id]?.severity || "informativa",
        active: typeof severityMap?.[event.id]?.active === "boolean" ? severityMap[event.id].active : true,
      }));
      const response = await api.put(API_ROUTES.protocolEventSeverity(selectedProtocol), { updates });
      setSeverityMap(response?.data?.severity || severityMap);
    } catch (error) {
      setSeverityError(error instanceof Error ? error : new Error("Erro ao salvar criticidades"));
    } finally {
      setSavingSeverity(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">Central de eventos</p>
              <h2 className="text-lg font-semibold">Eventos</h2>
              <p className="text-xs text-white/60">Relatórios no estilo Traccar com criticidade por protocolo.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 border-b border-white/10 pb-2">
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
        </header>

        {activeTab === "Relatório" && (
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative">
                    <Button type="button" variant="secondary" onClick={() => setShowDevicePicker((open) => !open)}>
                      Dispositivos ({selectedDeviceIds.length || filteredDeviceOptions.length})
                    </Button>
                    {showDevicePicker && (
                      <div className="absolute z-20 mt-2 w-[280px] rounded-2xl border border-white/10 bg-neutral-900 p-3 shadow-xl">
                        <p className="text-xs uppercase tracking-wide text-white/50">Selecionar dispositivos</p>
                        <div className="mt-2 max-h-52 space-y-2 overflow-auto pr-1 text-sm">
                          {filteredDeviceOptions.map((device) => (
                            <label key={device.id} className="flex items-center gap-2 text-xs text-white/70">
                              <input
                                type="checkbox"
                                checked={selectedDeviceIds.includes(device.id)}
                                onChange={(event) => {
                                  setSelectedDeviceIds((current) => {
                                    if (event.target.checked) return [...current, device.id];
                                    return current.filter((id) => id !== device.id);
                                  });
                                }}
                                className="rounded border-white/20 bg-transparent"
                              />
                              <span>{device.name}</span>
                            </label>
                          ))}
                          {filteredDeviceOptions.length === 0 && (
                            <p className="text-xs text-white/50">Nenhum dispositivo no grupo selecionado.</p>
                          )}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            onClick={() => setSelectedDeviceIds(filteredDeviceOptions.map((device) => device.id))}
                          >
                            Selecionar todos
                          </Button>
                          <Button type="button" size="xs" variant="ghost" onClick={() => setSelectedDeviceIds([])}>
                            Limpar
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <label className="flex-1 text-xs uppercase tracking-wide text-white/60">
                    Grupo
                    <Select
                      value={selectedGroupId}
                      onChange={(event) => setSelectedGroupId(event.target.value)}
                      className="mt-2 w-full bg-layer text-sm"
                    >
                      <option value="">Todos os grupos</option>
                      {groups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </Select>
                    {groupsLoading && <span className="mt-1 block text-[11px] text-white/50">Carregando grupos…</span>}
                  </label>

                  <label className="flex-1 text-xs uppercase tracking-wide text-white/60">
                    Tipo de evento
                    <Select
                      value={eventType}
                      onChange={(event) => setEventType(event.target.value)}
                      className="mt-2 w-full bg-layer text-sm"
                    >
                      {EVENT_TYPES.map((option) => (
                        <option key={option} value={option}>
                          {option === "all" ? "Todos" : translateEventType(option, locale)}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-xs uppercase tracking-wide text-white/60">
                    De
                    <input
                      type="datetime-local"
                      value={from}
                      onChange={(event) => setFrom(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-border bg-layer px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-xs uppercase tracking-wide text-white/60">
                    Até
                    <input
                      type="datetime-local"
                      value={to}
                      onChange={(event) => setTo(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-border bg-layer px-3 py-2 text-sm"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" onClick={fetchReport}>
                    Mostrar
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setSelectedDeviceIds([])}>
                    Limpar filtros
                  </Button>
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wide text-white/50">Colunas</p>
                  <Button type="button" size="xs" variant="secondary" onClick={() => setShowColumns((open) => !open)}>
                    Editar
                  </Button>
                </div>
                {showColumns && (
                  <div className="space-y-2 text-xs text-white/70">
                    {DEFAULT_COLUMNS.map((column) => (
                      <label key={column.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={columnsVisibility[column.id]}
                          onChange={(event) =>
                            setColumnsVisibility((current) => ({
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
                )}
                {!showColumns && (
                  <p className="text-xs text-white/60">
                    {visibleColumns.map((column) => column.label).join(" · ")}
                  </p>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-white/50">
                  <tr>
                    {visibleColumns.map((column) => (
                      <th key={column.id} className="py-2 pr-6">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {reportLoading && (
                    <tr>
                      <td colSpan={visibleColumns.length} className="py-4 text-center text-sm text-white/60">
                        Carregando eventos…
                      </td>
                    </tr>
                  )}
                  {!reportLoading && reportError && (
                    <tr>
                      <td colSpan={visibleColumns.length} className="py-4 text-center text-sm text-red-300">
                        Não foi possível carregar os eventos. {reportError.message}
                      </td>
                    </tr>
                  )}
                  {!reportLoading && !reportError && reportRows.length === 0 && (
                    <tr>
                      <td colSpan={visibleColumns.length} className="py-4 text-center text-sm text-white/60">
                        Nenhum evento encontrado para o período selecionado.
                      </td>
                    </tr>
                  )}
                  {reportRows.map((row) => (
                    <tr key={row.id} className="hover:bg-white/5">
                      {visibleColumns.map((column) => (
                        <td key={column.id} className="py-2 pr-6 text-white/70">
                          {renderColumnValue(column.id, row, locale)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "Criticidade" && (
          <div className="space-y-4">
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

            {severityError && <p className="text-xs text-red-300">{severityError.message}</p>}

            {selectedProtocol && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-white/50">Eventos homologados</p>
                    <p className="text-xs text-white/60">
                      {severityLoading ? "Carregando catálogo…" : `${filteredProtocolEvents.length} eventos`}
                    </p>
                  </div>
                  <Button type="button" onClick={handleSaveSeverity} disabled={savingSeverity || severityLoading}>
                    {savingSeverity ? "Salvando…" : "Salvar criticidades"}
                  </Button>
                </div>

                <div className="mt-3 space-y-2">
                  {filteredProtocolEvents.map((event) => (
                    <div key={event.id} className="rounded-2xl border border-white/10 bg-neutral-900/60 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{event.name}</p>
                          <p className="text-xs text-white/60">{event.description}</p>
                          <p className="mt-1 text-[11px] text-white/40">Código: {event.id}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="text-[11px] uppercase tracking-wide text-white/60">
                            Criticidade
                            <Select
                              value={severityMap?.[event.id]?.severity || "informativa"}
                              onChange={(evt) => handleSeverityChange(event.id, evt.target.value)}
                              className="mt-2 w-36 bg-layer text-xs"
                            >
                              {SEVERITY_LEVELS.map((level) => (
                                <option key={level.value} value={level.value}>
                                  {level.label}
                                </option>
                              ))}
                            </Select>
                          </label>
                          <label className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-white/60">
                            <input
                              type="checkbox"
                              checked={severityMap?.[event.id]?.active ?? true}
                              onChange={(evt) => handleActiveChange(event.id, evt.target.checked)}
                              className="rounded border-white/20 bg-transparent"
                            />
                            Ativo
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!severityLoading && selectedProtocol && filteredProtocolEvents.length === 0 && (
                    <p className="text-xs text-white/60">Nenhum evento encontrado para o protocolo.</p>
                  )}
                </div>
              </div>
            )}

            {!selectedProtocol && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                Selecione um protocolo para visualizar a criticidade dos eventos.
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function renderColumnValue(columnId, row, locale) {
  switch (columnId) {
    case "time":
      return row.time ? new Date(row.time).toLocaleString() : "—";
    case "device":
      return row.device || "—";
    case "type":
      return translateEventType(row.type || "", locale) || "—";
    case "description":
      return row.description || "—";
    case "address":
      return row.address ? <AddressCell address={row.address} lat={row.latitude} lng={row.longitude} /> : "—";
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
