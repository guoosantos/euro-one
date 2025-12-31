import React, { useEffect, useMemo, useRef, useState } from "react";
import { Columns3 } from "lucide-react";

import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import useDevices from "../lib/hooks/useDevices";
import useVehicles from "../lib/hooks/useVehicles";
import api from "../lib/api.js";
import { API_ROUTES } from "../lib/api-routes.js";

const COMMAND_TABS = ["Comandos", "Avançado", "SMS", "JSON"];
const STORAGE_KEY = "protocol-templates-v1";
const COLUMNS_STORAGE_KEY = "commands:columns:v1";
const COLUMN_WIDTHS_STORAGE_KEY = "commands:columns:widths:v1";
const MIN_COLUMN_WIDTH = 60;
const MAX_COLUMN_WIDTH = 800;
const DEFAULT_MIN_WIDTH = 60;
const DEFAULT_COLUMN_WIDTH = 140;

const COMMAND_COLUMNS = [
  { id: "device", label: "Dispositivo (Placa)", defaultVisible: true, width: 180, minWidth: 160 },
  { id: "command", label: "Comando", defaultVisible: true, width: 200, minWidth: 180 },
  { id: "description", label: "Descrição", defaultVisible: true, width: 260, minWidth: 200 },
  { id: "action", label: "Ação", defaultVisible: true, width: 140, minWidth: 120 },
  { id: "protocol", label: "Protocolo", defaultVisible: false, width: 140, minWidth: 120 },
  { id: "json", label: "JSON", defaultVisible: false, width: 240, minWidth: 200 },
];

const HISTORY_COLUMNS = [
  { id: "device", label: "Dispositivo (Placa)", width: 220 },
  { id: "command", label: "Comando", width: 200 },
  { id: "sentAt", label: "Enviado em", width: 140 },
  { id: "status", label: "Status", width: 90 },
  { id: "response", label: "Resposta", width: 260 },
  { id: "protocol", label: "Protocolo", width: 120 },
  { id: "payload", label: "JSON completo", width: 260 },
];

function normalizeProtocol(value) {
  return String(value || "").trim().toLowerCase();
}

function createLocalId(prefix) {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadTemplates() {
  if (typeof window === "undefined") return { sms: {}, json: {} };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { sms: {}, json: {} };
    const parsed = JSON.parse(raw);
    return {
      sms: parsed?.sms && typeof parsed.sms === "object" ? parsed.sms : {},
      json: parsed?.json && typeof parsed.json === "object" ? parsed.json : {},
    };
  } catch (_error) {
    return { sms: {}, json: {} };
  }
}

function buildInitialCommandColumns() {
  return COMMAND_COLUMNS.reduce((acc, column) => {
    acc[column.id] = column.defaultVisible;
    return acc;
  }, {});
}

