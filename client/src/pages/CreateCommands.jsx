import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Button from "../ui/Button.jsx";
import Input from "../ui/Input.jsx";
import Select from "../ui/Select.jsx";
import api from "../lib/api.js";
import { API_ROUTES } from "../lib/api-routes.js";

const EMPTY_FORM = {
  name: "",
  description: "",
  protocol: "",
  payload: "",
  visible: true,
};

const isHexLikePayload = (value) => {
  const compact = String(value ?? "").replace(/\s+/g, "");
  if (!compact) return false;
  return /^[0-9a-fA-F]+$/.test(compact) && compact.length % 2 === 0;
};

export default function CreateCommands({ readOnly = false }) {
  const [protocols, setProtocols] = useState([]);
  const [protocolsLoading, setProtocolsLoading] = useState(false);
  const [customCommands, setCustomCommands] = useState([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [commandsError, setCommandsError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [filterProtocol, setFilterProtocol] = useState("");
  const [toast, setToast] = useState(null);
  const toastTimeoutRef = useRef(null);

  const showToast = useCallback((message, type = "success") => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(
    () => () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    },
    [],
  );

  const fetchProtocols = useCallback(async () => {
    setProtocolsLoading(true);
    try {
      const response = await api.get(API_ROUTES.protocols);
      const list = Array.isArray(response?.data?.protocols) ? response.data.protocols : [];
      setProtocols(list);
    } catch (_error) {
      setProtocols([]);
    } finally {
      setProtocolsLoading(false);
    }
  }, []);

  const fetchCustomCommands = useCallback(async () => {
    setCommandsLoading(true);
    setCommandsError(null);
    try {
      const response = await api.get(API_ROUTES.commandsCustom, { params: { includeHidden: true } });
      const items = Array.isArray(response?.data?.data) ? response.data.data : [];
      setCustomCommands(items);
    } catch (error) {
      setCommandsError(new Error(error?.response?.data?.message || error?.message || "Erro ao carregar comandos"));
    } finally {
      setCommandsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProtocols().catch(() => {});
    fetchCustomCommands().catch(() => {});
  }, [fetchCustomCommands, fetchProtocols]);

  const protocolOptions = useMemo(() => {
    return protocols.map((protocol) => ({
      value: protocol?.id ?? protocol?.name ?? protocol?.protocol ?? protocol,
      label: protocol?.label ?? protocol?.name ?? protocol?.id ?? protocol,
    }));
  }, [protocols]);

  const rawCommands = useMemo(
    () => customCommands.filter((command) => String(command?.kind || "").toUpperCase() === "RAW"),
    [customCommands],
  );

  const filteredCommands = useMemo(() => {
    if (!filterProtocol) return rawCommands;
    return rawCommands.filter((command) => String(command?.protocol || "") === String(filterProtocol));
  }, [filterProtocol, rawCommands]);

  const resetForm = useCallback(() => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }, []);

  const handleFormChange = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleEdit = (command) => {
    setEditingId(command.id);
    setForm({
      name: command.name || "",
      description: command.description || "",
      protocol: command.protocol || "",
      payload: command.payload?.data || "",
      visible: Boolean(command.visible),
    });
  };

  const handleSave = async () => {
    if (readOnly) {
      showToast("Acesso somente leitura.", "warning");
      return;
    }
    const name = form.name.trim();
    const protocol = form.protocol.trim();
    const payload = String(form.payload ?? "");
    const trimmedPayload = payload.trim();

    if (!name) {
      showToast("Informe o nome do comando.", "error");
      return;
    }
    if (!protocol) {
      showToast("Selecione o protocolo.", "error");
      return;
    }
    if (!trimmedPayload) {
      showToast("Informe o payload do comando.", "error");
      return;
    }
    if (/^[\[{]/.test(trimmedPayload)) {
      showToast("Payload deve ser texto puro (não use JSON).", "error");
      return;
    }
    if (isHexLikePayload(trimmedPayload)) {
      showToast("Payload deve ser texto puro (não use HEX).", "error");
      return;
    }

    setSaving(true);
    try {
      const body = {
        name,
        description: form.description.trim() || null,
        protocol,
        kind: "RAW",
        visible: Boolean(form.visible),
        payload: { data: payload },
      };

      if (editingId) {
        await api.put(`${API_ROUTES.commandsCustom}/${editingId}`, body);
      } else {
        await api.post(API_ROUTES.commandsCustom, body);
      }
      showToast("Comando salvo com sucesso.");
      await fetchCustomCommands();
      resetForm();
    } catch (error) {
      showToast(error?.response?.data?.message || error?.message || "Erro ao salvar comando", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (commandId) => {
    if (readOnly) {
      showToast("Acesso somente leitura.", "warning");
      return;
    }
    const confirmed = window.confirm("Deseja remover este comando personalizado?");
    if (!confirmed) return;
    setDeletingId(commandId);
    try {
      await api.delete(`${API_ROUTES.commandsCustom}/${commandId}`);
      showToast("Comando removido.");
      await fetchCustomCommands();
      if (editingId === commandId) {
        resetForm();
      }
    } catch (error) {
      showToast(error?.response?.data?.message || error?.message || "Erro ao remover comando", "error");
    } finally {
      setDeletingId(null);
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
      <section className="card flex min-h-0 flex-1 flex-col gap-4 p-6">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-white/50">Comandos personalizados</p>
          <p className="text-sm text-white/70">
            Cadastre comandos RAW para aparecerem na central de comandos conforme o protocolo selecionado.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.55fr)]">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
                Nome
                <Input
                  value={form.name}
                  onChange={(event) => handleFormChange("name", event.target.value)}
                  className="mt-2"
                  disabled={readOnly}
                />
              </label>
              <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
                Protocolo
                <Select
                  value={form.protocol}
                  onChange={(event) => handleFormChange("protocol", event.target.value)}
                  className="mt-2 w-full bg-layer text-sm"
                  disabled={readOnly}
                >
                  <option value="">Selecione</option>
                  {protocolOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                {protocolsLoading && <span className="mt-2 text-[11px] text-white/50">Carregando protocolos…</span>}
              </label>
              <label className="flex flex-col text-xs uppercase tracking-wide text-white/60 md:col-span-2">
                Descrição (opcional)
                <Input
                  value={form.description}
                  onChange={(event) => handleFormChange("description", event.target.value)}
                  className="mt-2"
                  disabled={readOnly}
                />
              </label>
            </div>

            <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
              Payload (texto)
              <textarea
                value={form.payload}
                onChange={(event) => handleFormChange("payload", event.target.value)}
                rows={4}
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80"
                disabled={readOnly}
              />
            </label>

            <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-white/60">
              <input
                type="checkbox"
                checked={form.visible}
                onChange={(event) => handleFormChange("visible", event.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-transparent"
                disabled={readOnly}
              />
              Visível em Comandos
            </label>

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={handleSave} disabled={saving || readOnly}>
                {saving ? "Salvando…" : editingId ? "Atualizar" : "Criar"}
              </Button>
              <Button type="button" variant="outline" onClick={resetForm}>
                Limpar
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs uppercase tracking-wide text-white/60">Comandos cadastrados</p>
            <label className="flex flex-col text-xs uppercase tracking-wide text-white/60">
              Filtrar por protocolo
              <Select
                value={filterProtocol}
                onChange={(event) => setFilterProtocol(event.target.value)}
                className="mt-2 w-full bg-layer text-sm"
              >
                <option value="">Todos</option>
                {protocolOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </label>
            {commandsLoading && <p className="text-sm text-white/60">Carregando comandos…</p>}
            {commandsError && <p className="text-sm text-red-300">{commandsError.message}</p>}
            {!commandsLoading && !commandsError && filteredCommands.length === 0 && (
              <p className="text-sm text-white/60">Nenhum comando RAW cadastrado.</p>
            )}
            {!commandsLoading && !commandsError && filteredCommands.length > 0 && (
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <table className="w-full table-fixed border-collapse text-left text-xs">
                  <thead className="bg-[#0f141c] text-[11px] uppercase tracking-[0.12em] text-white/60">
                    <tr>
                      <th className="px-3 py-2">Nome</th>
                      <th className="px-3 py-2">Protocolo</th>
                      <th className="px-3 py-2">Visível</th>
                      <th className="px-3 py-2">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 text-white/80">
                    {filteredCommands.map((command) => (
                      <tr key={command.id} className="bg-[#0b0f17]">
                        <td className="px-3 py-2">
                          <div>
                            <p className="text-sm font-semibold text-white/90">{command.name}</p>
                            {command.description && <p className="text-[11px] text-white/60">{command.description}</p>}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-[11px]">{command.protocol || "—"}</td>
                        <td className="px-3 py-2 text-[11px]">{command.visible ? "Sim" : "Não"}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="outline" onClick={() => handleEdit(command)} disabled={readOnly}>
                              Editar
                            </Button>
                            <Button
                              type="button"
                              variant="danger"
                              onClick={() => handleDelete(command.id)}
                              disabled={readOnly || deletingId === command.id}
                            >
                              {deletingId === command.id ? "Removendo…" : "Excluir"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50">
          <div className={`rounded-xl border px-4 py-3 text-sm shadow-lg ${toastClassName}`}>{toast.message}</div>
        </div>
      )}
    </div>
  );
}
