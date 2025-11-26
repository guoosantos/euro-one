import { useEffect, useMemo, useState } from "react";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch (_error) {
    return String(value);
  }
}

const ICON_TYPES = [
  { value: "car", label: "Carro" },
  { value: "motorcycle", label: "Moto" },
  { value: "truck", label: "Caminhão" },
  { value: "person", label: "Pessoa" },
  { value: "tag", label: "Tag / Rastreador pequeno" },
  { value: "watercraft", label: "Jet / Embarcação" },
];

function statusBadge(device) {
  if (!device) return "—";
  if (device.statusLabel) return device.statusLabel;
  const usage = device.usageStatusLabel || (device.vehicleId ? "Ativo" : "Estoque");
  const connection = device.connectionStatusLabel ||
    (device.connectionStatus === "online"
      ? "Online"
      : device.connectionStatus === "offline"
      ? "Offline"
      : device.connectionStatus === "never"
      ? "Nunca conectado"
      : "");
  if (!connection) return usage;
  return `${usage} (${connection})`;
}

function ModelCards({ models }) {
  if (!Array.isArray(models) || models.length === 0) {
    return <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">Nenhum modelo cadastrado ainda.</div>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {models.map((model) => (
        <div key={model.id} className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-lg font-semibold text-white">{model.name}</div>
          <div className="text-sm text-white/70">{model.brand}</div>
          <dl className="mt-4 space-y-1 text-sm text-white/70">
            {model.protocol && (
              <div>
                <dt className="font-medium text-white">Protocolo</dt>
                <dd>{model.protocol}</dd>
              </div>
            )}
            {model.connectivity && (
              <div>
                <dt className="font-medium text-white">Conectividade</dt>
                <dd>{model.connectivity}</dd>
              </div>
            )}
          </dl>
          <div className="mt-4">
            <h4 className="text-sm font-semibold text-white">Portas / IO</h4>
            {Array.isArray(model.ports) && model.ports.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm text-white/70">
                {model.ports.map((port) => (
                  <li key={port.id || `${port.label}-${port.type}`} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <div className="font-medium text-white">{port.label || "Porta"}</div>
                    <div className="text-xs uppercase tracking-wide text-white/60">{port.type || "Digital"}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-white/60">Nenhuma porta cadastrada.</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Devices() {
  const { tenantId, user } = useTenant();
  const [tab, setTab] = useState("lista");
  const [devices, setDevices] = useState([]);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingDevice, setSavingDevice] = useState(false);
  const [savingModel, setSavingModel] = useState(false);

  const [deviceForm, setDeviceForm] = useState({ name: "", uniqueId: "", modelId: "", iconType: "" });
  const [modelForm, setModelForm] = useState({ name: "", brand: "", protocol: "", connectivity: "", ports: [{ label: "", type: "digital" }] });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [deviceList, modelList] = await Promise.all([CoreApi.listDevices(), CoreApi.models()]);
      setDevices(Array.isArray(deviceList) ? deviceList : []);
      setModels(Array.isArray(modelList) ? modelList : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : new Error("Falha ao carregar dados"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const modeloById = useMemo(() => {
    const map = new Map();
    models.forEach((model) => {
      if (model?.id) {
        map.set(model.id, model);
      }
    });
    return map;
  }, [models]);

  async function handleCreateDevice(event) {
    event.preventDefault();
    if (!deviceForm.uniqueId.trim()) {
      alert("Informe o IMEI / uniqueId");
      return;
    }
    setSavingDevice(true);
    try {
      await CoreApi.createDevice({
        name: deviceForm.name?.trim() || undefined,
        uniqueId: deviceForm.uniqueId.trim(),
        modelId: deviceForm.modelId || undefined,
        iconType: deviceForm.iconType || undefined,
        attributes: deviceForm.iconType ? { iconType: deviceForm.iconType } : undefined,
        clientId: tenantId || user?.clientId,
      });
      await load();
      setDeviceForm({ name: "", uniqueId: "", modelId: "", iconType: "" });
      setTab("lista");
    } catch (requestError) {
      alert(requestError?.message || "Falha ao cadastrar equipamento");
    } finally {
      setSavingDevice(false);
    }
  }

  function updateModelPort(index, key, value) {
    setModelForm((current) => {
      const ports = Array.isArray(current.ports) ? [...current.ports] : [];
      ports[index] = { ...ports[index], [key]: value };
      return { ...current, ports };
    });
  }

  function addPort() {
    setModelForm((current) => ({
      ...current,
      ports: [...(current.ports || []), { label: "", type: "digital" }],
    }));
  }

  function removePort(index) {
    setModelForm((current) => ({
      ...current,
      ports: (current.ports || []).filter((_, idx) => idx !== index),
    }));
  }

  async function handleCreateModel(event) {
    event.preventDefault();
    if (!modelForm.name.trim() || !modelForm.brand.trim()) {
      alert("Informe nome e fabricante");
      return;
    }
    setSavingModel(true);
    try {
      await CoreApi.createModel({
        name: modelForm.name.trim(),
        brand: modelForm.brand.trim(),
        protocol: modelForm.protocol?.trim() || undefined,
        connectivity: modelForm.connectivity?.trim() || undefined,
        ports: (modelForm.ports || [])
          .map((port) => ({
            label: port.label?.trim() || "Porta",
            type: port.type?.trim() || "digital",
          }))
          .filter((port) => port.label),
      });
      await load();
      setModelForm({ name: "", brand: "", protocol: "", connectivity: "", ports: [{ label: "", type: "digital" }] });
      setTab("modelos");
    } catch (requestError) {
      alert(requestError?.message || "Falha ao cadastrar modelo");
    } finally {
      setSavingModel(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setTab("lista")}
          className={`rounded-xl px-4 py-2 text-sm font-medium ${tab === "lista" ? "bg-white/20 text-white" : "bg-white/10 text-white/70"}`}
        >
          Lista
        </button>
        <button
          type="button"
          onClick={() => setTab("cadastro")}
          className={`rounded-xl px-4 py-2 text-sm font-medium ${tab === "cadastro" ? "bg-white/20 text-white" : "bg-white/10 text-white/70"}`}
        >
          Cadastro
        </button>
        <button
          type="button"
          onClick={() => setTab("modelos")}
          className={`rounded-xl px-4 py-2 text-sm font-medium ${tab === "modelos" ? "bg-white/20 text-white" : "bg-white/10 text-white/70"}`}
        >
          Modelos & Portas
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={load}
          className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20"
        >
          Atualizar
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error.message}
        </div>
      )}

      {tab === "lista" && (
        <div className="rounded-2xl border border-white/10 bg-white/5">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-white/80">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
                <tr>
                  <th className="px-4 py-3 text-left">Nome</th>
                  <th className="px-4 py-3 text-left">IMEI</th>
                  <th className="px-4 py-3 text-left">Modelo</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Última comunicação</th>
                  <th className="px-4 py-3 text-left">Veículo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-white/60">
                      Carregando equipamentos…
                    </td>
                  </tr>
                )}
                {!loading && devices.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-white/60">
                      Nenhum equipamento cadastrado.
                    </td>
                  </tr>
                )}
                {!loading &&
                  devices.map((device) => {
                    const modelo = modeloById.get(device.modelId) || null;
                    return (
                      <tr key={device.internalId || device.id || device.uniqueId} className="hover:bg-white/5">
                        <td className="px-4 py-3 text-white">{device.name || "—"}</td>
                        <td className="px-4 py-3">{device.uniqueId || "—"}</td>
                        <td className="px-4 py-3">{device.modelName || modelo?.name || "—"}</td>
                        <td className="px-4 py-3">{statusBadge(device)}</td>
                        <td className="px-4 py-3">{formatDate(device.lastCommunication)}</td>
                        <td className="px-4 py-3">{device.vehicle?.name || device.vehicle?.plate || "—"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "cadastro" && (
        <form onSubmit={handleCreateDevice} className="grid gap-4 rounded-2xl border border-white/10 bg-white/5 p-6 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-white/70">Nome (opcional)</span>
            <input
              type="text"
              value={deviceForm.name}
              onChange={(event) => setDeviceForm((current) => ({ ...current, name: event.target.value }))}
              className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-white focus:border-white/30 focus:outline-none"
              placeholder="Ex.: Rastreador Van 12"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-white/70">IMEI / uniqueId *</span>
            <input
              type="text"
              required
              value={deviceForm.uniqueId}
              onChange={(event) => setDeviceForm((current) => ({ ...current, uniqueId: event.target.value }))}
              className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-white focus:border-white/30 focus:outline-none"
              placeholder="Ex.: 866512345678901"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm md:col-span-2">
            <span className="text-white/70">Modelo</span>
            <select
              value={deviceForm.modelId}
              onChange={(event) => setDeviceForm((current) => ({ ...current, modelId: event.target.value }))}
              className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-white focus:border-white/30 focus:outline-none"
            >
              <option value="">— Selecione —</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} · {model.brand}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm md:col-span-2">
            <span className="text-white/70">Tipo de ícone no mapa</span>
            <select
              value={deviceForm.iconType}
              onChange={(event) => setDeviceForm((current) => ({ ...current, iconType: event.target.value }))}
              className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-white focus:border-white/30 focus:outline-none"
            >
              <option value="">— Selecionar —</option>
              {ICON_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-white/50">Use para personalizar o ícone do marcador deste equipamento no mapa.</span>
          </label>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={savingDevice}
              className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-60"
            >
              {savingDevice ? "Salvando…" : "Cadastrar equipamento"}
            </button>
          </div>
        </form>
      )}

      {tab === "modelos" && (
        <div className="space-y-6">
          <form onSubmit={handleCreateModel} className="grid gap-4 rounded-2xl border border-white/10 bg-white/5 p-6 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm">
              <span className="text-white/70">Nome *</span>
              <input
                type="text"
                value={modelForm.name}
                onChange={(event) => setModelForm((current) => ({ ...current, name: event.target.value }))}
                className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-white focus:border-white/30 focus:outline-none"
                placeholder="Ex.: TK-303"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              <span className="text-white/70">Fabricante *</span>
              <input
                type="text"
                value={modelForm.brand}
                onChange={(event) => setModelForm((current) => ({ ...current, brand: event.target.value }))}
                className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-white focus:border-white/30 focus:outline-none"
                placeholder="Ex.: Queclink"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              <span className="text-white/70">Protocolo</span>
              <input
                type="text"
                value={modelForm.protocol}
                onChange={(event) => setModelForm((current) => ({ ...current, protocol: event.target.value }))}
                className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-white focus:border-white/30 focus:outline-none"
                placeholder="Ex.: TK103"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              <span className="text-white/70">Conectividade</span>
              <input
                type="text"
                value={modelForm.connectivity}
                onChange={(event) => setModelForm((current) => ({ ...current, connectivity: event.target.value }))}
                className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-white focus:border-white/30 focus:outline-none"
                placeholder="Ex.: GSM/GPRS"
              />
            </label>

            <div className="md:col-span-2 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white">Portas</span>
                <button
                  type="button"
                  onClick={addPort}
                  className="rounded-lg border border-white/10 bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/20"
                >
                  + Adicionar porta
                </button>
              </div>
              <div className="space-y-3">
                {(modelForm.ports || []).map((port, index) => (
                  <div key={`port-${index}`} className="grid gap-3 md:grid-cols-5">
                    <div className="md:col-span-3">
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-white/60">
                        Nome
                        <input
                          type="text"
                          value={port.label}
                          onChange={(event) => updateModelPort(index, "label", event.target.value)}
                          className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-white focus:border-white/30 focus:outline-none"
                          placeholder="Ex.: Ignição"
                        />
                      </label>
                    </div>
                    <div className="md:col-span-2">
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-white/60">
                        Tipo
                        <select
                          value={port.type}
                          onChange={(event) => updateModelPort(index, "type", event.target.value)}
                          className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-white focus:border-white/30 focus:outline-none"
                        >
                          <option value="digital">Digital</option>
                          <option value="analógica">Analógica</option>
                          <option value="saida">Saída</option>
                          <option value="entrada">Entrada</option>
                        </select>
                      </label>
                    </div>
                    <div className="flex items-end justify-end">
                      <button
                        type="button"
                        onClick={() => removePort(index)}
                        className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white hover:bg-white/20"
                        disabled={(modelForm.ports || []).length <= 1}
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={savingModel}
                className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 disabled:opacity-60"
              >
                {savingModel ? "Salvando…" : "Salvar modelo"}
              </button>
            </div>
          </form>

          <ModelCards models={models} />
        </div>
      )}
    </div>
  );
}
