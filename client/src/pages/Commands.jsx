import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Settings2, X } from "lucide-react";

import Button from "../ui/Button.jsx";
import Input from "../ui/Input.jsx";
import Select from "../ui/Select.jsx";
import api from "../lib/api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import useVehicles, { formatVehicleLabel } from "../lib/hooks/useVehicles.js";
import { filterCommandsBySearch, isCustomCommandConfigured, mergeCommands, normalizeProtocolKey } from "./commands-helpers.js";

const COMMAND_TABS = ["Comandos", "Avançado"];
const HISTORY_COLUMNS = [
  { id: "sentAt", label: "Enviado em", width: 170, minWidth: 150 },
  { id: "responseAt", label: "Respondido em", width: 170, minWidth: 150 },
  { id: "command", label: "Comando", width: 220, minWidth: 180 },
  { id: "requestedBy", label: "Quem enviou", width: 180, minWidth: 160 },
  { id: "status", label: "Status", width: 140, minWidth: 120 },
  { id: "result", label: "Resultado", width: 320, minWidth: 220 },
];
const COLUMN_WIDTHS_STORAGE_KEY = "commands:history:columns:widths:v2";
const COMMAND_PREFERENCES_STORAGE_KEY = "commands:list:preferences:v1";
const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 800;
const PAGE_SIZE_OPTIONS = [5, 10, 15, 20, 50];
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_HISTORY_PAGE_SIZE = 10;

const normalizeValue = (value) => String(value ?? "");

const getCommandKey = (command) => command?.code || command?.id || "";
const resolveUiCommandKey = (command) => getCommandKey(command) || command?.name || String(command?.id || "");

const getProtocolKey = (protocol) => normalizeProtocolKey(protocol) || "default";

