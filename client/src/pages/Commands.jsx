import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Columns3 } from "lucide-react";

import Button from "../ui/Button.jsx";
import Input from "../ui/Input.jsx";
import Select from "../ui/Select.jsx";
import api from "../lib/api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import useVehicles, { formatVehicleLabel } from "../lib/hooks/useVehicles.js";

const COMMAND_TABS = ["Comandos", "Avançado", "SMS", "JSON"];
const HISTORY_COLUMNS = [
  { id: "device", label: "Dispositivo (Placa)", width: 220, minWidth: 180 },
  { id: "command", label: "Comando", width: 200, minWidth: 160 },
  { id: "sentAt", label: "Enviado em", width: 160, minWidth: 140 },
  { id: "status", label: "Status", width: 120, minWidth: 100 },
  { id: "response", label: "Resposta", width: 280, minWidth: 200 },
  { id: "protocol", label: "Protocolo", width: 140, minWidth: 120 },
  { id: "json", label: "JSON", width: 120, minWidth: 100 },
];
const COLUMN_WIDTHS_STORAGE_KEY = "commands:history:columns:widths:v1";
const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 800;

const normalizeValue = (value) => String(value ?? "");

const getCommandKey = (command) => command?.code || command?.id || "";

const formatDateTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function Commands() {
  const { vehicles, loading: vehiclesLoading } = useVehicles();
  const [activeTab, setActiveTab] = useState(COMMAND_TABS[0]);
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [commandSearch, setCommandSearch] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [device, setDevice] = useState(null);
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [deviceError, setDeviceError] = useState(null);
  const [protocolCommands, setProtocolCommands] = useState([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [commandsError, setCommandsError] = useState(null);
  const [expandedCommandId, setExpandedCommandId] = useState(null);
  const [commandParams, setCommandParams] = useState({});
  const [sendingCommandId, setSendingCommandId] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimeoutRef = useRef(null);

  const [columnWidths, setColumnWidths] = useState(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_error) {
      return {};
    }
  });
  const latestWidthsRef = useRef(columnWidths);

  useEffect(() => {
    latestWidthsRef.current = columnWidths;
  }, [columnWidths]);

  useEffect(() => () => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
  }, []);

  const showToast = useCallback((message, type = "success") => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const vehicleOptions = useMemo(() => {
    const search = normalizeValue(vehicleSearch).toLowerCase();
    return vehicles
      .map((vehicle) => ({
        id: String(vehicle.id),
        label: formatVehicleLabel(vehicle),
        plate: normalizeValue(vehicle.plate).toLowerCase(),
        name: normalizeValue(vehicle.name).toLowerCase(),
      }))
      .filter((vehicle) => {
        if (!search) return true;
        return (
          vehicle.label.toLowerCase().includes(search) ||
          vehicle.plate.includes(search) ||
          vehicle.name.includes(search)
        );
      });
  }, [vehicleSearch, vehicles]);

  const filteredCommands = useMemo(() => {
    const search = normalizeValue(commandSearch).toLowerCase();
    if (!search) return protocolCommands;
    return protocolCommands.filter((command) => {
      const name = normalizeValue(command?.name).toLowerCase();
      const description = normalizeValue(command?.description).toLowerCase();
      return name.includes(search) || description.includes(search);
    });
  }, [commandSearch, protocolCommands]);

  const vehiclesById = useMemo(() => {
    const map = new Map();
    vehicles.forEach((vehicle) => {
      map.set(String(vehicle.id), vehicle);
    });
    return map;
  }, [vehicles]);

  const fetchDevice = useCallback(async () => {
    if (!selectedVehicleId) {
      setDevice(null);
      setDeviceError(null);
      setProtocolCommands([]);
      setCommandsError(null);
      setExpandedCommandId(null);
      setCommandParams({});
      return;
    }
    setDeviceLoading(true);
    setDeviceError(null);
    setProtocolCommands([]);
    setCommandsError(null);
    setExpandedCommandId(null);
    setCommandParams({});
    try {
      const response = await api.get(API_ROUTES.core.vehicleTraccarDevice(selectedVehicleId));
      const traccarDevice = response?.data?.traccarDevice || null;
      if (!traccarDevice) {
        setDevice(null);
        setDeviceError("Veículo sem equipamento vinculado no Traccar");
        return;
      }
      if (!traccarDevice.protocol) {
        setDevice(null);
        setDeviceError("Device sem protocol no Traccar (dados inconsistentes)");
        return;
      }
      setDevice(traccarDevice);
    } catch (error) {
      const message =
        error?.response?.status === 404
          ? "Veículo sem equipamento vinculado no Traccar"
          : error?.message || "Erro ao carregar device";
      setDevice(null);
      setDeviceError(message);
    } finally {
      setDeviceLoading(false);
    }
  }, [selectedVehicleId]);

  const fetchCommands = useCallback(async () => {
    if (!device?.protocol) {
      setProtocolCommands([]);
      return;
    }
    setCommandsLoading(true);
    setCommandsError(null);
    try {
      const response = await api.get(API_ROUTES.protocolCommands(device.protocol));
      const commands = Array.isArray(response?.data?.commands) ? response.data.commands : [];
      setProtocolCommands(commands);
    } catch (error) {
      setCommandsError(error instanceof Error ? error : new Error("Erro ao carregar comandos"));
    } finally {
      setCommandsLoading(false);
    }
  }, [device?.protocol]);

  const fetchHistory = useCallback(async () => {
    if (!selectedVehicleId) {
      setHistory([]);
      setHistoryError(null);
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await api.get(API_ROUTES.commandsHistory, { params: { vehicleId: selectedVehicleId } });
      const items = Array.isArray(response?.data?.history)
        ? response.data.history
        : Array.isArray(response?.data)
        ? response.data
        : [];
      setHistory(items);
    } catch (error) {
      setHistoryError(error instanceof Error ? error : new Error("Erro ao carregar histórico"));
    } finally {
      setHistoryLoading(false);
    }
  }, [selectedVehicleId]);

  useEffect(() => {
    fetchDevice().catch(() => {});
  }, [fetchDevice]);

  useEffect(() => {
    fetchCommands().catch(() => {});
  }, [fetchCommands]);

  useEffect(() => {
    fetchHistory().catch(() => {});
  }, [fetchHistory]);

  const handleSendCommand = async (command) => {
    const commandKey = getCommandKey(command);
    if (!selectedVehicleId || !device?.protocol || !commandKey) {
      showToast("Selecione um veículo com protocolo válido", "error");
      return;
    }

    setSendingCommandId(commandKey);
    try {
      await api.post(API_ROUTES.commandsSend, {
        vehicleId: selectedVehicleId,
        traccarDeviceId: device.traccarDeviceId || device.id,
        protocol: device.protocol,
        commandKey,
        params: commandParams[commandKey] || {},
      });
      showToast("Comando enviado com sucesso.");
      setExpandedCommandId(null);
      const response = await api.get(API_ROUTES.commandsHistory, { params: { vehicleId: selectedVehicleId } });
      const items = Array.isArray(response?.data?.history)
        ? response.data.history
        : Array.isArray(response?.data)
        ? response.data
        : [];
      setHistory(items);
    } catch (error) {
      showToast(error?.response?.data?.message || error?.message || "Erro ao enviar comando", "error");
    } finally {
      setSendingCommandId(null);
    }
  };

  const handleUpdateParam = (commandId, key, value) => {
    setCommandParams((current) => ({
      ...current,
      [commandId]: {
        ...current?.[commandId],
        [key]: value,
      },
    }));
  };

  const handleClearFilters = () => {
    setVehicleSearch("");
    setCommandSearch("");
    setSelectedVehicleId("");
  };

  const handleShow = () => {
    fetchDevice().catch(() => {});
    fetchHistory().catch(() => {});
    fetchCommands().catch(() => {});
  };

  const resizeStateRef = useRef(null);

  const startResize = useCallback(
    (columnId, event) => {
      event.preventDefault();
      const column = HISTORY_COLUMNS.find((item) => item.id === columnId);
      if (!column) return;
      const startX = event.clientX;
      const startWidth = columnWidths[columnId] || column.width;
      resizeStateRef.current = { columnId, startX, startWidth };

      const handleMove = (moveEvent) => {
        if (!resizeStateRef.current) return;
        const delta = moveEvent.clientX - resizeStateRef.current.startX;
        const nextWidth = Math.min(
          MAX_COLUMN_WIDTH,
          Math.max(MIN_COLUMN_WIDTH, resizeStateRef.current.startWidth + delta),
        );
        setColumnWidths((current) => ({ ...current, [columnId]: nextWidth }));
      };

      const handleUp = () => {
        resizeStateRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
        try {
          window.localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(latestWidthsRef.current));
        } catch (_error) {
          // ignore
        }
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [columnWidths],
  );

  const getWidthStyle = (columnId) => {
    const column = HISTORY_COLUMNS.find((item) => item.id === columnId);
    if (!column) return undefined;
    const width = columnWidths[columnId] || column.width;
    return { width: `${width}px`, minWidth: `${column.minWidth || width}px` };
  };

  const toastClassName =
    toast?.type === "error"
      ? "bg-red-500/20 text-red-200 border-red-500/30"
      : toast?.type === "warning"
      ? "bg-amber-500/20 text-amber-100 border-amber-400/30"
      : "bg-emerald-500/20 text-emerald-200 border-emerald-500/30";

  return (
    <div className="flex min-h-[calc(100vh-180px)] w-full flex-col gap-6">
      <section className="card flex min-h-0 flex-1 flex-col gap-4 p-0">
        <header className="space-y-2 px-6 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">Central de comandos</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div className="flex flex-wrap gap-2">
              {COMMAND_TABS.map((tab) => (
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
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button type="button" onClick={handleShow}>
                Mostrar
              </Button>
              <Button type="button" variant="outline" onClick={handleClearFilters}>
                Limpar filtros
              </Button>
              <button
                type="button"
                className="rounded-xl border border-white/10 p-2 text-white/70 transition hover:text-white"
                aria-label="Colunas"
              >
                <Columns3 size={18} />
              </button>
            </div>
          </div>
        </header>

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
                <option value="">Selecione</option>
                {vehicleOptions.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex min-w-[200px] flex-1 flex-col text-xs uppercase tracking-wide text-white/60">
              Buscar comando
              <Input
                value={commandSearch}
                onChange={(event) => setCommandSearch(event.target.value)}
                placeholder="Digite o nome do comando"
                className="mt-2"
              />
            </label>
            <label className="flex min-w-[200px] flex-1 flex-col text-xs uppercase tracking-wide text-white/60">
              Protocolo
              <Input value={device?.protocol || ""} readOnly className="mt-2" />
            </label>
            {vehiclesLoading && <span className="text-xs text-white/50">Carregando veículos…</span>}
          </div>

          {!selectedVehicleId && (
            <div className="mx-6 flex min-h-[160px] items-center justify-center rounded-2xl border border-white/10 bg-[#0b0f17] text-sm text-white/60">
              Selecione um veículo
            </div>
          )}

          {selectedVehicleId && (
            <div className="mx-6 flex min-h-[200px] flex-col gap-3 rounded-2xl border border-white/10 bg-[#0b0f17] p-4">
              {deviceLoading && <p className="text-sm text-white/60">Carregando dispositivo do Traccar…</p>}
              {deviceError && <p className="text-sm text-red-300">{deviceError}</p>}
              {!deviceLoading && !deviceError && commandsLoading && (
                <p className="text-sm text-white/60">Carregando comandos…</p>
              )}
              {!deviceLoading && !deviceError && commandsError && (
                <p className="text-sm text-red-300">{commandsError.message}</p>
              )}
              {!deviceLoading && !deviceError && !commandsLoading && !commandsError && filteredCommands.length === 0 && (
                <p className="text-sm text-white/60">Nenhum comando encontrado para este protocolo.</p>
              )}
              {!deviceLoading &&
                !deviceError &&
                !commandsLoading &&
                !commandsError &&
                filteredCommands.map((command) => {
                  const commandKey = getCommandKey(command);
                  const hasParams = Array.isArray(command.parameters) && command.parameters.length > 0;
                  const isExpanded = expandedCommandId === commandKey;
                  const paramValues = commandParams[commandKey] || {};
                  return (
                    <div key={commandKey || command.name} className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white/90">{command.name || commandKey}</p>
                          {command.description && (
                            <p className="mt-1 text-xs text-white/60">{command.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {hasParams ? (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() =>
                                setExpandedCommandId((current) => (current === commandKey ? null : commandKey))
                              }
                            >
                              {isExpanded ? "Fechar" : "Configurar"}
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            onClick={() => handleSendCommand(command)}
                            disabled={sendingCommandId === commandKey}
                          >
                            {sendingCommandId === commandKey ? "Enviando…" : "Enviar"}
                          </Button>
                        </div>
                      </div>
                      {hasParams && isExpanded && (
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          {command.parameters.map((param) => {
                            const inputId = `${commandKey}-${param.key}`;
                            const value =
                              paramValues[param.key] ??
                              (param.defaultValue !== undefined && param.defaultValue !== null ? param.defaultValue : "");
                            const type = param.type === "number" ? "number" : "text";
                            return (
                              <label
                                key={param.key}
                                htmlFor={inputId}
                                className="flex flex-col text-xs uppercase tracking-wide text-white/60"
                              >
                                {param.label || param.key}
                                <Input
                                  id={inputId}
                                  type={type}
                                  value={value}
                                  min={param.min}
                                  max={param.max}
                                  onChange={(event) => handleUpdateParam(commandKey, param.key, event.target.value)}
                                  className="mt-2"
                                />
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </section>

      <section className="card flex min-h-0 flex-col gap-4 p-0">
        <header className="space-y-2 px-6 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">Histórico de comandos</p>
            </div>
          </div>
        </header>

        <div className="mx-6 mb-6 min-h-0 flex-1 overflow-auto rounded-2xl border border-white/10 bg-[#0b0f17]">
          <table className="w-full min-w-full table-fixed border-collapse text-left text-sm" style={{ tableLayout: "fixed" }}>
            <colgroup>
              {HISTORY_COLUMNS.map((column) => (
                <col key={column.id} style={getWidthStyle(column.id)} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10 border-b border-white/10 bg-[#0f141c] text-left text-[11px] uppercase tracking-[0.12em] text-white/60 shadow-sm">
              <tr>
                {HISTORY_COLUMNS.map((column) => (
                  <th
                    key={column.id}
                    style={getWidthStyle(column.id)}
                    className="relative border-r border-white/5 px-3 py-2 font-semibold last:border-r-0"
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
              {historyLoading && (
                <tr>
                  <td colSpan={HISTORY_COLUMNS.length} className="px-3 py-4 text-center text-sm text-white/60">
                    Carregando histórico…
                  </td>
                </tr>
              )}
              {!historyLoading && historyError && (
                <tr>
                  <td colSpan={HISTORY_COLUMNS.length} className="px-3 py-4 text-center text-sm text-red-300">
                    Não foi possível carregar o histórico. {historyError.message}
                  </td>
                </tr>
              )}
              {!historyLoading && !historyError && history.length === 0 && (
                <tr>
                  <td colSpan={HISTORY_COLUMNS.length} className="px-3 py-4 text-center text-sm text-white/60">
                    Nenhum comando encontrado.
                  </td>
                </tr>
              )}
              {!historyLoading &&
                !historyError &&
                history.map((item) => {
                  const vehicle = vehiclesById.get(String(item?.vehicleId || item?.vehicle?.id || ""));
                  const deviceLabel = item?.vehiclePlate || vehicle?.plate || item?.deviceName || item?.deviceId || "—";
                  const commandLabel = item?.commandName || item?.command || item?.type || "—";
                  return (
                    <tr key={item.id || `${item?.deviceId}-${item?.sentAt}` || Math.random()} className="hover:bg-white/5">
                      <td style={getWidthStyle("device")} className="border-r border-white/5 px-3 py-2 text-[11px] text-white/80">
                        {deviceLabel}
                      </td>
                      <td style={getWidthStyle("command")} className="border-r border-white/5 px-3 py-2 text-[11px] text-white/80">
                        {commandLabel}
                      </td>
                      <td style={getWidthStyle("sentAt")} className="border-r border-white/5 px-3 py-2 text-[11px] text-white/80">
                        {formatDateTime(item?.sentAt || item?.createdAt || item?.time)}
                      </td>
                      <td style={getWidthStyle("status")} className="border-r border-white/5 px-3 py-2 text-[11px] text-white/80">
                        {item?.status || item?.state || "—"}
                      </td>
                      <td style={getWidthStyle("response")} className="border-r border-white/5 px-3 py-2 text-[11px] text-white/80">
                        {item?.response || item?.result || item?.message || "—"}
                      </td>
                      <td style={getWidthStyle("protocol")} className="border-r border-white/5 px-3 py-2 text-[11px] text-white/80">
                        {item?.protocol || device?.protocol || "—"}
                      </td>
                      <td style={getWidthStyle("json")} className="border-r border-white/5 px-3 py-2 text-[11px] text-white/80">
                        {item?.payload || item?.attributes ? (
                          <details className="cursor-pointer">
                            <summary className="text-primary/80">Ver</summary>
                            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] text-white/70">
                              {JSON.stringify(item?.payload || item?.attributes, null, 2)}
                            </pre>
                          </details>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl border px-4 py-3 text-sm shadow-lg ${toastClassName}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
