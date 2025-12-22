import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import PageHeader from "../ui/PageHeader";
import Input from "../ui/Input";
import Button from "../ui/Button";
import Field from "../ui/Field";
import Modal from "../ui/Modal";
import { EllipsisVertical, Link2, Plus, RefreshCw, Search, Trash2, Unlink } from "lucide-react";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";
import { useTraccarDevices } from "../lib/hooks/useTraccarDevices.js";

export default function Vehicles() {
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
  const [menuOpenId, setMenuOpenId] = useState(null);
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
  });

  const resolvedClientId = tenantId || user?.clientId || null;

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
      [vehicle.name, vehicle.plate, vehicle.driver, vehicle.group, vehicle.device?.uniqueId, vehicle.device?.name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [vehicles, query]);

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
      setMenuOpenId(null);
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
      setMenuOpenId(null);
      await CoreApi.deleteVehicle(vehicle.id);
      await load();
    } catch (requestError) {
      alert(requestError?.message || "Falha ao excluir veículo.");
    }
  }

  function handleViewDevice(vehicle, latestPosition) {
    if (latestPosition) {
      setMapTarget({ vehicle, position: latestPosition });
      setMenuOpenId(null);
      return;
    }
    const deviceId = resolveDeviceId(vehicle);
    if (!deviceId) {
      alert("Nenhum equipamento vinculado para visualizar.");
      return;
    }
    setMenuOpenId(null);
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

  const renderActions = (vehicle, latestPosition) => {
    const isOpen = menuOpenId === vehicle.id;
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpenId((current) => (current === vehicle.id ? null : vehicle.id))}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-white hover:border-white/30"
        >
          <EllipsisVertical className="h-5 w-5" />
        </button>
        {isOpen && (
          <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-[#0f141c] text-sm shadow-xl">
            <button
              type="button"
              onClick={() => {
                setMenuOpenId(null);
                navigate(`/vehicles/${vehicle.id}`);
              }}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-white hover:bg-white/5"
            >
              Editar veículo
            </button>
            <button
              type="button"
              onClick={() => handleViewDevice(vehicle, latestPosition)}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-white hover:bg-white/5"
            >
              Ver dispositivo
            </button>
            <button
              type="button"
              onClick={() => handleUnlink(vehicle)}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-white hover:bg-white/5"
            >
              Desassociar dispositivo
            </button>
            <button
              type="button"
              onClick={() => handleDelete(vehicle)}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-red-300 hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" />
              Excluir veículo
            </button>
          </div>
        )}
      </div>
    );
  };

  async function handleSave(event) {
    event.preventDefault();
    if (!form.plate.trim()) {
      alert("Informe a placa do veículo");
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
        name: form.name?.trim() || undefined,
        plate: form.plate.trim(),
        driver: form.driver?.trim() || undefined,
        group: form.group?.trim() || undefined,
        type: form.type?.trim() || undefined,
        status: form.status || undefined,
        notes: form.notes?.trim() || undefined,
        deviceId: form.deviceId || undefined,
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
    <div className="space-y-6">
      <PageHeader
        title="Frota"
        description="Veículos"
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

      <Field label="">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            placeholder="Buscar (placa, veículo, motorista, equipamento)"
            icon={Search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="flex-1"
          />
        </div>
      </Field>

      <div className="rounded-2xl border border-white/10 bg-[#0f141c] shadow-lg">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-white/80">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
              <tr>
                <th className="px-4 py-3 text-left">Associação</th>
                <th className="px-4 py-3 text-left">Nº Cobli/ID</th>
                <th className="px-4 py-3 text-left">Placa</th>
                <th className="px-4 py-3 text-left">Modelo</th>
                <th className="px-4 py-3 text-left">Motorista</th>
                <th className="px-4 py-3 text-left">Grupo</th>
                <th className="px-4 py-3 text-left">Odômetro</th>
                <th className="px-4 py-3 text-left">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-white/60">
                    Carregando veículos…
                  </td>
                </tr>
              )}
              {!loading && filteredVehicles.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-white/60">
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
                    <tr key={vehicle.id} className="hover:bg-white/5">
                      <td className="px-4 py-4">{renderAssociation(vehicle, statusLive)}</td>
                      <td className="px-4 py-4">
                        <div className="space-y-1">
                          <div className="font-semibold text-white">{deviceIdentifier}</div>
                          <div className="text-xs text-white/60">{lastSeen}</div>
                          <div className="text-[11px] text-white/50">{coordinates}</div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-semibold text-white">{vehicle.plate || "—"}</div>
                        <div className="text-xs text-white/60">{vehicle.name || "—"}</div>
                      </td>
                      <td className="px-4 py-4">{vehicle.model?.name || "—"}</td>
                      <td className="px-4 py-4">{vehicle.driver || "—"}</td>
                      <td className="px-4 py-4">{vehicle.group || "—"}</td>
                      <td className="px-4 py-4">{formatOdometer(vehicle.odometer)}</td>
                      <td className="px-4 py-4 text-right">{renderActions(vehicle, latestPosition)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Novo veículo" width="max-w-3xl">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              placeholder="Nome do veículo"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
            <Input
              placeholder="Placa *"
              value={form.plate}
              onChange={(event) => setForm((current) => ({ ...current, plate: event.target.value }))}
              required
            />
            <Input
              placeholder="Motorista"
              value={form.driver}
              onChange={(event) => setForm((current) => ({ ...current, driver: event.target.value }))}
            />
            <Input
              placeholder="Grupo"
              value={form.group}
              onChange={(event) => setForm((current) => ({ ...current, group: event.target.value }))}
            />
            <Input
              placeholder="Tipo"
              value={form.type}
              onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}
            />
            {hasAdminAccess && (
              <div className="md:col-span-2">
                <label className="text-xs uppercase tracking-[0.12em] text-white/60">Cliente</label>
                <select
                  value={form.clientId}
                  onChange={(event) => setForm((current) => ({ ...current, clientId: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  required
                >
                  <option value="">Selecione o cliente</option>
                  {tenants.map((tenant) => (
                    <option key={tenant.id || "all"} value={tenant.id || ""}>
                      {tenant.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <select
              value={form.status}
              onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
              className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            >
              <option value="ativo">Ativo</option>
              <option value="inativo">Inativo</option>
              <option value="manutencao">Manutenção</option>
            </select>
            <select
              value={form.deviceId}
              onChange={(event) => setForm((current) => ({ ...current, deviceId: event.target.value }))}
              className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none md:col-span-2"
            >
              <option value="">Equipamento (opcional)</option>
              {availableDevices.map((device) => (
                <option key={device.internalId || device.id || device.uniqueId} value={device.internalId || device.id}>
                  {device.name || device.uniqueId || device.internalId}
                </option>
              ))}
            </select>
            <textarea
              placeholder="Observações"
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              className="w-full rounded-xl border border-stroke bg-card/60 px-3 py-2 md:col-span-2"
              rows={3}
            />
          </div>
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
              center={[
                Number(mapTarget.position.latitude ?? mapTarget.position.lat ?? 0),
                Number(mapTarget.position.longitude ?? mapTarget.position.lon ?? 0),
              ]}
              zoom={15}
              style={{ height: "100%", width: "100%" }}
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
