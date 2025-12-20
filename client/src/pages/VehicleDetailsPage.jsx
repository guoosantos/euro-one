import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import VehicleDetailsDrawer from "../components/monitoring/VehicleDetailsDrawer.jsx";
import Button from "../ui/Button";
import Input from "../ui/Input";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { useTranslation } from "../lib/i18n.js";
import { useTraccarDevices } from "../lib/hooks/useTraccarDevices.js";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";

function AdminBindingsTab({
  vehicle,
  devices,
  chips,
  clients,
  tenantId,
  user,
  onSaveVehicle,
  saving,
  onBindChip,
}) {
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
  });
  const [chipDeviceId, setChipDeviceId] = useState("");
  const [chipId, setChipId] = useState("");

  useEffect(() => {
    if (!vehicle) return;
    setForm({
      name: vehicle.name || "",
      plate: vehicle.plate || "",
      driver: vehicle.driver || "",
      group: vehicle.group || "",
      type: vehicle.type || "",
      status: vehicle.status || "ativo",
      notes: vehicle.notes || "",
      deviceId: vehicle.device?.id || "",
      clientId: vehicle.clientId || tenantId || user?.clientId || "",
    });
    setChipDeviceId(vehicle.device?.id || "");
    setChipId(chips.find((chip) => chip.deviceId === vehicle.device?.id)?.id || "");
  }, [chips, tenantId, user?.clientId, vehicle]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.plate.trim()) {
      alert("Informe a placa do veículo");
      return;
    }
    await onSaveVehicle({
      name: form.name?.trim() || undefined,
      plate: form.plate.trim(),
      driver: form.driver?.trim() || undefined,
      group: form.group?.trim() || undefined,
      type: form.type?.trim() || undefined,
      status: form.status || undefined,
      notes: form.notes?.trim() || undefined,
      deviceId: form.deviceId || null,
      clientId: form.clientId || vehicle.clientId,
    });
  };

  const handleChipBinding = async (event) => {
    event.preventDefault();
    if (!chipId || !chipDeviceId) {
      alert("Selecione chip e equipamento para vincular");
      return;
    }
    await onBindChip({ chipId, deviceId: chipDeviceId, clientId: form.clientId || vehicle.clientId });
  };

  return (
    <div className="space-y-4 text-white">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Input label="Nome" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
          <Input
            label="Placa"
            required
            value={form.plate}
            onChange={(event) => setForm((prev) => ({ ...prev, plate: event.target.value }))}
          />
          <Input label="Motorista" value={form.driver} onChange={(event) => setForm((prev) => ({ ...prev, driver: event.target.value }))} />
          <Input label="Grupo" value={form.group} onChange={(event) => setForm((prev) => ({ ...prev, group: event.target.value }))} />
          <Input label="Tipo" value={form.type} onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value }))} />
          <select
            value={form.status}
            onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
            className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
          >
            <option value="ativo">Ativo</option>
            <option value="inativo">Inativo</option>
            <option value="manutencao">Manutenção</option>
          </select>
          {user?.role === "admin" && (
            <div className="md:col-span-2">
              <label className="text-xs uppercase tracking-[0.12em] text-white/60">Cliente</label>
              <select
                value={form.clientId}
                onChange={(event) => setForm((prev) => ({ ...prev, clientId: event.target.value }))}
                className="mt-1 w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                <option value="">Selecionar cliente</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="md:col-span-2">
            <label className="text-xs uppercase tracking-[0.12em] text-white/60">Equipamento principal</label>
            <select
              value={form.deviceId}
              onChange={(event) => setForm((prev) => ({ ...prev, deviceId: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            >
              <option value="">Sem rastreador</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name || device.uniqueId || device.id}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs uppercase tracking-[0.12em] text-white/60">Observações</label>
            <textarea
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              rows={3}
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? "Salvando…" : "Salvar alterações"}
          </Button>
        </div>
      </form>

      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
        <p className="text-xs uppercase tracking-[0.12em] text-white/60">Vincular chip a equipamento</p>
        <form onSubmit={handleChipBinding} className="mt-2 grid gap-2 md:grid-cols-2">
          <select
            value={chipId}
            onChange={(event) => setChipId(event.target.value)}
            className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
          >
            <option value="">Selecione o chip</option>
            {chips.map((chip) => (
              <option key={chip.id} value={chip.id}>
                {chip.iccid}
              </option>
            ))}
          </select>
          <select
            value={chipDeviceId}
            onChange={(event) => setChipDeviceId(event.target.value)}
            className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
          >
            <option value="">Equipamento</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name || device.uniqueId || device.id}
              </option>
            ))}
          </select>
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" disabled={saving || !chipId || !chipDeviceId}>
              Vincular chip
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function VehicleDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { tenantId, user } = useTenant();
  const { t } = useTranslation();
  const [vehicle, setVehicle] = useState(null);
  const [devices, setDevices] = useState([]);
  const [chips, setChips] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isAdmin = user?.role === "admin";
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

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = resolvedClientId ? { clientId: resolvedClientId } : undefined;
      const [vehicleList, deviceList, chipList, clientList] = await Promise.all([
        CoreApi.listVehicles(params),
        CoreApi.listDevices(params),
        CoreApi.listChips(params),
        isAdmin
          ? safeApi.get(API_ROUTES.clients).then(({ data }) => data?.clients || [])
          : Promise.resolve([]),
      ]);
      setVehicle(vehicleList.find((item) => String(item.id) === String(id)) || null);
      setDevices(Array.isArray(deviceList) ? deviceList : []);
      setChips(Array.isArray(chipList) ? chipList : []);
      setClients(Array.isArray(clientList) ? clientList : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : new Error("Falha ao carregar veículo"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [resolvedClientId, id]);

  const handleSaveVehicle = async (payload) => {
    if (!vehicle) return;
    setSaving(true);
    try {
      await CoreApi.updateVehicle(vehicle.id, payload);
      await loadData();
    } catch (requestError) {
      alert(requestError?.message || "Falha ao salvar veículo");
    } finally {
      setSaving(false);
    }
  };

  const handleBindChip = async ({ chipId, deviceId, clientId }) => {
    try {
      await CoreApi.updateChip(chipId, { deviceId, clientId });
      await loadData();
    } catch (requestError) {
      alert(requestError?.message || "Falha ao vincular chip");
    }
  };

  const adminTabs = isAdmin
    ? [
        {
          id: "admin",
          label: "Admin / Editar",
          render: () => (
            <AdminBindingsTab
              vehicle={vehicle}
              devices={devices}
              chips={chips}
              clients={clients}
              tenantId={tenantId}
              user={user}
              onSaveVehicle={handleSaveVehicle}
              saving={saving}
              onBindChip={handleBindChip}
            />
          ),
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-white/60">{t("monitoring.columns.vehicle")}</p>
          <h1 className="text-2xl font-semibold text-white">{vehicle?.plate || "Veículo"}</h1>
          {vehicle?.name && <p className="text-sm text-white/60">{vehicle.name}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            Voltar
          </Button>
          <Link
            to="/vehicles"
            className="inline-flex items-center rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white hover:border-white/30 hover:bg-white/20"
          >
            Voltar à lista
          </Link>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error.message}</div>}

      {loading && <p className="text-sm text-white/60">Carregando dados do veículo…</p>}

      {!loading && !vehicle && (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">Veículo não encontrado.</div>
      )}

      {detailedVehicle && (
        <VehicleDetailsDrawer vehicle={detailedVehicle} variant="page" extraTabs={adminTabs} />
      )}
    </div>
  );
}
