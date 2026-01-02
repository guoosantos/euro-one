import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import Button from "../ui/Button.jsx";
import Input from "../ui/Input.jsx";
import Select from "../ui/Select.jsx";
import api from "../lib/api.js";
import { API_ROUTES } from "../lib/api-routes.js";

const friendlyApiError = (error, fallbackMessage) => {
  if (error?.response?.status === 503 || error?.status === 503) {
    return "Serviço temporariamente indisponível. Tente novamente em instantes.";
  }
  if (error?.response?.data?.message) return error.response.data.message;
  if (error instanceof Error && error.message) return error.message;
  return fallbackMessage;
};

const buildEmptyForm = (protocol = "") => ({
  name: "",
  description: "",
  protocol,
  payload: "",
  visible: true,
});

export default function CreateCommands() {
  const navigate = useNavigate();
  const [protocols, setProtocols] = useState([]);
  const [protocolsLoading, setProtocolsLoading] = useState(false);
  const [protocolsError, setProtocolsError] = useState(null);
  const [filterProtocol, setFilterProtocol] = useState("");
  const [customCommands, setCustomCommands] = useState([]);
  const [customCommandsLoading, setCustomCommandsLoading] = useState(false);
  const [customCommandsError, setCustomCommandsError] = useState(null);
  const [editingCommandId, setEditingCommandId] = useState(null);
  const [savingCommand, setSavingCommand] = useState(false);
  const [deletingCommandId, setDeletingCommandId] = useState(null);
  const [form, setForm] = useState(buildEmptyForm());
  const [toast, setToast] = useState(null);
  const toastTimeoutRef = useRef(null);

  const showToast = useCallback((message, type = "success") => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => () => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
  }, []);

  const fetchProtocols = useCallback(async () => {
    setProtocolsLoading(true);
    setProtocolsError(null);
    try {
      const response = await api.get(API_ROUTES.protocols);
      const items = Array.isArray(response?.data?.protocols) ? response.data.protocols : [];
      setProtocols(items);
      return items;
    } catch (error) {
      setProtocolsError(new Error(friendlyApiError(error, "Erro ao carregar protocolos")));
      return [];
    } finally {
      setProtocolsLoading(false);
    }
  }, []);

  const fetchCustomCommands = useCallback(async () => {
    setCustomCommandsLoading(true);
    setCustomCommandsError(null);
    const params = {
      includeHidden: true,
      ...(filterProtocol ? { protocol: filterProtocol } : {}),
    };
    try {
      const response = await api.get(API_ROUTES.commandsCustom, { params });
      const items = Array.isArray(response?.data?.data) ? response.data.data : [];
      setCustomCommands(items);
      if (response?.data?.error?.message) {
        setCustomCommandsError(new Error(response.data.error.message));
      }
      return items;
    } catch (error) {
      setCustomCommandsError(new Error(friendlyApiError(error, "Erro ao carregar comandos personalizados")));
      return [];
    } finally {
      setCustomCommandsLoading(false);
    }
  }, [filterProtocol]);

  useEffect(() => {
    fetchProtocols().catch(() => {});
  }, [fetchProtocols]);

  useEffect(() => {
    fetchCustomCommands().catch(() => {});
  }, [fetchCustomCommands]);

  useEffect(() => {
    if (!protocols.length) return;
    setForm((current) => {
      if (current.protocol) return current;
      return { ...current, protocol: protocols[0]?.id || "" };
    });
    setFilterProtocol((current) => current || protocols[0]?.id || "");
  }, [protocols]);

  const protocolOptions = useMemo(() => {
    return protocols.map((protocol) => ({
      id: protocol.id,
      label: protocol.label || protocol.id,
      description: protocol.description,
    }));
  }, [protocols]);

  const protocolLabelLookup = useMemo(() => {
    return new Map(protocolOptions.map((protocol) => [protocol.id, protocol.label]));
  }, [protocolOptions]);

  const resetForm = useCallback((protocolValue) => {
    setForm(buildEmptyForm(protocolValue));
    setEditingCommandId(null);
  }, []);

  const handleEditCommand = (command) => {
    if (!command) return;
    setEditingCommandId(command.id);
    setForm({
      name: command.name || "",
      description: command.description || "",
      protocol: command.protocol || "",
      payload: command.payload?.data || "",
      visible: Boolean(command.visible),
    });
  };

  const handleSaveCommand = async () => {
    const name = form.name.trim();
    const protocol = form.protocol.trim();
    const payload = form.payload.trim();

    if (!name) {
      showToast("Informe o nome do comando.", "error");
      return;
    }
    if (!protocol) {
      showToast("Selecione o protocolo do comando.", "error");
      return;
    }
    if (!payload) {
      showToast("Informe o payload do comando.", "error");
      return;
    }

    setSavingCommand(true);
    try {
      const body = {
        name,
        description: form.description.trim() || null,
        protocol,
        kind: "RAW",
        visible: form.visible,
        payload: { data: payload },
      };

      if (editingCommandId) {
        await api.put(`${API_ROUTES.commandsCustom}/${editingCommandId}`, body);
      } else {
        await api.post(API_ROUTES.commandsCustom, body);
      }

      await fetchCustomCommands();
      resetForm(protocol);
      showToast("Comando salvo com sucesso.");
    } catch (error) {
      showToast(error?.response?.data?.message || error?.message || "Erro ao salvar comando", "error");
    } finally {
      setSavingCommand(false);
    }
  };

  const handleDeleteCommand = async (commandId) => {
    const confirmed = window.confirm("Deseja remover este comando personalizado?");
    if (!confirmed) return;
    setDeletingCommandId(commandId);
    try {
      await api.delete(`${API_ROUTES.commandsCustom}/${commandId}`);
      await fetchCustomCommands();
      if (editingCommandId === commandId) {
        resetForm(form.protocol);
      }
      showToast("Comando removido com sucesso.");
    } catch (error) {
      showToast(error?.response?.data?.message || error?.message || "Erro ao remover comando", "error");
    } finally {
      setDeletingCommandId(null);
    }
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
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">Gestão de comandos personalizados</p>
              <p className="text-sm text-white/70">Cadastre comandos de texto simples associados ao protocolo.</p>
            </div>
            <Button type="button" variant="outline" onClick={() => navigate("/commands")}
            >
              Ir para Comandos
            </Button>
          </div>
        </header>

        <div className="mx-6 mb-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <div className="rounded-2xl border border-white/10 bg-[#0b0f17] p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white/90">
                {editingCommandId ? "Editar comando" : "Criar comando"}
              </p>
              {editingCommandId && (
                <Button type="button" variant="outline" onClick={() => resetForm(form.protocol)}>
                  Cancelar edição
                </Button>
              )}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="flex flex-col text-xs uppercase tracking-wide text-white/60 md:col-span-2">
                Nome do comando
                <Input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  className="mt-2"
                />
              </label>
              <label className="flex flex-col text-xs uppercase tracking-wide text-white/60 md:col-span-2">
                Descrição (opcional)
                <Input
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  className="mt-2"
                />
              </label>
              <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
                Protocolo
                <Select
                  value={form.protocol}
                  onChange={(event) => setForm((current) => ({ ...current, protocol: event.target.value }))}
                  className="mt-2 w-full bg-layer text-sm"
                >
                  <option value="">Selecione</option>
                  {protocolOptions.map((protocol) => (
                    <option key={protocol.id} value={protocol.id}>
                      {protocol.label}
                    </option>
                  ))}
                </Select>
                {protocolsLoading && <span className="mt-2 text-[11px] text-white/50">Carregando protocolos…</span>}
                {protocolsError && <span className="mt-2 text-[11px] text-red-300">{protocolsError.message}</span>}
              </label>
              <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-white/60">
                <input
                  type="checkbox"
                  checked={form.visible}
                  onChange={(event) => setForm((current) => ({ ...current, visible: event.target.checked }))}
                  className="h-4 w-4 rounded border-white/20 bg-transparent"
                />
                Visível em Comandos
              </label>
              <label className="flex flex-col text-xs uppercase tracking-wide text-white/60 md:col-span-2">
                Payload (texto)
                <textarea
                  value={form.payload}
                  onChange={(event) => setForm((current) => ({ ...current, payload: event.target.value }))}
                  rows={5}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80"
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" onClick={handleSaveCommand} disabled={savingCommand}>
                {savingCommand ? "Salvando…" : "Salvar"}
              </Button>
              <Button type="button" variant="outline" onClick={() => resetForm(form.protocol)}>
                Limpar
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#0b0f17] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white/90">Comandos cadastrados</p>
              <label className="flex flex-col text-[11px] uppercase tracking-wide text-white/60">
                Filtrar por protocolo
                <Select
                  value={filterProtocol}
                  onChange={(event) => setFilterProtocol(event.target.value)}
                  className="mt-2 w-full bg-layer text-sm"
                >
                  {protocolOptions.map((protocol) => (
                    <option key={protocol.id} value={protocol.id}>
                      {protocol.label}
                    </option>
                  ))}
                </Select>
              </label>
            </div>

            <div className="mt-4 space-y-2">
              {customCommandsLoading && <p className="text-sm text-white/60">Carregando comandos…</p>}
              {customCommandsError && <p className="text-sm text-red-300">{customCommandsError.message}</p>}
              {!customCommandsLoading && !customCommandsError && customCommands.length === 0 && (
                <p className="text-sm text-white/60">Nenhum comando personalizado cadastrado.</p>
              )}
              {!customCommandsLoading &&
                !customCommandsError &&
                customCommands.map((command) => (
                  <div key={command.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white/90">{command.name}</p>
                        <p className="text-[11px] uppercase tracking-wide text-primary/70">
                          {protocolLabelLookup.get(command.protocol) || command.protocol}
                          {" · "}
                          {command.visible ? "Visível" : "Oculto"}
                        </p>
                        {command.description && <p className="mt-1 text-xs text-white/60">{command.description}</p>}
                        {command.payload?.data && (
                          <p className="mt-2 text-[11px] text-white/60">
                            Payload: <span className="text-white/80">{command.payload.data}</span>
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-2">
                        <Button type="button" variant="outline" onClick={() => handleEditCommand(command)}>
                          Editar
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          onClick={() => handleDeleteCommand(command.id)}
                          disabled={deletingCommandId === command.id}
                        >
                          {deletingCommandId === command.id ? "Removendo…" : "Excluir"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
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
