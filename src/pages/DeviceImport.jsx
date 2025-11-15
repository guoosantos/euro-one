import React, { useEffect, useMemo, useState } from "react";
import { DownloadCloud, RefreshCw } from "lucide-react";

import PageHeader from "../ui/PageHeader";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Modal from "../ui/Modal";
import Field from "../ui/Field";
import { CoreApi } from "../lib/coreApi";
import { useTenant } from "../lib/tenant-context";

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch (_error) {
    return String(value);
  }
}

export default function DeviceImport() {
  const { tenant, tenants, role } = useTenant();
  const [devices, setDevices] = useState([]);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ clientId: "", modelId: "" });
  const [saving, setSaving] = useState(false);
  const canChooseClient = role === "admin";

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [importable, availableModels] = await Promise.all([
        CoreApi.listImportableDevices({ clientId: tenant?.id }),
        CoreApi.models({ clientId: tenant?.id }),
      ]);
      setDevices(Array.isArray(importable) ? importable : []);
      setModels(Array.isArray(availableModels) ? availableModels : []);
      setForm((prev) => ({ ...prev, clientId: tenant?.id ?? prev.clientId ?? "" }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : new Error("Falha ao carregar importação"));
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id]);

  const filteredDevices = useMemo(() => {
    if (!search.trim()) {
      return devices;
    }
    const term = search.trim().toLowerCase();
    return devices.filter((device) => {
      return [device?.name, device?.uniqueId, device?.protocol, device?.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [devices, search]);

  const tenantOptions = useMemo(() => tenants || [], [tenants]);

  function openModal(device) {
    setSelected(device);
    setForm((prev) => ({
      ...prev,
      clientId: canChooseClient ? prev.clientId || tenant?.id || "" : tenant?.id || prev.clientId || "",
      modelId: "",
    }));
  }

  async function handleImport(event) {
    event.preventDefault();
    if (!selected) return;
    if (!form.clientId) {
      alert("Selecione o cliente destino");
      return;
    }
    setSaving(true);
    try {
      await CoreApi.importDevice({
        traccarId: selected.id,
        clientId: form.clientId,
        modelId: form.modelId || undefined,
        name: selected.name,
      });
      setSelected(null);
      await load();
    } catch (requestError) {
      alert(requestError?.message || "Falha ao importar equipamento");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Importar rastreadores"
        subtitle="Associe dispositivos já existentes no Traccar a um cliente do Euro One."
        right={
          <Button variant="outline" onClick={load} aria-label="Atualizar lista">
            <RefreshCw size={14} /> Atualizar
          </Button>
        }
      />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error.message}
        </div>
      )}

      <Field label="Buscar dispositivos disponíveis">
        <div className="flex flex-col gap-3 md:flex-row">
          <Input
            placeholder="Buscar por nome, protocolo ou identificador"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {canChooseClient && (
            <Select value={form.clientId} onChange={(event) => setForm((prev) => ({ ...prev, clientId: event.target.value }))}>
              <option value="">Cliente destino</option>
              {tenantOptions.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          )}
        </div>
      </Field>

      <div className="card space-y-4">
        <div className="flex items-center justify-between text-sm text-white/70">
          <span>
            {loading
              ? "Carregando dispositivos do Traccar…"
              : `${filteredDevices.length} dispositivo(s) disponíveis para importação`}
          </span>
          <span className="inline-flex items-center gap-2 text-xs text-white/50">
            <DownloadCloud size={14} /> Snapshot atualizado a cada sincronização
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-white/50">
              <tr>
                <th className="py-2 pr-6">Nome</th>
                <th className="py-2 pr-6">Identificador</th>
                <th className="py-2 pr-6">Protocolo</th>
                <th className="py-2 pr-6">Status</th>
                <th className="py-2 pr-6">Último contato</th>
                <th className="py-2 pr-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white/80">
              {loading && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-white/60">
                    Sincronizando com o Traccar…
                  </td>
                </tr>
              )}
              {!loading && filteredDevices.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-white/60">
                    Nenhum dispositivo aguardando importação.
                  </td>
                </tr>
              )}
              {!loading &&
                filteredDevices.map((device) => (
                  <tr key={device.id} className="hover:bg-white/5">
                    <td className="py-3 pr-6 font-medium">{device.name || "—"}</td>
                    <td className="py-3 pr-6 text-white/70">{device.uniqueId}</td>
                    <td className="py-3 pr-6 text-white/60">{device.protocol || "—"}</td>
                    <td className="py-3 pr-6">
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs uppercase tracking-wide">
                        {device.status || "Desconhecido"}
                      </span>
                    </td>
                    <td className="py-3 pr-6 text-white/60">{formatDate(device.lastUpdate)}</td>
                    <td className="py-3 pr-6 text-right">
                      <Button onClick={() => openModal(device)} disabled={!form.clientId && canChooseClient}>
                        Importar
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={Boolean(selected)}
        title={selected ? `Importar ${selected.name || selected.uniqueId}` : ""}
        onClose={() => setSelected(null)}
        width="max-w-3xl"
      >
        {selected && (
          <form onSubmit={handleImport} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              {canChooseClient && (
                <label className="text-sm">
                  <span className="text-xs uppercase tracking-wide text-white/60">Cliente</span>
                  <select
                    value={form.clientId}
                    onChange={(event) => setForm((prev) => ({ ...prev, clientId: event.target.value }))}
                    required
                    className="mt-1 w-full rounded-xl border border-border bg-layer px-3 py-2"
                  >
                    <option value="" disabled>
                      Selecione o cliente
                    </option>
                    {tenantOptions.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="text-sm">
                <span className="text-xs uppercase tracking-wide text-white/60">Modelo</span>
                <select
                  value={form.modelId}
                  onChange={(event) => setForm((prev) => ({ ...prev, modelId: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-border bg-layer px-3 py-2"
                >
                  <option value="">Selecionar depois</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.brand ? `${model.brand} · ${model.name}` : model.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              <div className="font-semibold text-white">Resumo do Traccar</div>
              <dl className="mt-3 grid gap-2 md:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-white/50">Identificador</dt>
                  <dd>{selected.uniqueId}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-white/50">Protocolo</dt>
                  <dd>{selected.protocol || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-white/50">Status</dt>
                  <dd>{selected.status || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-white/50">Último contato</dt>
                  <dd>{formatDate(selected.lastUpdate)}</dd>
                </div>
              </dl>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setSelected(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving || (canChooseClient && !form.clientId)}>
                {saving ? "Importando…" : "Confirmar importação"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
