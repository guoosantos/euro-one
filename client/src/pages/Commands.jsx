import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Columns3 } from "lucide-react";

import Button from "../ui/Button.jsx";
import Input from "../ui/Input.jsx";
import Select from "../ui/Select.jsx";
import api from "../lib/api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import useVehicles, { formatVehicleLabel } from "../lib/hooks/useVehicles.js";

const COMMAND_TABS = ["Comandos", "Avançado"];
const HISTORY_COLUMNS = [
  { id: "dateTime", label: "Data/Hora", width: 170, minWidth: 150 },
  { id: "command", label: "Comando", width: 220, minWidth: 180 },
  { id: "status", label: "Status", width: 140, minWidth: 120 },
  { id: "result", label: "Resultado", width: 320, minWidth: 220 },
];
const COLUMN_WIDTHS_STORAGE_KEY = "commands:history:columns:widths:v2";
const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 800;
const PROTOCOL_OPTIONS = [
  { label: "Todos", value: "" },
  { label: "GT06", value: "gt06" },
  { label: "IOTM", value: "iotm" },
  { label: "Suntech", value: "suntech" },
];

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
  const [customCommands, setCustomCommands] = useState([]);
  const [customCommandsLoading, setCustomCommandsLoading] = useState(false);
  const [customCommandsError, setCustomCommandsError] = useState(null);
  const [editingCustomCommandId, setEditingCustomCommandId] = useState(null);
  const [savingCustomCommand, setSavingCustomCommand] = useState(false);
  const [deletingCustomCommandId, setDeletingCustomCommandId] = useState(null);
  const [expandedCommandId, setExpandedCommandId] = useState(null);
  const [commandParams, setCommandParams] = useState({});
  const [sendingCommandId, setSendingCommandId] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimeoutRef = useRef(null);
  const buildCustomForm = useCallback(
    (protocol = "") => ({
      name: "",
      description: "",
      protocol,
      kind: "SMS",
      visible: true,
      sms: { phone: "", message: "" },
      json: { type: "", attributes: "{\n  \n}" },
      raw: { data: "" },
    }),
    [],
  );
  const [customForm, setCustomForm] = useState(buildCustomForm);

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

  const mergedCommands = useMemo(() => {
    const protocolKey = device?.protocol ? String(device.protocol).toLowerCase() : null;
    const customVisible = customCommands
      .filter((command) => command?.visible)
      .filter((command) => {
        if (!command?.protocol) return true;
        if (!protocolKey) return false;
        return String(command.protocol).toLowerCase() === protocolKey;
      })
      .map((command) => ({
        ...command,
        kind: "custom",
        customKind: command.kind,
        parameters: [],
      }));
    const protocol = protocolCommands.map((command) => ({
      ...command,
      kind: "protocol",
    }));
    return [...protocol, ...customVisible];
  }, [customCommands, protocolCommands, device?.protocol]);

  const filteredCommands = useMemo(() => {
    const search = normalizeValue(commandSearch).toLowerCase();
    if (!search) return mergedCommands;
    return mergedCommands.filter((command) => {
      const name = normalizeValue(command?.name).toLowerCase();
      const description = normalizeValue(command?.description).toLowerCase();
      return name.includes(search) || description.includes(search);
    });
  }, [commandSearch, mergedCommands]);

  const resolveHistoryTimestamp = useCallback((item) => {
    if (!item) return null;
    if (item.status === "Respondido") return item.responseAt || item.sentAt;
    return item.sentAt || item.responseAt;
  }, []);

  const resolveDeviceFromVehicle = useCallback(async (vehicleId) => {
    const response = await api.get(API_ROUTES.core.vehicleTraccarDevice(vehicleId));
    const payload = response?.data;
    if (!payload || payload.ok === false || payload.error) {
      const error = new Error("Erro ao buscar device no Traccar");
      error.payload = payload;
      throw error;
    }
    return payload?.device || null;
  }, []);

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
      const traccarDevice = await resolveDeviceFromVehicle(selectedVehicleId);
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
      const isMissingDevice = error?.response?.status === 404;
      const isTraccarError =
        !isMissingDevice &&
        (error?.response?.data?.ok === false ||
          error?.response?.data?.error ||
          error?.message === "Erro ao buscar device no Traccar");
      const message = isMissingDevice
        ? "Veículo sem equipamento vinculado no Traccar"
        : isTraccarError
        ? "Erro ao buscar device no Traccar"
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

  const fetchCustomCommands = useCallback(
    async ({ includeHidden = false } = {}) => {
      setCustomCommandsLoading(true);
      setCustomCommandsError(null);
      try {
        const response = await api.get(API_ROUTES.commandsCustom, {
          params: includeHidden ? { includeHidden: true } : {},
        });
        const items = Array.isArray(response?.data?.data) ? response.data.data : [];
        setCustomCommands(items);
      } catch (error) {
        if (includeHidden && error?.response?.status === 403) {
          try {
            const response = await api.get(API_ROUTES.commandsCustom);
            const items = Array.isArray(response?.data?.data) ? response.data.data : [];
            setCustomCommands(items);
          } catch (fallbackError) {
            setCustomCommandsError(
              fallbackError instanceof Error ? fallbackError : new Error("Erro ao carregar comandos personalizados"),
            );
          }
        } else {
          setCustomCommandsError(error instanceof Error ? error : new Error("Erro ao carregar comandos personalizados"));
        }
      } finally {
        setCustomCommandsLoading(false);
      }
    },
    [],
  );

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
      const items = Array.isArray(response?.data?.data?.items) ? response.data.data.items : [];
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
    fetchCustomCommands({ includeHidden: activeTab === "Avançado" }).catch(() => {});
  }, [activeTab, fetchCustomCommands]);

  useEffect(() => {
    fetchHistory().catch(() => {});
  }, [fetchHistory]);

  useEffect(() => {
    if (editingCustomCommandId) return;
    if (!device?.protocol) return;
    setCustomForm((current) => {
      if (current.protocol) return current;
      return { ...current, protocol: device.protocol };
    });
  }, [device?.protocol, editingCustomCommandId]);

  const handleSendCommand = async (command) => {
    const commandKey = getCommandKey(command);
    if (!selectedVehicleId || !commandKey) {
      showToast("Selecione um veículo válido", "error");
      return;
    }

    setSendingCommandId(commandKey);
    try {
      if (command.kind === "custom") {
        await api.post(API_ROUTES.commandsSend, {
          vehicleId: selectedVehicleId,
          customCommandId: command.id,
        });
      } else {
        if (!device?.protocol) {
          showToast("Veículo sem protocolo válido", "error");
          return;
        }
        await api.post(API_ROUTES.commandsSend, {
          vehicleId: selectedVehicleId,
          protocol: device.protocol,
          commandKey,
          commandName: command.name || commandKey,
          params: commandParams[commandKey] || {},
        });
      }
      showToast("Comando enviado com sucesso.");
      setExpandedCommandId(null);
      await fetchHistory();
    } catch (error) {
      showToast(error?.response?.data?.message || error?.message || "Erro ao enviar comando", "error");
    } finally {
      setSendingCommandId(null);
    }
  };

  const resetCustomForm = useCallback(() => {
    setCustomForm(buildCustomForm(device?.protocol || ""));
    setEditingCustomCommandId(null);
  }, [buildCustomForm, device?.protocol]);

  const handleCustomFormChange = (field, value) => {
    setCustomForm((current) => ({ ...current, [field]: value }));
  };

  const handleCustomPayloadChange = (section, field, value) => {
    setCustomForm((current) => ({
      ...current,
      [section]: {
        ...(current?.[section] || {}),
        [field]: value,
      },
    }));
  };

  const handleEditCustomCommand = (command) => {
    setEditingCustomCommandId(command.id);
    setCustomForm({
      name: command.name || "",
      description: command.description || "",
      protocol: command.protocol || "",
      kind: command.kind || "SMS",
      visible: Boolean(command.visible),
      sms: {
        phone: command.payload?.phone || "",
        message: command.payload?.message || "",
      },
      json: {
        type: command.payload?.type || "",
        attributes: JSON.stringify(command.payload?.attributes || {}, null, 2),
      },
      raw: {
        data: command.payload?.data || "",
      },
    });
  };

  const handleSaveCustomCommand = async () => {
    if (!customForm.name.trim()) {
      showToast("Informe o nome do comando.", "error");
      return;
    }

    const payload = {};
    if (customForm.kind === "SMS") {
      payload.phone = customForm.sms.phone.trim();
      payload.message = customForm.sms.message.trim();
      if (!payload.phone || !payload.message) {
        showToast("Informe telefone e mensagem para o SMS.", "error");
        return;
      }
    } else if (customForm.kind === "JSON") {
      const type = customForm.json.type.trim();
      if (!type) {
        showToast("Informe o type do comando JSON.", "error");
        return;
      }
      let attributes = {};
      if (customForm.json.attributes.trim()) {
        try {
          attributes = JSON.parse(customForm.json.attributes);
        } catch (error) {
          showToast("JSON inválido em attributes.", "error");
          return;
        }
      }
      payload.type = type;
      payload.attributes = attributes;
    } else if (customForm.kind === "RAW") {
      payload.data = customForm.raw.data;
      if (!String(payload.data || "").trim()) {
        showToast("Informe o conteúdo RAW.", "error");
        return;
      }
    }

    setSavingCustomCommand(true);
    try {
      const body = {
        name: customForm.name.trim(),
        description: customForm.description.trim() || null,
        protocol: customForm.protocol ? customForm.protocol.trim() : null,
        kind: customForm.kind,
        visible: customForm.visible,
        payload,
      };

      if (editingCustomCommandId) {
        await api.put(`${API_ROUTES.commandsCustom}/${editingCustomCommandId}`, body);
        showToast("Comando personalizado atualizado.");
      } else {
        await api.post(API_ROUTES.commandsCustom, body);
        showToast("Comando personalizado criado.");
      }
      await fetchCustomCommands({ includeHidden: true });
      resetCustomForm();
    } catch (error) {
      showToast(error?.response?.data?.message || error?.message || "Erro ao salvar comando", "error");
    } finally {
      setSavingCustomCommand(false);
    }
  };

  const handleDeleteCustomCommand = async (commandId) => {
    const confirmed = window.confirm("Deseja remover este comando personalizado?");
    if (!confirmed) return;
    setDeletingCustomCommandId(commandId);
    try {
      await api.delete(`${API_ROUTES.commandsCustom}/${commandId}`);
      showToast("Comando personalizado removido.");
      await fetchCustomCommands({ includeHidden: true });
      if (editingCustomCommandId === commandId) {
        resetCustomForm();
      }
    } catch (error) {
      showToast(error?.response?.data?.message || error?.message || "Erro ao remover comando", "error");
    } finally {
      setDeletingCustomCommandId(null);
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
    fetchCustomCommands({ includeHidden: activeTab === "Avançado" }).catch(() => {});
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
          {activeTab === "Comandos" && (
            <>
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
                  {!deviceLoading &&
                    !deviceError &&
                    !commandsLoading &&
                    !commandsError &&
                    filteredCommands.length === 0 && (
                      <p className="text-sm text-white/60">Nenhum comando encontrado.</p>
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
                              {command.kind === "custom" && (
                                <p className="mt-1 text-[11px] uppercase tracking-wide text-primary/80">
                                  Personalizado · {command.customKind || "Custom"}
                                </p>
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
                                  (param.defaultValue !== undefined && param.defaultValue !== null
                                    ? param.defaultValue
                                    : "");
                                const type = param.type === "number" ? "number" : "text";
                                const options = Array.isArray(param.options) ? param.options : null;
                                return (
                                  <label
                                    key={param.key}
                                    htmlFor={inputId}
                                    className="flex flex-col text-xs uppercase tracking-wide text-white/60"
                                  >
                                    {param.label || param.key}
                                    {options ? (
                                      <Select
                                        id={inputId}
                                        value={value}
                                        onChange={(event) => handleUpdateParam(commandKey, param.key, event.target.value)}
                                        className="mt-2 w-full bg-layer text-sm"
                                      >
                                        {options.map((option) => (
                                          <option key={option.value ?? option} value={option.value ?? option}>
                                            {option.label ?? option.value ?? option}
                                          </option>
                                        ))}
                                      </Select>
                                    ) : (
                                      <Input
                                        id={inputId}
                                        type={type}
                                        value={value}
                                        min={param.min}
                                        max={param.max}
                                        step={param.step}
                                        onChange={(event) => handleUpdateParam(commandKey, param.key, event.target.value)}
                                        className="mt-2"
                                      />
                                    )}
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
            </>
          )}

          {activeTab === "Avançado" && (
            <div className="mx-6 flex flex-col gap-6 rounded-2xl border border-white/10 bg-[#0b0f17] p-6">
              <div className="space-y-3">
                <p className="text-sm font-semibold text-white/90">Comandos personalizados</p>
                <p className="text-xs text-white/60">
                  Crie comandos SMS, JSON ou RAW, defina o protocolo e controle onde eles aparecem na aba Comandos.
                </p>
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.6fr)]">
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
                      Nome
                      <Input
                        value={customForm.name}
                        onChange={(event) => handleCustomFormChange("name", event.target.value)}
                        className="mt-2"
                      />
                    </label>
                    <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
                      Protocolo
                      <Select
                        value={customForm.protocol}
                        onChange={(event) => handleCustomFormChange("protocol", event.target.value)}
                        className="mt-2 w-full bg-layer text-sm"
                      >
                        {PROTOCOL_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
                      Tipo
                      <Select
                        value={customForm.kind}
                        onChange={(event) => handleCustomFormChange("kind", event.target.value)}
                        className="mt-2 w-full bg-layer text-sm"
                      >
                        <option value="SMS">SMS</option>
                        <option value="JSON">JSON</option>
                        <option value="RAW">RAW</option>
                      </Select>
                    </label>
                    <label className="flex flex-col text-xs uppercase tracking-wide text-white/60 md:col-span-2">
                      Descrição (opcional)
                      <Input
                        value={customForm.description}
                        onChange={(event) => handleCustomFormChange("description", event.target.value)}
                        className="mt-2"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-white/60">
                      <input
                        type="checkbox"
                        checked={customForm.visible}
                        onChange={(event) => handleCustomFormChange("visible", event.target.checked)}
                        className="h-4 w-4 rounded border-white/20 bg-transparent"
                      />
                      Visível em Comandos
                    </label>
                  </div>

                  {customForm.kind === "SMS" && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
                        Telefone
                        <Input
                          value={customForm.sms.phone}
                          onChange={(event) => handleCustomPayloadChange("sms", "phone", event.target.value)}
                          className="mt-2"
                        />
                      </label>
                      <label className="flex flex-col text-xs uppercase tracking-wide text-white/60 md:col-span-2">
                        Mensagem
                        <Input
                          value={customForm.sms.message}
                          onChange={(event) => handleCustomPayloadChange("sms", "message", event.target.value)}
                          className="mt-2"
                        />
                      </label>
                    </div>
                  )}

                  {customForm.kind === "JSON" && (
                    <div className="grid gap-3">
                      <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
                        Type
                        <Input
                          value={customForm.json.type}
                          onChange={(event) => handleCustomPayloadChange("json", "type", event.target.value)}
                          className="mt-2"
                        />
                      </label>
                      <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
                        Attributes (JSON)
                        <textarea
                          value={customForm.json.attributes}
                          onChange={(event) => handleCustomPayloadChange("json", "attributes", event.target.value)}
                          rows={6}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/80"
                        />
                      </label>
                    </div>
                  )}

                  {customForm.kind === "RAW" && (
                    <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
                      Conteúdo RAW
                      <textarea
                        value={customForm.raw.data}
                        onChange={(event) => handleCustomPayloadChange("raw", "data", event.target.value)}
                        rows={4}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/80"
                      />
                    </label>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={handleSaveCustomCommand} disabled={savingCustomCommand}>
                      {savingCustomCommand ? "Salvando…" : editingCustomCommandId ? "Atualizar" : "Criar"}
                    </Button>
                    <Button type="button" variant="outline" onClick={resetCustomForm}>
                      Limpar
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-wide text-white/60">Comandos cadastrados</p>
                  {customCommandsLoading && <p className="text-sm text-white/60">Carregando comandos…</p>}
                  {customCommandsError && <p className="text-sm text-red-300">{customCommandsError.message}</p>}
                  {!customCommandsLoading && !customCommandsError && customCommands.length === 0 && (
                    <p className="text-sm text-white/60">Nenhum comando personalizado cadastrado.</p>
                  )}
                  <div className="space-y-2">
                    {customCommands.map((command) => (
                      <div key={command.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-white/90">{command.name}</p>
                            <p className="text-[11px] uppercase tracking-wide text-primary/70">
                              {command.kind}
                              {command.protocol ? ` · ${String(command.protocol).toUpperCase()}` : ""}
                              {" · "}
                              {command.visible ? "Visível" : "Oculto"}
                            </p>
                            {command.description && (
                              <p className="mt-1 text-xs text-white/60">{command.description}</p>
                            )}
                          </div>
                          <div className="flex flex-col gap-2">
                            <Button type="button" variant="outline" onClick={() => handleEditCustomCommand(command)}>
                              Editar
                            </Button>
                            <Button
                              type="button"
                              variant="danger"
                              onClick={() => handleDeleteCustomCommand(command.id)}
                              disabled={deletingCustomCommandId === command.id}
                            >
                              {deletingCustomCommandId === command.id ? "Removendo…" : "Excluir"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
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
                  const commandLabel = item?.commandName || "—";
                  const statusLabel = item?.status || "Enviado";
                  const resultText = item?.result || "—";
                  const dateValue = resolveHistoryTimestamp(item);
                  return (
                    <tr key={item.requestId || `${dateValue}-${commandLabel}`} className="hover:bg-white/5">
                      <td
                        style={getWidthStyle("dateTime")}
                        className="border-r border-white/5 px-3 py-2 text-[11px] text-white/80"
                      >
                        {formatDateTime(dateValue)}
                      </td>
                      <td style={getWidthStyle("command")} className="border-r border-white/5 px-3 py-2 text-[11px] text-white/80">
                        {commandLabel}
                      </td>
                      <td style={getWidthStyle("status")} className="border-r border-white/5 px-3 py-2 text-[11px] text-white/80">
                        {statusLabel}
                      </td>
                      <td style={getWidthStyle("result")} className="border-r border-white/5 px-3 py-2 text-[11px] text-white/80">
                        {resultText}
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
