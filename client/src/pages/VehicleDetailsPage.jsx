import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import Button from "../ui/Button";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { useTraccarDevices } from "../lib/hooks/useTraccarDevices.js";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";
import VehicleForm from "../components/vehicles/VehicleForm.jsx";
import { VEHICLE_TYPE_OPTIONS } from "../lib/icons/vehicleIcons.js";
import PageHeader from "../components/ui/PageHeader.jsx";
import DataCard from "../components/ui/DataCard.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";

const translateUnknownValue = (value) => {
  if (value === null || value === undefined) return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "unknown") return "Desconhecido";
  return value;
};

function AdminBindingsTab({
  vehicle,
  vehicleAttributes,
  clients,
  tenantId,
  user,
  onSaveVehicle,
  saving,
  onError = () => {},
}) {
  const normalizeVehicleType = (value) => {
    if (!value) return "";
    const normalized = String(value).toLowerCase();
    const directMatch = VEHICLE_TYPE_OPTIONS.find((option) => option.value === normalized);
    if (directMatch) return directMatch.value;
    const legacyMap = {
      carro: "car",
      caminhao: "truck",
      "caminhão": "truck",
      moto: "motorcycle",
      motocicleta: "motorcycle",
      onibus: "bus",
      "ônibus": "bus",
      van: "van",
      outros: "other",
    };
    return legacyMap[normalized] || normalized;
  };
  const [form, setForm] = useState({
    name: "",
    plate: "",
    driver: "",
    group: "",
    type: "",
    status: "",
    notes: "",
    deviceId: "",
    clientId: "",
    item: "",
    identifier: "",
    model: "",
    brand: "",
    chassis: "",
    renavam: "",
    color: "",
    modelYear: "",
    manufactureYear: "",
    fipeCode: "",
    fipeValue: "",
    zeroKm: false,
    vehicleAttributes: [],
  });

  useEffect(() => {
    if (!vehicle) return;
    setForm({
      name: vehicle.name || "",
      plate: vehicle.plate || "",
      driver: vehicle.driver || "",
      group: vehicle.group || "",
      type: normalizeVehicleType(vehicle.type),
      status: vehicle.status || "ativo",
      notes: vehicle.notes || "",
      deviceId: vehicle.device?.id || "",
      clientId: vehicle.clientId || tenantId || user?.clientId || "",
      item: vehicle.item || "",
      identifier: vehicle.identifier || "",
      model: vehicle.model || vehicle.name || "",
      brand: vehicle.brand || "",
      chassis: vehicle.chassis || "",
      renavam: vehicle.renavam || "",
      color: vehicle.color || "",
      modelYear: vehicle.modelYear || "",
      manufactureYear: vehicle.manufactureYear || "",
      fipeCode: vehicle.fipeCode || "",
      fipeValue: vehicle.fipeValue || "",
      zeroKm: Boolean(vehicle.zeroKm),
      vehicleAttributes: Array.isArray(vehicle.attributes?.vehicleAttributes)
        ? vehicle.attributes.vehicleAttributes
        : [],
    });
  }, [tenantId, user?.clientId, vehicle]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.plate.trim()) {
      onError(new Error("Informe a placa do veículo"));
      return;
    }
    if (!form.model.trim()) {
      onError(new Error("Informe o modelo do veículo"));
      return;
    }
    if (!form.type.trim()) {
      onError(new Error("Informe o tipo do veículo"));
      return;
    }
    await onSaveVehicle({
      name: form.model?.trim() || form.name?.trim() || undefined,
      plate: form.plate.trim(),
      driver: form.driver?.trim() || undefined,
      group: form.group?.trim() || undefined,
      type: form.type?.trim() || undefined,
      status: form.status || undefined,
      notes: form.notes?.trim() || undefined,
      deviceId: autoPrimary ? null : form.deviceId || null,
      clientId: form.clientId || vehicle.clientId,
      item: form.item?.trim() || undefined,
      identifier: form.identifier?.trim() || undefined,
      model: form.model?.trim() || undefined,
      brand: form.brand?.trim() || undefined,
      chassis: form.chassis?.trim() || undefined,
      renavam: form.renavam?.trim() || undefined,
      color: form.color?.trim() || undefined,
      modelYear: form.modelYear || undefined,
      manufactureYear: form.manufactureYear || undefined,
      fipeCode: form.fipeCode?.trim() || undefined,
      fipeValue: form.fipeValue || undefined,
      zeroKm: form.zeroKm || false,
      vehicleAttributes: Array.isArray(form.vehicleAttributes) ? form.vehicleAttributes : [],
    });
  };

  return (
    <div className="space-y-4 text-white">
      <form onSubmit={handleSubmit} className="space-y-3">
        <VehicleForm
          value={form}
          onChange={setForm}
          tenants={clients}
          showClient={user?.role === "admin"}
          requireClient={user?.role === "admin"}
          showDeviceSelect={false}
        />
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-[0.12em] text-white/60">Atributos do veículo</label>
          <div className="flex flex-wrap gap-2">
            {vehicleAttributes.length === 0 && (
              <p className="text-xs text-white/60">Nenhum atributo cadastrado.</p>
            )}
            {vehicleAttributes.map((attribute) => {
              const isSelected = form.vehicleAttributes?.some(
                (item) => String(item.id) === String(attribute.id),
              );
              return (
                <button
                  key={attribute.id}
                  type="button"
                  onClick={() => {
                    setForm((prev) => {
                      const current = Array.isArray(prev.vehicleAttributes) ? prev.vehicleAttributes : [];
                      if (isSelected) {
                        return {
                          ...prev,
                          vehicleAttributes: current.filter((item) => String(item.id) !== String(attribute.id)),
                        };
                      }
                      return {
                        ...prev,
                        vehicleAttributes: [...current, attribute],
                      };
                    });
                  }}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    isSelected
                      ? "border-sky-400 bg-sky-500/20 text-white"
                      : "border-white/10 bg-white/5 text-white/70 hover:border-white/30"
                  }`}
                  style={{
                    borderColor: isSelected ? attribute.color || "#38bdf8" : undefined,
                  }}
                >
                  {attribute.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? "Salvando…" : "Salvar alterações"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function VehicleDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { tenantId, user } = useTenant();
  const [vehicle, setVehicle] = useState(null);
  const [devices, setDevices] = useState([]);
  const [chips, setChips] = useState([]);
  const [vehicleAttributes, setVehicleAttributes] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [equipmentSearch, setEquipmentSearch] = useState("");
  const [equipmentDropdownOpen, setEquipmentDropdownOpen] = useState(false);
  const [equipmentHighlightIndex, setEquipmentHighlightIndex] = useState(0);
  const equipmentDropdownRef = useRef(null);
  const [chipSearch, setChipSearch] = useState("");
  const [chipLinkId, setChipLinkId] = useState("");
  const [chipDeviceId, setChipDeviceId] = useState("");
  const [chipDropdownOpen, setChipDropdownOpen] = useState(false);
  const [chipHighlightIndex, setChipHighlightIndex] = useState(0);
  const chipDropdownRef = useRef(null);
  const [activeTab, setActiveTab] = useState("resumo");
  const [equipmentTab, setEquipmentTab] = useState("equipamentos");
  const [lastPositionAddress, setLastPositionAddress] = useState(null);
  const [lastPositionLoading, setLastPositionLoading] = useState(false);
  const geocodeCacheRef = useRef(new Map());

  const isAdmin = ["admin", "manager"].includes(user?.role);
  const resolvedClientId = tenantId || user?.clientId || null;

  const trackedDeviceIds = useMemo(() => {
    if (!vehicle) return [];
    const list = Array.isArray(vehicle.devices) ? vehicle.devices : [];
    return list
      .map((item) => toDeviceKey(item.traccarId ?? item.id ?? item.uniqueId))
      .filter(Boolean);
  }, [vehicle]);

  const { getDevicePosition, getDeviceStatus, getDeviceLastSeen, getDeviceCoordinates } = useTraccarDevices({
    deviceIds: trackedDeviceIds,
    enabled: trackedDeviceIds.length > 0,
  });

  const detailedVehicle = useMemo(() => {
    if (!vehicle) return null;
    const position = getDevicePosition(vehicle);
    const lat = position?.latitude ?? position?.lat;
    const lng = position?.longitude ?? position?.lon;
    const lastUpdate = position?.deviceTime || position?.fixTime || position?.serverTime || vehicle.updatedAt;
    const speed = position?.speed ?? vehicle.speed ?? 0;
    const deviceName = vehicle.device?.name || vehicle.name || vehicle.plate;
    return {
      ...vehicle,
      position,
      lat,
      lng,
      lastUpdate,
      speed,
      deviceName,
      address: position?.address || vehicle.address,
      statusLabel: getDeviceStatus(vehicle, position),
      lastSeen: getDeviceLastSeen(vehicle, position),
      coordinatesLabel: getDeviceCoordinates(vehicle, position),
    };
  }, [getDeviceCoordinates, getDeviceLastSeen, getDevicePosition, getDeviceStatus, vehicle]);

  const lastPositionInfo = useMemo(() => {
    const position = detailedVehicle?.position || null;
    if (!position) {
      return { lat: null, lng: null, timestamp: null };
    }
    const rawLat = position.latitude ?? position.lat ?? null;
    const rawLng = position.longitude ?? position.lon ?? null;
    const lat = Number.isFinite(Number(rawLat)) ? Number(rawLat) : null;
    const lng = Number.isFinite(Number(rawLng)) ? Number(rawLng) : null;
    const timestamp = position.deviceTime || position.fixTime || position.serverTime || null;
    return { lat, lng, timestamp };
  }, [detailedVehicle?.position]);

  const lastPositionDateTime = useMemo(() => {
    if (!lastPositionInfo.timestamp) return "—";
    const date = new Date(lastPositionInfo.timestamp);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
  }, [lastPositionInfo.timestamp]);

  useEffect(() => {
    const { lat, lng } = lastPositionInfo;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setLastPositionAddress(null);
      setLastPositionLoading(false);
      return;
    }
    const cacheKey = `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
    const cached = geocodeCacheRef.current.get(cacheKey);
    if (cached) {
      setLastPositionAddress(cached);
      setLastPositionLoading(false);
      return;
    }

    let cancelled = false;
    setLastPositionLoading(true);

    safeApi
      .get(API_ROUTES.geocode.reverse, { params: { lat, lng, reason: "vehicle_details" } })
      .then(({ data }) => {
        if (cancelled) return;
        const address = data?.formattedAddress || data?.address || data?.shortAddress || null;
        if (address) {
          geocodeCacheRef.current.set(cacheKey, address);
        }
        setLastPositionAddress(address);
      })
      .catch(() => {
        if (!cancelled) {
          setLastPositionAddress(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLastPositionLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [lastPositionInfo]);

  const linkedDevices = useMemo(() => {
    const list = Array.isArray(vehicle?.devices) ? vehicle.devices : [];
    return list
      .map((device) => {
        const position = getDevicePosition(device) || {};
        const lastSeen = getDeviceLastSeen(device, position);
        const coordinates = getDeviceCoordinates(device, position);
        const lastUpdate = position.deviceTime || position.fixTime || position.serverTime || device.updatedAt;
        return { ...device, position, lastSeen, coordinates, lastUpdate };
      })
      .sort((a, b) => {
        const aTime = a.lastUpdate ? new Date(a.lastUpdate).getTime() : 0;
        const bTime = b.lastUpdate ? new Date(b.lastUpdate).getTime() : 0;
        return bTime - aTime;
      });
  }, [getDeviceCoordinates, getDeviceLastSeen, getDevicePosition, vehicle]);

  useEffect(() => {
    if (!linkedDevices.length) {
      setChipDeviceId("");
      return;
    }
    if (linkedDevices.length === 1) {
      setChipDeviceId(linkedDevices[0].id);
      return;
    }
    if (!linkedDevices.some((device) => String(device.id) === String(chipDeviceId))) {
      setChipDeviceId("");
    }
  }, [chipDeviceId, linkedDevices]);

  const availableDevices = useMemo(
    () =>
      devices.filter((device) => {
        const sameVehicle = !device.vehicleId || String(device.vehicleId) === String(vehicle?.id);
        const sameClient = !vehicle?.clientId || String(device.clientId) === String(vehicle.clientId);
        return sameVehicle && sameClient;
      }),
    [devices, vehicle?.clientId, vehicle?.id],
  );

  const filteredAvailableDevices = useMemo(() => {
    const term = equipmentSearch.trim().toLowerCase();
    if (!term) return availableDevices;
    return availableDevices.filter((device) => {
      const haystack = [
        device.name,
        device.uniqueId,
        device.model,
        device.status,
        device.connectionStatusLabel,
        device.id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [availableDevices, equipmentSearch]);

  const linkedChips = useMemo(() => {
    if (!linkedDevices.length) return [];
    const deviceIds = new Set(linkedDevices.map((device) => String(device.id)));
    return chips.filter((chip) => chip.deviceId && deviceIds.has(String(chip.deviceId)));
  }, [chips, linkedDevices]);

  const availableChips = useMemo(() => {
    if (!vehicle) return [];
    const deviceIds = new Set(linkedDevices.map((device) => String(device.id)));
    return chips.filter((chip) => !chip.deviceId || deviceIds.has(String(chip.deviceId)));
  }, [chips, linkedDevices, vehicle]);

  const filteredChips = useMemo(() => {
    const term = chipSearch.trim().toLowerCase();
    if (!term) return availableChips;
    return availableChips.filter((chip) => {
      const haystack = [chip.iccid, chip.phone, chip.carrier, chip.provider, chip.status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [availableChips, chipSearch]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!equipmentDropdownRef.current) return;
      if (equipmentDropdownRef.current.contains(event.target)) return;
      setEquipmentDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!chipDropdownRef.current) return;
      if (chipDropdownRef.current.contains(event.target)) return;
      setChipDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const reportError = (message, fallbackMessage = "Falha ao executar ação") => {
    const payload = message instanceof Error ? message : new Error(message || fallbackMessage);
    setError(payload);
    setFeedback(null);
  };

  const reportSuccess = (message) => {
    setError(null);
    setFeedback(message);
  };

  const loadData = async () => {
    setLoading(true);
    setError(null);
    setFeedback(null);
    try {
      const params = resolvedClientId ? { clientId: resolvedClientId } : {};
      if (isAdmin) {
        params.includeUnlinked = true;
      } else {
        params.onlyLinked = true;
      }
      const [vehicleList, deviceList, chipList, clientList, attributeList] = await Promise.all([
        CoreApi.listVehicles(params),
        CoreApi.listDevices(params),
        CoreApi.listChips(params),
        isAdmin
          ? safeApi.get(API_ROUTES.clients).then(({ data }) => data?.clients || [])
          : Promise.resolve([]),
        params.clientId ? CoreApi.listVehicleAttributes({ clientId: params.clientId }) : Promise.resolve([]),
      ]);
      setVehicle(vehicleList.find((item) => String(item.id) === String(id)) || null);
      setDevices(Array.isArray(deviceList) ? deviceList : []);
      setChips(Array.isArray(chipList) ? chipList : []);
      setClients(Array.isArray(clientList) ? clientList : []);
      setVehicleAttributes(Array.isArray(attributeList) ? attributeList : []);
    } catch (requestError) {
      reportError(requestError, "Falha ao carregar veículo");
    } finally {
      setLoading(false);
    }
  };

  const handleLinkDevice = async (deviceId) => {
    if (!vehicle || !deviceId) return;
    const device =
      devices.find((item) => String(item.id) === String(deviceId)) ||
      availableDevices.find((item) => String(item.id) === String(deviceId));
    const targetClientId = vehicle?.clientId || device?.clientId || resolvedClientId;
    if (!targetClientId) {
      reportError("Selecione o cliente antes de vincular o equipamento");
      return;
    }
    if (vehicle?.clientId && device?.clientId && String(vehicle.clientId) !== String(device.clientId)) {
      reportError("Equipamento pertence a outro cliente. Ajuste o tenant antes de continuar.");
      return;
    }
    setSaving(true);
    try {
      await CoreApi.linkDeviceToVehicle(vehicle.id, deviceId, { clientId: targetClientId });
      setEquipmentSearch("");
      setEquipmentDropdownOpen(false);
      await loadData();
      reportSuccess("Equipamento vinculado ao veículo.");
    } catch (requestError) {
      reportError(requestError, "Não foi possível vincular o equipamento");
    } finally {
      setSaving(false);
    }
  };

  const handleUnlinkDevice = async (deviceId) => {
    if (!vehicle || !deviceId) return;
    const device =
      linkedDevices.find((item) => String(item.id) === String(deviceId)) ||
      devices.find((item) => String(item.id) === String(deviceId));
    const targetClientId = vehicle?.clientId || device?.clientId || resolvedClientId;
    if (!targetClientId) {
      reportError("Selecione o cliente antes de desvincular o equipamento");
      return;
    }
    setSaving(true);
    try {
      await CoreApi.unlinkDeviceFromVehicle(vehicle.id, deviceId, { clientId: targetClientId });
      await loadData();
      reportSuccess("Equipamento desvinculado.");
    } catch (requestError) {
      reportError(requestError, "Não foi possível desvincular o equipamento");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [resolvedClientId, id]);

  const handleSaveVehicle = async (payload) => {
    if (!vehicle) return;
    const clientId = payload.clientId || vehicle.clientId || resolvedClientId;
    if (!clientId) {
      reportError("Selecione o cliente antes de salvar o veículo");
      return;
    }
    setSaving(true);
    try {
      await CoreApi.updateVehicle(vehicle.id, { ...payload, clientId });
      await loadData();
      reportSuccess("Veículo atualizado com sucesso.");
    } catch (requestError) {
      reportError(requestError, "Falha ao salvar veículo");
    } finally {
      setSaving(false);
    }
  };

  const handleBindChip = async ({ chipId, deviceId, clientId }) => {
    const resolved = clientId || vehicle?.clientId || resolvedClientId;
    if (!resolved) {
      reportError("Selecione o cliente antes de vincular o chip");
      return;
    }
    try {
      await CoreApi.updateChip(chipId, { deviceId, clientId: resolved });
      await loadData();
      reportSuccess("Chip vinculado ao equipamento.");
    } catch (requestError) {
      reportError(requestError, "Falha ao vincular chip");
    }
  };

  const handleUnlinkChip = async (chipId) => {
    const resolved = vehicle?.clientId || resolvedClientId;
    if (!resolved) {
      reportError("Selecione o cliente antes de desvincular o chip");
      return;
    }
    try {
      await CoreApi.updateChip(chipId, { deviceId: null, clientId: resolved });
      await loadData();
      reportSuccess("Chip desvinculado do veículo.");
    } catch (requestError) {
      reportError(requestError, "Falha ao desvincular chip");
    }
  };

  const handleLinkChip = async () => {
    if (!chipLinkId || !chipDeviceId) {
      reportError("Selecione chip e equipamento para vincular");
      return;
    }
    await handleBindChip({
      chipId: chipLinkId,
      deviceId: chipDeviceId,
      clientId: vehicle?.clientId || resolvedClientId,
    });
    setChipLinkId("");
    setChipSearch("");
  };

  const tabs = useMemo(() => {
    const baseTabs = [
      { id: "resumo", label: "Resumo" },
      { id: "equipamentos", label: "Equipamentos" },
      { id: "os", label: "Ordens de Serviço" },
    ];
    if (isAdmin) {
      baseTabs.push({ id: "admin", label: "Editar" });
    }
    return baseTabs;
  }, [isAdmin]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={vehicle?.plate || "Veículo"}
        subtitle={[
          vehicle?.brand || "Marca",
          vehicle?.model || vehicle?.name || "Modelo",
          translateUnknownValue(vehicle?.status) || "—",
          detailedVehicle?.statusLabel ? translateUnknownValue(detailedVehicle.statusLabel) : null,
        ]
          .filter(Boolean)
          .join(" • ")}
        actions={
          <Link
            to="/services/new"
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
          >
            Nova OS
          </Link>
        }
      />

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error.message}
        </div>
      )}
      {feedback && !error && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {feedback}
        </div>
      )}

      {loading && (
        <DataCard className="animate-pulse">
          <div className="h-6 w-52 rounded-full bg-white/10" />
          <div className="mt-3 h-4 w-64 rounded-full bg-white/10" />
        </DataCard>
      )}

      {!loading && !vehicle && (
        <DataCard>
          <EmptyState title="Veículo não encontrado." subtitle="Verifique a placa ou tente novamente." />
        </DataCard>
      )}

      {!loading && vehicle && (
        <>
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-xl px-4 py-2 text-sm transition ${
                  activeTab === tab.id ? "bg-sky-500 text-black" : "bg-white/10 text-white hover:bg-white/15"
                }`}
              >
                {tab.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
            >
              Voltar
            </button>
          </div>

          {activeTab === "resumo" && (
            <DataCard className="space-y-3">
              <h2 className="text-sm font-semibold text-white">Resumo</h2>
              <div className="grid gap-4 md:grid-cols-2 text-sm text-white/70">
                <div>
                  <div className="text-xs uppercase tracking-[0.1em] text-white/50">Placa</div>
                  <div className="text-white">{vehicle.plate || "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.1em] text-white/50">Tipo</div>
                  <div className="text-white">{translateUnknownValue(vehicle.type) || "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.1em] text-white/50">Motorista</div>
                  <div className="text-white">{translateUnknownValue(vehicle.driver) || "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.1em] text-white/50">Grupo</div>
                  <div className="text-white">{translateUnknownValue(vehicle.group) || "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.1em] text-white/50">Marca</div>
                  <div className="text-white">{translateUnknownValue(vehicle.brand) || "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.1em] text-white/50">Modelo</div>
                  <div className="text-white">
                    {translateUnknownValue(vehicle.model || vehicle.name) || "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.1em] text-white/50">Chassi</div>
                  <div className="text-white">{vehicle.chassis || "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.1em] text-white/50">Ano</div>
                  <div className="text-white">{vehicle.modelYear || vehicle.manufactureYear || "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.1em] text-white/50">Cliente</div>
                  <div className="text-white">{vehicle.clientName || "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.1em] text-white/50">Odômetro</div>
                  <div className="text-white">{vehicle.odometer ? `${vehicle.odometer} km` : "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.1em] text-white/50">Última posição</div>
                  <div className="text-white">
                    {Number.isFinite(lastPositionInfo.lat) && Number.isFinite(lastPositionInfo.lng)
                      ? lastPositionDateTime
                      : "Sem posição"}
                  </div>
                  <div className="text-xs text-white/60">
                    {Number.isFinite(lastPositionInfo.lat) && Number.isFinite(lastPositionInfo.lng)
                      ? lastPositionLoading
                        ? "Carregando endereço..."
                        : lastPositionAddress || "Endereço não disponível"
                      : "—"}
                  </div>
                </div>
              </div>
            </DataCard>
          )}

          {activeTab === "equipamentos" && (
            <DataCard className="space-y-4">
              <div className="flex flex-wrap gap-2 px-4 pt-4">
                {[
                  { key: "equipamentos", label: "Equipamentos" },
                  { key: "chips", label: "Chips" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setEquipmentTab(tab.key)}
                    className={`rounded-xl px-4 py-2 text-xs uppercase tracking-[0.12em] transition ${
                      equipmentTab === tab.key ? "bg-sky-500 text-black" : "bg-white/10 text-white/70 hover:bg-white/15"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {equipmentTab === "equipamentos" && (
                <>
                  <div className="space-y-3 px-4" ref={equipmentDropdownRef}>
                    <label className="block text-xs text-white/60">
                      Buscar equipamento
                      <div className="relative mt-2">
                        <input
                          value={equipmentSearch}
                          onChange={(event) => {
                            setEquipmentSearch(event.target.value);
                            setEquipmentDropdownOpen(true);
                            setEquipmentHighlightIndex(0);
                          }}
                          onFocus={() => setEquipmentDropdownOpen(true)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              setEquipmentDropdownOpen(false);
                              return;
                            }
                            if (event.key === "Enter" && equipmentDropdownOpen) {
                              event.preventDefault();
                              const candidate =
                                filteredAvailableDevices[equipmentHighlightIndex] || filteredAvailableDevices[0];
                              if (candidate) {
                                handleLinkDevice(candidate.id);
                              }
                            }
                          }}
                          className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                          placeholder="Digite ID, modelo, IMEI ou status"
                        />
                        {equipmentDropdownOpen && (
                          <div className="absolute z-[60] mt-2 max-h-60 w-full overflow-auto rounded-xl border border-white/10 bg-[#0f141c] py-1 shadow-lg">
                            {filteredAvailableDevices.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-white/50">Nenhum equipamento encontrado.</div>
                            ) : (
                              <ul className="text-sm">
                                {filteredAvailableDevices.map((device, index) => (
                                  <li key={device.id}>
                                    <button
                                      type="button"
                                      className={`flex w-full items-start justify-between px-3 py-2 text-left transition hover:bg-white/5 ${
                                        index === equipmentHighlightIndex ? "bg-white/5" : ""
                                      }`}
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                        handleLinkDevice(device.id);
                                      }}
                                      onMouseEnter={() => setEquipmentHighlightIndex(index)}
                                    >
                                      <span className="flex flex-col">
                                        <span className="text-white">{device.model || device.name || "Equipamento"}</span>
                                        <span className="text-xs text-white/50">{device.uniqueId || device.id}</span>
                                      </span>
                                      <span className="text-[11px] text-white/40">
                                        {device.status || device.connectionStatusLabel || "—"}
                                      </span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    </label>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-white/10">
                    <DataTable>
                      <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
                        <tr className="text-left">
                          <th className="px-4 py-3">ID/IMEI</th>
                          <th className="px-4 py-3">Produto/Modelo</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Local</th>
                          <th className="px-4 py-3 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {linkedDevices.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-4 py-6">
                              <EmptyState title="Nenhum equipamento vinculado." />
                            </td>
                          </tr>
                        )}
                        {linkedDevices.map((device) => (
                          <tr key={device.id} className="hover:bg-white/5">
                            <td className="px-4 py-3 text-white/80">{device.uniqueId || device.id}</td>
                            <td className="px-4 py-3 text-white/70">{device.model || device.name || "—"}</td>
                            <td className="px-4 py-3">
                              <span className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80">
                                {translateUnknownValue(device.status) || "HABILITADO"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-white/70">{device.location || "No veículo"}</td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleUnlinkDevice(device.id)}
                                className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
                              >
                                Desvincular
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </DataTable>
                  </div>
                </>
              )}

              {equipmentTab === "chips" && (
                <div className="space-y-4 px-4 pb-4">
                  <div className="grid gap-3 md:grid-cols-3" ref={chipDropdownRef}>
                    <label className="block text-xs text-white/60 md:col-span-2">
                      Buscar chip
                      <div className="relative mt-2">
                        <input
                          value={chipSearch}
                          onChange={(event) => {
                            setChipSearch(event.target.value);
                            setChipDropdownOpen(true);
                            setChipHighlightIndex(0);
                          }}
                          onFocus={() => setChipDropdownOpen(true)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              setChipDropdownOpen(false);
                              return;
                            }
                            if (event.key === "Enter" && chipDropdownOpen) {
                              event.preventDefault();
                              const candidate = filteredChips[chipHighlightIndex] || filteredChips[0];
                              if (candidate) {
                                setChipLinkId(candidate.id);
                                setChipSearch(candidate.iccid || candidate.phone || "");
                                setChipDropdownOpen(false);
                              }
                            }
                          }}
                          className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                          placeholder="Digite ICCID, telefone ou operadora"
                        />
                        {chipDropdownOpen && (
                          <div className="absolute z-[60] mt-2 max-h-60 w-full overflow-auto rounded-xl border border-white/10 bg-[#0f141c] py-1 shadow-lg">
                            {filteredChips.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-white/50">Nenhum chip encontrado.</div>
                            ) : (
                              <ul className="text-sm">
                                {filteredChips.map((chip, index) => (
                                  <li key={chip.id}>
                                    <button
                                      type="button"
                                      className={`flex w-full items-start justify-between px-3 py-2 text-left transition hover:bg-white/5 ${
                                        index === chipHighlightIndex ? "bg-white/5" : ""
                                      }`}
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                        setChipLinkId(chip.id);
                                        setChipSearch(chip.iccid || chip.phone || "");
                                        setChipDropdownOpen(false);
                                      }}
                                      onMouseEnter={() => setChipHighlightIndex(index)}
                                    >
                                      <span className="flex flex-col">
                                        <span className="text-white">{chip.iccid}</span>
                                        <span className="text-xs text-white/50">{chip.phone || chip.carrier || "—"}</span>
                                      </span>
                                      <span className="text-[11px] text-white/40">{chip.status || "—"}</span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    </label>
                    <label className="block text-xs text-white/60">
                      Equipamento
                      <select
                        value={chipDeviceId}
                        onChange={(event) => setChipDeviceId(event.target.value)}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                      >
                        <option value="">Selecione o equipamento</option>
                        {linkedDevices.map((device) => (
                          <option key={device.id} value={device.id}>
                            {device.name || device.uniqueId || device.id}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleLinkChip}
                      disabled={!chipLinkId || !chipDeviceId}
                      className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15 disabled:opacity-60"
                    >
                      Vincular chip
                    </button>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-white/10">
                    <DataTable>
                      <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
                        <tr className="text-left">
                          <th className="px-4 py-3">ICCID</th>
                          <th className="px-4 py-3">Telefone</th>
                          <th className="px-4 py-3">Operadora</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {linkedChips.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-4 py-6">
                              <EmptyState title="Nenhum chip vinculado ao veículo." />
                            </td>
                          </tr>
                        )}
                        {linkedChips.map((chip) => (
                          <tr key={chip.id} className="hover:bg-white/5">
                            <td className="px-4 py-3 text-white/80">{chip.iccid}</td>
                            <td className="px-4 py-3 text-white/70">{chip.phone || "—"}</td>
                            <td className="px-4 py-3 text-white/70">{chip.carrier || "—"}</td>
                            <td className="px-4 py-3">
                              <span className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80">
                                {chip.status || "—"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleUnlinkChip(chip.id)}
                                className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
                              >
                                Desvincular
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </DataTable>
                  </div>
                </div>
              )}
            </DataCard>
          )}

          {activeTab === "os" && (
            <DataCard>
              <EmptyState title="Nenhuma ordem de serviço registrada." subtitle="Crie uma nova OS para este veículo." />
            </DataCard>
          )}

          {activeTab === "admin" && (
            <DataCard>
          <AdminBindingsTab
            vehicle={vehicle}
            vehicleAttributes={vehicleAttributes}
            clients={clients}
            tenantId={tenantId}
            user={user}
            onSaveVehicle={handleSaveVehicle}
            saving={saving}
            onError={reportError}
          />
            </DataCard>
          )}
        </>
      )}
    </div>
  );
}
