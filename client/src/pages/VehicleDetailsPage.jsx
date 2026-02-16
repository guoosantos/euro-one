import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import { CoreApi } from "../lib/coreApi.js";
import api from "../lib/api.js";
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
import AutocompleteSelect from "../components/ui/AutocompleteSelect.jsx";
import { useConfirmDialog } from "../components/ui/ConfirmDialogProvider.jsx";
import useAdminGeneralAccess from "../lib/hooks/useAdminGeneralAccess.js";
import { usePageToast } from "../lib/hooks/usePageToast.js";
import PageToast from "../components/ui/PageToast.jsx";
import { usePermissionGate } from "../lib/permissions/permission-gate.js";
import { buildPortList } from "../lib/device-ports.js";
import { normalizeEquipmentStatusValue } from "../lib/equipment-status.js";
import { isServiceStockGlobalPermissionGroup } from "../lib/permissions/profile-groups.js";

const translateUnknownValue = (value) => {
  if (value === null || value === undefined) return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "unknown") return "Desconhecido";
  return value;
};

function resolveDeviceEquipmentStatus(device) {
  const fallback = device?.vehicleId || device?.vehicle?.id ? "HABILITADO" : "ESTOQUE NOVO";
  return normalizeEquipmentStatusValue(device?.equipmentStatus || device?.status || device?.attributes?.equipmentStatus, {
    fallback,
  });
}

function normalizeVehicleConfigItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      id: item?.id ? String(item.id) : crypto.randomUUID(),
      name: String(item?.name || "").trim(),
      value: String(item?.value || "").trim(),
      description: String(item?.description || "").trim(),
    }))
    .filter((item) => item.name);
}

function AdminBindingsTab({
  vehicle,
  vehicleAttributes,
  clients,
  tenantId,
  tenantScope,
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
      clientId:
        vehicle.clientId || (tenantScope === "ALL" ? "" : tenantId || user?.clientId || ""),
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
  }, [tenantId, tenantScope, user?.clientId, vehicle]);

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
      deviceId: form.deviceId || null,
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

function VehicleConfigItemsEditor({
  items = [],
  onChange = () => {},
  onSave = () => {},
  saving = false,
  title = "Itens adicionais",
  subtitle = "Nome, valor e descrição",
}) {
  const updateItem = (id, field, value) => {
    onChange(
      items.map((item) => (String(item.id) === String(id) ? { ...item, [field]: value } : item)),
    );
  };

  const removeItem = (id) => {
    onChange(items.filter((item) => String(item.id) !== String(id)));
  };

  const addItem = () => {
    onChange([
      ...items,
      {
        id: crypto.randomUUID(),
        name: "",
        value: "",
        description: "",
      },
    ]);
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="text-xs text-white/60">{subtitle}</p>
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="grid gap-2 rounded-lg border border-white/10 bg-black/20 p-3 md:grid-cols-4">
            <Input
              label="Nome"
              value={item.name}
              onChange={(event) => updateItem(item.id, "name", event.target.value)}
              placeholder="Nome"
            />
            <Input
              label="Valor"
              value={item.value}
              onChange={(event) => updateItem(item.id, "value", event.target.value)}
              placeholder="Valor"
            />
            <Input
              label="Descrição"
              value={item.description}
              onChange={(event) => updateItem(item.id, "description", event.target.value)}
              placeholder="Descrição"
            />
            <div className="flex items-end justify-end">
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white transition hover:bg-white/15"
              >
                Remover
              </button>
            </div>
          </div>
        ))}
        {!items.length && (
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-4 text-sm text-white/60">
            Nenhum item cadastrado.
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={addItem}
          className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
        >
          Adicionar item
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15 disabled:opacity-60"
        >
          {saving ? "Salvando..." : "Salvar itens"}
        </button>
      </div>
    </div>
  );
}

