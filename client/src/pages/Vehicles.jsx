import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import Button from "../ui/Button";
import { FolderPlus, Pencil, Plus, RefreshCw, Search, Tags } from "lucide-react";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";
import { useTraccarDevices } from "../lib/hooks/useTraccarDevices.js";
import { resolveVehicleIconType, VEHICLE_TYPE_OPTIONS } from "../lib/icons/vehicleIcons.js";
import { computeAutoVisibility, loadColumnVisibility, saveColumnVisibility } from "../lib/column-visibility.js";
import VehicleForm from "../components/vehicles/VehicleForm.jsx";
import useMapLifecycle from "../lib/map/useMapLifecycle.js";
import PageHeader from "../components/ui/PageHeader.jsx";
import FilterBar from "../components/ui/FilterBar.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import SkeletonTable from "../components/ui/SkeletonTable.jsx";
import Modal from "../ui/Modal";
import { useConfirmDialog } from "../components/ui/ConfirmDialogProvider.jsx";
import useAdminGeneralAccess from "../lib/hooks/useAdminGeneralAccess.js";
import usePageToast from "../lib/hooks/usePageToast.js";
import PageToast from "../components/ui/PageToast.jsx";

const BRAND_COLORS = {
  fiat: "bg-red-500/20 text-red-200",
  vw: "bg-sky-500/20 text-sky-200",
  volkswagen: "bg-sky-500/20 text-sky-200",
  gm: "bg-slate-500/20 text-slate-200",
  chevrolet: "bg-slate-500/20 text-slate-200",
  ford: "bg-indigo-500/20 text-indigo-200",
};

