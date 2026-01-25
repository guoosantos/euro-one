import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import AutocompleteSelect from "../components/ui/AutocompleteSelect.jsx";
import { useConfirmDialog } from "../components/ui/ConfirmDialogProvider.jsx";
import useAdminGeneralAccess from "../lib/hooks/useAdminGeneralAccess.js";
import usePageToast from "../lib/hooks/usePageToast.js";
import PageToast from "../components/ui/PageToast.jsx";

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

export default function VehicleDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { tenantId, user, tenants, setTenantId } = useTenant();
  const { confirmDelete } = useConfirmDialog();
  const { isAdminGeneral } = useAdminGeneralAccess();
  const { toast, showToast } = usePageToast();
  const [vehicle, setVehicle] = useState(null);
  const [devices, setDevices] = useState([]);
  const [chips, setChips] = useState([]);
  const [vehicleAttributes, setVehicleAttributes] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [linkEquipmentId, setLinkEquipmentId] = useState("");
  const [chipLinkId, setChipLinkId] = useState("");
  const [chipDeviceId, setChipDeviceId] = useState("");
  const [activeTab, setActiveTab] = useState("resumo");
  const [equipmentTab, setEquipmentTab] = useState("equipamentos");
  const [lastPositionAddress, setLastPositionAddress] = useState(null);
  const [lastPositionLoading, setLastPositionLoading] = useState(false);
  const geocodeCacheRef = useRef(new Map());

  const isAdmin = ["admin", "manager"].includes(user?.role);
  const resolvedClientId = tenantId || user?.clientId || null;
  const isMirrorContextActive = Boolean(user?.activeMirrorOwnerClientId);

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
      const params = resolvedClientId ? { clientId: resolvedClientId } : {};
      params.accessible = true;
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
      const status = Number(requestError?.status || requestError?.response?.status);
      if (status === 403 || status === 404) {
        setVehicle(null);
        setDevices([]);
        setChips([]);
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
      setTenantId(nextTenant.id ?? null);
    }
    navigate("/vehicles");
  }, [navigate, setTenantId, tenantId, tenants]);

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
                  <div className="grid gap-3 px-4 md:grid-cols-[2fr_auto]">
                    <AutocompleteSelect
                      label="Buscar equipamento"
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
      <PageToast toast={toast} />
    </div>
  );
}
