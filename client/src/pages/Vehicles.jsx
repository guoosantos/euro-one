import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import PageHeader from "../ui/PageHeader";
import Input from "../ui/Input";
import Button from "../ui/Button";
import Field from "../ui/Field";
import Modal from "../ui/Modal";
import DropdownMenu from "../ui/DropdownMenu";
import { EllipsisVertical, Link2, Plus, RefreshCw, Search, Trash2, Unlink } from "lucide-react";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";
import { useTraccarDevices } from "../lib/hooks/useTraccarDevices.js";
import { resolveVehicleIconType, VEHICLE_TYPE_OPTIONS } from "../lib/icons/vehicleIcons.js";
import { computeAutoVisibility, loadColumnVisibility, saveColumnVisibility } from "../lib/column-visibility.js";
import VehicleForm from "../components/vehicles/VehicleForm.jsx";
import useMapLifecycle from "../lib/map/useMapLifecycle.js";

function VehicleRow({
  vehicle,
  association,
  deviceIdentifier,
  lastSeen,
  coordinates,
  typeLabel,
  showDriver,
  showGroup,
  showOdometer,
  odometerLabel,
  onEdit,
  onViewDevice,
  onUnlink,
  onDelete,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef(null);

  return (
    <tr className="hover:bg-white/5">
      <td className="px-4 py-4">{association}</td>
      <td className="px-4 py-4">
        <div className="space-y-1">
          <div className="font-semibold text-white">{deviceIdentifier}</div>
          <div className="text-xs text-white/60">{lastSeen}</div>
          <div className="text-[11px] text-white/50">{coordinates}</div>
        </div>
      </td>
      <td className="px-4 py-4">
      <div className="font-semibold text-white">{vehicle.plate || "—"}</div>
      <div className="text-xs text-white/60">{vehicle.model || vehicle.name || "—"}</div>
      </td>
      <td className="px-4 py-4">{typeLabel}</td>
      {showDriver && <td className="px-4 py-4">{vehicle.driver || "—"}</td>}
      {showGroup && <td className="px-4 py-4">{vehicle.group || "—"}</td>}
      {showOdometer && <td className="px-4 py-4">{odometerLabel}</td>}
      <td className="px-4 py-4 text-right">
        <button
          type="button"
          ref={menuButtonRef}
          onClick={() => setMenuOpen((prev) => !prev)}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-white hover:border-white/30"
          aria-label="Ações"
        >
          <EllipsisVertical className="h-5 w-5" />
        </button>
        <DropdownMenu open={menuOpen} anchorRef={menuButtonRef} onClose={() => setMenuOpen(false)}>
          <div className="flex flex-col py-2 text-sm text-white">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onEdit?.();
              }}
              className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-white/5"
            >
              Editar veículo
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onViewDevice?.();
              }}
              className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-white/5"
            >
              Ver dispositivo
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onUnlink?.();
              }}
              className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-white/5"
            >
              Desassociar dispositivo
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onDelete?.();
              }}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-red-300 hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" />
              Excluir veículo
            </button>
          </div>
        </DropdownMenu>
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
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mapTarget, setMapTarget] = useState(null);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
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
      setError(requestError instanceof Error ? requestError : new Error("Falha ao carregar veículos"));
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
    setQuery("");
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

  const filteredVehicles = useMemo(() => {
    if (!query.trim()) return vehicles;
    const term = query.trim().toLowerCase();
    return vehicles.filter((vehicle) =>
      [
        vehicle.model,
        vehicle.name,
        vehicle.plate,
        vehicle.driver,
        vehicle.group,
        vehicle.device?.uniqueId,
        vehicle.device?.name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [vehicles, query]);

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

  const tableColCount =
    5 + (visibleColumns.driver ? 1 : 0) + (visibleColumns.group ? 1 : 0) + (visibleColumns.odometer ? 1 : 0);

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

  function openModal() {
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
    });
    setOpen(true);
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
    const confirmed = window.confirm("Deseja realmente excluir este veículo?");
    if (!confirmed) return;
    try {
      await CoreApi.deleteVehicle(vehicle.id);
      await load();
    } catch (requestError) {
      alert(requestError?.message || "Falha ao excluir veículo.");
    }
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
        clientId,
      });
      setOpen(false);
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
        description="Gestão de veículos e vínculos com equipamentos"
        right={(
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="inline-flex items-center gap-2 px-4 py-2"
              onClick={load}
            >
              <RefreshCw className="h-4 w-4" /> Atualizar
            </Button>
            <Button className="inline-flex items-center gap-2 px-4 py-2" onClick={openModal}>
              <Plus className="h-4 w-4" /> Novo veículo
            </Button>
          </div>
        )}
      />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error.message}</div>
      )}

      <Field label="Filtros">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            placeholder="Buscar (placa, veículo, motorista, equipamento)"
            icon={Search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="flex-1"
          />
          <Button variant="ghost" onClick={() => setShowColumnPicker((prev) => !prev)}>
            Exibir colunas
          </Button>
        </div>
      </Field>

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

      <div className="flex-1 rounded-2xl border border-white/10 bg-[#0f141c] shadow-lg">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-white/80">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
              <tr>
                <th className="px-4 py-3 text-left">Associação</th>
                <th className="px-4 py-3 text-left">N° EURO ONE / ID</th>
                <th className="px-4 py-3 text-left">Placa</th>
                <th className="px-4 py-3 text-left">Tipo</th>
                {visibleColumns.driver && <th className="px-4 py-3 text-left">Motorista</th>}
                {visibleColumns.group && <th className="px-4 py-3 text-left">Grupo</th>}
                {visibleColumns.odometer && <th className="px-4 py-3 text-left">Odômetro</th>}
                <th className="px-4 py-3 text-left">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loading && (
                <tr>
                  <td colSpan={tableColCount} className="px-4 py-6 text-center text-white/60">
                    Carregando veículos…
                  </td>
                </tr>
              )}
              {!loading && filteredVehicles.length === 0 && (
                <tr>
                  <td colSpan={tableColCount} className="px-4 py-6 text-center text-white/60">
                    Nenhum veículo encontrado.
                  </td>
                </tr>
              )}
              {!loading &&
                filteredVehicles.map((vehicle) => {
                  const latestPosition = getDevicePosition(vehicle);
                  const statusLive = getDeviceStatus(vehicle, latestPosition);
                  const lastSeen = getDeviceLastSeen(vehicle, latestPosition);
                  const coordinates = getDeviceCoordinates(vehicle, latestPosition);
                  const deviceIdentifier =
                    vehicle.device?.uniqueId || vehicle.device?.identifier || vehicle.device?.id || "—";
                  return (
                    <VehicleRow
                      key={vehicle.id}
                      vehicle={vehicle}
                      association={renderAssociation(vehicle, statusLive)}
                      deviceIdentifier={deviceIdentifier}
                      lastSeen={lastSeen}
                      coordinates={coordinates}
                      typeLabel={formatVehicleType(vehicle.type)}
                      showDriver={visibleColumns.driver}
                      showGroup={visibleColumns.group}
                      showOdometer={visibleColumns.odometer}
                      odometerLabel={formatOdometer(vehicle.odometer)}
                      onEdit={() => navigate(`/vehicles/${vehicle.id}`)}
                      onViewDevice={() => handleViewDevice(vehicle, latestPosition)}
                      onUnlink={() => handleUnlink(vehicle)}
                      onDelete={() => handleDelete(vehicle)}
                    />
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Novo veículo" width="max-w-3xl">
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
            <Button type="button" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </form>
      </Modal>

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
    </div>
  );
}
