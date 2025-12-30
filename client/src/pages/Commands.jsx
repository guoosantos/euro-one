import React, { useEffect, useMemo, useRef, useState } from "react";

import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import useCommands from "../lib/hooks/useCommands";
import useDevices from "../lib/hooks/useDevices";
import useVehicles, { formatVehicleLabel } from "../lib/hooks/useVehicles";
import api from "../lib/api.js";
import { API_ROUTES } from "../lib/api-routes.js";

const COMMAND_TABS = ["Comandos", "Avançado", "SMS", "JSON"];
const STORAGE_KEY = "protocol-templates-v1";

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

export default function Commands() {
  const { vehicles, loading: vehiclesLoading, error: vehiclesError } = useVehicles();
  const { devices: deviceList } = useDevices();
  const devices = useMemo(() => (Array.isArray(deviceList) ? deviceList : []), [deviceList]);
  const { commands, loading, error, reload, sendCommand } = useCommands({ autoRefreshMs: 45_000 });
  const commandsCacheRef = useRef(new Map());

  const [activeTab, setActiveTab] = useState(COMMAND_TABS[0]);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [protocols, setProtocols] = useState([]);
  const [protocolsLoading, setProtocolsLoading] = useState(false);
  const [protocolError, setProtocolError] = useState(null);
  const [protocolCommands, setProtocolCommands] = useState([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [commandsError, setCommandsError] = useState(null);
  const [commandSearch, setCommandSearch] = useState("");
  const [selectedCommandId, setSelectedCommandId] = useState("");
  const [commandParams, setCommandParams] = useState({});
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState(null);
  const [manualType, setManualType] = useState("custom");
  const [manualPayload, setManualPayload] = useState("");
  const [manualChannel, setManualChannel] = useState("");
  const [templatesByProtocol, setTemplatesByProtocol] = useState(loadTemplates);
  const [smsDraft, setSmsDraft] = useState({ id: null, name: "", content: "", variables: "" });
  const [jsonDraft, setJsonDraft] = useState({ id: null, name: "", payload: "", description: "" });
  const [copiedId, setCopiedId] = useState(null);

  const list = Array.isArray(commands) ? commands : [];
  const vehicleOptions = useMemo(
    () =>
      vehicles.map((vehicle) => ({
        id: vehicle.id,
        label: formatVehicleLabel(vehicle),
        deviceId: vehicle.primaryDeviceId,
      })),
    [vehicles],
  );

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => String(vehicle.id) === String(selectedVehicleId)) || null,
    [selectedVehicleId, vehicles],
  );
  const selectedDeviceId = selectedVehicle?.primaryDeviceId || "";
  const selectedDevice = useMemo(() => {
    if (!selectedDeviceId) return null;
    return (
      devices.find(
        (device) => String(device.deviceId ?? device.traccarId ?? device.id) === String(selectedDeviceId),
      ) || null
    );
  }, [devices, selectedDeviceId]);
  const protocolKey = useMemo(
    () =>
      normalizeProtocol(
        selectedDevice?.protocol || selectedDevice?.attributes?.protocol || selectedDevice?.modelProtocol || "",
      ),
    [selectedDevice],
  );
  const protocolLabel = useMemo(() => {
    const protocol = protocols.find((item) => normalizeProtocol(item.id) === protocolKey);
    return protocol?.label || protocolKey.toUpperCase() || "—";
  }, [protocolKey, protocols]);

  const selectedCommand = useMemo(
    () => protocolCommands.find((command) => command.id === selectedCommandId) || null,
    [protocolCommands, selectedCommandId],
  );
  const filteredCommands = useMemo(() => {
    const term = commandSearch.trim().toLowerCase();
    if (!term) return protocolCommands;
    return protocolCommands.filter(
      (command) =>
        command.name?.toLowerCase().includes(term) ||
        command.description?.toLowerCase().includes(term) ||
        command.tags?.some((tag) => String(tag).toLowerCase().includes(term)),
    );
  }, [commandSearch, protocolCommands]);

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
  }, [protocolKey]);

  useEffect(() => {
    let mounted = true;
    async function loadCommands() {
      if (!protocolKey) {
        setProtocolCommands([]);
        setCommandsError(null);
        return;
      }
      if (commandsCacheRef.current.has(protocolKey)) {
        setProtocolCommands(commandsCacheRef.current.get(protocolKey));
        setCommandsError(null);
        return;
      }
      setCommandsLoading(true);
      setCommandsError(null);
      try {
        const response = await api.get(`${API_ROUTES.protocols}/${protocolKey}/commands`);
        const list = Array.isArray(response?.data?.commands) ? response.data.commands : [];
        commandsCacheRef.current.set(protocolKey, list);
        if (mounted) {
          setProtocolCommands(list);
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
  }, [protocolKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templatesByProtocol));
  }, [templatesByProtocol]);

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

  async function handleSendCommand(payload) {
    setFormError(null);
    if (!selectedDeviceId) {
      setFormError(new Error("Selecione um veículo com equipamento vinculado."));
      return;
    }
    if (!payload?.type) {
      setFormError(new Error("Informe o tipo do comando."));
      return;
    }
    setSending(true);
    try {
      await sendCommand({ deviceId: selectedDeviceId, ...payload });
      reload();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError : new Error("Erro ao enviar comando"));
    } finally {
      setSending(false);
    }
  }

  async function handleSendSelectedCommand() {
    if (!selectedCommand) {
      setFormError(new Error("Selecione um comando para enviar."));
      return;
    }
    const attributes = (selectedCommand.parameters || []).reduce((acc, param) => {
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
    await handleSendCommand({ type: selectedCommand.type, attributes });
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
    <div className="space-y-6">
      <section className="card space-y-4">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">Central de comandos</p>
              <h2 className="text-lg font-semibold">Enviar comandos</h2>
              <p className="text-xs text-white/60">Os comandos são encaminhados diretamente ao dispositivo via Traccar.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
                Protocolo: {protocolLabel}
              </span>
              {protocolsLoading && (
                <span className="text-xs text-white/50">Carregando protocolos…</span>
              )}
            </div>
          </div>
          {protocolError && <p className="text-xs text-red-300">{protocolError.message}</p>}
        </header>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="space-y-2 text-sm">
            <span className="text-xs uppercase tracking-wide text-white/60">Selecionar veículo</span>
            <Select
              value={selectedVehicleId}
              onChange={(event) => setSelectedVehicleId(event.target.value)}
              className="w-full bg-layer text-sm"
            >
              <option value="">Selecione um veículo</option>
              {vehicleOptions.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.label}
                </option>
              ))}
            </Select>
            {vehiclesLoading && <span className="text-xs text-white/50">Carregando veículos…</span>}
            {vehiclesError && <span className="text-xs text-red-300">{vehiclesError.message}</span>}
            {selectedVehicle && !selectedDeviceId && (
              <span className="text-xs text-amber-200/80">Veículo sem equipamento vinculado.</span>
            )}
          </label>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-white/60">
            <p className="text-xs uppercase tracking-wide text-white/50">Resumo</p>
            <p className="mt-2">Veículo: {selectedVehicle ? formatVehicleLabel(selectedVehicle) : "—"}</p>
            <p>Equipamento: {selectedDevice?.name || selectedDevice?.uniqueId || selectedDeviceId || "—"}</p>
            <p>Protocolo: {protocolLabel || "—"}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-white/10 pb-2">
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

        {activeTab === "Comandos" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                value={commandSearch}
                onChange={(event) => setCommandSearch(event.target.value)}
                placeholder="Buscar comando por nome, descrição ou tag"
                className="flex-1"
              />
              <Button type="button" variant="outline" onClick={reload}>
                Atualizar histórico
              </Button>
            </div>

            {!protocolKey && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                Selecione um veículo com protocolo definido para visualizar comandos.
              </div>
            )}

            {protocolKey && (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs uppercase tracking-wide text-white/50">
                    <span>Comandos homologados</span>
                    <span>{filteredCommands.length} itens</span>
                  </div>
                  <div className="space-y-2">
                    {commandsLoading && <p className="text-xs text-white/60">Carregando comandos…</p>}
                    {commandsError && <p className="text-xs text-red-300">{commandsError.message}</p>}
                    {!commandsLoading && filteredCommands.length === 0 && (
                      <p className="text-xs text-white/60">Nenhum comando disponível para este protocolo.</p>
                    )}
                    {filteredCommands.map((command) => (
                      <button
                        key={command.id}
                        type="button"
                        onClick={() => handleSelectCommand(command)}
                        className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
                          selectedCommandId === command.id
                            ? "border-primary/60 bg-primary/10 text-white"
                            : "border-white/10 bg-white/5 text-white/70 hover:border-white/30"
                        }`}
                      >
                        <div className="text-sm font-semibold text-white">{command.name}</div>
                        <p className="mt-1 text-xs text-white/60">{command.description}</p>
                        {command.tags?.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
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
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs uppercase tracking-wide text-white/50">
                    <span>Parâmetros do comando</span>
                    <span>{selectedCommand ? selectedCommand.type : "Selecione um comando"}</span>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                    {!selectedCommand && <p className="text-xs text-white/60">Selecione um comando para configurar.</p>}
                    {selectedCommand && (
                      <div className="space-y-3">
                        <div>
                          <div className="text-sm font-semibold text-white">{selectedCommand.name}</div>
                          <p className="text-xs text-white/60">{selectedCommand.description}</p>
                        </div>
                        {selectedCommand.parameters?.length ? (
                          <div className="grid gap-3 md:grid-cols-2">
                            {selectedCommand.parameters.map((param) => (
                              <label key={param.key} className="text-xs uppercase tracking-wide text-white/60">
                                {param.label}
                                <input
                                  type={param.type === "number" ? "number" : "text"}
                                  min={param.min}
                                  value={commandParams[param.key] ?? ""}
                                  onChange={(event) =>
                                    setCommandParams((prev) => ({ ...prev, [param.key]: event.target.value }))
                                  }
                                  className="mt-1 w-full rounded-xl border border-border bg-layer px-3 py-2 text-sm"
                                  required={param.required}
                                />
                              </label>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-white/50">Nenhum parâmetro adicional necessário.</p>
                        )}
                        <Button type="button" onClick={handleSendSelectedCommand} disabled={sending}>
                          {sending ? "Enviando…" : "Enviar comando"}
                        </Button>
                      </div>
                    )}
                  </div>
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
                handleSendCommand({
                  type: manualType.trim(),
                  attributes: {
                    payload: manualPayload.trim(),
                    channel: manualChannel.trim() || undefined,
                  },
                })
              }
              disabled={sending}
            >
              {sending ? "Enviando…" : "Enviar comando avançado"}
            </Button>
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

        {(formError || error) && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {formError?.message || error?.message}
          </div>
        )}
      </section>

      <section className="card space-y-4">
        <header className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Histórico de comandos</h3>
          <span className="text-xs opacity-60">{list.length} registros</span>
        </header>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide opacity-60">
              <tr>
                <th className="py-2 pr-6">Dispositivo</th>
                <th className="py-2 pr-6">Tipo</th>
                <th className="py-2 pr-6">Enviado em</th>
                <th className="py-2 pr-6">Executado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-sm opacity-60">
                    Carregando comandos…
                  </td>
                </tr>
              )}
              {!loading && !list.length && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-sm opacity-60">
                    Nenhum comando encontrado para o período selecionado.
                  </td>
                </tr>
              )}
              {list.map((command) => (
                <tr key={command.id ?? `${command.deviceId}-${command.type}-${command.sentAt}`}
                  className="hover:bg-white/5"
                >
                  <td className="py-2 pr-6 text-white/80">{command.deviceId ?? command.device?.name ?? "—"}</td>
                  <td className="py-2 pr-6 text-white/70">{command.type ?? "—"}</td>
                  <td className="py-2 pr-6 text-white/60">{formatDate(command.sentAt || command.sentTime)}</td>
                  <td className="py-2 pr-6 text-white/60">{formatDate(command.deliveredAt || command.resultTime)}</td>
                </tr>
              ))}
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