export default function Commands() {
  const { vehicles, loading: vehiclesLoading, error: vehiclesError } = useVehicles();
  const { devices: deviceList } = useDevices();
  const devices = useMemo(() => (Array.isArray(deviceList) ? deviceList : []), [deviceList]);
  const commandsCacheRef = useRef(new Map());

  const [activeTab, setActiveTab] = useState(COMMAND_TABS[0]);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [protocols, setProtocols] = useState([]);
  const [protocolsLoading, setProtocolsLoading] = useState(false);
  const [protocolError, setProtocolError] = useState(null);
  const [protocolCommands, setProtocolCommands] = useState([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [commandsError, setCommandsError] = useState(null);
  const [commandSearch, setCommandSearch] = useState("");
  const [selectedCommandId, setSelectedCommandId] = useState("");
  const [commandParams, setCommandParams] = useState({});
  const [commandsRefreshKey, setCommandsRefreshKey] = useState(0);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [historyFrom] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  const [historyTo] = useState(() => new Date().toISOString());
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formErrorContext, setFormErrorContext] = useState(null);
  const [formSuccess, setFormSuccess] = useState(null);
  const [formSuccessContext, setFormSuccessContext] = useState(null);
  const [manualType, setManualType] = useState("custom");
  const [manualPayload, setManualPayload] = useState("");
  const [manualChannel, setManualChannel] = useState("");
  const [templatesByProtocol, setTemplatesByProtocol] = useState(loadTemplates);
  const [smsDraft, setSmsDraft] = useState({ id: null, name: "", content: "", variables: "" });
  const [smsPhone, setSmsPhone] = useState("");
  const [smsStatus, setSmsStatus] = useState(null);
  const [jsonDraft, setJsonDraft] = useState({ id: null, name: "", payload: "", description: "" });
  const [copiedId, setCopiedId] = useState(null);
  const [showColumns, setShowColumns] = useState(false);
  const [columnsVisibility, setColumnsVisibility] = useState(() => {
    try {
      const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
      if (!raw) return buildInitialCommandColumns();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return buildInitialCommandColumns();
      const defaults = buildInitialCommandColumns();
      return { ...defaults, ...parsed };
    } catch (_error) {
      return buildInitialCommandColumns();
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
  const liveWidthsRef = useRef(columnWidths);

  const vehicleOptions = useMemo(
    () =>
      vehicles.map((vehicle) => ({
        id: vehicle.id,
        label: vehicle.plate || "Placa não informada",
        deviceId: vehicle.primaryDeviceId,
      })),
    [vehicles],
  );

  const protocolLabelById = useMemo(() => {
    return new Map(protocols.map((protocol) => [normalizeProtocol(protocol.id), protocol.label]));
  }, [protocols]);

  const protocolIdByKey = useMemo(() => {
    return new Map(protocols.map((protocol) => [normalizeProtocol(protocol.id), protocol.id]));
  }, [protocols]);

  const getVehicleProtocolKey = (vehicle) => {
    if (!vehicle) return "";
    const rawProtocol =
      vehicle?.primaryDevice?.protocol ||
      vehicle?.primaryDevice?.attributes?.protocol ||
      vehicle?.primaryDevice?.modelProtocol ||
      vehicle?.protocol ||
      vehicle?.attributes?.protocol ||
      "";
    return normalizeProtocol(rawProtocol);
  };

  const formatProtocolLabel = (protocolKeyValue) => {
    if (!protocolKeyValue) return "—";
    return protocolLabelById.get(protocolKeyValue) || protocolKeyValue.toUpperCase();
  };

  const filteredVehicleOptions = useMemo(() => {
    const term = vehicleSearch.trim().toLowerCase();
    if (!term) return vehicleOptions;
    return vehicleOptions.filter(
      (vehicle) =>
        vehicle.label?.toLowerCase().includes(term) ||
        String(vehicle.id).toLowerCase().includes(term),
    );
  }, [vehicleOptions, vehicleSearch]);

  const vehicleSearchResults = useMemo(() => {
    if (!vehicleSearch.trim()) return [];
    const term = vehicleSearch.trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      const plate = vehicle?.plate || "";
      const name = vehicle?.name || "";
      return plate.toLowerCase().includes(term) || name.toLowerCase().includes(term);
    });
  }, [vehicleSearch, vehicles]);

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => String(vehicle.id) === String(selectedVehicleId)) || null,
    [selectedVehicleId, vehicles],
  );
  const selectedDeviceId = selectedVehicle?.primaryDeviceId || "";
  const list = Array.isArray(history) ? history : [];
  const selectedDevice = useMemo(() => {
    if (!selectedDeviceId) return null;
    return (
      devices.find(
        (device) => String(device.deviceId ?? device.traccarId ?? device.id) === String(selectedDeviceId),
      ) || null
    );
  }, [devices, selectedDeviceId]);
  const rawProtocol = useMemo(() => {
    return (
      selectedDevice?.protocol ||
      selectedDevice?.attributes?.protocol ||
      selectedDevice?.modelProtocol ||
      selectedVehicle?.primaryDevice?.protocol ||
      selectedVehicle?.primaryDevice?.attributes?.protocol ||
      selectedVehicle?.primaryDevice?.modelProtocol ||
      selectedVehicle?.protocol ||
      selectedVehicle?.attributes?.protocol ||
      selectedVehicle?.primaryDevice?.protocol ||
      ""
    );
  }, [selectedDevice, selectedVehicle, selectedVehicleId]);
  const protocolKey = useMemo(() => normalizeProtocol(rawProtocol), [rawProtocol]);
  const protocolId = useMemo(() => protocolIdByKey.get(protocolKey) || rawProtocol, [protocolIdByKey, protocolKey, rawProtocol]);
  const protocolLabel = formatProtocolLabel(protocolKey);

  const selectedCommand = useMemo(
    () => protocolCommands.find((command) => command.id === selectedCommandId) || null,
    [protocolCommands, selectedCommandId],
  );
  const matchesCommandSearch = useMemo(() => {
    const term = commandSearch.trim().toLowerCase();
    if (!term) return () => true;
    return (command) =>
      command.name?.toLowerCase().includes(term) ||
      command.description?.toLowerCase().includes(term) ||
      command.tags?.some((tag) => String(tag).toLowerCase().includes(term));
  }, [commandSearch]);
  const filteredCommands = useMemo(() => {
    return protocolCommands.filter(matchesCommandSearch);
  }, [matchesCommandSearch, protocolCommands]);

  const jsonDraftValidation = useMemo(() => {
    if (!jsonDraft.payload.trim()) {
      return { valid: true, error: null };
    }
    try {
      JSON.parse(jsonDraft.payload);
      return { valid: true, error: null };
    } catch (_error) {
      return { valid: false, error: "JSON inválido" };
    }
  }, [jsonDraft.payload]);

  const smsDraftValidation = useMemo(() => {
    if (!smsDraft.name.trim() || !smsDraft.content.trim()) {
      return { valid: false, error: "Informe nome amigável e conteúdo do SMS." };
    }
    if (!smsPhone.trim()) {
      return { valid: false, error: "Informe o telefone para envio do SMS." };
    }
    return { valid: true, error: null };
  }, [smsDraft.content, smsDraft.name, smsPhone]);

  const vehicleByDeviceId = useMemo(() => {
    const map = new Map();
    vehicles.forEach((vehicle) => {
      if (!vehicle.primaryDeviceId) return;
      map.set(String(vehicle.primaryDeviceId), vehicle);
    });
    return map;
  }, [vehicles]);

  const visibleCommandColumns = useMemo(
    () => COMMAND_COLUMNS.filter((column) => columnsVisibility[column.id]),
    [columnsVisibility],
  );
  const commandColumnLookup = useMemo(
    () =>
      COMMAND_COLUMNS.reduce((acc, column) => {
        acc[column.id] = column;
        return acc;
      }, {}),
    [],
  );

  const getColumnMinWidth = (columnId) => {
    const columnConfig = commandColumnLookup[columnId];
    const declaredMin = Number.isFinite(columnConfig?.minWidth) ? columnConfig.minWidth : DEFAULT_MIN_WIDTH;
    return Math.max(MIN_COLUMN_WIDTH, declaredMin);
  };

  const getDefaultWidth = (columnId) => {
    const columnConfig = commandColumnLookup[columnId];
    const declaredWidth = Number.isFinite(columnConfig?.width) && columnConfig.width > 0
      ? columnConfig.width
      : DEFAULT_COLUMN_WIDTH;
    return declaredWidth;
  };

  const getAppliedWidth = (columnId) => {
    const minWidth = getColumnMinWidth(columnId);
    const storedWidth = columnWidths[columnId];
    const declaredWidth = getDefaultWidth(columnId);
    const chosenWidth = Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : declaredWidth;
    return Math.max(minWidth, Math.min(chosenWidth, MAX_COLUMN_WIDTH));
  };

  const getWidthStyle = (columnId) => {
    const minWidth = getColumnMinWidth(columnId);
    const width = getAppliedWidth(columnId);
    return { width, minWidth, maxWidth: MAX_COLUMN_WIDTH };
  };

  const handleColumnResizeEnd = (columnId, nextWidth) => {
    const minWidth = getColumnMinWidth(columnId);
    const clampedWidth = Math.max(minWidth, Math.min(nextWidth, MAX_COLUMN_WIDTH));
    setColumnWidths((prev) => {
      const updated = { ...prev, [columnId]: clampedWidth };
      try {
        localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(updated));
      } catch (_error) {
        // ignore storage failures
      }
      return updated;
    });
  };

  const startResize = (columnId, event) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidthRaw = event.currentTarget.parentElement?.getBoundingClientRect().width;
    const minWidth = getColumnMinWidth(columnId);
    const startWidth = Number.isFinite(startWidthRaw) && startWidthRaw > 0
      ? startWidthRaw
      : getAppliedWidth(columnId);
    const safeStartWidth = Math.max(minWidth, Math.min(startWidth, MAX_COLUMN_WIDTH));

    const handleMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const unclamped = Math.round(safeStartWidth + delta);
      const safeWidth = Number.isFinite(unclamped) ? unclamped : minWidth;
      const clampedWidth = Math.max(minWidth, Math.min(safeWidth, MAX_COLUMN_WIDTH));

      setColumnWidths((prev) => {
        if (prev[columnId] === clampedWidth) return prev;
        const updated = { ...prev, [columnId]: clampedWidth };
        liveWidthsRef.current = updated;
        return updated;
      });
    };

    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      const storedWidth = liveWidthsRef.current?.[columnId];
      const safeStored = Number.isFinite(storedWidth) ? storedWidth : minWidth;
      handleColumnResizeEnd(columnId, safeStored);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const commandParamsValidation = useMemo(() => {
    if (!selectedCommand?.parameters?.length) {
      return { valid: true, missing: [] };
    }
    const missing = selectedCommand.parameters
      .filter((param) => param.required)
      .filter((param) => {
        const value = commandParams[param.key];
        return value === "" || value === undefined || value === null;
      })
      .map((param) => param.label || param.key);
    return { valid: missing.length === 0, missing };
  }, [commandParams, selectedCommand]);

  const manualCommandValidation = useMemo(() => {
    const type = manualType.trim();
    if (!type) {
      return { valid: false, error: "Informe o tipo do comando." };
    }
    return { valid: true, error: null };
  }, [manualType]);

  useEffect(() => {
    setColumnsDraft(columnsVisibility);
  }, [columnsVisibility]);

  useEffect(() => {
    liveWidthsRef.current = columnWidths;
  }, [columnWidths]);

  useEffect(() => {
    let mounted = true;
    async function loadProtocols() {
      setProtocolsLoading(true);
      setProtocolError(null);
      try {
        const response = await api.get(API_ROUTES.protocols);
        const list = Array.isArray(response?.data?.protocols) ? response.data.protocols : [];
        if (mounted) {
          setProtocols(list);
        }
      } catch (requestError) {
        if (mounted) {
          setProtocolError(requestError instanceof Error ? requestError : new Error("Erro ao carregar protocolos"));
        }
      } finally {
        if (mounted) {
          setProtocolsLoading(false);
        }
      }
    }
    loadProtocols();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setSelectedCommandId("");
    setCommandParams({});
  }, [protocolId]);

  useEffect(() => {
    let mounted = true;
    async function loadCommands() {
      if (!selectedVehicleId || !protocolId) {
        setProtocolCommands([]);
        setCommandsError(null);
        return;
      }
      const cacheKey = protocolId;
      if (commandsCacheRef.current.has(cacheKey) && commandsRefreshKey === 0) {
        setProtocolCommands(commandsCacheRef.current.get(cacheKey));
        setCommandsError(null);
        return;
      }
      setCommandsLoading(true);
      setCommandsError(null);
      try {
        const response = await api.get(API_ROUTES.protocolCommands(protocolId));
        const responseList = Array.isArray(response?.data?.commands) ? response.data.commands : [];
        commandsCacheRef.current.set(cacheKey, responseList);
        if (mounted) {
          setProtocolCommands(responseList);
        }
      } catch (requestError) {
        if (mounted) {
          setCommandsError(requestError instanceof Error ? requestError : new Error("Erro ao carregar comandos"));
          setProtocolCommands([]);
        }
      } finally {
        if (mounted) {
          setCommandsLoading(false);
        }
      }
    }
    loadCommands();
    return () => {
      mounted = false;
    };
  }, [commandsRefreshKey, protocolId, selectedVehicleId]);

  useEffect(() => {
    let mounted = true;
    async function loadHistory() {
      if (!selectedDeviceId) {
        setHistory([]);
        setHistoryError(null);
        return;
      }
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const response = await api.get(API_ROUTES.commands, {
          params: { deviceId: selectedDeviceId, from: historyFrom, to: historyTo },
        });
        const entries = Array.isArray(response?.data?.commands)
          ? response.data.commands
          : Array.isArray(response?.data)
            ? response.data
            : [];
        if (mounted) {
          setHistory(entries);
        }
      } catch (requestError) {
        if (mounted) {
          setHistoryError(requestError instanceof Error ? requestError : new Error("Erro ao carregar histórico"));
          setHistory([]);
        }
      } finally {
        if (mounted) {
          setHistoryLoading(false);
        }
      }
    }
    loadHistory();
    return () => {
      mounted = false;
    };
  }, [historyFrom, historyRefreshKey, historyTo, selectedDeviceId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templatesByProtocol));
  }, [templatesByProtocol]);

  useEffect(() => {
    if (activeTab !== "SMS") return;
    setSmsStatus(null);
  }, [activeTab, selectedVehicleId]);

  function handleSelectCommand(command) {
    setSelectedCommandId(command.id);
    const defaults = (command.parameters || []).reduce((acc, param) => {
      acc[param.key] = param.defaultValue ?? "";
      return acc;
    }, {});
    setCommandParams(defaults);
  }

  function updateTemplate(kind, updater) {
    setTemplatesByProtocol((current) => {
      const protocolTemplates = current?.[kind] || {};
      const currentList = Array.isArray(protocolTemplates[protocolKey]) ? protocolTemplates[protocolKey] : [];
      const nextList = updater(currentList);
      return {
        ...current,
        [kind]: {
          ...protocolTemplates,
          [protocolKey]: nextList,
        },
      };
    });
  }

  async function handleSendCommand(payload, { context } = {}) {
    setFormError(null);
    setFormErrorContext(context || null);
    setFormSuccess(null);
    setFormSuccessContext(null);
    if (!selectedDeviceId) {
      setFormError(new Error("Selecione um veículo com equipamento vinculado."));
      return;
    }
    const commandType = String(payload?.command || "").trim();
    if (!commandType) {
      setFormError(new Error("Informe o tipo do comando."));
      return;
    }
    const isSmsContext = context === "sms";
    if (isSmsContext) {
      setSmsStatus({ state: "pending", message: "Enviando SMS..." });
    }
    setSending(true);
    try {
      const response = await api.post(API_ROUTES.commands, {
        deviceId: selectedDeviceId,
        type: commandType,
        attributes: payload?.params && Object.keys(payload.params).length ? payload.params : undefined,
      });
      setHistoryRefreshKey((value) => value + 1);
      const successMessage =
        response?.data?.message || "Comando enviado com sucesso.";
      setFormSuccess({ message: successMessage });
      setFormSuccessContext(context || null);
      if (isSmsContext) {
        setSmsStatus({ state: "success", message: successMessage });
      }
    } catch (requestError) {
      const message =
        requestError?.response?.data?.message ||
        requestError?.message ||
        "Não foi possível enviar o comando. Verifique os dados e tente novamente.";
      const errorMessage = `Erro ao enviar comando: ${message}`;
      setFormError(new Error(errorMessage));
      if (isSmsContext) {
        setSmsStatus({ state: "error", message: errorMessage });
      }
    } finally {
      setSending(false);
    }
  }

  const handleSaveColumns = () => {
    setColumnsVisibility(columnsDraft);
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(columnsDraft));
    } catch (_error) {
      // ignore storage failures
    }
    setShowColumns(false);
  };

  const handleClearFilters = () => {
    setSelectedVehicleId("");
    setVehicleSearch("");
    setCommandSearch("");
  };

  const handleRefreshHistory = () => {
    if (protocolKey) {
      commandsCacheRef.current.delete(protocolKey);
    }
    setCommandsRefreshKey((value) => value + 1);
    setHistoryRefreshKey((value) => value + 1);
  };

  async function handleSendSelectedCommand() {
    if (!selectedCommand) {
      setFormError(new Error("Selecione um comando para enviar."));
      setFormErrorContext("selected");
      return;
    }
    if (!commandParamsValidation.valid) {
      setFormError(new Error("Preencha todos os parâmetros obrigatórios antes de enviar."));
      setFormErrorContext("selected");
      return;
    }
    const params = (selectedCommand.parameters || []).reduce((acc, param) => {
      const value = commandParams[param.key];
      if (value === "" || value === undefined || value === null) return acc;
      if (param.type === "number") {
        const numericValue = Number(value);
        acc[param.key] = Number.isNaN(numericValue) ? value : numericValue;
        return acc;
      }
      acc[param.key] = value;
      return acc;
    }, {});
    await handleSendCommand({ command: selectedCommand.type || selectedCommand.id, params }, { context: "selected" });
  }

  function handleSaveSmsTemplate(event) {
    event.preventDefault();
    if (!protocolKey) return;
    const payload = {
      id: smsDraft.id || createLocalId("sms"),
      name: smsDraft.name.trim(),
      content: smsDraft.content.trim(),
      variables: smsDraft.variables.trim(),
    };
    if (!payload.name || !payload.content) {
      setFormError(new Error("Informe o nome e o conteúdo do SMS."));
      return;
    }
    updateTemplate("sms", (list) => {
      const filtered = list.filter((item) => item.id !== payload.id);
      return [...filtered, payload];
    });
    setSmsDraft({ id: null, name: "", content: "", variables: "" });
  }

  function handleSaveJsonTemplate(event) {
    event.preventDefault();
    if (!protocolKey) return;
    if (!jsonDraftValidation.valid) {
      setFormError(new Error("Corrija o JSON antes de salvar."));
      return;
    }
    const payload = {
      id: jsonDraft.id || createLocalId("json"),
      name: jsonDraft.name.trim(),
      payload: jsonDraft.payload.trim(),
      description: jsonDraft.description.trim(),
    };
    if (!payload.name || !payload.payload) {
      setFormError(new Error("Informe o nome e o JSON do template."));
      return;
    }
    updateTemplate("json", (list) => {
      const filtered = list.filter((item) => item.id !== payload.id);
      return [...filtered, payload];
    });
    setJsonDraft({ id: null, name: "", payload: "", description: "" });
  }

  async function handleCopy(content, templateId) {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(templateId);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (_error) {
      setCopiedId(null);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-180px)] w-full flex-col gap-6">
      <section className="card flex min-h-0 flex-1 flex-col gap-4 p-0">
        <header className="space-y-2 px-6 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.2em] text-white/50">Central de comandos</p>
          </div>
          <div className="flex flex-nowrap items-center justify-between gap-3 overflow-x-auto border-b border-white/10 pb-4">
            <div className="flex flex-nowrap gap-2">
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
            <div className="flex flex-nowrap items-center justify-end gap-2 whitespace-nowrap">
              <Button type="button" onClick={handleRefreshHistory}>
                Mostrar
              </Button>
              <Button type="button" variant="outline" onClick={handleClearFilters}>
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
                  <div className="absolute right-0 top-12 z-20 w-52 rounded-xl border border-white/10 bg-[#0f141c] p-3 text-xs text-white/70 shadow-xl">
                    <p className="mb-2 text-[11px] uppercase tracking-wide text-white/50">Colunas</p>
                    <div className="space-y-2">
                      {COMMAND_COLUMNS.map((column) => (
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
          </div>
          {protocolError && <p className="text-xs text-red-300">{protocolError.message}</p>}
          {vehiclesLoading && <p className="text-xs text-white/50">Carregando veículos…</p>}
          {vehiclesError && <p className="text-xs text-red-300">{vehiclesError.message}</p>}
          {selectedVehicle && !selectedDeviceId && (
            <p className="text-xs text-amber-200/80">Veículo sem equipamento vinculado.</p>
          )}
        </header>

        <div className="space-y-4 px-6 pb-6">
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
            <label className="flex min-w-[220px] flex-1 flex-col text-xs uppercase tracking-wide text-white/60">
              Buscar veículo
              <Input
                value={vehicleSearch}
                onChange={(event) => setVehicleSearch(event.target.value)}
                placeholder="Digite placa ou nome"
                className="mt-2"
              />
            </label>
            <label className="flex min-w-[220px] flex-1 flex-col text-xs uppercase tracking-wide text-white/60">
              Veículo
              <Select
                value={selectedVehicleId}
                onChange={(event) => setSelectedVehicleId(event.target.value)}
                className="mt-2 w-full bg-layer text-sm"
              >
                <option value="">Selecione uma placa</option>
                {filteredVehicleOptions.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex min-w-[220px] flex-1 flex-col text-xs uppercase tracking-wide text-white/60">
              Buscar comando
              <Input
                value={commandSearch}
                onChange={(event) => setCommandSearch(event.target.value)}
                placeholder="Buscar comando"
                className="mt-2"
              />
            </label>
            <div className="flex flex-nowrap items-center gap-2">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-wide text-white/60">
                Protocolo: {protocolLabel}
              </span>
              {protocolsLoading && <span className="text-xs text-white/50">Carregando protocolos…</span>}
            </div>
          </div>

          {vehicleSearch.trim() && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {vehicleSearchResults.length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                  Nenhum veículo encontrado.
                </div>
              )}
              {vehicleSearchResults.map((vehicle) => {
                const vehicleProtocolKey = getVehicleProtocolKey(vehicle);
                return (
                  <div
                    key={vehicle.id}
                    className="flex flex-col justify-between gap-3 rounded-2xl border border-white/10 bg-[#0b0f17] p-4"
                  >
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-white">{vehicle.plate || "Placa não informada"}</div>
                      {vehicle.name && <div className="text-xs text-white/60">{vehicle.name}</div>}
                      <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-wide text-white/60">
                        {formatProtocolLabel(vehicleProtocolKey)}
                      </span>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="xs"
                        onClick={() => {
                          setSelectedVehicleId(vehicle.id);
                          setVehicleSearch("");
                        }}
                      >
                        Selecionar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === "Comandos" && (
            <div className="space-y-4">
              {!selectedVehicleId && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                  Selecione um veículo para visualizar comandos disponíveis.
                </div>
              )}
              {selectedVehicleId && (
                <div className="space-y-4">
                  {!protocolKey && (
                    <div className="rounded-xl border border-amber-300/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                      Protocolo não identificado para este veículo.
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs uppercase tracking-wide text-white/50">
                    <span>Comandos homologados</span>
                    <span>{filteredCommands.length} itens</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full w-full table-fixed text-sm">
                      <colgroup>
                        {visibleCommandColumns.map((column) => (
                          <col key={column.id} style={{ width: getAppliedWidth(column.id) }} />
                        ))}
                      </colgroup>
                      <thead className="text-left text-xs uppercase tracking-wide text-white/50">
                        <tr>
                          {visibleCommandColumns.map((column) => (
                            <th
                              key={column.id}
                              style={getWidthStyle(column.id)}
                              className="relative py-2 pr-6"
                            >
                              <div className="flex items-center justify-between gap-2 pr-2">
                                <span className="truncate" title={column.label}>
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
                      <tbody className="divide-y divide-border/40">
                        {commandsLoading && (
                          <tr>
                            <td colSpan={visibleCommandColumns.length} className="py-4 text-center text-sm text-white/60">
                              Carregando comandos…
                            </td>
                          </tr>
                        )}
                        {commandsError && (
                          <tr>
                            <td colSpan={visibleCommandColumns.length} className="py-4 text-center text-sm text-red-300">
                              {commandsError.message}
                            </td>
                          </tr>
                        )}
                        {!commandsLoading && filteredCommands.length === 0 && (
                          <tr>
                            <td colSpan={visibleCommandColumns.length} className="py-4 text-center text-sm text-white/60">
                              Nenhum comando cadastrado para o protocolo {protocolLabel}. Verifique o cadastro de comandos.
                            </td>
                          </tr>
                        )}
                        {filteredCommands.map((command) => (
                          <tr key={command.id} className="hover:bg-white/5">
                            {visibleCommandColumns.map((column) => {
                              switch (column.id) {
                                case "device":
                                  return (
                                    <td key={column.id} className="py-2 pr-6 text-white/70">
                                      {selectedVehicle?.plate || selectedVehicle?.name || "—"}
                                    </td>
                                  );
                                case "command":
                                  return (
                                    <td key={column.id} className="py-2 pr-6 text-white/80">
                                      <div className="text-sm font-semibold text-white">{command.name}</div>
                                      {command.tags?.length ? (
                                        <div className="mt-1 flex flex-wrap gap-2">
                                          {command.tags.map((tag) => (
                                            <span
                                              key={tag}
                                              className="rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/60"
                                            >
                                              {tag}
                                            </span>
                                          ))}
                                        </div>
                                      ) : null}
                                    </td>
                                  );
                                case "description":
                                  return (
                                    <td key={column.id} className="py-2 pr-6 text-white/60">
                                      {command.description}
                                    </td>
                                  );
                                case "action":
                                  return (
                                    <td key={column.id} className="py-2 pr-6">
                                      {command.parameters?.length ? (
                                        <Button
                                          size="xs"
                                          variant="secondary"
                                          onClick={() => handleSelectCommand(command)}
                                        >
                                          Configurar
                                        </Button>
                                      ) : (
                                        <Button
                                          size="xs"
                                          onClick={() =>
                                            handleSendCommand(
                                              { command: command.type || command.id },
                                              { context: "quick" },
                                            )
                                          }
                                          disabled={sending}
                                        >
                                          {sending ? "Enviando…" : "Enviar"}
                                        </Button>
                                      )}
                                    </td>
                                  );
                                case "protocol":
                                  return (
                                    <td key={column.id} className="py-2 pr-6 text-white/60">
                                      {protocolLabel}
                                    </td>
                                  );
                                case "json":
                                  return (
                                    <td key={column.id} className="py-2 pr-6 text-white/60">
                                      {formatCommandTemplatePayload(command)}
                                    </td>
                                  );
                                default:
                                  return (
                                    <td key={column.id} className="py-2 pr-6 text-white/60">
                                      —
                                    </td>
                                  );
                              }
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                    <div className="flex items-center justify-between text-xs uppercase tracking-wide text-white/50">
                      <span>Parâmetros do comando</span>
                      <span>{selectedCommand ? selectedCommand.type : "Selecione um comando"}</span>
                    </div>
                    {!selectedCommand && (
                      <p className="mt-3 text-xs text-white/60">Selecione um comando para configurar.</p>
                    )}
                    {selectedCommand && (
                      <div className="mt-3 space-y-3">
                        <div>
                          <div className="text-sm font-semibold text-white">{selectedCommand.name}</div>
                          <p className="text-xs text-white/60">{selectedCommand.description}</p>
                        </div>
                        {selectedCommand.parameters?.length ? (
                          <div className="grid gap-3 md:grid-cols-2">
                            {selectedCommand.parameters.map((param) => (
                              <label key={param.key} className="text-xs uppercase tracking-wide text-white/60">
                                {param.label}
                                {param.key === "index" ? (
                                  <Select
                                    value={commandParams[param.key] ?? ""}
                                    onChange={(event) =>
                                      setCommandParams((prev) => ({ ...prev, [param.key]: event.target.value }))
                                    }
                                    className="mt-1 w-full bg-layer text-sm"
                                  >
                                    <option value="">Selecione</option>
                                    {[1, 2, 3, 4].map((value) => (
                                      <option key={value} value={value}>
                                        Saída {value}
                                      </option>
                                    ))}
                                  </Select>
                                ) : (
                                  <input
                                    type={param.type === "number" ? "number" : "text"}
                                    min={param.min}
                                    max={param.max}
                                    value={commandParams[param.key] ?? ""}
                                    onChange={(event) =>
                                      setCommandParams((prev) => ({ ...prev, [param.key]: event.target.value }))
                                    }
                                    className="mt-1 w-full rounded-xl border border-border bg-layer px-3 py-2 text-sm"
                                    required={param.required}
                                  />
                                )}
                              </label>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-white/50">Nenhum parâmetro adicional necessário.</p>
                        )}
                        <Button
                          type="button"
                          onClick={handleSendSelectedCommand}
                          disabled={sending || !commandParamsValidation.valid}
                        >
                          {sending ? "Enviando…" : "Enviar comando"}
                        </Button>
                        {formSuccess && formSuccessContext === "selected" && (
                          <p className="text-xs text-emerald-200">{formSuccess.message}</p>
                        )}
                        {formError && formErrorContext === "selected" && (
                          <p className="text-xs text-red-300">{formError.message}</p>
                        )}
                        {!commandParamsValidation.valid && (
                          <p className="text-xs text-amber-200/80">
                            Preencha: {commandParamsValidation.missing.join(", ")}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "Avançado" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-xs text-amber-100">
              Use com cuidado: comandos avançados podem causar comportamento inesperado no dispositivo.
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <label className="space-y-2 text-sm">
                <span className="text-xs uppercase tracking-wide text-white/60">Tipo do comando</span>
                <Input value={manualType} onChange={(event) => setManualType(event.target.value)} placeholder="custom" />
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-xs uppercase tracking-wide text-white/60">Canal (opcional)</span>
                <Input value={manualChannel} onChange={(event) => setManualChannel(event.target.value)} placeholder="sms" />
              </label>
            </div>
            <label className="space-y-2 text-sm">
              <span className="text-xs uppercase tracking-wide text-white/60">Payload (raw)</span>
              <textarea
                value={manualPayload}
                onChange={(event) => setManualPayload(event.target.value)}
                rows={4}
                className="w-full rounded-xl border border-border bg-layer px-3 py-2 text-sm"
                placeholder="Ex: 123456,000000,15"
              />
            </label>
            <Button
              type="button"
              onClick={() =>
                handleSendCommand(
                  {
                    command: manualType.trim(),
                    params: {
                      payload: manualPayload.trim(),
                      channel: manualChannel.trim() || undefined,
                    },
                  },
                  { context: "advanced" },
                )
              }
              disabled={sending || !manualCommandValidation.valid}
            >
              {sending ? "Enviando…" : "Enviar comando avançado"}
            </Button>
            {formSuccess && formSuccessContext === "advanced" && (
              <p className="text-xs text-emerald-200">{formSuccess.message}</p>
            )}
            {formError && formErrorContext === "advanced" && (
              <p className="text-xs text-red-300">{formError.message}</p>
            )}
            {!manualCommandValidation.valid && (
              <p className="text-xs text-amber-200/80">{manualCommandValidation.error}</p>
            )}
          </div>
        )}

          {activeTab === "SMS" && (
          <div className="space-y-4">
            {!protocolKey && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                Selecione um protocolo para gerenciar templates de SMS.
              </div>
            )}
            {protocolKey && (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs uppercase tracking-wide text-white/50">
                    <span>Templates SMS</span>
                    <span>{(templatesByProtocol.sms?.[protocolKey] || []).length} itens</span>
                  </div>
                  <div className="space-y-2">
                    {(templatesByProtocol.sms?.[protocolKey] || []).map((template) => (
                      <div key={template.id} className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-white">{template.name}</p>
                            <p className="text-xs text-white/60">{template.content}</p>
                            {template.variables && (
                              <p className="mt-1 text-[11px] text-white/40">Variáveis: {template.variables}</p>
                            )}
                          </div>
                          <div className="flex flex-col gap-2">
                            <Button
                              size="xs"
                              variant="secondary"
                              onClick={() => setSmsDraft(template)}
                            >
                              Editar
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() =>
                                updateTemplate("sms", (list) => list.filter((item) => item.id !== template.id))
                              }
                            >
                              Excluir
                            </Button>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => handleCopy(template.content, template.id)}
                          >
                            {copiedId === template.id ? "Copiado" : "Copiar SMS"}
                          </Button>
                        </div>
                      </div>
                    ))}
                    {(templatesByProtocol.sms?.[protocolKey] || []).length === 0 && (
                      <p className="text-xs text-white/60">Nenhum template cadastrado.</p>
                    )}
                  </div>
                </div>

                <form onSubmit={handleSaveSmsTemplate} className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-white/50">
                    {smsDraft.id ? "Editar template" : "Novo template"}
                  </p>
                  <label className="space-y-2 text-sm">
                    <span className="text-xs uppercase tracking-wide text-white/60">Nome amigável</span>
                    <Input
                      value={smsDraft.name}
                      onChange={(event) => setSmsDraft((prev) => ({ ...prev, name: event.target.value }))}
                      placeholder="Bloquear motor SMS"
                      className="map-compact-input"
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="text-xs uppercase tracking-wide text-white/60">Conteúdo do SMS</span>
                    <textarea
                      value={smsDraft.content}
                      onChange={(event) => setSmsDraft((prev) => ({ ...prev, content: event.target.value }))}
                      rows={4}
                      className="w-full rounded-xl border border-border bg-layer px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="text-xs uppercase tracking-wide text-white/60">Telefone para envio</span>
                    <Input
                      value={smsPhone}
                      onChange={(event) => setSmsPhone(event.target.value)}
                      placeholder="+55 11 99999-0000"
                      className="map-compact-input"
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="text-xs uppercase tracking-wide text-white/60">Variáveis (opcional)</span>
                    <Input
                      value={smsDraft.variables}
                      onChange={(event) => setSmsDraft((prev) => ({ ...prev, variables: event.target.value }))}
                      placeholder="{password}, {interval}"
                      className="map-compact-input"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit">Salvar template</Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!smsDraftValidation.valid || sending}
                      onClick={() =>
                        handleSendCommand(
                          {
                            command: "sendSms",
                            params: {
                              phone: smsPhone.trim(),
                              message: smsDraft.content.trim(),
                            },
                          },
                          { context: "sms" },
                        )
                      }
                    >
                      {sending ? "Enviando…" : "Enviar SMS"}
                    </Button>
                    {smsDraft.id && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setSmsDraft({ id: null, name: "", content: "", variables: "" })}
                      >
                        Cancelar
                      </Button>
                    )}
                  </div>
                  {!smsDraftValidation.valid && (
                    <p className="text-xs text-amber-200/80">{smsDraftValidation.error}</p>
                  )}
                  {smsStatus?.state === "pending" && (
                    <p className="text-xs text-white/70">Pendente: {smsStatus.message}</p>
                  )}
                  {smsStatus?.state === "success" && (
                    <p className="text-xs text-emerald-200">Enviado: {smsStatus.message}</p>
                  )}
                  {smsStatus?.state === "error" && (
                    <p className="text-xs text-red-300">Erro: {smsStatus.message}</p>
                  )}
                  {formSuccess && formSuccessContext === "sms" && (
                    <p className="text-xs text-emerald-200">{formSuccess.message}</p>
                  )}
                  {formError && formErrorContext === "sms" && (
                    <p className="text-xs text-red-300">{formError.message}</p>
                  )}
                </form>
              </div>
            )}
          </div>
        )}

          {activeTab === "JSON" && (
          <div className="space-y-4">
            {!protocolKey && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                Selecione um protocolo para gerenciar templates JSON.
              </div>
            )}
            {protocolKey && (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs uppercase tracking-wide text-white/50">
                    <span>Templates JSON</span>
                    <span>{(templatesByProtocol.json?.[protocolKey] || []).length} itens</span>
                  </div>
                  <div className="space-y-2">
                    {(templatesByProtocol.json?.[protocolKey] || []).map((template) => (
                      <div key={template.id} className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-white">{template.name}</p>
                            <p className="text-xs text-white/60">{template.description || "Sem descrição"}</p>
                          </div>
                          <div className="flex flex-col gap-2">
                            <Button size="xs" variant="secondary" onClick={() => setJsonDraft(template)}>
                              Editar
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() =>
                                updateTemplate("json", (list) => list.filter((item) => item.id !== template.id))
                              }
                            >
                              Excluir
                            </Button>
                          </div>
                        </div>
                        <pre className="mt-3 max-h-40 overflow-auto rounded-xl bg-black/40 p-3 text-xs text-white/70">
                          {template.payload}
                        </pre>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="xs" variant="outline" onClick={() => handleCopy(template.payload, template.id)}>
                            {copiedId === template.id ? "Copiado" : "Copiar JSON"}
                          </Button>
                        </div>
                      </div>
                    ))}
                    {(templatesByProtocol.json?.[protocolKey] || []).length === 0 && (
                      <p className="text-xs text-white/60">Nenhum template cadastrado.</p>
                    )}
                  </div>
                </div>

                <form onSubmit={handleSaveJsonTemplate} className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-white/50">
                    {jsonDraft.id ? "Editar template" : "Novo template"}
                  </p>
                  <label className="space-y-2 text-sm">
                    <span className="text-xs uppercase tracking-wide text-white/60">Nome</span>
                    <Input
                      value={jsonDraft.name}
                      onChange={(event) => setJsonDraft((prev) => ({ ...prev, name: event.target.value }))}
                      placeholder="Configurar intervalo JSON"
                      className="map-compact-input"
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="text-xs uppercase tracking-wide text-white/60">JSON</span>
                    <textarea
                      value={jsonDraft.payload}
                      onChange={(event) => setJsonDraft((prev) => ({ ...prev, payload: event.target.value }))}
                      rows={5}
                      className={`w-full rounded-xl border bg-layer px-3 py-2 text-sm ${
                        jsonDraftValidation.valid ? "border-border" : "border-red-500/60"
                      }`}
                    />
                    {!jsonDraftValidation.valid && <span className="text-xs text-red-300">{jsonDraftValidation.error}</span>}
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="text-xs uppercase tracking-wide text-white/60">Descrição (opcional)</span>
                    <Input
                      value={jsonDraft.description}
                      onChange={(event) => setJsonDraft((prev) => ({ ...prev, description: event.target.value }))}
                      placeholder="Uso para equipamentos Suntech"
                      className="map-compact-input"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit">Salvar template</Button>
                    {jsonDraft.id && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setJsonDraft({ id: null, name: "", payload: "", description: "" })}
                      >
                        Cancelar
                      </Button>
                    )}
                  </div>
                </form>
              </div>
            )}
          </div>
        )}

        {(formError || historyError || formSuccess) && (
          <div
            className={`rounded-lg border p-3 text-sm ${
              formSuccess
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                : "border-red-500/30 bg-red-500/10 text-red-200"
            }`}
          >
            {formSuccess?.message || formError?.message || historyError?.message}
          </div>
        )}
        </div>
      </section>

      <section className="card space-y-4">
        <header className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Histórico de comandos</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs opacity-60">{list.length} registros</span>
            <Button type="button" size="xs" variant="outline" onClick={handleRefreshHistory}>
              Atualizar histórico
            </Button>
          </div>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-full table-fixed text-sm">
            <colgroup>
              {HISTORY_COLUMNS.map((column) => (
                <col key={column.id} style={{ width: column.width ? `${column.width}px` : "auto" }} />
              ))}
            </colgroup>
            <thead className="text-left text-xs uppercase tracking-wide opacity-60">
              <tr>
                {HISTORY_COLUMNS.map((column) => (
                  <th key={column.id} className="py-2 pr-6">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {historyLoading && (
                <tr>
                  <td colSpan={HISTORY_COLUMNS.length} className="py-4 text-center text-sm opacity-60">
                    Carregando comandos…
                  </td>
                </tr>
              )}
              {!historyLoading && historyError && (
                <tr>
                  <td colSpan={HISTORY_COLUMNS.length} className="py-4 text-center text-sm text-red-300">
                    {historyError.message}
                  </td>
                </tr>
              )}
              {!historyLoading && !list.length && (
                <tr>
                  <td colSpan={HISTORY_COLUMNS.length} className="py-4 text-center text-sm opacity-60">
                    Nenhum comando encontrado para o período selecionado.
                  </td>
                </tr>
              )}
              {list.map((command) => {
                const status = resolveCommandStatus(command);
                const response = resolveCommandResponse(command);
                const vehicle = vehicleByDeviceId.get(String(command.deviceId ?? command.device?.id ?? ""));
                const plateLabel = vehicle?.plate || vehicle?.name || command.device?.name || "—";
                return (
                  <tr key={command.id ?? `${command.deviceId}-${command.type}-${command.sentAt}`} className="hover:bg-white/5">
                    {HISTORY_COLUMNS.map((column) => {
                      switch (column.id) {
                        case "device":
                          return (
                            <td key={column.id} className="py-2 pr-6 text-white/80">
                              {plateLabel}
                            </td>
                          );
                        case "command":
                          return (
                            <td key={column.id} className="py-2 pr-6 text-white/70">
                              {command.command || command.type || command.name || "—"}
                            </td>
                          );
                        case "sentAt":
                          return (
                            <td key={column.id} className="py-2 pr-6 text-white/60">
                              {formatDate(command.sentAt || command.sentTime)}
                            </td>
                          );
                        case "status":
                          return (
                            <td key={column.id} className="py-2 pr-6">
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${status.className}`}
                              >
                                {status.label}
                              </span>
                            </td>
                          );
                        case "response":
                          return (
                            <td key={column.id} className="py-2 pr-6 text-white/60">
                              {response}
                            </td>
                          );
                        case "protocol":
                          return (
                            <td key={column.id} className="py-2 pr-6 text-white/60">
                              {resolveCommandProtocol(command)}
                            </td>
                          );
                        case "payload":
                          return (
                            <td key={column.id} className="py-2 pr-6 text-white/60">
                              {formatCommandPayload(command)}
                            </td>
                          );
                        default:
                          return (
                            <td key={column.id} className="py-2 pr-6 text-white/60">
                              —
                            </td>
                          );
                      }
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch (_error) {
    return String(value);
  }
}

function formatCommandTemplatePayload(command) {
  if (!command) return "—";
  const attributes = (command.parameters || []).reduce((acc, param) => {
    if (param.defaultValue !== undefined && param.defaultValue !== null && param.defaultValue !== "") {
      acc[param.key] = param.defaultValue;
    }
    return acc;
  }, {});
  const payload = {
    type: command.type || command.id,
    ...(Object.keys(attributes).length ? { attributes } : {}),
  };
  try {
    return JSON.stringify(payload);
  } catch (_error) {
    return String(payload.type || "—");
  }
}

function resolveCommandStatus(command) {
  const error = command?.error || command?.attributes?.error || command?.result?.error;
  const statusRaw = String(command?.status || command?.attributes?.status || "").toLowerCase();
  const result = command?.result || command?.attributes?.result;
  const delivered = command?.deliveredAt || command?.resultTime || command?.attributes?.deliveredAt;
  if (error || statusRaw.includes("fail") || statusRaw.includes("error")) {
    return { label: "erro", className: "border-slate-500/40 bg-slate-500/10 text-slate-200" };
  }
  if (statusRaw.includes("reject") || statusRaw.includes("denied")) {
    return { label: "rejeitado", className: "border-red-500/40 bg-red-500/10 text-red-200" };
  }
  if (statusRaw.includes("accept") || statusRaw.includes("success")) {
    return { label: "aceito", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" };
  }
  if (result || delivered) {
    return { label: "aceito", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" };
  }
  if (command?.sentAt || command?.sentTime) {
    return { label: "pendente", className: "border-amber-500/40 bg-amber-500/10 text-amber-200" };
  }
  return { label: "pendente", className: "border-amber-500/40 bg-amber-500/10 text-amber-200" };
}

function resolveCommandResponse(command) {
  const response =
    command?.response ||
    command?.result ||
    command?.attributes?.response ||
    command?.attributes?.result ||
    command?.attributes?.message ||
    command?.message ||
    command?.error;
  if (response) return String(response);
  const payload = command?.attributes?.payload || command?.attributes?.text || command?.attributes?.data;
  return payload ? String(payload) : "Sem resposta";
}

function resolveCommandProtocol(command) {
  const protocol =
    command?.protocol ||
    command?.device?.protocol ||
    command?.device?.attributes?.protocol ||
    command?.attributes?.protocol;
  if (!protocol) return "—";
  return String(protocol).toUpperCase();
}

function formatCommandPayload(command) {
  const payload = command?.attributes?.payload ?? command?.attributes?.data ?? command?.attributes?.text ?? command?.payload;
  if (payload == null) return "—";
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch (_error) {
    return String(payload);
  }
}
