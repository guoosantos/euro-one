import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { Plus, RefreshCw, Trash2, MapPin } from "lucide-react";
import { latLngBounds } from "leaflet";
import "leaflet/dist/leaflet.css";

import Button from "../ui/Button";
import Modal from "../ui/Modal";
import Input from "../ui/Input";
import Select from "../ui/Select";
import PageHeader from "../ui/PageHeader";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { useLivePositions } from "../lib/hooks/useLivePositions.js";
import useTraccarDevices from "../lib/hooks/useTraccarDevices.js";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";

const ICON_TYPES = [
  { value: "car", label: "Carro" },
  { value: "motorcycle", label: "Moto" },
  { value: "truck", label: "Caminhão" },
  { value: "person", label: "Pessoa" },
  { value: "tag", label: "Tag / Rastreador pequeno" },
  { value: "watercraft", label: "Jet / Embarcação" },
];

function parsePositionTime(position) {
  if (!position) return null;
  const time = Date.parse(
    position.fixTime ?? position.deviceTime ?? position.serverTime ?? position.timestamp ?? position.time ?? 0,
  );
  return Number.isNaN(time) ? null : time;
}

function pickLatestPosition(...positions) {
  return positions
    .filter(Boolean)
    .reduce((latest, current) => {
      const currentTime = parsePositionTime(current);
      if (!latest) return { ...current, parsedTime: currentTime };
      const latestTime = parsePositionTime(latest);
      if (currentTime !== null && (latestTime === null || currentTime > latestTime)) {
        return { ...current, parsedTime: currentTime };
      }
      return latest;
    }, null);
}

function formatDate(value) {
  const parsed = Date.parse(value || 0);
  if (!value || Number.isNaN(parsed)) return null;
  return new Date(parsed).toLocaleString();
}

function formatBattery(position) {
  if (!position) return "—";
  const battery =
    position.batteryLevel ?? position.attributes?.batteryLevel ?? position.attributes?.battery ?? position.battery;
  if (battery === undefined || battery === null) return "—";
  if (typeof battery === "number" && !Number.isNaN(battery)) return `${battery}%`;
  return String(battery);
}