const friendlyApiError = (error, fallbackMessage) => {
  if (error?.response?.status === 503 || error?.status === 503) {
    return "Serviço temporariamente indisponível. Tente novamente em instantes.";
  }
  if (error?.response?.data?.message) return error.response.data.message;
  if (error instanceof Error && error.message) return error.message;
  return fallbackMessage;
};

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
  const [commandErrors, setCommandErrors] = useState({});
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRefreshing, setHistoryRefreshing] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [historyWarning, setHistoryWarning] = useState(null);
  const [historyPerPage, setHistoryPerPage] = useState(DEFAULT_HISTORY_PAGE_SIZE);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [toast, setToast] = useState(null);
  const toastTimeoutRef = useRef(null);
  const historyPollRef = useRef({ intervalId: null, vehicleId: null });
  const historyRef = useRef([]);
  const [advancedMode, setAdvancedMode] = useState("vehicle");
  const [advancedCommandKey, setAdvancedCommandKey] = useState("");
  const [phoneForm, setPhoneForm] = useState({ commandId: "", phone: "", message: "" });
  const [sendingPhone, setSendingPhone] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [commandPreferences, setCommandPreferences] = useState(() => {
    if (typeof window === "undefined") return { order: {}, hidden: {} };
    try {
      const raw = window.localStorage.getItem(COMMAND_PREFERENCES_STORAGE_KEY);
      return raw ? JSON.parse(raw) : { order: {}, hidden: {} };
    } catch (_error) {
      return { order: {}, hidden: {} };
    }
  });
  const [commandsPerPage, setCommandsPerPage] = useState(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);
  const buildCustomForm = useCallback(
    () => ({
      name: "",
      description: "",
      kind: "SMS",
      visible: true,
      sms: { message: "" },
      json: { type: "", attributes: "{\n  \n}" },
      raw: { data: "" },
      hex: { data: "" },
    }),
    [],
  );
  const [customForm, setCustomForm] = useState(buildCustomForm);
  const manualCustomCommand = useMemo(
    () => ({
      id: "custom-manual",
      code: "custom-manual",
      name: "Comando personalizado (payload)",
      description: "Envie texto ou HEX diretamente para o dispositivo usando o tipo custom do Traccar.",
      kind: "protocol",
      manualCustom: true,
      type: "custom",
      tags: ["avancado"],
      parameters: [
        { key: "description", label: "Descrição (opcional)", type: "text" },
        { key: "data", label: "Payload (texto ou HEX)", type: "textarea", required: true },
        { key: "textChannel", label: "Enviar como texto (textChannel)", type: "boolean", defaultValue: false },
        { key: "savePreset", label: "Salvar como preset", type: "boolean", defaultValue: false },
        { key: "presetName", label: "Nome do preset", type: "text" },
      ],
    }),
    [],
  );

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

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const protocolCommandsWithManual = useMemo(() => {
    if (!selectedVehicleId) return protocolCommands;
    const alreadyAdded = (protocolCommands || []).some((command) => command.manualCustom);
    if (alreadyAdded) return protocolCommands;
    return [...(protocolCommands || []), manualCustomCommand];
  }, [manualCustomCommand, protocolCommands, selectedVehicleId]);

  useEffect(() => () => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
  }, []);

  const stopHistoryPolling = useCallback(() => {
    if (historyPollRef.current.intervalId) {
      clearInterval(historyPollRef.current.intervalId);
    }
    historyPollRef.current = { intervalId: null, vehicleId: null };
  }, []);

  useEffect(() => () => {
    stopHistoryPolling();
  }, [stopHistoryPolling]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(COMMAND_PREFERENCES_STORAGE_KEY, JSON.stringify(commandPreferences));
    } catch (_error) {
      // ignore
    }
  }, [commandPreferences]);

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

  const vehicleOptionsAll = useMemo(
    () =>
      vehicles.map((vehicle) => ({
        id: String(vehicle.id),
        label: formatVehicleLabel(vehicle),
      })),
    [vehicles],
  );

  const mergedCommands = useMemo(
    () => mergeCommands(protocolCommandsWithManual, customCommands, { deviceProtocol: device?.protocol }),
    [customCommands, device?.protocol, protocolCommandsWithManual],
  );

  const advancedCommands = useMemo(
    () =>
      mergeCommands(protocolCommandsWithManual, customCommands, {
        includeHiddenCustom: true,
        deviceProtocol: device?.protocol,
      }),
    [customCommands, device?.protocol, protocolCommandsWithManual],
  );

  const smsPresetOptions = useMemo(
    () =>
      customCommands
        .filter((command) => String(command?.kind || "").toUpperCase() === "SMS")
        .map((command) => ({
          id: command.id,
          name: command.name,
          message: command.payload?.message || "",
        })),
    [customCommands],
  );

  useEffect(() => {
    if (advancedCommandKey && !advancedCommands.some((command) => resolveUiCommandKey(command) === advancedCommandKey)) {
      setAdvancedCommandKey("");
    }
  }, [advancedCommandKey, advancedCommands]);

  const availableCommandKeys = useMemo(() => new Set(mergedCommands.map((command) => resolveUiCommandKey(command))), [mergedCommands]);

  const filteredCommands = useMemo(
    () => filterCommandsBySearch(mergedCommands, commandSearch),
    [commandSearch, mergedCommands],
  );

  const scopedPreferences = useMemo(() => {
    const scopeKey = getProtocolKey(device?.protocol);
    return {
      order: (commandPreferences.order?.[scopeKey] || []).filter((key) => availableCommandKeys.has(key)),
      hidden: Object.fromEntries(
        Object.entries(commandPreferences.hidden?.[scopeKey] || {}).filter(
          ([key, value]) => availableCommandKeys.has(key) && value === true,
        ),
      ),
    };
  }, [availableCommandKeys, commandPreferences, device?.protocol]);

  const orderedCommands = useMemo(() => {
    const base = filteredCommands.filter((command) => scopedPreferences.hidden[resolveUiCommandKey(command)] !== true);
    const orderIndex = scopedPreferences.order.reduce((acc, key, index) => ({ ...acc, [key]: index }), {});
    return base.sort((first, second) => {
      const keyA = resolveUiCommandKey(first);
      const keyB = resolveUiCommandKey(second);
      const hasOrderA = orderIndex[keyA] !== undefined;
      const hasOrderB = orderIndex[keyB] !== undefined;
      if (hasOrderA && hasOrderB) return orderIndex[keyA] - orderIndex[keyB];
      if (hasOrderA) return -1;
      if (hasOrderB) return 1;
      if (first.kind !== second.kind) {
        return first.kind === "custom" ? 1 : -1;
      }
      const labelA = normalizeValue(first?.name || keyA);
      const labelB = normalizeValue(second?.name || keyB);
      return labelA.localeCompare(labelB, "pt-BR", { sensitivity: "base" });
    });
  }, [filteredCommands, scopedPreferences.hidden, scopedPreferences.order]);

  const totalPages = useMemo(() => {
    if (orderedCommands.length === 0) return 1;
    return Math.max(1, Math.ceil(orderedCommands.length / commandsPerPage));
  }, [commandsPerPage, orderedCommands.length]);

  const paginatedCommands = useMemo(() => {
    const start = (currentPage - 1) * commandsPerPage;
    const end = start + commandsPerPage;
    return orderedCommands.slice(start, end);
  }, [commandsPerPage, currentPage, orderedCommands]);

  useEffect(() => {
    setCurrentPage(1);
  }, [commandSearch, commandsPerPage, device?.protocol, selectedVehicleId]);

  useEffect(() => {
    setCurrentPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

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
      setCommandErrors({});
      return;
    }
    setDeviceLoading(true);
    setDeviceError(null);
    setProtocolCommands([]);
    setCommandsError(null);
    setExpandedCommandId(null);
    setCommandParams({});
    setCommandErrors({});
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
      setCommandsError(new Error(friendlyApiError(error, "Erro ao carregar comandos")));
    } finally {
      setCommandsLoading(false);
    }
  }, [device?.protocol]);

  const fetchCustomCommands = useCallback(
    async ({ includeHidden = false } = {}) => {
      setCustomCommandsLoading(true);
      setCustomCommandsError(null);
      const params = {
        ...(includeHidden ? { includeHidden: true } : {}),
        ...(!includeHidden && device?.traccarId ? { deviceId: device.traccarId } : {}),
        ...(!includeHidden && device?.protocol ? { protocol: device.protocol } : {}),
      };
      try {
        const response = await api.get(API_ROUTES.commandsCustom, { params });
        const items = Array.isArray(response?.data?.data) ? response.data.data : [];
        setCustomCommands(items);
        if (response?.data?.error?.message) {
          setCustomCommandsError(new Error(response.data.error.message));
        }
      } catch (error) {
        if (includeHidden && error?.response?.status === 403) {
          try {
            const response = await api.get(API_ROUTES.commandsCustom, { params });
            const items = Array.isArray(response?.data?.data) ? response.data.data : [];
            setCustomCommands(items);
            if (response?.data?.error?.message) {
              setCustomCommandsError(new Error(response.data.error.message));
            }
          } catch (fallbackError) {
            setCustomCommandsError(new Error(friendlyApiError(fallbackError, "Erro ao carregar comandos personalizados")));
          }
        } else {
          setCustomCommandsError(new Error(friendlyApiError(error, "Erro ao carregar comandos personalizados")));
        }
      } finally {
        setCustomCommandsLoading(false);
      }
    },
    [device?.protocol, device?.traccarId],
  );

  const fetchHistory = useCallback(
    async ({ useLoading, bustCache } = {}) => {
      if (!selectedVehicleId) {
        setHistory([]);
        setHistoryError(null);
        setHistoryWarning(null);
        setHistoryTotal(0);
        setHistoryLoading(false);
        setHistoryRefreshing(false);
        return;
      }

      const shouldShowLoading = useLoading ?? historyRef.current.length === 0;
      setHistoryLoading(shouldShowLoading);
      setHistoryError(null);
      setHistoryWarning(null);
      setHistoryRefreshing(!shouldShowLoading);
      try {
        const cacheParams = bustCache ? { ts: Date.now() } : {};
        const response = await api.get(API_ROUTES.commandsHistory, {
          params: { vehicleId: selectedVehicleId, page: historyPage, pageSize: historyPerPage, ...cacheParams },
        });
        const items = Array.isArray(response?.data?.data?.items) ? response.data.data.items : [];
        const total = Number(response?.data?.data?.pagination?.total ?? items.length);
        const shouldIncludePending = historyPage === 1;
        const pendingLocal = shouldIncludePending
          ? (historyRef.current || []).filter((item) => {
              const id = String(item?.id ?? "");
              const isPending = ["PENDING", "SENT"].includes(item?.status);
              const existsInResponse = items.some((apiItem) => String(apiItem?.id ?? "") === id);
              return isPending && !existsInResponse;
            })
          : [];
        const merged = shouldIncludePending ? [...pendingLocal, ...items] : items;
        const sorted = shouldIncludePending
          ? merged.sort((a, b) => {
              const dateA = new Date(a?.sentAt || a?.createdAt || 0).getTime();
              const dateB = new Date(b?.sentAt || b?.createdAt || 0).getTime();
              return dateB - dateA;
            })
          : merged;
        setHistory(shouldIncludePending ? sorted.slice(0, historyPerPage) : sorted);
        setHistoryTotal((current) => {
          const baseTotal = Number.isFinite(total) ? total : items.length;
          const pendingCount = pendingLocal.length;
          return Math.max(baseTotal + pendingCount, current);
        });
        if (response?.data?.warning) {
          setHistoryWarning(response.data.warning);
        }
      } catch (error) {
        setHistoryError(new Error(friendlyApiError(error, "Erro ao carregar histórico")));
      } finally {
        setHistoryLoading(false);
        setHistoryRefreshing(false);
      }
    },
    [selectedVehicleId, historyPage, historyPerPage],
  );

  const getPendingHistoryIds = useCallback(() => {
    const pendingStatuses = new Set(["PENDING", "SENT"]);
    return (historyRef.current || [])
      .filter((item) => pendingStatuses.has(item?.status))
      .map((item) => item.id)
      .filter(Boolean);
  }, []);

  const fetchHistoryStatus = useCallback(
    async (ids, { bustCache } = {}) => {
      if (!selectedVehicleId || !ids.length) return;
      try {
        const cacheParams = bustCache ? { ts: Date.now() } : {};
        const response = await api.get(API_ROUTES.commandsHistoryStatus, {
          params: { vehicleId: selectedVehicleId, ids: ids.join(","), ...cacheParams },
        });
        const items = Array.isArray(response?.data?.data?.items) ? response.data.data.items : [];
        if (items.length) {
          const itemMap = new Map(items.map((item) => [String(item.id), item]));
          setHistory((current) =>
            current.map((item) => {
              const update = itemMap.get(String(item.id));
              if (!update) return item;
              return {
                ...item,
                status: update.status ?? item.status,
                receivedAt: update.receivedAt ?? item.receivedAt,
                result: update.result ?? item.result,
                command: update.command ?? item.command,
                sentAt: update.sentAt ?? item.sentAt,
                user: update.user ?? item.user,
              };
            }),
          );
        }
        if (response?.data?.warning) {
          setHistoryWarning(response.data.warning);
        }
      } catch (error) {
        const message = friendlyApiError(error, "Erro ao atualizar status do histórico");
        setHistoryWarning(message);
      }
    },
    [selectedVehicleId],
  );

  const handleRefreshHistory = useCallback(async () => {
    await fetchHistory({ useLoading: false, bustCache: true });
    const pendingIds = getPendingHistoryIds();
    if (pendingIds.length) {
      await fetchHistoryStatus(pendingIds, { bustCache: true });
    }
  }, [fetchHistory, fetchHistoryStatus, getPendingHistoryIds]);

  const startHistoryPolling = useCallback(() => {
    if (!selectedVehicleId) return;
    if (historyPollRef.current.intervalId && historyPollRef.current.vehicleId === selectedVehicleId) return;
    stopHistoryPolling();
    historyPollRef.current.vehicleId = selectedVehicleId;
    const poll = () => {
      const pendingIds = getPendingHistoryIds();
      if (!pendingIds.length) {
        stopHistoryPolling();
        return;
      }
      fetchHistoryStatus(pendingIds, { bustCache: true }).catch(() => {});
    };
    poll();
    historyPollRef.current.intervalId = setInterval(poll, 4000);
  }, [fetchHistoryStatus, getPendingHistoryIds, selectedVehicleId, stopHistoryPolling]);

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
    stopHistoryPolling();
  }, [selectedVehicleId, stopHistoryPolling]);

  useEffect(() => {
    setHistoryPage(1);
  }, [selectedVehicleId, historyPerPage]);

  useEffect(() => {
    if (!selectedVehicleId) {
      stopHistoryPolling();
      return;
    }
    const pending = history.filter((item) => ["PENDING", "SENT"].includes(item?.status));
    if (pending.length) {
      startHistoryPolling();
    } else {
      stopHistoryPolling();
    }
  }, [history, selectedVehicleId, startHistoryPolling, stopHistoryPolling]);

  const totalHistoryPages = useMemo(() => {
    if (!historyTotal) return 1;
    return Math.max(1, Math.ceil(historyTotal / historyPerPage));
  }, [historyTotal, historyPerPage]);

  useEffect(() => {
    setHistoryPage((current) => Math.min(current, totalHistoryPages));
  }, [totalHistoryPages]);

  const buildPendingHistoryItem = (commandLabel, requestId) => ({
    id: requestId,
    vehicleId: selectedVehicleId,
    traccarId: device?.traccarId || null,
    user: null,
    command: commandLabel,
    payload: null,
    status: "PENDING",
    sentAt: new Date().toISOString(),
    receivedAt: null,
    result: null,
    source: "EURO_ONE",
    traccarCommandId: null,
  });

  const handleSendCommand = async (command) => {
    const commandKey = getCommandKey(command);
    if (!selectedVehicleId || !commandKey) {
      showToast("Selecione um veículo válido", "error");
      return;
    }
    const isManualCustom = command.manualCustom === true;
    if (command.kind !== "custom" && !device?.protocol) {
      showToast("Veículo sem protocolo válido", "error");
      return;
    }
    if (command.kind === "custom" && !isCustomCommandConfigured(command, device?.protocol)) {
      showToast("Configure este comando personalizado na aba Avançado antes de enviar.", "error");
      return;
    }
    const manualParams = commandParams[commandKey] || {};
    const manualPayload = manualParams.data ?? manualParams.payload ?? "";
    if (isManualCustom && !String(manualPayload || "").trim()) {
      const message = "Informe o payload para o comando personalizado.";
      setCommandErrors((current) => ({ ...current, [commandKey]: message }));
      showToast(message, "error");
      return;
    }

    let pendingId = null;
    try {
      setSendingCommandId(commandKey);
      setCommandErrors((current) => ({ ...current, [commandKey]: null }));
      const savePreset = Boolean(manualParams.savePreset);
      const presetName = manualParams.presetName?.trim();
      if (isManualCustom && savePreset) {
        if (!presetName) {
          const message = "Informe o nome do preset para salvar.";
          setCommandErrors((current) => ({ ...current, [commandKey]: message }));
          showToast(message, "error");
          return;
        }
        if (!manualParams.textChannel) {
          const compact = String(manualPayload).replace(/\s+/g, "");
          if (!/^[0-9a-fA-F]+$/.test(compact) || compact.length % 2 !== 0) {
            const message = "Conteúdo HEX inválido para salvar preset.";
            setCommandErrors((current) => ({ ...current, [commandKey]: message }));
            showToast(message, "error");
            return;
          }
        }
        await api.post(API_ROUTES.commandsCustom, {
          name: presetName,
          description: manualParams.description?.trim() || null,
          protocol: device?.protocol ? String(device.protocol).trim() : null,
          kind: manualParams.textChannel ? "RAW" : "HEX",
          visible: true,
          payload: { data: manualPayload },
        });
        await fetchCustomCommands({ includeHidden: true });
        showToast("Preset salvo com sucesso.");
      }

      pendingId = `pending-${commandKey}-${Date.now()}`;
      const pendingLabel = isManualCustom
        ? presetName || manualParams.description?.trim() || command.name || commandKey
        : command.name || commandKey;
      const pendingItem = buildPendingHistoryItem(pendingLabel, pendingId);
      setHistory((current) => [pendingItem, ...current].slice(0, historyPerPage));
      setHistoryTotal((current) => current + 1);
      let response = null;
      if (isManualCustom) {
        response = await api.post(API_ROUTES.commandsSend, {
          vehicleId: selectedVehicleId,
          payload: manualPayload,
          textChannel: Boolean(manualParams.textChannel),
          description: manualParams.description?.trim() || undefined,
          commandName: presetName || manualParams.description?.trim() || command.name || "Comando personalizado",
        });
      } else if (command.kind === "custom") {
        response = await api.post(API_ROUTES.commandsSend, {
          vehicleId: selectedVehicleId,
          customCommandId: command.id,
        });
      } else {
        response = await api.post(API_ROUTES.commandsSend, {
          vehicleId: selectedVehicleId,
          protocol: device.protocol,
          commandKey,
          commandName: command.name || commandKey,
          params: commandParams[commandKey] || {},
        });
      }
      const createdItem = response?.data?.data;
      if (createdItem) {
        setHistory((current) => {
          const filtered = current.filter((item) => item.id !== pendingId);
          return [createdItem, ...filtered].slice(0, historyPerPage);
        });
      } else {
        setHistory((current) =>
          current.map((item) => (item.id === pendingId ? { ...item, status: "SENT" } : item)),
        );
      }
      if (isManualCustom) {
        setCommandParams((current) => ({
          ...current,
          [commandKey]: { description: "", data: "", textChannel: false, savePreset: false, presetName: "" },
        }));
      }
      if (response?.data?.ok === false && response?.data?.warning) {
        showToast(response.data.warning, "warning");
      } else {
        showToast("Comando enviado com sucesso.");
      }
      setExpandedCommandId(null);
      if (response?.data?.ok !== false) {
        startHistoryPolling();
      }
    } catch (error) {
      const message = friendlyApiError(error, "Erro ao enviar comando");
      setCommandErrors((current) => ({ ...current, [commandKey]: message }));
      setHistory((current) =>
        current.map((item) =>
          item.id === pendingId ? { ...item, status: "ERROR", result: message } : item,
        ),
      );
      showToast(message, "error");
    } finally {
      setSendingCommandId(null);
    }
  };

  const resetCustomForm = useCallback(() => {
    setCustomForm(buildCustomForm());
    setEditingCustomCommandId(null);
  }, [buildCustomForm]);

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
    if (command.readonly) return;
    setEditingCustomCommandId(command.id);
    setCustomForm({
      name: command.name || "",
      description: command.description || "",
      kind: command.kind || "SMS",
      visible: Boolean(command.visible),
      sms: {
        message: command.payload?.message || "",
      },
      json: {
        type: command.payload?.type || "",
        attributes: JSON.stringify(command.payload?.attributes || {}, null, 2),
      },
      raw: {
        data: command.payload?.data || "",
      },
      hex: {
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
      payload.message = customForm.sms.message.trim();
      if (!payload.message) {
        showToast("Informe a mensagem para o SMS.", "error");
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
    } else if (customForm.kind === "HEX") {
      payload.data = customForm.hex.data;
      if (!String(payload.data || "").trim()) {
        showToast("Informe o conteúdo HEX.", "error");
        return;
      }
    }

    setSavingCustomCommand(true);
    try {
      const body = {
        name: customForm.name.trim(),
        description: customForm.description.trim() || null,
        protocol: device?.protocol ? String(device.protocol).trim() : null,
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

  const buildFormFromPreset = useCallback((command) => {
    return {
      name: command.name || "",
      description: command.description || "",
      kind: command.customKind || command.kind || "SMS",
      visible: Boolean(command.visible),
      sms: {
        message: command.payload?.message || "",
      },
      json: {
        type: command.payload?.type || "",
        attributes: JSON.stringify(command.payload?.attributes || {}, null, 2),
      },
      raw: {
        data: command.payload?.data || "",
      },
      hex: {
        data: command.payload?.data || "",
      },
    };
  }, []);

  const handleConfigureCustomCommand = useCallback(
    (command) => {
      if (!command) return;
      setActiveTab("Avançado");
      setAdvancedMode("vehicle");
      setAdvancedCommandKey(resolveUiCommandKey(command));
      setCustomForm(buildFormFromPreset(command));
      setEditingCustomCommandId(command.readonly ? null : command.id);
    },
    [buildFormFromPreset],
  );

  const handleUsePreset = useCallback(
    (command) => {
      setEditingCustomCommandId(null);
      setCustomForm(buildFormFromPreset(command));
    },
    [buildFormFromPreset],
  );

  const handleSendPreset = useCallback(
    async (command) => {
      if (!selectedVehicleId) {
        showToast("Selecione um veículo para enviar o comando.", "error");
        return;
      }
      const pendingId = `pending-${command.id}-${Date.now()}`;
      const pendingItem = buildPendingHistoryItem(command.name || command.id, pendingId);
      setHistory((current) => [pendingItem, ...current].slice(0, historyPerPage));
      setHistoryTotal((current) => current + 1);
      setSendingCommandId(command.id);
      try {
        const response = await api.post(API_ROUTES.commandsSend, {
          vehicleId: selectedVehicleId,
          customCommandId: command.id,
        });
        const createdItem = response?.data?.data;
        if (createdItem) {
          setHistory((current) => {
            const filtered = current.filter((item) => item.id !== pendingId);
            return [createdItem, ...filtered].slice(0, historyPerPage);
          });
        } else {
          setHistory((current) =>
            current.map((item) => (item.id === pendingId ? { ...item, status: "SENT" } : item)),
          );
        }
        if (response?.data?.ok === false && response?.data?.warning) {
          showToast(response.data.warning, "warning");
        } else {
          showToast("Comando enviado com sucesso.");
        }
        if (response?.data?.ok !== false) {
          startHistoryPolling();
        }
      } catch (error) {
        const message = friendlyApiError(error, "Erro ao enviar comando");
        setHistory((current) =>
          current.map((item) => (item.id === pendingId ? { ...item, status: "ERROR", result: message } : item)),
        );
        showToast(message, "error");
      } finally {
        setSendingCommandId(null);
      }
    },
    [historyPerPage, selectedVehicleId, showToast, startHistoryPolling, buildPendingHistoryItem],
  );

  const handleTogglePresetVisible = useCallback(
    async (command) => {
      try {
        await api.patch(`${API_ROUTES.commandsCustom}/${command.id}`, {
          visible: !command.visible,
        });
        await fetchCustomCommands({ includeHidden: true });
      } catch (error) {
        showToast(friendlyApiError(error, "Erro ao atualizar visibilidade"), "error");
      }
    },
    [fetchCustomCommands, showToast],
  );

  const handleMovePreset = useCallback(
    async (command, direction) => {
      const sorted = [...customCommands].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      const index = sorted.findIndex((item) => item.id === command.id);
      if (index === -1) return;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= sorted.length) return;
      const target = sorted[targetIndex];
      try {
        await api.patch(`${API_ROUTES.commandsCustom}/${command.id}`, {
          sortOrder: target.sortOrder ?? 0,
        });
        await api.patch(`${API_ROUTES.commandsCustom}/${target.id}`, {
          sortOrder: command.sortOrder ?? 0,
        });
        await fetchCustomCommands({ includeHidden: true });
      } catch (error) {
        showToast(friendlyApiError(error, "Erro ao reordenar presets"), "error");
      }
    },
    [customCommands, fetchCustomCommands, showToast],
  );

  const handleUpdateParam = (commandId, key, value) => {
    setCommandParams((current) => ({
      ...current,
      [commandId]: {
        ...current?.[commandId],
        [key]: value,
      },
    }));
  };

  const selectedAdvancedCommand = useMemo(
    () => advancedCommands.find((command) => resolveUiCommandKey(command) === advancedCommandKey),
    [advancedCommandKey, advancedCommands],
  );

  const handleAdvancedCommandSelect = (value) => {
    setAdvancedCommandKey(value);
  };

  const handlePhoneFormChange = (field, value) => {
    setPhoneForm((current) => ({ ...current, [field]: value }));
  };

  const handlePhonePresetSelect = (presetId) => {
    const preset = smsPresetOptions.find((item) => String(item.id) === String(presetId));
    setPhoneForm((current) => ({
      ...current,
      commandId: presetId,
      message: preset?.message || current.message,
    }));
  };

  const handleSendSmsByPhone = async () => {
    const phone = phoneForm.phone.trim();
    const message = phoneForm.message.trim();
    if (!phone || !message) {
      showToast("Informe telefone e mensagem para enviar o SMS.", "error");
      return;
    }
    setSendingPhone(true);
    try {
      await api.post(API_ROUTES.commandsSendSms, { phone, message });
      showToast("SMS enviado com sucesso.");
      setPhoneForm((current) => ({ ...current, phone: "" }));
    } catch (error) {
      showToast(friendlyApiError(error, "Erro ao enviar SMS"), "error");
    } finally {
      setSendingPhone(false);
    }
  };

  const updatePreferences = useCallback(
    (updater) => {
      const scopeKey = getProtocolKey(device?.protocol);
      setCommandPreferences((current) => {
        const currentOrder = current.order?.[scopeKey] || [];
        const currentHidden = current.hidden?.[scopeKey] || {};
        const sanitizedOrder = currentOrder.filter((key) => availableCommandKeys.has(key));
        const sanitizedHidden = Object.fromEntries(
          Object.entries(currentHidden).filter(([key, value]) => availableCommandKeys.has(key) && value === true),
        );
        const { order = sanitizedOrder, hidden = sanitizedHidden } = updater({
          order: sanitizedOrder,
          hidden: sanitizedHidden,
        });
        const nextOrder = Array.from(new Set(order.filter((key) => availableCommandKeys.has(key))));
        const nextHidden = Object.fromEntries(
          Object.entries(hidden).filter(([key, value]) => availableCommandKeys.has(key) && value === true),
        );
        return {
          order: { ...current.order, [scopeKey]: nextOrder },
          hidden: { ...current.hidden, [scopeKey]: nextHidden },
        };
      });
    },
    [availableCommandKeys, device?.protocol],
  );

  const handleToggleCommandVisibility = useCallback(
    (commandKey) => {
      updatePreferences(({ order, hidden }) => {
        const nextHidden = { ...hidden, [commandKey]: !hidden[commandKey] };
        if (nextHidden[commandKey] === false) {
          delete nextHidden[commandKey];
        }
        return { order, hidden: nextHidden };
      });
    },
    [updatePreferences],
  );

  const handleMoveCommand = useCallback(
    (commandKey, direction) => {
      updatePreferences(({ order, hidden }) => {
        const ensuredOrder = order.includes(commandKey) ? [...order] : [...order, commandKey];
        const index = ensuredOrder.indexOf(commandKey);
        if (direction === "top" && index > 0) {
          ensuredOrder.splice(index, 1);
          ensuredOrder.unshift(commandKey);
        } else if (direction === "bottom" && index !== -1 && index < ensuredOrder.length - 1) {
          ensuredOrder.splice(index, 1);
          ensuredOrder.push(commandKey);
        } else if (direction === "up" && index > 0) {
          [ensuredOrder[index - 1], ensuredOrder[index]] = [ensuredOrder[index], ensuredOrder[index - 1]];
        } else if (direction === "down" && index !== -1 && index < ensuredOrder.length - 1) {
          [ensuredOrder[index + 1], ensuredOrder[index]] = [ensuredOrder[index], ensuredOrder[index + 1]];
        }
        return { order: ensuredOrder, hidden };
      });
    },
    [updatePreferences],
  );

  const handleResetPreferences = useCallback(() => {
    const scopeKey = getProtocolKey(device?.protocol);
    setCommandPreferences((current) => ({
      order: { ...current.order, [scopeKey]: [] },
      hidden: { ...current.hidden, [scopeKey]: {} },
    }));
  }, [device?.protocol]);

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

  const renderCommandCard = (command) => {
    const commandKey = getCommandKey(command);
    const uiKey = resolveUiCommandKey(command);
    const hasParams = Array.isArray(command.parameters) && command.parameters.length > 0;
    const isExpanded = expandedCommandId === commandKey;
    const paramValues = commandParams[commandKey] || {};
    const commandError = commandErrors[commandKey];
    const isCustom = command.kind === "custom";
    const isConfigured = isCustom ? isCustomCommandConfigured(command, device?.protocol) : true;
    const shouldShowConfigure = isCustom || hasParams;
    const sendDisabled = sendingCommandId === commandKey || (isCustom && !isConfigured);
    const protocolMismatch =
      isCustom &&
      command.protocol &&
      device?.protocol &&
      normalizeProtocolKey(command.protocol) !== normalizeProtocolKey(device.protocol);

    return (
      <div key={uiKey} className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white/90">{command.name || commandKey}</p>
            {command.description && <p className="mt-1 text-xs text-white/60">{command.description}</p>}
            {command.kind === "custom" && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide">
                <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-primary/80">
                  Personalizado
                </span>
                <span className="text-white/50">{command.customKind || "Custom"}</span>
                {command.protocol && (
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-white/60">
                    Protocolo: {command.protocol}
                  </span>
                )}
              </div>
            )}
            {protocolMismatch && (
              <p className="mt-2 text-[11px] uppercase tracking-wide text-amber-200">
                Protocolo do comando diferente do veículo selecionado.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {shouldShowConfigure ? (
              isCustom ? (
                <Button type="button" variant="outline" onClick={() => handleConfigureCustomCommand(command)}>
                  Configurar
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setExpandedCommandId((current) => (current === commandKey ? null : commandKey))}
                >
                  {isExpanded ? "Fechar" : "Configurar"}
                </Button>
              )
            ) : null}
            <Button type="button" onClick={() => handleSendCommand(command)} disabled={sendDisabled}>
              {sendingCommandId === commandKey ? "Enviando…" : "Enviar"}
            </Button>
          </div>
        </div>
        {commandError && <p className="mt-2 text-xs text-red-300">Erro: {commandError}</p>}
        {isCustom && !isConfigured && (
          <p className="mt-2 text-xs text-amber-200">
            Configure este comando na aba Avançado antes de enviar.
          </p>
        )}
        {hasParams && isExpanded && (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {command.parameters.map((param) => {
              const inputId = `${uiKey}-${param.key}`;
              const value =
                paramValues[param.key] ??
                (param.defaultValue !== undefined && param.defaultValue !== null
                  ? param.defaultValue
                  : param.type === "boolean"
                  ? false
                  : "");
              if (param.key === "presetName" && !paramValues.savePreset) {
                return null;
              }
              const type = param.type === "number" ? "number" : "text";
              const options = Array.isArray(param.options) ? param.options : null;
              return (
                <label key={param.key} htmlFor={inputId} className="flex flex-col text-xs uppercase tracking-wide text-white/60">
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
                  ) : param.type === "textarea" ? (
                    <textarea
                      id={inputId}
                      value={value}
                      onChange={(event) => handleUpdateParam(commandKey, param.key, event.target.value)}
                      rows={4}
                      className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80"
                    />
                  ) : param.type === "boolean" ? (
                    <div className="mt-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-white/60">
                      <input
                        id={inputId}
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(event) => handleUpdateParam(commandKey, param.key, event.target.checked)}
                        className="h-4 w-4 rounded border-white/20 bg-transparent"
                      />
                      <span>{param.helpText || "Ativar"}</span>
                    </div>
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
  };

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
                aria-label="Preferências de comandos"
                onClick={() => setIsPreferencesOpen(true)}
              >
                <Settings2 size={18} />
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
                    !customCommandsLoading &&
                    !customCommandsError &&
                    orderedCommands.length === 0 && (
                      <p className="text-sm text-white/60">Nenhum comando encontrado.</p>
                    )}

                  {!deviceLoading &&
                    !deviceError &&
                    !commandsLoading &&
                    !commandsError &&
                    paginatedCommands.map(renderCommandCard)}

                  {!deviceLoading &&
                    !deviceError &&
                    !commandsLoading &&
                    !commandsError &&
                    filteredCommands.length > 0 &&
                    orderedCommands.length === 0 && (
                      <p className="text-sm text-white/60">Todos os comandos estão ocultos pela configuração atual.</p>
                    )}

                  {!deviceLoading &&
                    !deviceError &&
                    !commandsLoading &&
                    !commandsError &&
                    orderedCommands.length > 0 &&
                    paginatedCommands.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-white/70">
                        <div className="flex items-center gap-2">
                          <span>Itens por página</span>
                          <Select
                            value={commandsPerPage}
                            onChange={(event) => setCommandsPerPage(Number(event.target.value))}
                            className="w-[90px] bg-layer text-sm"
                          >
                            {PAGE_SIZE_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="rounded-lg border border-white/10 px-2 py-1 transition hover:border-primary/50 disabled:opacity-50"
                            onClick={() => setCurrentPage((current) => Math.max(1, current - 1))}
                            disabled={currentPage === 1}
                          >
                            Anterior
                          </button>
                          <span>
                            Página {currentPage} de {totalPages}
                          </span>
                          <button
                            type="button"
                            className="rounded-lg border border-white/10 px-2 py-1 transition hover:border-primary/50 disabled:opacity-50"
                            onClick={() => setCurrentPage((current) => Math.min(totalPages, current + 1))}
                            disabled={currentPage >= totalPages}
                          >
                            Próxima
                          </button>
                        </div>
                      </div>
                    )}
                  {customCommandsLoading && (
                    <p className="text-sm text-white/60">Carregando comandos personalizados…</p>
                  )}
                  {customCommandsError && (
                    <p className="text-sm text-red-300">
                      {customCommandsError.message || "Erro ao carregar comandos personalizados."}
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {activeTab === "Avançado" && (
            <div className="mx-6 flex flex-col gap-6 rounded-2xl border border-white/10 bg-[#0b0f17] p-6">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white/90">Envio avançado</p>
                    <p className="text-xs text-white/60">
                      Escolha como enviar comandos: via dispositivo ou direto por telefone (chip).
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "vehicle", label: "Veículo/Dispositivo" },
                      { id: "phone", label: "Telefone (chip)" },
                    ].map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => setAdvancedMode(mode.id)}
                        className={`rounded-xl px-3 py-2 text-[11px] font-semibold uppercase tracking-wide transition ${
                          advancedMode === mode.id
                            ? "bg-primary/20 text-white border border-primary/40"
                            : "border border-white/10 text-white/60 hover:text-white"
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>

                {advancedMode === "vehicle" && (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
                      Veículo
                      <Select
                        value={selectedVehicleId}
                        onChange={(event) => setSelectedVehicleId(event.target.value)}
                        className="mt-2 w-full bg-layer text-sm"
                      >
                        <option value="">Selecione</option>
                        {vehicleOptionsAll.map((vehicle) => (
                          <option key={vehicle.id} value={vehicle.id}>
                            {vehicle.label}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
                      Comando
                      <Select
                        value={advancedCommandKey}
                        onChange={(event) => handleAdvancedCommandSelect(event.target.value)}
                        className="mt-2 w-full bg-layer text-sm"
                      >
                        <option value="">Selecione</option>
                        {advancedCommands.map((command) => {
                          const uiKey = resolveUiCommandKey(command);
                          return (
                            <option key={uiKey} value={uiKey}>
                              {command.name || uiKey}
                              {command.kind === "custom" ? " · Personalizado" : ""}
                            </option>
                          );
                        })}
                      </Select>
                    </label>
                    {selectedAdvancedCommand?.parameters?.length > 0 && (
                      <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
                        {selectedAdvancedCommand.parameters.map((param) => {
                          const inputId = `advanced-${resolveUiCommandKey(selectedAdvancedCommand)}-${param.key}`;
                          const value =
                            commandParams[getCommandKey(selectedAdvancedCommand)]?.[param.key] ??
                            (param.defaultValue !== undefined && param.defaultValue !== null ? param.defaultValue : "");
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
                                  onChange={(event) =>
                                    handleUpdateParam(getCommandKey(selectedAdvancedCommand), param.key, event.target.value)
                                  }
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
                                  onChange={(event) =>
                                    handleUpdateParam(getCommandKey(selectedAdvancedCommand), param.key, event.target.value)
                                  }
                                  className="mt-2"
                                />
                              )}
                            </label>
                          );
                        })}
                      </div>
                    )}
                    <div className="md:col-span-2">
                      <Button
                        type="button"
                        onClick={() => {
                          if (!selectedAdvancedCommand) {
                            showToast("Selecione um comando para enviar.", "error");
                            return;
                          }
                          handleSendCommand(selectedAdvancedCommand);
                        }}
                        disabled={!selectedAdvancedCommand || !selectedVehicleId}
                      >
                        Enviar comando
                      </Button>
                    </div>
                  </div>
                )}

                {advancedMode === "phone" && (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
                      Preset SMS (opcional)
                      <Select
                        value={phoneForm.commandId}
                        onChange={(event) => handlePhonePresetSelect(event.target.value)}
                        className="mt-2 w-full bg-layer text-sm"
                      >
                        <option value="">Selecione</option>
                        {smsPresetOptions.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
                      Telefone
                      <Input
                        value={phoneForm.phone}
                        onChange={(event) => handlePhoneFormChange("phone", event.target.value)}
                        className="mt-2"
                      />
                    </label>
                    <label className="flex flex-col text-xs uppercase tracking-wide text-white/60 md:col-span-2">
                      Mensagem
                      <Input
                        value={phoneForm.message}
                        onChange={(event) => handlePhoneFormChange("message", event.target.value)}
                        className="mt-2"
                      />
                    </label>
                    <div className="md:col-span-2">
                      <Button type="button" onClick={handleSendSmsByPhone} disabled={sendingPhone}>
                        {sendingPhone ? "Enviando…" : "Enviar SMS"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <p className="text-sm font-semibold text-white/90">Comandos personalizados</p>
                <p className="text-xs text-white/60">
                  Crie comandos SMS, JSON, RAW ou HEX e controle onde eles aparecem na aba Comandos.
                </p>
                {!device?.protocol && (
                  <p className="text-xs text-amber-200">
                    Opcional: selecione um veículo para associar o protocolo. Sem veículo, o comando fica geral e visível.
                  </p>
                )}
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
                      Tipo
                      <Select
                        value={customForm.kind}
                        onChange={(event) => handleCustomFormChange("kind", event.target.value)}
                        className="mt-2 w-full bg-layer text-sm"
                      >
                        <option value="SMS">SMS</option>
                        <option value="JSON">JSON</option>
                        <option value="RAW">RAW</option>
                        <option value="HEX">HEX</option>
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
                    <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
                      Mensagem
                      <Input
                        value={customForm.sms.message}
                        onChange={(event) => handleCustomPayloadChange("sms", "message", event.target.value)}
                        className="mt-2"
                      />
                    </label>
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

                  {customForm.kind === "HEX" && (
                    <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
                      Conteúdo HEX
                      <textarea
                        value={customForm.hex.data}
                        onChange={(event) => handleCustomPayloadChange("hex", "data", event.target.value)}
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
                              {" · "}
                              {command.visible ? "Visível" : "Oculto"}
                              {command.readonly ? " · Template" : ""}
                            </p>
                            {command.description && (
                              <p className="mt-1 text-xs text-white/60">{command.description}</p>
                            )}
                          </div>
                          <div className="flex flex-col gap-2">
                            <Button type="button" variant="outline" onClick={() => handleUsePreset(command)}>
                              Usar
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => handleSendPreset(command)}
                              disabled={sendingCommandId === command.id}
                            >
                              {sendingCommandId === command.id ? "Enviando…" : "Enviar"}
                            </Button>
                            {!command.readonly && (
                              <>
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
                              </>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/70">
                          <Button type="button" variant="outline" onClick={() => handleTogglePresetVisible(command)}>
                            {command.visible ? "Ocultar" : "Mostrar"}
                          </Button>
                          <Button type="button" variant="outline" onClick={() => handleMovePreset(command, "up")}>
                            ↑
                          </Button>
                          <Button type="button" variant="outline" onClick={() => handleMovePreset(command, "down")}>
                            ↓
                          </Button>
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
            <Button
              type="button"
              variant="ghost"
              className="inline-flex items-center gap-2"
              onClick={handleRefreshHistory}
              disabled={historyRefreshing || historyLoading}
            >
              <RefreshCw className={`h-4 w-4 ${historyRefreshing || historyLoading ? "animate-spin" : ""}`} />
              <span>{historyRefreshing || historyLoading ? "Atualizando…" : "Atualizar"}</span>
            </Button>
          </div>
          {historyWarning && (
            <p className="text-xs text-amber-200">
              Histórico parcial: {historyWarning}
            </p>
          )}
          {historyError && history.length > 0 && (
            <p className="text-xs text-red-300">
              Não foi possível atualizar o histórico. {historyError.message}
            </p>
          )}
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
              {historyLoading && history.length === 0 && (
                <tr>
                  <td colSpan={HISTORY_COLUMNS.length} className="px-3 py-4 text-center text-sm text-white/60">
                    Carregando histórico…
                  </td>
                </tr>
              )}
              {!historyLoading && historyError && history.length === 0 && (
                <tr>
                  <td colSpan={HISTORY_COLUMNS.length} className="px-3 py-4 text-center text-sm text-red-300">
                    Não foi possível carregar o histórico. {historyError.message}
                  </td>
                </tr>
              )}
              {!historyLoading && !historyError && historyTotal === 0 && history.length === 0 && (
                <tr>
                  <td colSpan={HISTORY_COLUMNS.length} className="px-3 py-4 text-center text-sm text-white/60">
                    Nenhum comando encontrado.
                  </td>
                </tr>
              )}
              {history.length > 0 &&
                history.map((item) => {
                  const commandLabel = item?.command || item?.commandName || "—";
                  const statusLabel =
                    item?.status === "RESPONDED"
                      ? "Respondido"
                      : item?.status === "ERROR"
                      ? "Erro"
                      : item?.status === "SENT"
                      ? "Enviado"
                      : "Pendente";
                  const resultText = item?.result || "—";
                  const sentAt = item?.sentAt || null;
                  const responseAt = item?.receivedAt || item?.responseAt || null;
                  const requestedBy = item?.user?.name || item?.createdByName || "—";
                  return (
                    <tr key={item.id || item.requestId || `${sentAt || responseAt}-${commandLabel}`} className="hover:bg-white/5">
                      <td
                        style={getWidthStyle("sentAt")}
                        className="border-r border-white/5 px-3 py-2 text-[11px] text-white/80"
                      >
                        {formatDateTime(sentAt)}
                      </td>
                      <td
                        style={getWidthStyle("responseAt")}
                        className="border-r border-white/5 px-3 py-2 text-[11px] text-white/80"
                      >
                        {formatDateTime(responseAt)}
                      </td>
                      <td style={getWidthStyle("command")} className="border-r border-white/5 px-3 py-2 text-[11px] text-white/80">
                        {commandLabel}
                      </td>
                      <td style={getWidthStyle("requestedBy")} className="border-r border-white/5 px-3 py-2 text-[11px] text-white/80">
                        {requestedBy}
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

        {!historyLoading && !historyError && historyTotal > 0 && (
          <div className="mx-6 mb-6 flex flex-wrap items-center justify-between gap-3 text-xs text-white/70">
            <div className="flex items-center gap-2">
              <span>Itens por página</span>
              <Select
                value={historyPerPage}
                onChange={(event) => setHistoryPerPage(Number(event.target.value))}
                className="w-[90px] bg-layer text-sm"
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-lg border border-white/10 px-2 py-1 transition hover:border-primary/50 disabled:opacity-50"
                onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}
                disabled={historyPage === 1}
              >
                Anterior
              </button>
              <span>
                Página {historyPage} de {totalHistoryPages}
              </span>
              <button
                type="button"
                className="rounded-lg border border-white/10 px-2 py-1 transition hover:border-primary/50 disabled:opacity-50"
                onClick={() => setHistoryPage((current) => Math.min(totalHistoryPages, current + 1))}
                disabled={historyPage >= totalHistoryPages}
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </section>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl border px-4 py-3 text-sm shadow-lg ${toastClassName}`}>
          {toast.message}
        </div>
      )}

      {isPreferencesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-10">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-[#0f141c] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-white">Visibilidade e ordem dos comandos</p>
                <p className="text-xs text-white/60">Mostre ou oculte comandos e defina a prioridade manualmente.</p>
              </div>
              <button
                type="button"
                className="rounded-full border border-white/10 p-1 text-white/70 transition hover:text-white"
                onClick={() => setIsPreferencesOpen(false)}
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto px-5 py-4 space-y-4">
              {mergedCommands.length === 0 && <p className="text-sm text-white/60">Nenhum comando disponível para ajustar.</p>}
              {mergedCommands.length > 0 && (
                <div className="space-y-2">
                  {mergedCommands
                    .slice()
                    .sort((a, b) =>
                      normalizeValue(a?.name || resolveUiCommandKey(a)).localeCompare(
                        normalizeValue(b?.name || resolveUiCommandKey(b)),
                        "pt-BR",
                        { sensitivity: "base" },
                      ),
                    )
                    .map((command) => {
                      const uiKey = resolveUiCommandKey(command);
                      const position = scopedPreferences.order.indexOf(uiKey);
                      const isHidden = scopedPreferences.hidden[uiKey] === true;
                      return (
                        <div
                          key={uiKey}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3"
                        >
                          <div className="min-w-[220px] flex-1">
                            <div className="flex items-center gap-2">
                              <input
                                id={`toggle-${uiKey}`}
                                type="checkbox"
                                checked={!isHidden}
                                onChange={() => handleToggleCommandVisibility(uiKey)}
                                className="h-4 w-4 rounded border-white/20 bg-transparent"
                              />
                              <label htmlFor={`toggle-${uiKey}`} className="text-sm font-semibold text-white/90">
                                {command.name || uiKey}
                              </label>
                            </div>
                            <p className="mt-1 text-[11px] uppercase tracking-wide text-primary/70">
                              {command.kind === "custom" ? "Personalizado" : "Protocolo"}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="rounded-lg border border-white/10 px-2 py-1 text-white/70">
                              {position >= 0 ? `Prioridade ${position + 1}` : "Sem prioridade"}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                className="rounded-lg border border-white/10 px-2 py-1 text-white/80 transition hover:border-primary/50"
                                onClick={() => handleMoveCommand(uiKey, "top")}
                                disabled={position === 0}
                                title="Mover para o topo"
                              >
                                ⬆⬆
                              </button>
                              <button
                                type="button"
                                className="rounded-lg border border-white/10 px-2 py-1 text-white/80 transition hover:border-primary/50"
                                onClick={() => handleMoveCommand(uiKey, "up")}
                                disabled={position <= 0}
                                title="Subir prioridade"
                              >
                                ⬆
                              </button>
                              <button
                                type="button"
                                className="rounded-lg border border-white/10 px-2 py-1 text-white/80 transition hover:border-primary/50"
                                onClick={() => handleMoveCommand(uiKey, "down")}
                                disabled={position === -1 || position >= scopedPreferences.order.length - 1}
                                title="Descer prioridade"
                              >
                                ⬇
                              </button>
                              <button
                                type="button"
                                className="rounded-lg border border-white/10 px-2 py-1 text-white/80 transition hover:border-primary/50"
                                onClick={() => handleMoveCommand(uiKey, "bottom")}
                                disabled={position === -1 || position >= scopedPreferences.order.length - 1}
                                title="Mover para o final"
                              >
                                ⬇⬇
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-4">
              <Button type="button" variant="outline" onClick={handleResetPreferences}>
                Restaurar padrão
              </Button>
              <Button type="button" onClick={() => setIsPreferencesOpen(false)}>
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
