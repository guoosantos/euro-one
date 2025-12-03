import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";

import Button from "../ui/Button";
import Modal from "../ui/Modal";
import Input from "../ui/Input";
import Select from "../ui/Select";
import PageHeader from "../ui/PageHeader";
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
  const connection =
    device.connectionStatusLabel ||
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
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">
        Nenhum modelo cadastrado ainda.
      </div>
    );
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
  const [chips, setChips] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingDevice, setSavingDevice] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [showDeviceModal, setShowDeviceModal] = useState(false);

  const resolvedClientId = tenantId || user?.clientId || null;

  const [deviceForm, setDeviceForm] = useState({
    name: "",
    uniqueId: "",
    modelId: "",
    iconType: "",
    chipId: "",
    vehicleId: "",
  });
  const [modelForm, setModelForm] = useState({
    name: "",
    brand: "",
    protocol: "",
    connectivity: "",
    ports: [{ label: "", type: "digital" }],
  });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const clientId = tenantId || user?.clientId;
      const [deviceList, modelList, chipList, vehicleList] = await Promise.all([
        CoreApi.listDevices(clientId ? { clientId } : undefined),
        CoreApi.models(clientId ? { clientId, includeGlobal: true } : undefined),
        CoreApi.listChips(clientId ? { clientId } : undefined),
        CoreApi.listVehicles(clientId ? { clientId } : undefined),
      ]);
      setDevices(Array.isArray(deviceList) ? deviceList : []);
      setModels(Array.isArray(modelList) ? modelList : []);
      setChips(Array.isArray(chipList) ? chipList : []);
      setVehicles(Array.isArray(vehicleList) ? vehicleList : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : new Error("Falha ao carregar dados"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (resolvedClientId || user) {
      load();
    }
  }, [resolvedClientId, user]);

  const modeloById = useMemo(() => {
    const map = new Map();
    models.forEach((model) => {
      if (model?.id) {
        map.set(model.id, model);
      }
    });
    return map;
  }, [models]);

  const chipOptions = useMemo(() => {
    return chips.map((chip) => ({
      value: chip.id,
      label: chip.iccid || chip.phone || chip.device?.uniqueId || chip.id,
    }));
  }, [chips]);

  const vehicleOptions = useMemo(() => {
    return vehicles.map((vehicle) => ({
      value: vehicle.id,
      label: vehicle.name || vehicle.plate || vehicle.id,
    }));
  }, [vehicles]);

  function resetDeviceForm() {
    setDeviceForm({ name: "", uniqueId: "", modelId: "", iconType: "", chipId: "", vehicleId: "" });
    setEditingId(null);
  }

  async function handleSaveDevice(event) {
    event.preventDefault();
    if (!deviceForm.uniqueId.trim()) {
      alert("Informe o IMEI / uniqueId");
      return;
    }
    setSavingDevice(true);
    try {
      const payload = {
        name: deviceForm.name?.trim() || undefined,
        uniqueId: deviceForm.uniqueId.trim(),
        modelId: deviceForm.modelId || undefined,
        iconType: deviceForm.iconType || undefined,
        attributes: deviceForm.iconType ? { iconType: deviceForm.iconType } : undefined,
        chipId: deviceForm.chipId || undefined,
        vehicleId: deviceForm.vehicleId || undefined,
        clientId: tenantId || user?.clientId,
      };
      if (editingId) {
        await CoreApi.updateDevice(editingId, payload);
      } else {
        await CoreApi.createDevice(payload);
      }
      await load();
      resetDeviceForm();
      setShowDeviceModal(false);
      setTab("lista");
    } catch (requestError) {
      alert(requestError?.message || "Falha ao salvar equipamento");
    } finally {
      setSavingDevice(false);
    }
  }

  async function handleDeleteDevice(id) {
    if (!id) return;
    if (!window.confirm("Remover este equipamento?")) return;
    try {
      await CoreApi.deleteDevice(id, { clientId: tenantId || user?.clientId });
      await load();
    } catch (requestError) {
      alert(requestError?.message || "Não foi possível remover o equipamento");
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

  function openEditDevice(device) {
    setEditingId(device.id);
    setDeviceForm({
      name: device.name || "",
      uniqueId: device.uniqueId || "",
      modelId: device.modelId || "",
      iconType: device.iconType || device.attributes?.iconType || "",
      chipId: device.chipId || "",
      vehicleId: device.vehicleId || "",
    });
    setShowDeviceModal(true);
    setTab("cadastro");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Equipamentos"
        description="Cadastre e vincule rastreadores a chips e veículos do tenant atual."
        right={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={load} icon={RefreshCw}>
              Atualizar
            </Button>
            <Button onClick={() => setShowDeviceModal(true)} icon={Plus}>
              Novo equipamento
            </Button>
          </div>
        }
      />

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
          onClick={() => {
            resetDeviceForm();
            setTab("cadastro");
            setShowDeviceModal(true);
          }}
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
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error.message}</div>
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
                  <th className="px-4 py-3 text-left">Chip</th>
                  <th className="px-4 py-3 text-left">Veículo</th>
                  <th className="px-4 py-3 text-left">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {loading && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-white/60">
                      Carregando equipamentos…
                    </td>
                  </tr>
                )}
                {!loading && devices.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-white/60">
                      Nenhum equipamento cadastrado.
                    </td>
                  </tr>
                )}
                {!loading &&
                  devices.map((device) => {
                    const modelo = modeloById.get(device.modelId) || null;
                    const chip = chips.find((item) => item.id === device.chipId) || device.chip;
                    const vehicle = vehicles.find((item) => item.id === device.vehicleId) || device.vehicle;
                    return (
                      <tr key={device.internalId || device.id || device.uniqueId} className="hover:bg-white/5">
                        <td className="px-4 py-3 text-white">{device.name || "—"}</td>
                        <td className="px-4 py-3">{device.uniqueId || "—"}</td>
                        <td className="px-4 py-3">{device.modelName || modelo?.name || "—"}</td>
                        <td className="px-4 py-3">{statusBadge(device)}</td>
                        <td className="px-4 py-3">{chip?.iccid || chip?.phone || "—"}</td>
                        <td className="px-4 py-3">{vehicle?.name || vehicle?.plate || "—"}</td>
                        <td className="px-4 py-3 space-x-2 whitespace-nowrap">
                          <Button size="sm" variant="ghost" onClick={() => openEditDevice(device)}>
                            Editar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDeleteDevice(device.id)} icon={Trash2}>
                            Remover
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "modelos" && (
        <div className="space-y-5">
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

      <Modal open={showDeviceModal} onClose={() => setShowDeviceModal(false)} title={editingId ? "Editar equipamento" : "Novo equipamento"} width="max-w-3xl">
        <form onSubmit={handleSaveDevice} className="grid gap-4 md:grid-cols-2">
          <Input
            label="Nome (opcional)"
            value={deviceForm.name}
            onChange={(event) => setDeviceForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Ex.: Rastreador Van 12"
          />
          <Input
            label="IMEI / uniqueId *"
            required
            value={deviceForm.uniqueId}
            onChange={(event) => setDeviceForm((current) => ({ ...current, uniqueId: event.target.value }))}
            placeholder="Ex.: 866512345678901"
          />
          <Select
            label="Modelo"
            value={deviceForm.modelId}
            onChange={(event) => setDeviceForm((current) => ({ ...current, modelId: event.target.value }))}
          >
            <option value="">— Selecione —</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} · {model.brand}
              </option>
            ))}
          </Select>
          <Select
            label="Tipo de ícone no mapa"
            value={deviceForm.iconType}
            onChange={(event) => setDeviceForm((current) => ({ ...current, iconType: event.target.value }))}
          >
            <option value="">Padrão</option>
            {ICON_TYPES.map((icon) => (
              <option key={icon.value} value={icon.value}>
                {icon.label}
              </option>
            ))}
          </Select>
          <Select
            label="Chip vinculado"
            value={deviceForm.chipId}
            onChange={(event) => setDeviceForm((current) => ({ ...current, chipId: event.target.value }))}
          >
            <option value="">— Sem chip —</option>
            {chipOptions.map((chip) => (
              <option key={chip.value} value={chip.value}>
                {chip.label}
              </option>
            ))}
          </Select>
          <Select
            label="Veículo"
            value={deviceForm.vehicleId}
            onChange={(event) => setDeviceForm((current) => ({ ...current, vehicleId: event.target.value }))}
          >
            <option value="">— Sem veículo —</option>
            {vehicleOptions.map((vehicle) => (
              <option key={vehicle.value} value={vehicle.value}>
                {vehicle.label}
              </option>
            ))}
          </Select>
          <div className="md:col-span-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowDeviceModal(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={savingDevice}>
              {savingDevice ? "Salvando…" : editingId ? "Atualizar" : "Salvar"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