function formatPositionTimestamps(position) {
  if (!position) return "—";
  const parts = [];
  const gpsTime = formatDate(position.fixTime);
  if (gpsTime) parts.push(`GPS: ${gpsTime}`);
  const deviceTime = formatDate(position.deviceTime);
  if (deviceTime && deviceTime !== gpsTime) parts.push(`Dispositivo: ${deviceTime}`);
  const serverTime = formatDate(position.serverTime);
  if (serverTime && serverTime !== gpsTime && serverTime !== deviceTime) parts.push(`Servidor: ${serverTime}`);
  const eventTime = formatDate(position.eventTime || position.eventtime);
  if (eventTime) parts.push(`Evento: ${eventTime}`);
  const timestampTime = formatDate(position.timestamp);
  if (!parts.length && timestampTime) parts.push(`Timestamp: ${timestampTime}`);
  return parts.length ? parts.join(" · ") : "—";
}

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
  const { positions } = useLivePositions();
  const { byId: traccarById, byUniqueId: traccarByUniqueId, loading: traccarLoading } = useTraccarDevices();
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
  const [conflictDevice, setConflictDevice] = useState(null);
  const [linkTarget, setLinkTarget] = useState(null);
  const [linkVehicleId, setLinkVehicleId] = useState("");
  const [linkQuery, setLinkQuery] = useState("");

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
  const [query, setQuery] = useState("");
  const [mapTarget, setMapTarget] = useState(null);
  const mapRef = useRef(null);

  const positionMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(positions) ? positions : []).forEach((position) => {
      const key = toDeviceKey(position?.deviceId ?? position?.device_id ?? position?.deviceID ?? position?.deviceid);
      if (!key) return;
      const time = parsePositionTime(position);
      const existing = map.get(key);
      if (!existing || (time !== null && (existing.parsedTime === undefined || time > existing.parsedTime))) {
        map.set(key, { ...position, parsedTime: time });
      }
    });
    return map;
  }, [positions]);

  const deviceKey = (device) => toDeviceKey(device?.traccarId ?? device?.id ?? device?.internalId ?? device?.uniqueId);

  const traccarDeviceFor = (device) => {
    const byIdMatch = device?.traccarId != null ? traccarById.get(String(device.traccarId)) : null;
    if (byIdMatch) return byIdMatch;
    if (device?.uniqueId) return traccarByUniqueId.get(String(device.uniqueId)) || null;
    return null;
  };

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const clientId = tenantId || user?.clientId;
      const vehiclesParams = clientId ? { clientId } : {};
      if (["admin", "manager"].includes(user?.role)) {
        vehiclesParams.includeUnlinked = true;
      }
      const [deviceList, modelList, chipList, vehicleList] = await Promise.all([
        CoreApi.listDevices(clientId ? { clientId } : undefined),
        CoreApi.models(clientId ? { clientId, includeGlobal: true } : undefined),
        CoreApi.listChips(clientId ? { clientId } : undefined),
        CoreApi.listVehicles(vehiclesParams),
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

  useEffect(() => {
    const map = mapRef.current;
    const target = mapTarget?.position;
    if (!map || !target) return;
    const lat = Number(target.latitude ?? target.lat ?? target.latitute);
    const lng = Number(target.longitude ?? target.lon ?? target.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const bounds = latLngBounds([[lat, lng]]);
    map.fitBounds(bounds.pad(0.02), { maxZoom: 16 });
    setTimeout(() => map.invalidateSize(), 50);
  }, [mapTarget]);

  useEffect(() => {
    if (linkTarget?.vehicleId) {
      setLinkVehicleId(linkTarget.vehicleId);
    }
  }, [linkTarget]);

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

  const filteredDevices = useMemo(() => {
    if (!query.trim()) return devices;
    const term = query.trim().toLowerCase();
    return devices.filter((device) =>
      [device.name, device.uniqueId, device.imei]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [devices, query]);

  const latestPositionByDevice = useMemo(() => {
    const map = new Map();
    filteredDevices.forEach((device) => {
      const key = deviceKey(device);
      if (!key) return;

      const pos = positionMap.get(key);
      if (pos) {
        map.set(key, pos);

      }
    });
    return map;
  }, [filteredDevices, positionMap]);


  function parseTimestamp(value) {
    if (!value) return null;
    const ts = Date.parse(value);
    return Number.isNaN(ts) ? null : ts;
  }

  function getStatus(device) {
    const key = deviceKey(device);
    const position = latestPositionByDevice.get(key);
    const traccarDevice = traccarDeviceFor(device);
    const positionFresh = position?.parsedTime ? Date.now() - position.parsedTime : null;
    if (positionFresh != null) {
      const isOnline = positionFresh < 5 * 60 * 1000;

      return isOnline ? "Online" : "Offline";
    }
    if (traccarDevice?.status) {
      const status = String(traccarDevice.status).toLowerCase();
      if (status === "online") return "Online";
      if (status === "offline") return "Offline";
      if (status === "unknown") return "Desconhecido";
    }
    return statusBadge(device);
  }


  function formatPosition(device) {
    const key = deviceKey(device);
    const position = latestPositionByDevice.get(key);

    if (!position) return "—";
    const lat = Number(position.latitude ?? position.lat ?? position.latitute);
    const lon = Number(position.longitude ?? position.lon ?? position.lng);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }
    return "—";
  }


  function formatSpeed(device) {
    const key = deviceKey(device);
    const position = latestPositionByDevice.get(key);

    if (!position?.speed) return "0 km/h";
    const speedKmh = Number(position.speed) * 1.852 || Number(position.speed);
    if (!Number.isFinite(speedKmh)) return "—";
    return `${speedKmh.toFixed(1)} km/h`;
  }


  function formatLastCommunication(device) {
    const key = deviceKey(device);
    const position = latestPositionByDevice.get(key);
    const traccarDevice = traccarDeviceFor(device);
    const positionTime = position?.parsedTime || null;
    const statusTime = parseTimestamp(traccarDevice?.lastUpdate || traccarDevice?.lastCommunication);
    const deviceTime = parseTimestamp(device.lastCommunication || device.lastUpdate);
    const latestTime = Math.max(positionTime || 0, statusTime || 0, deviceTime || 0);
    if (!latestTime) return "—";
    return new Date(latestTime).toLocaleString();
  }

  function formatBattery(device) {
    const key = deviceKey(device);
    const position = latestPositionByDevice.get(key);
    if (!position) return "—";
    const attrs = position.attributes || {};
    const battery = attrs.batteryLevel ?? attrs.battery ?? attrs.power ?? attrs.charge;
    if (battery === null || battery === undefined) return "—";
    const numericBattery = Number(battery);
    if (Number.isFinite(numericBattery)) {
      const bounded = Math.max(0, Math.min(100, numericBattery));
      return `${bounded.toFixed(0)}%`;
    }
    return String(battery);
  }

  function formatIgnition(device) {
    const key = deviceKey(device);
    const position = latestPositionByDevice.get(key);
    const attrs = position?.attributes || {};
    if (typeof attrs.ignition === "boolean") {
      return attrs.ignition ? "Ignição ON" : "Ignição OFF";
    }
    return null;

  }

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
        const response = await CoreApi.createDevice(payload);
        const upserted = response?.device && response?.upserted;
        if (upserted) {
          alert("Equipamento já existia e foi sincronizado com sucesso.");
        }
      }
      await load();
      resetDeviceForm();
      setShowDeviceModal(false);
      setTab("lista");
    } catch (requestError) {
      const isConflict = requestError?.response?.status === 409;
      const code = requestError?.response?.data?.code;
      if (isConflict && code === "DEVICE_ALREADY_EXISTS") {
        const uniqueId = deviceForm.uniqueId.trim();
        const existingId = requestError?.response?.data?.details?.deviceId || null;
        const match = devices.find(
          (item) =>
            item.id === existingId ||
            (item.uniqueId && uniqueId && String(item.uniqueId).toLowerCase() === uniqueId.toLowerCase()),
        );
        setShowDeviceModal(false);
        setConflictDevice({
          uniqueId,
          deviceId: match?.id || existingId || null,
          message: requestError?.message || "Equipamento já existe no Euro One",
        });
        return;
      }

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

  function handleGoToExistingDevice() {
    if (!conflictDevice) return;
    const match = devices.find(
      (item) =>
        item.id === conflictDevice.deviceId ||
        (item.uniqueId && conflictDevice.uniqueId &&
          String(item.uniqueId).toLowerCase() === conflictDevice.uniqueId.toLowerCase()),
    );
    if (match) {
      openEditDevice(match);
    } else {
      setTab("lista");
      void load();
    }
    setConflictDevice(null);
  }

  const linkVehicleOptions = useMemo(() => {
    const search = linkQuery.trim().toLowerCase();
    const list = vehicles.map((vehicle) => ({
      value: vehicle.id,
      label: `${vehicle.plate || vehicle.name || vehicle.id}${vehicle.clientName ? ` · ${vehicle.clientName}` : ""}`,
      plate: vehicle.plate || "",
      name: vehicle.name || "",
    }));
    if (!search) return list;
    return list.filter(
      (vehicle) =>
        vehicle.plate.toLowerCase().includes(search) ||
        vehicle.name.toLowerCase().includes(search) ||
        vehicle.label.toLowerCase().includes(search),
    );
  }, [linkQuery, vehicles]);

  async function handleLinkToVehicle(event) {
    event.preventDefault();
    if (!linkTarget || !linkVehicleId) return;
    try {
      await CoreApi.linkDeviceToVehicle(linkVehicleId, linkTarget.id, { clientId: tenantId || user?.clientId });
      await load();
      setLinkTarget(null);
      setLinkVehicleId("");
      setLinkQuery("");
    } catch (requestError) {
      alert(requestError?.message || "Falha ao vincular equipamento");
    }
  }

  async function handleUnlinkFromVehicle(device) {
    if (!device?.vehicleId) return;
    try {
      await CoreApi.unlinkDeviceFromVehicle(device.vehicleId, device.id, { clientId: tenantId || user?.clientId });
      await load();
    } catch (requestError) {
      alert(requestError?.message || "Falha ao desvincular equipamento");
    }
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

      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
        <Input
          label="Buscar por nome ou IMEI"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Digite parte do nome ou IMEI"
        />
      </div>

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
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Vínculo</th>
                  <th className="px-4 py-3 text-left">Última comunicação</th>
                  <th className="px-4 py-3 text-left">Última posição</th>
                  <th className="px-4 py-3 text-left">Velocidade</th>
                  <th className="px-4 py-3 text-left">Bateria / Ignição</th>
                  <th className="px-4 py-3 text-left">Chip</th>
                  <th className="px-4 py-3 text-left">Veículo</th>
                  <th className="px-4 py-3 text-left">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {(loading || traccarLoading) && (
                  <tr>
                    <td colSpan={11} className="px-4 py-6 text-center text-white/60">
                      Carregando equipamentos…
                    </td>
                  </tr>
                )}
                {!loading && !traccarLoading && filteredDevices.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-6 text-center text-white/60">
                      Nenhum equipamento cadastrado.
                    </td>
                  </tr>
                )}
                {!loading &&
                  filteredDevices.map((device) => {
                    const modelo = modeloById.get(device.modelId) || null;
                    const chip = chips.find((item) => item.id === device.chipId) || device.chip;
                    const vehicle = vehicles.find((item) => item.id === device.vehicleId) || device.vehicle;
                    const latestPosition = latestPositionByDevice.get(deviceKey(device));
                    const ignitionLabel = formatIgnition(device);
                    const batteryLabel = formatBattery(device);
                    const traccarDevice = traccarDeviceFor(device);
                    const linkLabel = vehicle
                      ? `Vinculado ao veículo ${vehicle.name || vehicle.plate || vehicle.id}`
                      : "Não vinculado";
                    return (
                      <tr key={device.internalId || device.id || device.uniqueId} className="hover:bg-white/5">

                        <td className="px-4 py-3 text-white">{device.name || traccarDevice?.name || "—"}</td>
                        <td className="px-4 py-3">{device.uniqueId || traccarDevice?.uniqueId || "—"}</td>
                        <td className="px-4 py-3">{getStatus(device)}</td>
                        <td className="px-4 py-3">{linkLabel}</td>
                        <td className="px-4 py-3">{formatLastCommunication(device)}</td>

                        <td className="px-4 py-3 flex items-center gap-2">
                          <span>{formatPosition(latestPosition)}</span>
                          {latestPosition && (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={MapPin}
                              onClick={() => setMapTarget({ device, position: latestPosition })}
                            >
                              Ver no mapa
                            </Button>
                          )}
                        </td>

                        <td className="px-4 py-3">{formatSpeed(device)}</td>
                        <td className="px-4 py-3 space-x-2">
                          <span>{batteryLabel}</span>
                          {ignitionLabel && (
                            <span className="rounded-full bg-white/10 px-2 py-1 text-xs">{ignitionLabel}</span>

                          )}
                        </td>
                        <td className="px-4 py-3">{chip?.iccid || chip?.phone || "—"}</td>
                        <td className="px-4 py-3">{vehicle?.name || vehicle?.plate || "—"}</td>
                        <td className="px-4 py-3 space-x-2 whitespace-nowrap">
                          <Button size="sm" variant="ghost" onClick={() => setLinkTarget(device)}>
                            Vincular a veículo
                          </Button>
                          {vehicle?.id && (
                            <Button size="sm" variant="ghost" onClick={() => handleUnlinkFromVehicle(device)}>
                              Desvincular
                            </Button>
                          )}
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

      <Modal
        open={Boolean(linkTarget)}
        onClose={() => {
          setLinkTarget(null);
          setLinkVehicleId("");
          setLinkQuery("");
        }}
        title={linkTarget ? `Vincular ${linkTarget.name || linkTarget.uniqueId || "equipamento"}` : "Vincular equipamento"}
        width="max-w-xl"
      >
        <form onSubmit={handleLinkToVehicle} className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.1em] text-white/60">Buscar placa/veículo</label>
            <input
              value={linkQuery}
              onChange={(event) => setLinkQuery(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
              placeholder="Digite a placa ou nome"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.1em] text-white/60">Selecionar veículo</label>
            <select
              value={linkVehicleId}
              onChange={(event) => setLinkVehicleId(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
              required
            >
              <option value="">— Escolha um veículo —</option>
              {linkVehicleOptions.map((vehicle) => (
                <option key={vehicle.value} value={vehicle.value}>
                  {vehicle.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => { setLinkTarget(null); setLinkVehicleId(""); setLinkQuery(""); }}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!linkVehicleId}>
              Vincular
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(conflictDevice)}
        onClose={() => setConflictDevice(null)}
        title="Equipamento já existe"
        width="max-w-xl"
      >
        <div className="space-y-4 text-white">
          <p className="text-sm text-white/80">
            {conflictDevice?.message || "Já existe um equipamento com este IMEI / uniqueId no Euro One."}
          </p>
          <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
            <div className="font-semibold text-white">UniqueId</div>
            <div className="break-all">{conflictDevice?.uniqueId || ""}</div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConflictDevice(null)}>
              Fechar
            </Button>
            <Button onClick={handleGoToExistingDevice}>Ir para equipamento existente</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(mapTarget)}
        onClose={() => setMapTarget(null)}
        title={mapTarget?.device?.name || mapTarget?.device?.uniqueId || "Posição"}
        width="max-w-4xl"
      >
        {mapTarget?.position ? (
          <div className="h-[420px] overflow-hidden rounded-xl">
            <MapContainer
              center={[
                Number(mapTarget.position.latitude ?? mapTarget.position.lat ?? 0),
                Number(mapTarget.position.longitude ?? mapTarget.position.lon ?? mapTarget.position.lng ?? 0),
              ]}
              zoom={15}
              style={{ height: "100%", width: "100%" }}
              whenCreated={(map) => {
                mapRef.current = map;
                setTimeout(() => map.invalidateSize(), 50);
              }}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="OpenStreetMap" />
              <Marker
                position={[
                  Number(mapTarget.position.latitude ?? mapTarget.position.lat ?? 0),
                  Number(mapTarget.position.longitude ?? mapTarget.position.lon ?? mapTarget.position.lng ?? 0),
                ]}
              >
                <Popup>
                  <div className="space-y-1 text-sm">
                    <div className="font-semibold">{mapTarget.device?.name || mapTarget.device?.uniqueId}</div>
                    <div>{formatPosition(mapTarget.position)}</div>
                    <div className="text-xs text-white/60">{formatPositionTimestamps(mapTarget.position)}</div>
                    <div>{formatLastCommunication(mapTarget.position, mapTarget.device)}</div>
                  </div>
                </Popup>
              </Marker>
            </MapContainer>
          </div>
        ) : (
          <p className="text-sm text-white/70">Sem posição recente para este dispositivo.</p>
        )}
      </Modal>
    </div>
  );
}