function Drawer({ open, onClose, title, description, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9998] flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-3xl border-l border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Veículos</p>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {description && <p className="text-sm text-white/60">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-white/70 transition hover:border-white/30 hover:text-white"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>
        <div className="h-[calc(100%-80px)] overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

function VehicleTypeIcon({ type }) {
  const tone = "stroke-white/70";
  if (type === "truck") {
    return (
      <svg width="28" height="20" viewBox="0 0 28 20" className={`${tone}`}>
        <rect x="1" y="6" width="14" height="8" rx="2" fill="none" strokeWidth="1.5" />
        <rect x="16" y="8" width="8" height="6" rx="2" fill="none" strokeWidth="1.5" />
        <circle cx="6" cy="16" r="2" fill="none" strokeWidth="1.5" />
        <circle cx="20" cy="16" r="2" fill="none" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg width="28" height="20" viewBox="0 0 28 20" className={`${tone}`}>
      <rect x="2" y="8" width="20" height="6" rx="2" fill="none" strokeWidth="1.5" />
      <path d="M6 8l3-4h7l3 4" fill="none" strokeWidth="1.5" />
      <circle cx="8" cy="16" r="2" fill="none" strokeWidth="1.5" />
      <circle cx="18" cy="16" r="2" fill="none" strokeWidth="1.5" />
    </svg>
  );
}

function BrandBadge({ brand }) {
  const normalized = String(brand || "").toLowerCase();
  const className = BRAND_COLORS[normalized] || "bg-white/10 text-white/80";
  const initials = brand ? brand.slice(0, 2).toUpperCase() : "--";
  return (
    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${className}`}>
      {initials}
    </span>
  );
}

function VehicleRow({
  vehicle,
  typeIcon,
  brandBadge,
  modelLabel,
  plateLabel,
  responsibleLabel,
  statusLabel,
  attributeBadges,
  onEdit,
  onDelete,
  canDelete,
}) {
  return (
    <tr className="hover:bg-white/5">
      <td className="px-4 py-4">{typeIcon}</td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-2">
          {brandBadge}
          <div>
            <div className="font-semibold text-white">{vehicle.brand || "—"}</div>
            <div className="text-xs text-white/60">{vehicle.model || vehicle.name || "—"}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="font-semibold text-white">{modelLabel}</div>
        <div className="text-xs text-white/60">{plateLabel}</div>
      </td>
      <td className="px-4 py-4">{plateLabel}</td>
      <td className="px-4 py-4">{responsibleLabel}</td>
      <td className="px-4 py-4">
        <span className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80">{statusLabel}</span>
      </td>
      <td className="px-4 py-4">
        {attributeBadges?.length ? (
          <div className="flex flex-wrap gap-2">
            {attributeBadges}
          </div>
        ) : (
          <span className="text-xs text-white/50">—</span>
        )}
      </td>
      <td className="px-4 py-4 text-right">
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white transition hover:border-white/30"
            aria-label="Editar veículo"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-500/40 text-red-300 transition hover:bg-red-500/10"
              aria-label="Excluir veículo"
            >
              ×
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function Vehicles() {
  const mapRef = useRef(null);
  const { onMapReady } = useMapLifecycle({ mapRef });
  const { tenantId, user, tenants, hasAdminAccess } = useTenant();
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mapTarget, setMapTarget] = useState(null);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [vehicleAttributes, setVehicleAttributes] = useState([]);
  const [attributeQuery, setAttributeQuery] = useState("");
  const [attributeListQuery, setAttributeListQuery] = useState("");
  const [attributeFilterId, setAttributeFilterId] = useState("");
  const [attributeDrawerOpen, setAttributeDrawerOpen] = useState(false);
  const [attributeDrawerTab, setAttributeDrawerTab] = useState("list");
  const [attributeForm, setAttributeForm] = useState({ name: "", color: "#38bdf8" });
  const { confirmDelete } = useConfirmDialog();
  const { isAdminGeneral } = useAdminGeneralAccess();
  const { toast, showToast } = usePageToast();
  const [form, setForm] = useState({
    name: "",
    plate: "",
    driver: "",
    group: "",
    type: "",
    status: "ativo",
    notes: "",
    deviceId: "",
    clientId: tenantId || user?.clientId || "",
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

  const resolvedClientId = tenantId || user?.clientId || null;
  const columnStorageKey = useMemo(
    () => `vehicles.columns:${user?.id || "anon"}:${resolvedClientId || "all"}`,
    [resolvedClientId, user?.id],
  );
  const columnDefaults = useMemo(
    () => ({
      driver: true,
      group: true,
      odometer: true,
    }),
    [],
  );
  const [visibleColumns, setVisibleColumns] = useState(
    () => loadColumnVisibility(columnStorageKey) ?? columnDefaults,
  );
  const columnAutoApplied = useRef(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const clientParams = resolvedClientId ? { clientId: resolvedClientId } : {};
      clientParams.accessible = true;
      if (user?.role === "admin" || user?.role === "manager") {
        clientParams.includeUnlinked = true;
      } else {
        clientParams.onlyLinked = true;
      }
      const [vehicleList, deviceList] = await Promise.all([
        CoreApi.listVehicles(clientParams),
        CoreApi.listDevices(clientParams),
      ]);
      setVehicles(Array.isArray(vehicleList) ? vehicleList : []);
      setDevices(Array.isArray(deviceList) ? deviceList : []);
    } catch (requestError) {
      const status = requestError?.status || requestError?.response?.status;
      if (status === 503) {
        setError(new Error("Telemetria indisponível no momento. Tente novamente em instantes."));
      } else if (status >= 500) {
        const requestId =
          requestError?.response?.data?.requestId ||
          requestError?.response?.data?.request_id ||
          requestError?.response?.data?.id ||
          null;
        console.error("Erro interno ao carregar veículos", { status, requestId, error: requestError });
        setError(new Error("Erro interno no servidor ao carregar veículos."));
      } else {
        setError(requestError instanceof Error ? requestError : new Error("Falha ao carregar veículos"));
      }
    } finally {
      setLoading(false);
    }
  }

  const loadVehicleAttributes = async (clientId) => {
    if (!clientId) {
      setVehicleAttributes([]);
      return;
    }
    try {
      const list = await CoreApi.listVehicleAttributes({ clientId });
      setVehicleAttributes(Array.isArray(list) ? list : []);
    } catch (requestError) {
      console.error("Falha ao carregar atributos de veículo", requestError);
      setVehicleAttributes([]);
    }
  };

  useEffect(() => {
    if (resolvedClientId || user) {
      load();
      loadVehicleAttributes(resolvedClientId);
    }
  }, [resolvedClientId, user]);

  useEffect(() => {
    setQuery("");
    setAttributeQuery("");
    setAttributeListQuery("");
    setAttributeFilterId("");
    setShowColumnPicker(false);
    setMapTarget(null);
  }, [resolvedClientId]);

  const trackedDeviceIds = useMemo(
    () =>
      vehicles
        .map((vehicle) =>
          toDeviceKey(
            vehicle.device?.traccarId ?? vehicle.device?.id ?? vehicle.deviceId ?? vehicle.device?.uniqueId ?? vehicle.device_id,
          ),
        )
        .filter(Boolean),
    [vehicles],
  );

  const { getDeviceCoordinates, getDeviceLastSeen, getDevicePosition, getDeviceStatus } = useTraccarDevices({
    deviceIds: trackedDeviceIds,
  });

  const getVehicleAttributeList = (vehicle) => {
    const list = vehicle?.attributes?.vehicleAttributes;
    return Array.isArray(list) ? list : [];
  };

  const filteredVehicles = useMemo(() => {
    const term = query.trim().toLowerCase();
    const attributeTerm = attributeQuery.trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      if (term) {
        const matches = [
          vehicle.model,
          vehicle.name,
          vehicle.plate,
          vehicle.driver,
          vehicle.group,
          vehicle.brand,
          vehicle.clientName,
          vehicle.client?.name,
          vehicle.device?.uniqueId,
          vehicle.device?.name,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
        if (!matches) return false;
      }

      const attributes = getVehicleAttributeList(vehicle);
      if (attributeFilterId) {
        const hasAttribute = attributes.some((item) => String(item.id) === String(attributeFilterId));
        if (!hasAttribute) return false;
      }
      if (attributeTerm) {
        const matchesAttribute = attributes.some((item) =>
          String(item.name || "").toLowerCase().includes(attributeTerm),
        );
        if (!matchesAttribute) return false;
      }

      return true;
    });
  }, [attributeFilterId, attributeQuery, getVehicleAttributeList, query, vehicles]);

  const columnDefs = useMemo(
    () => [
      {
        key: "driver",
        label: "Motorista",
        defaultVisible: true,
        isMissing: (vehicle) => !vehicle?.driver,
      },
      {
        key: "group",
        label: "Grupo",
        defaultVisible: true,
        isMissing: (vehicle) => !vehicle?.group,
      },
      {
        key: "odometer",
        label: "Odômetro",
        defaultVisible: true,
        isMissing: (vehicle) => !Number.isFinite(Number(vehicle?.odometer)),
      },
    ],
    [],
  );

  useEffect(() => {
    columnAutoApplied.current = false;
    const stored = loadColumnVisibility(columnStorageKey);
    setVisibleColumns(stored ?? columnDefaults);
  }, [columnDefaults, columnStorageKey]);

  useEffect(() => {
    if (columnAutoApplied.current) return;
    if (!vehicles.length) return;
    const stored = loadColumnVisibility(columnStorageKey);
    if (stored) {
      columnAutoApplied.current = true;
      return;
    }
    const autoVisibility = computeAutoVisibility(vehicles, columnDefs, 0.9);
    setVisibleColumns((current) => ({ ...current, ...autoVisibility }));
    columnAutoApplied.current = true;
  }, [columnDefs, columnStorageKey, vehicles]);

  useEffect(() => {
    saveColumnVisibility(columnStorageKey, visibleColumns);
  }, [columnStorageKey, visibleColumns]);

  const tableColCount = 8;

  const formatVehicleType = (value) => {
    if (!value) return "—";
    const normalized = String(value).toLowerCase();
    const match = VEHICLE_TYPE_OPTIONS.find((option) => option.value === normalized);
    if (match) return match.label;
    const resolved = resolveVehicleIconType(value);
    const resolvedMatch = VEHICLE_TYPE_OPTIONS.find((option) => option.value === resolved);
    return resolvedMatch?.label || value;
  };

  const formatOdometer = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return `${Intl.NumberFormat("pt-BR").format(Math.round(number))} km`;
  };

  const resolveDeviceId = (vehicle) =>
    vehicle?.deviceId ||
    vehicle?.device?.traccarId ||
    vehicle?.device?.id ||
    vehicle?.device?.deviceId ||
    vehicle?.device?.uniqueId ||
    vehicle?.device_id ||
    null;

  const availableDevices = useMemo(() => {
    const currentDeviceId = form.deviceId;
    const targetClientId = hasAdminAccess ? form.clientId || tenantId || "" : resolvedClientId;
    if (hasAdminAccess && !targetClientId) {
      return [];
    }
    return devices.filter((device) => {
      if (hasAdminAccess && targetClientId && String(device.clientId) !== String(targetClientId)) {
        return false;
      }
      if (!device.vehicleId) return true;
      if (!currentDeviceId) return false;
      return device.vehicleId === currentDeviceId || device.internalId === currentDeviceId;
    });
  }, [devices, form.clientId, form.deviceId, hasAdminAccess, resolvedClientId, tenantId]);

  const attributeCounts = useMemo(() => {
    const counts = new Map();
    vehicles.forEach((vehicle) => {
      getVehicleAttributeList(vehicle).forEach((attribute) => {
        const key = String(attribute.id || attribute.name);
        if (!key) return;
        counts.set(key, (counts.get(key) || 0) + 1);
      });
    });
    return counts;
  }, [getVehicleAttributeList, vehicles]);

  const filteredAttributeOptions = useMemo(() => {
    const term = attributeListQuery.trim().toLowerCase();
    if (!term) return vehicleAttributes;
    return vehicleAttributes.filter((attribute) =>
      String(attribute.name || "").toLowerCase().includes(term),
    );
  }, [attributeListQuery, vehicleAttributes]);

  const handleCreateAttribute = async (event) => {
    event.preventDefault();
    if (!attributeForm.name.trim()) {
      alert("Informe o nome do atributo.");
      return;
    }
    if (!resolvedClientId && !form.clientId) {
      alert("Selecione o cliente antes de criar o atributo.");
      return;
    }
    const clientId = resolvedClientId || form.clientId || "";
    try {
      const response = await CoreApi.createVehicleAttribute({
        clientId,
        name: attributeForm.name.trim(),
        color: attributeForm.color || "#38bdf8",
      });
      const updatedList = response?.items || [];
      setVehicleAttributes(updatedList);
      setAttributeForm({ name: "", color: "#38bdf8" });
      setAttributeDrawerTab("list");
    } catch (requestError) {
      alert(requestError?.message || "Falha ao criar atributo.");
    }
  };

  function openDrawer() {
    const nextClientId = hasAdminAccess ? tenantId || "" : resolvedClientId || "";
    setForm({
      name: "",
      plate: "",
      driver: "",
      group: "",
      type: "",
      status: "ativo",
      notes: "",
      deviceId: "",
      clientId: nextClientId,
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
    setCreateDrawerOpen(true);
  }

  async function handleUnlink(vehicle) {
    const deviceId = resolveDeviceId(vehicle);
    if (!deviceId || !vehicle?.id) {
      alert("Nenhum equipamento vinculado a este veículo.");
      return;
    }
    try {
      await CoreApi.unlinkDeviceFromVehicle(vehicle.id, deviceId, {});
      await load();
    } catch (requestError) {
      alert(requestError?.message || "Falha ao desassociar equipamento.");
    }
  }

  async function handleDelete(vehicle) {
    if (!vehicle?.id) return;
    if (!isAdminGeneral) return;
    await confirmDelete({
      title: "Excluir veículo",
      message: `Tem certeza que deseja excluir o veículo ${vehicle.plate || vehicle.name || ""}? Essa ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      onConfirm: async () => {
        try {
          await CoreApi.deleteVehicle(vehicle.id);
          await load();
          showToast("Excluído com sucesso.");
        } catch (requestError) {
          showToast("Falha ao excluir.", "error");
          throw requestError;
        }
      },
    });
  }

  function handleViewDevice(vehicle, latestPosition) {
    if (latestPosition) {
      setMapTarget({ vehicle, position: latestPosition });
      return;
    }
    const deviceId = resolveDeviceId(vehicle);
    if (!deviceId) {
      alert("Nenhum equipamento vinculado para visualizar.");
      return;
    }
    navigate(`/equipamentos?deviceId=${encodeURIComponent(deviceId)}`);
  }

  const renderAssociation = (vehicle, statusLive) => {
    if (!vehicle.device) {
      return (
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
          <Unlink className="h-4 w-4" />
          Sem equipamento
        </div>
      );
    }
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white">
        <Link2 className="h-4 w-4" />
        <div className="text-left">
          <div className="font-semibold leading-tight">{vehicle.device.name || vehicle.device.uniqueId}</div>
          <div className="text-[11px] text-white/60">{statusLive}</div>
        </div>
      </div>
    );
  };

  async function handleSave(event) {
    event.preventDefault();
    if (!form.plate.trim()) {
      alert("Informe a placa do veículo");
      return;
    }
    if (!form.model.trim()) {
      alert("Informe o modelo do veículo");
      return;
    }
    if (!form.type.trim()) {
      alert("Informe o tipo do veículo");
      return;
    }
    const clientId = hasAdminAccess ? form.clientId || tenantId || "" : tenantId || user?.clientId;
    if (!clientId) {
      alert("Selecione o cliente para salvar o veículo");
      return;
    }
    setSaving(true);
    try {
      await CoreApi.createVehicle({
        name: form.model?.trim() || form.name?.trim() || undefined,
        plate: form.plate.trim(),
        driver: form.driver?.trim() || undefined,
        group: form.group?.trim() || undefined,
        type: form.type?.trim() || undefined,
        status: form.status || undefined,
        notes: form.notes?.trim() || undefined,
        deviceId: form.deviceId || undefined,
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
        clientId,
      });
      setCreateDrawerOpen(false);
      await load();
    } catch (requestError) {
      alert(requestError?.message || "Falha ao salvar veículo");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-180px)] flex-col gap-6">
      <PageHeader
        title="Veículos"
        subtitle="Frota e dados principais."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={load}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="h-4 w-4" /> Atualizar
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAttributeDrawerTab("list");
                setAttributeDrawerOpen(true);
              }}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
            >
              <span className="inline-flex items-center gap-2">
                <Tags className="h-4 w-4" /> Atributos
              </span>
            </button>
            <button
              type="button"
              onClick={openDrawer}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
            >
              <span className="inline-flex items-center gap-2">
                <Plus className="h-4 w-4" /> Novo veículo
              </span>
            </button>
          </div>
        }
      />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error.message}</div>
      )}

      <div className="space-y-3">
        <FilterBar
          left={
            <>
              <div className="relative min-w-[220px] flex-1">
                <Tags className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                <input
                  placeholder="Buscar por atributos"
                  value={attributeQuery}
                  onChange={(event) => setAttributeQuery(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
              </div>
              <div className="relative min-w-[240px] flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                <input
                  placeholder="Buscar por placa, veículo, motorista, equipamento"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
              </div>
              {attributeFilterId && (
                <button
                  type="button"
                  onClick={() => setAttributeFilterId("")}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 transition hover:border-white/30"
                >
                  Limpar filtro de atributo
                </button>
              )}
            </>
          }
          right={
            <button
              type="button"
              onClick={() => setShowColumnPicker((prev) => !prev)}
              className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
            >
              Exibir colunas
            </button>
          }
        />

        {showColumnPicker && (
          <div className="flex flex-wrap gap-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/80">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={visibleColumns.driver}
                onChange={() => setVisibleColumns((current) => ({ ...current, driver: !current.driver }))}
                className="h-4 w-4 rounded border-white/30 bg-transparent"
              />
              Motorista
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={visibleColumns.group}
                onChange={() => setVisibleColumns((current) => ({ ...current, group: !current.group }))}
                className="h-4 w-4 rounded border-white/30 bg-transparent"
              />
              Grupo
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={visibleColumns.odometer}
                onChange={() => setVisibleColumns((current) => ({ ...current, odometer: !current.odometer }))}
                className="h-4 w-4 rounded border-white/30 bg-transparent"
              />
              Odômetro
            </label>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        <DataTable tableClassName="text-white/80">
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
            <tr>
              <th className="px-4 py-3 text-left">Tipo</th>
              <th className="px-4 py-3 text-left">Marca</th>
              <th className="px-4 py-3 text-left">Modelo</th>
              <th className="px-4 py-3 text-left">Placa</th>
              <th className="px-4 py-3 text-left">Responsável/Cliente</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Atributos</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {loading && (
              <tr>
                <td colSpan={tableColCount} className="px-4 py-6">
                  <SkeletonTable rows={6} columns={tableColCount} />
                </td>
              </tr>
            )}
            {!loading && filteredVehicles.length === 0 && (
              <tr>
                <td colSpan={tableColCount} className="px-4 py-6">
                  <EmptyState
                    title="Nenhum veículo cadastrado."
                    subtitle="Cadastre um novo veículo para iniciar o acompanhamento."
                    action={
                  <button
                    type="button"
                    onClick={openDrawer}
                    className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
                  >
                    Novo veículo
                  </button>
                    }
                  />
                </td>
              </tr>
            )}
            {!loading &&
              filteredVehicles.map((vehicle) => {
                const latestPosition = getDevicePosition(vehicle);
                const statusLive = getDeviceStatus(vehicle, latestPosition);
                const normalizedType = resolveVehicleIconType(vehicle.type) || vehicle.type;
                const responsibleLabel =
                  vehicle.clientName || vehicle.client?.name || vehicle.driver || vehicle.group || "—";
                const attributeBadges = getVehicleAttributeList(vehicle).map((attribute) => (
                  <span
                    key={attribute.id || attribute.name}
                    className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-white/80"
                    style={{
                      backgroundColor: attribute.color ? `${attribute.color}22` : "rgba(255,255,255,0.08)",
                      borderColor: attribute.color || "rgba(255,255,255,0.2)",
                    }}
                  >
                    {attribute.name}
                  </span>
                ));
                return (
                  <VehicleRow
                    key={vehicle.id}
                    vehicle={vehicle}
                    typeIcon={<VehicleTypeIcon type={normalizedType} />}
                    brandBadge={<BrandBadge brand={vehicle.brand} />}
                    modelLabel={vehicle.model || vehicle.name || "—"}
                    plateLabel={vehicle.plate || "—"}
                    responsibleLabel={responsibleLabel}
                    statusLabel={vehicle.status || statusLive?.label || "—"}
                    attributeBadges={attributeBadges}
                    onEdit={() => navigate(`/vehicles/${vehicle.id}`)}
                    onDelete={() => handleDelete(vehicle)}
                    canDelete={isAdminGeneral}
                  />
                );
              })}
          </tbody>
        </DataTable>
      </div>

      <Drawer
        open={createDrawerOpen}
        onClose={() => setCreateDrawerOpen(false)}
        title="Novo veículo"
        description="Cadastre os dados principais do veículo."
      >
        <form onSubmit={handleSave} className="space-y-4">
          <VehicleForm
            value={form}
            onChange={setForm}
            tenants={tenants}
            showClient={hasAdminAccess}
            requireClient={hasAdminAccess}
            showDeviceSelect
            deviceOptions={availableDevices}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" onClick={() => setCreateDrawerOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </form>
      </Drawer>

      <Drawer
        open={attributeDrawerOpen}
        onClose={() => setAttributeDrawerOpen(false)}
        title="Atributos"
        description="Gerencie atributos usados nos veículos."
      >
        <div className="flex gap-2 overflow-x-auto pb-2 text-[11px] uppercase tracking-[0.1em] text-white/60">
          {[
            { key: "list", label: "Atributos" },
            { key: "create", label: "Criar" },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setAttributeDrawerTab(tab.key)}
              className={`rounded-full border px-4 py-2 transition ${
                attributeDrawerTab === tab.key
                  ? "border-sky-400 bg-sky-500/20 text-white"
                  : "border-white/10 text-white/60 hover:border-white/30"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {attributeDrawerTab === "list" && (
          <div className="space-y-4">
            <label className="block text-xs text-white/60">
              Buscar atributo
              <input
                value={attributeListQuery}
                onChange={(event) => setAttributeListQuery(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                placeholder="Digite o nome do atributo"
              />
            </label>
            <div className="space-y-2">
              {filteredAttributeOptions.length === 0 && (
                <EmptyState title="Nenhum atributo cadastrado." subtitle="Crie um atributo para usar nos veículos." />
              )}
              {filteredAttributeOptions.map((attribute) => {
                const count = attributeCounts.get(String(attribute.id || attribute.name)) || 0;
                return (
                  <button
                    key={attribute.id || attribute.name}
                    type="button"
                    onClick={() => {
                      setAttributeFilterId(String(attribute.id || attribute.name));
                      setAttributeDrawerOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-white/80 transition hover:border-white/30"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: attribute.color || "#38bdf8" }}
                      />
                      {attribute.name}
                    </span>
                    <span className="text-xs text-white/50">{count} veículos</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {attributeDrawerTab === "create" && (
          <form onSubmit={handleCreateAttribute} className="space-y-4">
            <label className="block text-xs text-white/60">
              Nome do atributo
              <input
                value={attributeForm.name}
                onChange={(event) => setAttributeForm((prev) => ({ ...prev, name: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                placeholder="Ex.: Rastreador VIP"
              />
            </label>
            <label className="block text-xs text-white/60">
              Cor do atributo
              <input
                type="color"
                value={attributeForm.color}
                onChange={(event) => setAttributeForm((prev) => ({ ...prev, color: event.target.value }))}
                className="mt-2 h-12 w-24 rounded-lg border border-white/10 bg-black/30"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAttributeDrawerTab("list")}>
                Voltar
              </Button>
              <Button type="submit">
                <FolderPlus className="h-4 w-4" /> Salvar atributo
              </Button>
            </div>
          </form>
        )}
      </Drawer>

      <Modal
        open={Boolean(mapTarget)}
        onClose={() => setMapTarget(null)}
        title={mapTarget?.vehicle?.name || mapTarget?.vehicle?.plate || "Posição"}
        width="max-w-4xl"
      >
        {mapTarget?.position ? (
          <div className="h-[420px] overflow-hidden rounded-xl">
            <MapContainer
              ref={mapRef}
              center={[
                Number(mapTarget.position.latitude ?? mapTarget.position.lat ?? 0),
                Number(mapTarget.position.longitude ?? mapTarget.position.lon ?? 0),
              ]}
              zoom={15}
              style={{ height: "100%", width: "100%" }}
              whenReady={onMapReady}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="OpenStreetMap" />
              <Marker
                position={[
                  Number(mapTarget.position.latitude ?? mapTarget.position.lat ?? 0),
                  Number(mapTarget.position.longitude ?? mapTarget.position.lon ?? 0),
                ]}
              >
                <Popup>
                  <div className="space-y-1 text-sm">
                    <div className="font-semibold">{mapTarget.vehicle?.name || mapTarget.vehicle?.plate}</div>
                    <div>{getDeviceCoordinates(mapTarget.vehicle, mapTarget.position)}</div>
                    <div>{getDeviceLastSeen(mapTarget.vehicle, mapTarget.position)}</div>
                  </div>
                </Popup>
              </Marker>
            </MapContainer>
          </div>
        ) : (
          <p className="text-sm text-white/70">Sem posição recente para este veículo.</p>
        )}
      </Modal>
      <PageToast toast={toast} />
    </div>
  );
}