export default function VehicleDetailsPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { tenantId, tenantScope, user, tenants, switchClientAndReset, permissionContext } = useTenant();
  const vehiclesPermission = usePermissionGate({ menuKey: "fleet", pageKey: "vehicles" });
  const { confirmDelete } = useConfirmDialog();
  const { isAdminGeneral } = useAdminGeneralAccess();
  const { toast, showToast } = usePageToast();
  const [vehicle, setVehicle] = useState(null);
  const [devices, setDevices] = useState([]);
  const [chips, setChips] = useState([]);
  const [models, setModels] = useState([]);
  const [kits, setKits] = useState([]);
  const [vehicleAttributes, setVehicleAttributes] = useState([]);
  const [clients, setClients] = useState([]);
  const [serviceOrders, setServiceOrders] = useState([]);
  const [serviceOrdersLoading, setServiceOrdersLoading] = useState(false);
  const [serviceOrdersError, setServiceOrdersError] = useState(null);
  const [serviceOrdersPage, setServiceOrdersPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPorts, setSavingPorts] = useState(false);
  const [error, setError] = useState(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [linkEquipmentId, setLinkEquipmentId] = useState("");
  const [linkKitId, setLinkKitId] = useState("");
  const [chipLinkId, setChipLinkId] = useState("");
  const [chipDeviceId, setChipDeviceId] = useState("");
  const [activeTab, setActiveTab] = useState("resumo");
  const [equipmentTab, setEquipmentTab] = useState("equipamentos");
  const [vehiclePortLabels, setVehiclePortLabels] = useState({});
  const [lastPositionAddress, setLastPositionAddress] = useState(null);
  const [lastPositionLoading, setLastPositionLoading] = useState(false);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [historyType, setHistoryType] = useState("all");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [vehicleConfigItems, setVehicleConfigItems] = useState([]);
  const [savingVehicleConfigItems, setSavingVehicleConfigItems] = useState(false);
  const geocodeCacheRef = useRef(new Map());
  const serviceOrdersPageSize = 6;
  const historyPageSize = 8;

  const isAdmin = ["admin", "manager"].includes(user?.role);
  const isTechnician = user?.role === "technician";
  const isServiceStockGlobalGroup = isServiceStockGlobalPermissionGroup(permissionContext);
  const resolvedClientId = tenantScope === "ALL" ? null : (tenantId || user?.clientId || null);
  const isMirrorContextActive = Boolean(user?.activeMirrorOwnerClientId);

  const linkedDeviceCandidates = useMemo(() => {
    if (!vehicle) return [];
    const vehicleId = vehicle?.id ? String(vehicle.id) : null;
    const deduped = new Map();

    const pushDevice = (device) => {
      if (!device) return;
      const key = toDeviceKey(device.traccarId ?? device.id ?? device.uniqueId);
      if (!key || deduped.has(key)) return;
      deduped.set(key, { ...device, __deviceKey: key });
    };

    if (vehicleId && Array.isArray(devices)) {
      devices.forEach((device) => {
        if (device?.vehicleId && String(device.vehicleId) === vehicleId) {
          pushDevice(device);
        }
      });
    }

    if (vehicle?.deviceId && Array.isArray(devices)) {
      const byId = devices.find((device) => String(device?.id) === String(vehicle.deviceId));
      pushDevice(byId);
    }

    if (Array.isArray(vehicle?.devices)) {
      vehicle.devices.forEach(pushDevice);
    }
    if (vehicle?.device) {
      pushDevice(vehicle.device);
    }
    if (vehicle?.primaryDevice) {
      pushDevice(vehicle.primaryDevice);
    }

    return Array.from(deduped.values());
  }, [devices, vehicle]);

  const trackedDeviceIds = useMemo(
    () =>
      linkedDeviceCandidates
        .map((item) => item.__deviceKey || toDeviceKey(item.traccarId ?? item.id ?? item.uniqueId))
        .filter(Boolean),
    [linkedDeviceCandidates],
  );

  const { getDevicePosition, getDeviceStatus, getDeviceLastSeen, getDeviceCoordinates } = useTraccarDevices({
    deviceIds: trackedDeviceIds,
    enabled: trackedDeviceIds.length > 0 && vehiclesPermission.hasAccess,
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

  const formatServiceOrderDate = useCallback((value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  }, []);

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
    return linkedDeviceCandidates
      .map((device) => {
        const position = getDevicePosition(device) || {};
        const lastSeen = getDeviceLastSeen(device, position);
        const coordinates = getDeviceCoordinates(device, position);
        const lastUpdate = position.deviceTime || position.fixTime || position.serverTime || device.updatedAt;
        const equipmentStatus = resolveDeviceEquipmentStatus(device);
        return { ...device, position, lastSeen, coordinates, lastUpdate, status: equipmentStatus, equipmentStatus };
      })
      .sort((a, b) => {
        const aTime = a.lastUpdate ? new Date(a.lastUpdate).getTime() : 0;
        const bTime = b.lastUpdate ? new Date(b.lastUpdate).getTime() : 0;
        return bTime - aTime;
      });
  }, [getDeviceCoordinates, getDeviceLastSeen, getDevicePosition, linkedDeviceCandidates]);

  const modelById = useMemo(() => {
    const map = new Map();
    (Array.isArray(models) ? models : []).forEach((model) => {
      if (model?.id) {
        map.set(String(model.id), model);
      }
    });
    return map;
  }, [models]);

  const primaryDevice = linkedDevices[0] || null;
  const primaryModelId = primaryDevice?.modelId || primaryDevice?.attributes?.modelId || null;
  const primaryModel = primaryModelId ? modelById.get(String(primaryModelId)) : null;
  const vehiclePortList = useMemo(
    () =>
      buildPortList({
        model: primaryModel,
        telemetry: primaryDevice?.position?.attributes || {},
        deviceLabels: primaryDevice?.attributes?.portLabels || {},
        vehicleLabels: vehiclePortLabels || {},
      }),
    [primaryDevice?.attributes?.portLabels, primaryDevice?.position?.attributes, primaryModel, vehiclePortLabels],
  );

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

  const availableDeviceOptions = useMemo(
    () =>
      availableDevices.map((device) => ({
        value: device.id,
        label: device.model || device.name || device.uniqueId || device.id,
        description: device.uniqueId || device.connectionStatusLabel || "",
        data: device,
      })),
    [availableDevices],
  );

  const availableKits = useMemo(() => {
    if (!vehicle?.clientId) return [];
    return kits.filter((kit) => String(kit.clientId || vehicle.clientId) === String(vehicle.clientId));
  }, [kits, vehicle?.clientId]);

  const availableKitOptions = useMemo(
    () =>
      availableKits.map((kit) => ({
        value: kit.id,
        label: `${kit.code || "Sem código"} · ${kit.modelName || "Modelo"}`,
        description: `${kit.equipmentCount || kit.equipmentIds?.length || 0} equipamentos`,
        data: kit,
      })),
    [availableKits],
  );

  const linkedDeviceOptions = useMemo(
    () =>
      linkedDevices.map((device) => ({
        value: device.id,
        label: device.model || device.name || device.uniqueId || device.id,
        description: device.uniqueId || device.connectionStatusLabel || "",
      })),
    [linkedDevices],
  );

  const availableDeviceIds = useMemo(
    () => new Set(availableDevices.map((device) => String(device.id))),
    [availableDevices],
  );

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

  const availableChipOptions = useMemo(
    () =>
      availableChips.map((chip) => ({
        value: chip.id,
        label: chip.iccid || chip.phone || chip.id,
        description: chip.carrier || chip.provider || chip.status || "",
        data: chip,
      })),
    [availableChips],
  );

  const availableChipIds = useMemo(
    () => new Set(availableChips.map((chip) => String(chip.id))),
    [availableChips],
  );

  const loadDeviceOptions = useCallback(
    async ({ query, page, pageSize }) => {
      const response = await CoreApi.searchDevices({
        clientId: resolvedClientId || vehicle?.clientId || undefined,
        query,
        page,
        pageSize,
      });
      const list = response?.devices || response?.data || [];
      const options = list
        .filter((device) => availableDeviceIds.has(String(device.id)))
        .map((device) => ({
          value: device.id,
          label: device.model || device.name || device.uniqueId || device.id,
          description: device.uniqueId || device.connectionStatusLabel || "",
          data: device,
        }));
      return { options, hasMore: Boolean(response?.hasMore) };
    },
    [availableDeviceIds, resolvedClientId, vehicle?.clientId],
  );

  const loadKitOptions = useCallback(
    async ({ query, page, pageSize }) => {
      const term = String(query || "").trim().toLowerCase();
      const filtered = availableKitOptions.filter((option) => {
        const haystack = `${option.label} ${option.description || ""}`.toLowerCase();
        return haystack.includes(term);
      });
      const start = (page - 1) * pageSize;
      const options = filtered.slice(start, start + pageSize);
      return { options, hasMore: start + pageSize < filtered.length };
    },
    [availableKitOptions],
  );

  const loadChipOptions = useCallback(
    async ({ query, page, pageSize }) => {
      const response = await CoreApi.searchChips({
        clientId: resolvedClientId || vehicle?.clientId || undefined,
        query,
        page,
        pageSize,
      });
      const list = response?.chips || response?.data || [];
      const options = list
        .filter((chip) => availableChipIds.has(String(chip.id)))
        .map((chip) => ({
          value: chip.id,
          label: chip.iccid || chip.phone || chip.id,
          description: chip.carrier || chip.provider || chip.status || "",
          data: chip,
        }));
      return { options, hasMore: Boolean(response?.hasMore) };
    },
    [availableChipIds, resolvedClientId, vehicle?.clientId],
  );

  const reportError = (message, fallbackMessage = "Falha ao executar ação") => {
    const payload = message instanceof Error ? message : new Error(message || fallbackMessage);
    setError(payload);
    setFeedback(null);
  };

  const reportSuccess = (message) => {
    setError(null);
    setAccessDenied(false);
    setFeedback(message);
  };

  const loadData = async () => {
    setLoading(true);
    setError(null);
    setFeedback(null);
    setAccessDenied(false);
    try {
      const params = isTechnician ? {} : resolvedClientId ? { clientId: resolvedClientId } : {};
      params.accessible = true;
      params.skipPositions = true;
      if (isAdmin) {
        params.includeUnlinked = true;
      } else {
        params.onlyLinked = true;
      }
      const modelParams = isTechnician
        ? undefined
        : {
            ...(resolvedClientId ? { clientId: resolvedClientId, includeGlobal: true } : {}),
            ...(isServiceStockGlobalGroup ? { scope: "both" } : {}),
          };
      const safeList = async (label, loader, fallback = []) => {
        try {
          return await loader();
        } catch (loadError) {
          console.warn(`[vehicle-details] falha ao carregar ${label}`, loadError?.message || loadError);
          return fallback;
        }
      };

      const vehicleList = await CoreApi.listVehicles(params);
      const [deviceList, chipList, modelList, kitList, clientList, attributeList] = await Promise.all([
        safeList("equipamentos", () => CoreApi.listDevices(params), []),
        isTechnician ? Promise.resolve([]) : safeList("chips", () => CoreApi.listChips(params), []),
        isTechnician ? Promise.resolve([]) : safeList("modelos", () => CoreApi.models(modelParams), []),
        !isTechnician && params.clientId
          ? safeList("kits", () => CoreApi.listKits({ clientId: params.clientId }), [])
          : Promise.resolve([]),
        isAdmin
          ? safeList("clientes", () => safeApi.get(API_ROUTES.clients).then(({ data }) => data?.clients || []), [])
          : Promise.resolve([]),
        !isTechnician && params.clientId
          ? safeList("atributos de veículo", () => CoreApi.listVehicleAttributes({ clientId: params.clientId }), [])
          : Promise.resolve([]),
      ]);
      const selectedVehicle = vehicleList.find((item) => String(item.id) === String(id)) || null;
      let resolvedKits = Array.isArray(kitList) ? kitList : [];
      if (!params.clientId && selectedVehicle?.clientId) {
        resolvedKits = await safeList(
          "kits do cliente do veículo",
          () => CoreApi.listKits({ clientId: selectedVehicle.clientId }),
          [],
        );
      }

      setVehicle(selectedVehicle);
      setDevices(Array.isArray(deviceList) ? deviceList : []);
      setChips(Array.isArray(chipList) ? chipList : []);
      setModels(Array.isArray(modelList) ? modelList : []);
      setKits(Array.isArray(resolvedKits) ? resolvedKits : []);
      setClients(Array.isArray(clientList) ? clientList : []);
      setVehicleAttributes(Array.isArray(attributeList) ? attributeList : []);
    } catch (requestError) {
      const status = Number(requestError?.status || requestError?.response?.status);
      if (status === 403 || status === 404) {
        setVehicle(null);
        setDevices([]);
        setChips([]);
        setModels([]);
        setKits([]);
        setClients([]);
        setVehicleAttributes([]);
        setFeedback(null);
        setAccessDenied(true);
        const mirrorMessage =
          requestError?.response?.data?.message || "Sem acesso ao veículo selecionado.";
        setError(new Error(mirrorMessage));
        return;
      }
      reportError(requestError, "Falha ao carregar veículo");
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchTenant = useCallback(() => {
    const nextTenant =
      tenants.find((item) => String(item.id) !== String(tenantId)) ||
      tenants[0];
    if (nextTenant) {
      switchClientAndReset({ nextTenantId: nextTenant.id ?? null });
    }
    navigate("/vehicles");
  }, [navigate, switchClientAndReset, tenantId, tenants]);

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
      setLinkEquipmentId("");
      await loadData();
      reportSuccess("Equipamento vinculado ao veículo.");
    } catch (requestError) {
      reportError(requestError, "Não foi possível vincular o equipamento");
    } finally {
      setSaving(false);
    }
  };

  const handleLinkKit = async (kitId) => {
    if (!vehicle || !kitId) return;
    const targetClientId = vehicle?.clientId || resolvedClientId;
    if (!targetClientId) {
      reportError("Selecione o cliente antes de vincular o kit");
      return;
    }
    setSaving(true);
    try {
      const response = await CoreApi.linkKitToVehicle(vehicle.id, kitId, { clientId: targetClientId });
      setLinkKitId("");
      await loadData();
      const linkedCount = Number(response?.linkedCount) || 0;
      reportSuccess(
        linkedCount > 0
          ? `Kit vinculado com sucesso (${linkedCount} equipamentos).`
          : "Kit vinculado com sucesso.",
      );
    } catch (requestError) {
      reportError(requestError, "Não foi possível vincular o kit");
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

  useEffect(() => {
    setVehiclePortLabels(vehicle?.attributes?.portLabels || {});
  }, [vehicle?.id, vehicle?.attributes?.portLabels]);

  useEffect(() => {
    setVehicleConfigItems(normalizeVehicleConfigItems(vehicle?.attributes?.customFields || []));
  }, [vehicle?.id, vehicle?.attributes?.customFields]);

  const loadServiceOrders = useCallback(async () => {
    if (!vehicle?.id) return;
    setServiceOrdersLoading(true);
    setServiceOrdersError(null);
    try {
      const params = {
        vehicleId: vehicle.id,
        ...(!isTechnician && (resolvedClientId || vehicle.clientId)
          ? { clientId: resolvedClientId || vehicle.clientId }
          : {}),
        ...(isTechnician && user?.id ? { technicianId: String(user.id) } : {}),
      };
      const response = await api.get("core/service-orders", { params });
      const list = Array.isArray(response?.data?.items) ? response.data.items : [];
      setServiceOrders(list);
      setServiceOrdersPage(1);
    } catch (requestError) {
      console.error("Falha ao carregar ordens de serviço do veículo", requestError);
      setServiceOrders([]);
      setServiceOrdersError(new Error("Não foi possível carregar as ordens de serviço."));
    } finally {
      setServiceOrdersLoading(false);
    }
  }, [isTechnician, resolvedClientId, user?.id, vehicle?.clientId, vehicle?.id]);

  const loadHistory = useCallback(async () => {
    if (!vehicle?.id) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const params = {
        clientId: resolvedClientId || vehicle.clientId || undefined,
        ...(historyFrom ? { from: historyFrom } : {}),
        ...(historyTo ? { to: historyTo } : {}),
      };
      const response = await CoreApi.getVehicleHistory(vehicle.id, params);
      const list = response?.data || response?.items || response?.events || response || [];
      setHistoryEntries(Array.isArray(list) ? list : []);
      setHistoryPage(1);
    } catch (requestError) {
      console.error("Falha ao carregar histórico do veículo", requestError);
      setHistoryEntries([]);
      setHistoryError(new Error("Não foi possível carregar o histórico."));
    } finally {
      setHistoryLoading(false);
    }
  }, [historyFrom, historyTo, resolvedClientId, vehicle?.clientId, vehicle?.id]);

  const handleSaveVehicle = async (payload) => {
    if (!vehicle) return;
    const clientId = payload.clientId || vehicle.clientId || resolvedClientId;
    if (!clientId) {
      reportError("Selecione o cliente antes de salvar o veículo");
      return;
    }
    setSaving(true);
    try {
      const mergedPayload = { ...payload, clientId };
      if (payload.vehicleAttributes !== undefined || payload.attributes !== undefined) {
        const currentAttributes =
          vehicle?.attributes && typeof vehicle.attributes === "object" ? vehicle.attributes : {};
        const payloadAttributes =
          payload?.attributes && typeof payload.attributes === "object" ? payload.attributes : {};
        mergedPayload.attributes = { ...currentAttributes, ...payloadAttributes };
        if (payload.vehicleAttributes !== undefined) {
          mergedPayload.attributes.vehicleAttributes = Array.isArray(payload.vehicleAttributes)
            ? payload.vehicleAttributes
            : [];
          delete mergedPayload.vehicleAttributes;
        }
      }
      await CoreApi.updateVehicle(vehicle.id, mergedPayload);
      await loadData();
      reportSuccess("Veículo atualizado com sucesso.");
    } catch (requestError) {
      reportError(requestError, "Falha ao salvar veículo");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveVehicleConfigItems = async () => {
    if (!vehicle) return;
    const clientId = resolvedClientId || vehicle.clientId;
    if (!clientId) {
      reportError("Selecione o cliente antes de salvar os itens.");
      return;
    }
    const normalizedItems = normalizeVehicleConfigItems(vehicleConfigItems);
    setSavingVehicleConfigItems(true);
    try {
      const nextAttributes = {
        ...(vehicle.attributes || {}),
        customFields: normalizedItems,
      };
      await CoreApi.updateVehicle(vehicle.id, { clientId, attributes: nextAttributes });
      await loadData();
      reportSuccess("Itens adicionais salvos com sucesso.");
    } catch (requestError) {
      reportError(requestError, "Falha ao salvar itens adicionais");
    } finally {
      setSavingVehicleConfigItems(false);
    }
  };

  const handleSaveVehiclePorts = async () => {
    if (!vehicle) return;
    const clientId = resolvedClientId || vehicle.clientId;
    if (!clientId) {
      reportError("Selecione o cliente antes de salvar as portas");
      return;
    }
    setSavingPorts(true);
    try {
      const nextAttributes = {
        ...(vehicle.attributes || {}),
        portLabels: vehiclePortLabels || {},
      };
      await CoreApi.updateVehicle(vehicle.id, { clientId, attributes: nextAttributes });
      await loadData();
      reportSuccess("Portas do veículo atualizadas.");
    } catch (requestError) {
      reportError(requestError, "Falha ao salvar portas do veículo");
    } finally {
      setSavingPorts(false);
    }
  };

  const handleDeleteVehicle = async () => {
    if (!vehicle?.id || !isAdminGeneral) return;
    await confirmDelete({
      title: "Excluir veículo",
      message: `Tem certeza que deseja excluir o veículo ${vehicle.plate || vehicle.name || ""}? Essa ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      onConfirm: async () => {
        try {
          await CoreApi.deleteVehicle(vehicle.id);
          showToast("Excluído com sucesso.");
          navigate("/vehicles");
        } catch (requestError) {
          showToast("Falha ao excluir.", "error");
          throw requestError;
        }
      },
    });
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
  };

  const tabs = useMemo(() => {
    if (isTechnician) {
      return [{ id: "os", label: "Ordens de Serviço" }];
    }
    if (isServiceStockGlobalGroup) {
      return [
        { id: "resumo", label: "Resumo" },
        { id: "equipamentos", label: "Equipamentos" },
        { id: "os", label: "Ordens de Serviço" },
        { id: "admin", label: "Editar" },
      ];
    }
    const baseTabs = [
      { id: "resumo", label: "Resumo" },
      { id: "equipamentos", label: "Equipamentos" },
      { id: "configuracao", label: "Configuração do Veículo" },
      { id: "os", label: "Ordens de Serviço" },
      { id: "historico", label: "Histórico" },
    ];
    if (isAdmin) {
      baseTabs.push({ id: "admin", label: "Editar" });
    }
    return baseTabs;
  }, [isAdmin, isServiceStockGlobalGroup, isTechnician]);

  useEffect(() => {
    if (!isTechnician) return;
    if (activeTab !== "os") {
      setActiveTab("os");
    }
  }, [activeTab, isTechnician]);

  const historyTypeOptions = useMemo(
    () => [
      { value: "all", label: "Todos" },
      { value: "vinculo", label: "Vínculos" },
      { value: "tratativa", label: "Tratativas" },
      { value: "veiculo", label: "Alterações" },
      { value: "outro", label: "Outros" },
    ],
    [],
  );

  const normalizeHistoryType = useCallback((entry) => {
    const action = String(entry?.action || "").toUpperCase();
    if (String(entry?.category || "") === "alert-handling") return "tratativa";
    if (action.includes("VINCULAR") || action.includes("DESVINCULAR")) return "vinculo";
    if (String(entry?.category || "") === "vehicle") return "veiculo";
    return "outro";
  }, []);

  const normalizedHistoryEntries = useMemo(() => {
    const list = Array.isArray(historyEntries) ? historyEntries : [];
    return list
      .map((entry) => {
        const timestamp = entry?.sentAt || entry?.respondedAt || entry?.createdAt || null;
        const type = normalizeHistoryType(entry);
        const handlingNotes =
          entry?.details?.handlingNotes ||
          entry?.details?.notes ||
          entry?.details?.handlingAction ||
          entry?.details?.handlingCause ||
          null;
        const plate = entry?.details?.plate ? `Placa: ${entry.details.plate}` : null;
        const description = handlingNotes || plate || entry?.status || "—";
        return {
          ...entry,
          __type: type,
          __timestamp: timestamp,
          __description: description,
        };
      })
      .sort((a, b) => {
        const aMs = a.__timestamp ? new Date(a.__timestamp).getTime() : 0;
        const bMs = b.__timestamp ? new Date(b.__timestamp).getTime() : 0;
        return bMs - aMs;
      });
  }, [historyEntries, normalizeHistoryType]);

  const filteredHistoryEntries = useMemo(() => {
    if (historyType === "all") return normalizedHistoryEntries;
    return normalizedHistoryEntries.filter((entry) => entry.__type === historyType);
  }, [historyType, normalizedHistoryEntries]);

  const historyPageCount = useMemo(() => {
    if (!filteredHistoryEntries.length) return 1;
    return Math.ceil(filteredHistoryEntries.length / historyPageSize);
  }, [filteredHistoryEntries.length, historyPageSize]);

  const pagedHistoryEntries = useMemo(() => {
    const start = (historyPage - 1) * historyPageSize;
    return filteredHistoryEntries.slice(start, start + historyPageSize);
  }, [filteredHistoryEntries, historyPage, historyPageSize]);

  const sortedServiceOrders = useMemo(() => {
    if (!Array.isArray(serviceOrders)) return [];
    return [...serviceOrders].sort((a, b) => {
      const aDate = new Date(a?.startAt || a?.createdAt || a?.updatedAt || 0).getTime();
      const bDate = new Date(b?.startAt || b?.createdAt || b?.updatedAt || 0).getTime();
      return bDate - aDate;
    });
  }, [serviceOrders]);

  const pagedServiceOrders = useMemo(() => {
    const start = (serviceOrdersPage - 1) * serviceOrdersPageSize;
    return sortedServiceOrders.slice(start, start + serviceOrdersPageSize);
  }, [serviceOrdersPage, serviceOrdersPageSize, sortedServiceOrders]);

  const serviceOrdersPageCount = useMemo(() => {
    if (!sortedServiceOrders.length) return 1;
    return Math.ceil(sortedServiceOrders.length / serviceOrdersPageSize);
  }, [serviceOrdersPageSize, sortedServiceOrders.length]);

  useEffect(() => {
    if (activeTab !== "os") return;
    loadServiceOrders();
  }, [activeTab, loadServiceOrders]);

  useEffect(() => {
    if (!vehicle?.id) return;
    loadServiceOrders();
  }, [loadServiceOrders, vehicle?.id]);

  const renderHistoryPanel = () => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={historyType} onChange={(event) => setHistoryType(event.target.value)}>
          {historyTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Input
          type="datetime-local"
          value={historyFrom}
          onChange={(event) => setHistoryFrom(event.target.value)}
        />
        <Input
          type="datetime-local"
          value={historyTo}
          onChange={(event) => setHistoryTo(event.target.value)}
        />
        <button
          type="button"
          onClick={loadHistory}
          className="rounded-xl bg-white/10 px-4 py-2 text-xs text-white/70 transition hover:bg-white/15"
        >
          Atualizar
        </button>
      </div>

      {historyError && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {historyError.message}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-white/10">
        <DataTable>
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
            <tr className="text-left">
              <th className="px-4 py-3">Data/Hora</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Ação</th>
              <th className="px-4 py-3">Usuário</th>
              <th className="px-4 py-3">Detalhes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {historyLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-sm text-white/60">
                  Carregando histórico...
                </td>
              </tr>
            )}
            {!historyLoading && pagedHistoryEntries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6">
                  <EmptyState title="Nenhum histórico encontrado." />
                </td>
              </tr>
            )}
            {!historyLoading &&
              pagedHistoryEntries.map((entry) => (
                <tr key={entry.id} className="hover:bg-white/5">
                  <td className="px-4 py-3 text-sm text-white/80">
                    {formatServiceOrderDate(entry.__timestamp)}
                  </td>
                  <td className="px-4 py-3 text-sm text-white/70">
                    {historyTypeOptions.find((option) => option.value === entry.__type)?.label || "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-white/70">{entry.action || "—"}</td>
                  <td className="px-4 py-3 text-sm text-white/70">
                    {entry.user?.name || entry.user?.id || "Sistema"}
                  </td>
                  <td className="px-4 py-3 text-sm text-white/70">{entry.__description}</td>
                </tr>
              ))}
          </tbody>
        </DataTable>
      </div>

      {historyPageCount > 1 && (
        <div className="flex items-center justify-between text-xs text-white/60">
          <span>
            Página {historyPage} de {historyPageCount}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHistoryPage((prev) => Math.max(prev - 1, 1))}
              disabled={historyPage <= 1}
              className="rounded-lg border border-white/10 px-3 py-1 text-white/70 transition hover:border-white/30 disabled:opacity-50"
            >
              Anterior
            </button>
            <button
              type="button"
              onClick={() => setHistoryPage((prev) => Math.min(prev + 1, historyPageCount))}
              disabled={historyPage >= historyPageCount}
              className="rounded-lg border border-white/10 px-3 py-1 text-white/70 transition hover:border-white/30 disabled:opacity-50"
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );

  useEffect(() => {
    if (activeTab === "historico") {
      loadHistory();
    }
  }, [activeTab, loadHistory]);

  useEffect(() => {
    if (activeTab !== "historico") return;
    setHistoryPage(1);
  }, [activeTab, historyType, historyFrom, historyTo]);

  useEffect(() => {
    const normalizedPath = String(location.pathname || "");
    const searchParams = new URLSearchParams(location.search || "");
    const normalizeTab = (value) => String(value || "").trim().toLowerCase();
    const tabParam = normalizeTab(searchParams.get("tab"));
    const subTabParam = normalizeTab(
      searchParams.get("subtab") || searchParams.get("adminTab") || searchParams.get("activeSubTab"),
    );
    const stateSubTab = normalizeTab(location.state?.activeSubTab || location.state?.adminTab);
    const isLegacyEditPath = /\/(vehicles|veiculos)\/[^/]+\/(edit|editar)$/i.test(normalizedPath);
    const isLegacyHistoryTarget =
      tabParam === "history" ||
      tabParam === "historico" ||
      subTabParam === "history" ||
      subTabParam === "historico" ||
      stateSubTab === "history" ||
      stateSubTab === "historico";
    const wantsEditTab =
      isLegacyEditPath ||
      tabParam === "edit" ||
      tabParam === "editar" ||
      tabParam === "admin" ||
      isLegacyHistoryTarget;

    if ((isAdmin || isServiceStockGlobalGroup) && wantsEditTab && activeTab !== "admin") {
      setActiveTab("admin");
    }

    const hasLegacyState = Boolean(location.state?.activeSubTab || location.state?.adminTab);
    const legacyQueryKeys = ["tab", "subtab", "adminTab", "activeSubTab"];
    const cleanedSearchParams = new URLSearchParams(searchParams);
    let hasLegacyQuery = false;
    legacyQueryKeys.forEach((key) => {
      if (cleanedSearchParams.has(key)) {
        cleanedSearchParams.delete(key);
        hasLegacyQuery = true;
      }
    });

    if (!isLegacyEditPath && !hasLegacyQuery && !hasLegacyState) return;

    const canonicalBase = normalizedPath.startsWith("/veiculos/") ? "/veiculos" : "/vehicles";
    const canonicalPath = `${canonicalBase}/${id}`;
    const nextSearch = cleanedSearchParams.toString();
    navigate(
      {
        pathname: canonicalPath,
        search: nextSearch ? `?${nextSearch}` : "",
      },
      { replace: true },
    );
  }, [activeTab, id, isAdmin, isServiceStockGlobalGroup, location.pathname, location.search, location.state, navigate]);

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
          !isTechnician ? (
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/services/new"
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
              >
                Nova OS
              </Link>
              {isAdminGeneral && vehicle && (
                <button
                  type="button"
                  onClick={handleDeleteVehicle}
                  className="rounded-xl border border-red-500/40 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10"
                >
                  Excluir
                </button>
              )}
            </div>
          ) : null
        }
      />

      {accessDenied && (
        <DataCard>
          <EmptyState
            title="Sem acesso"
            subtitle={error?.message || "Você não tem acesso a este veículo."}
            action={(
              <button
                type="button"
                onClick={handleSwitchTenant}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
              >
                Trocar cliente
              </button>
            )}
          />
        </DataCard>
      )}
      {error && !accessDenied && (
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

      {!loading && !vehicle && !error && !accessDenied && (
        <DataCard>
          <EmptyState
            title={isMirrorContextActive ? "Veículo não encontrado para este espelhamento." : "Veículo não encontrado."}
            subtitle="Verifique a placa ou tente novamente."
          />
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
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4">
                    <span className="text-xs uppercase tracking-[0.12em] text-white/60">
                      Equipamentos vinculados
                    </span>
                  </div>
                  <div className="grid gap-3 px-4">
                    <div className="grid gap-3 md:grid-cols-[2fr_auto]">
                      <AutocompleteSelect
                        label="Vincular por kit"
                        placeholder="Selecione um kit"
                        value={linkKitId}
                        onChange={(value) => setLinkKitId(value)}
                        options={availableKitOptions}
                        loadOptions={loadKitOptions}
                        allowClear
                      />
                      <div className="flex items-end">
                        <Button
                          type="button"
                          onClick={() => handleLinkKit(linkKitId)}
                          disabled={!linkKitId || saving}
                        >
                          {saving ? "Vinculando..." : "Vincular kit"}
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[2fr_auto]">
                      <AutocompleteSelect
                        label="Vincular equipamento avulso"
                        placeholder="Buscar equipamento"
                        value={linkEquipmentId}
                        onChange={(value) => setLinkEquipmentId(value)}
                        options={availableDeviceOptions}
                        loadOptions={loadDeviceOptions}
                        allowClear
                      />
                      <div className="flex items-end">
                        <Button
                          type="button"
                          onClick={() => handleLinkDevice(linkEquipmentId)}
                          disabled={!linkEquipmentId || saving}
                        >
                          {saving ? "Vinculando..." : "Vincular equipamento"}
                        </Button>
                      </div>
                    </div>
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
                                {resolveDeviceEquipmentStatus(device)}
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
                  <div className="grid gap-3 md:grid-cols-3">
                    <AutocompleteSelect
                      label="Chip"
                      placeholder="Buscar chip"
                      value={chipLinkId}
                      onChange={(value) => setChipLinkId(value)}
                      options={availableChipOptions}
                      loadOptions={loadChipOptions}
                      allowClear
                      className="md:col-span-2"
                    />
                    <AutocompleteSelect
                      label="Equipamento"
                      placeholder="Selecione o equipamento"
                      value={chipDeviceId}
                      onChange={(value) => setChipDeviceId(value)}
                      options={linkedDeviceOptions}
                      allowClear
                    />
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

          {activeTab === "configuracao" && (
            <DataCard className="space-y-4">
              <div className="px-4 pt-4">
                <h2 className="text-sm font-semibold text-white">Configuração do Veículo</h2>
                <p className="text-xs text-white/60">Portas e parâmetros específicos do veículo.</p>
              </div>
              <div className="space-y-4 px-4 pb-4">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
                  <div className="text-xs uppercase tracking-[0.12em] text-white/50">Portas</div>
                  {!primaryDevice && (
                    <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                      Vincule um equipamento para configurar as portas deste veículo.
                    </div>
                  )}
                  {primaryDevice && vehiclePortList.length === 0 && (
                    <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                      Nenhuma porta encontrada para o equipamento vinculado.
                    </div>
                  )}
                  {primaryDevice && vehiclePortList.length > 0 && (
                    <div className="grid gap-3">
                      {vehiclePortList.map((port) => (
                        <div key={port.key} className="rounded-xl border border-white/10 bg-white/5 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs uppercase tracking-[0.12em] text-white/50">{port.key}</div>
                            {port.stateLabel ? (
                              <span className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-white/70">
                                {port.stateLabel}
                              </span>
                            ) : null}
                          </div>
                          <Input
                            value={vehiclePortLabels?.[port.key] ?? port.label}
                            onChange={(event) => {
                              const value = event.target.value;
                              setVehiclePortLabels((current) => {
                                const next = { ...(current || {}) };
                                if (value.trim()) {
                                  next[port.key] = value;
                                } else {
                                  delete next[port.key];
                                }
                                return next;
                              });
                            }}
                            placeholder={port.defaultLabel}
                            className="mt-2"
                          />
                          <div className="mt-2 text-xs text-white/40">Nome padrão: {port.defaultLabel}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {primaryDevice && (
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleSaveVehiclePorts}
                        disabled={savingPorts}
                        className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15 disabled:opacity-60"
                      >
                        {savingPorts ? "Salvando..." : "Salvar portas"}
                      </button>
                    </div>
                  )}
                </div>
                <VehicleConfigItemsEditor
                  items={vehicleConfigItems}
                  onChange={setVehicleConfigItems}
                  onSave={handleSaveVehicleConfigItems}
                  saving={savingVehicleConfigItems}
                  title="Configurações adicionais do veículo"
                  subtitle="Cadastre Nome, Valor e Descrição dos itens do veículo."
                />
              </div>
            </DataCard>
          )}

          {activeTab === "os" && (
            <DataCard className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Ordens de Serviço</h2>
                <button
                  type="button"
                  onClick={loadServiceOrders}
                  className="rounded-xl bg-white/10 px-3 py-2 text-xs text-white/70 transition hover:bg-white/15"
                >
                  Atualizar
                </button>
              </div>

              {serviceOrdersError && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  {serviceOrdersError.message}
                </div>
              )}

              <div className="overflow-hidden rounded-xl border border-white/10">
                <DataTable>
                  <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
                    <tr className="text-left">
                      <th className="px-4 py-3">OS</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Técnico</th>
                      <th className="px-4 py-3">Data</th>
                      <th className="px-4 py-3">Endereço</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {serviceOrdersLoading && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-sm text-white/60">
                          Carregando ordens de serviço...
                        </td>
                      </tr>
                    )}
                    {!serviceOrdersLoading && pagedServiceOrders.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6">
                          <EmptyState
                            title="Nenhuma ordem de serviço registrada."
                            subtitle={
                              isTechnician
                                ? "Nenhuma ordem de serviço vinculada a você para este veículo."
                                : "Crie uma nova OS para este veículo."
                            }
                          />
                        </td>
                      </tr>
                    )}
                    {!serviceOrdersLoading &&
                      pagedServiceOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-white/5">
                          <td className="px-4 py-3">
                            <Link
                              to={`/services/${order.id}`}
                              className="text-sm text-sky-200 hover:text-sky-100"
                            >
                              {order.osInternalId || order.id?.slice(0, 8)}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-sm text-white/80">{order.status || "—"}</td>
                          <td className="px-4 py-3 text-sm text-white/70">{order.technicianName || "—"}</td>
                          <td className="px-4 py-3 text-sm text-white/70">
                            {formatServiceOrderDate(order.startAt || order.createdAt)}
                          </td>
                          <td className="px-4 py-3 text-sm text-white/70">{order.address || "—"}</td>
                        </tr>
                      ))}
                  </tbody>
                </DataTable>
              </div>

              {serviceOrdersPageCount > 1 && (
                <div className="flex items-center justify-between text-xs text-white/60">
                  <span>
                    Página {serviceOrdersPage} de {serviceOrdersPageCount}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setServiceOrdersPage((prev) => Math.max(prev - 1, 1))}
                      disabled={serviceOrdersPage <= 1}
                      className="rounded-lg border border-white/10 px-3 py-1 text-white/70 transition hover:border-white/30 disabled:opacity-50"
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      onClick={() => setServiceOrdersPage((prev) => Math.min(prev + 1, serviceOrdersPageCount))}
                      disabled={serviceOrdersPage >= serviceOrdersPageCount}
                      className="rounded-lg border border-white/10 px-3 py-1 text-white/70 transition hover:border-white/30 disabled:opacity-50"
                    >
                      Próxima
                    </button>
                  </div>
                </div>
              )}
            </DataCard>
          )}

          {activeTab === "historico" && (
            <DataCard className="space-y-4">
              <h2 className="text-sm font-semibold text-white">Histórico do veículo</h2>
              {renderHistoryPanel()}
            </DataCard>
          )}

          {activeTab === "admin" && (
            <DataCard className="space-y-4">
              <AdminBindingsTab
                vehicle={vehicle}
                vehicleAttributes={vehicleAttributes}
                clients={clients}
                tenantId={tenantId}
                tenantScope={tenantScope}
                user={user}
                onSaveVehicle={handleSaveVehicle}
                saving={saving}
                onError={reportError}
              />
              <VehicleConfigItemsEditor
                items={vehicleConfigItems}
                onChange={setVehicleConfigItems}
                onSave={handleSaveVehicleConfigItems}
                saving={savingVehicleConfigItems}
                title="Itens adicionais (Editar)"
                subtitle="Gerencie Nome, Valor e Descrição também na aba Editar."
              />
            </DataCard>
          )}
        </>
      )}
      <PageToast toast={toast} />
    </div>
  );
}
