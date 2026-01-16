import React, { useEffect, useMemo, useState } from "react";
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
  linkedDevices,
  autoPrimaryDeviceId,
  linkingDeviceId = "",
  setLinkingDeviceId = () => {},
  availableDevices,
  onLinkDevice,
  onUnlinkDevice,
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
  });
  const [chipDeviceId, setChipDeviceId] = useState("");
  const [chipId, setChipId] = useState("");
  const [autoPrimary, setAutoPrimary] = useState(true);

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
    });
    setChipDeviceId(vehicle.device?.id || "");
    setChipId(chips.find((chip) => chip.deviceId === vehicle.device?.id)?.id || "");
    setAutoPrimary(!vehicle.device?.id);
  }, [chips, tenantId, user?.clientId, vehicle]);

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
    });
  };

  const handleChipBinding = async (event) => {
    event.preventDefault();
    if (!chipId || !chipDeviceId) {
      onError(new Error("Selecione chip e equipamento para vincular"));
      return;
    }
    await onBindChip({ chipId, deviceId: chipDeviceId, clientId: form.clientId || vehicle.clientId });
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
        <div className="md:col-span-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs uppercase tracking-[0.12em] text-white/60">Equipamento principal</label>
            <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.1em] text-white/60">
              <input
                type="checkbox"
                checked={autoPrimary}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setAutoPrimary(enabled);
                  if (enabled) {
                    setForm((prev) => ({ ...prev, deviceId: "" }));
                  }
                }}
              />
              <span>Automático (último sinal)</span>
            </label>
          </div>
          {!autoPrimary && (
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
          )}
          {autoPrimary && (
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
              {autoPrimaryDeviceId
                ? `Selecionado automaticamente: ${autoPrimaryDeviceId} (mais recente)`
                : "Nenhum equipamento com posição recente"}
            </div>
          )}
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

      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-[0.12em] text-white/60">Equipamentos vinculados</p>
          <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] text-white/70">{linkedDevices.length} itens</span>
        </div>
        <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center">
          <select
            value={linkingDeviceId}
            onChange={(event) => setLinkingDeviceId(event.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none md:max-w-xs"
          >
            <option value="">Adicionar equipamento</option>
            {availableDevices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name || device.uniqueId || device.id}
              </option>
            ))}
          </select>
          <Button type="button" disabled={!linkingDeviceId || saving} onClick={onLinkDevice}>
            Adicionar equipamento
          </Button>
        </div>
        <div className="mt-2 space-y-2">
          {linkedDevices.length === 0 && <p className="text-xs text-white/60">Nenhum equipamento vinculado.</p>}
          {linkedDevices.map((device) => (
            <div
              key={device.id}
              className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
            >
              <div className="flex items-center justify-between gap-2 text-sm font-semibold">
                <span>{device.name || device.uniqueId || device.id}</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-white/70">
                  {device.id === form.deviceId
                    ? "Principal (manual)"
                    : device.id === autoPrimaryDeviceId && autoPrimary
                      ? "Principal (auto)"
                      : "Secundário"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-white/70">
                <span className="rounded bg-white/5 px-2 py-0.5 text-[11px]">{device.lastSeen || "Sem comunicação"}</span>
                {device.coordinates && (
                  <span className="text-[11px] text-white/60">{device.coordinates}</span>
                )}
                <Button size="xs" variant="ghost" onClick={() => onUnlinkDevice(device.id)}>
                  Desvincular
                </Button>
                <button
                  type="button"
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/10 px-2 py-1 text-[11px] uppercase tracking-[0.1em] text-white/80 transition hover:border-primary/50 hover:text-white"
                  onClick={() => {
                    setAutoPrimary(false);
                    setForm((prev) => ({ ...prev, deviceId: device.id }));
                  }}
                >
                  Definir como principal
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
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
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [linkingDeviceId, setLinkingDeviceId] = useState("");
  const [activeTab, setActiveTab] = useState("resumo");

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

  const autoPrimaryDeviceId = linkedDevices[0]?.id || null;
  const availableDevices = useMemo(
    () =>
      devices.filter((device) => {
        const sameVehicle = !device.vehicleId || String(device.vehicleId) === String(vehicle?.id);
        const sameClient = !vehicle?.clientId || String(device.clientId) === String(vehicle.clientId);
        return sameVehicle && sameClient;
      }),
    [devices, vehicle?.clientId, vehicle?.id],
  );

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
      reportError(requestError, "Falha ao carregar veículo");
    } finally {
      setLoading(false);
    }
  };

  const handleLinkDevice = async () => {
    if (!vehicle || !linkingDeviceId) return;
    const device =
      devices.find((item) => String(item.id) === String(linkingDeviceId)) ||
      availableDevices.find((item) => String(item.id) === String(linkingDeviceId));
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
      await CoreApi.linkDeviceToVehicle(vehicle.id, linkingDeviceId, { clientId: targetClientId });
      setLinkingDeviceId("");
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

  const tabs = useMemo(() => {
    const baseTabs = [
      { id: "resumo", label: "Resumo" },
      { id: "equipamentos", label: "Equipamentos" },
      { id: "os", label: "Ordens de Serviço" },
    ];
    if (isAdmin) {
      baseTabs.push({ id: "admin", label: "Admin / Editar" });
    }
    return baseTabs;
  }, [isAdmin]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Veículo ${vehicle?.plate || "—"}`}
        subtitle="Resumo, equipamentos e histórico de OS."
        actions={
          <>
            <button
              type="button"
              onClick={() => setActiveTab("equipamentos")}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
            >
              Vincular equipamento
            </button>
            <Link
              to="/services/new"
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
            >
              Nova OS
            </Link>
          </>
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
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <DataCard>
              <div className="text-xs uppercase tracking-[0.1em] text-white/60">Status do veículo</div>
              <div className="mt-2 text-lg font-semibold text-white">{detailedVehicle?.statusLabel || "—"}</div>
            </DataCard>
            <DataCard>
              <div className="text-xs uppercase tracking-[0.1em] text-white/60">Última posição</div>
              <div className="mt-2 text-sm text-white/80">{detailedVehicle?.address || "—"}</div>
            </DataCard>
            <DataCard>
              <div className="text-xs uppercase tracking-[0.1em] text-white/60">Equipamentos vinculados</div>
              <div className="mt-2 text-lg font-semibold text-white">{linkedDevices.length}</div>
            </DataCard>
            <DataCard>
              <div className="text-xs uppercase tracking-[0.1em] text-white/60">OS no histórico</div>
              <div className="mt-2 text-lg font-semibold text-white">
                {Array.isArray(vehicle.serviceOrders) ? vehicle.serviceOrders.length : 0}
              </div>
            </DataCard>
          </div>

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
                  <div className="text-white">{vehicle.type || "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.1em] text-white/50">Motorista</div>
                  <div className="text-white">{vehicle.driver || "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.1em] text-white/50">Grupo</div>
                  <div className="text-white">{vehicle.group || "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.1em] text-white/50">Odômetro</div>
                  <div className="text-white">{vehicle.odometer ? `${vehicle.odometer} km` : "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.1em] text-white/50">Última posição</div>
                  <div className="text-white">{detailedVehicle?.coordinatesLabel || "—"}</div>
                </div>
              </div>
            </DataCard>
          )}

          {activeTab === "equipamentos" && (
            <DataCard className="overflow-hidden p-0">
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
                          {device.status || "HABILITADO"}
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
                devices={devices}
                chips={chips}
                clients={clients}
                tenantId={tenantId}
                user={user}
                onSaveVehicle={handleSaveVehicle}
                saving={saving}
                onBindChip={handleBindChip}
                linkedDevices={linkedDevices}
                autoPrimaryDeviceId={autoPrimaryDeviceId}
                linkingDeviceId={linkingDeviceId}
                setLinkingDeviceId={setLinkingDeviceId}
                availableDevices={availableDevices}
                onLinkDevice={handleLinkDevice}
                onUnlinkDevice={handleUnlinkDevice}
                onError={reportError}
              />
            </DataCard>
          )}
        </>
      )}
    </div>
  );
}
