import React, { useEffect, useMemo, useState } from "react";

import PageHeader from "../ui/PageHeader";
import Input from "../ui/Input";
import Button from "../ui/Button";
import Field from "../ui/Field";
import Modal from "../ui/Modal";
import { Search } from "lucide-react";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { useTranslation } from "../lib/i18n.js";
import { getTelemetryColumnByKey } from "../features/telemetry/telemetryColumns.js";

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch (_error) {
    return String(value);
  }
}

export default function Vehicles() {
  const { tenantId, user } = useTenant();
  const { t, locale } = useTranslation();
  const [vehicles, setVehicles] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState("new");
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({
    name: "",
    plate: "",
    driver: "",
    group: "",
    type: "",
    status: "ativo",
    notes: "",
    deviceId: "",
  });

  const resolvedClientId = tenantId || user?.clientId || null;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const clientParams = resolvedClientId ? { clientId: resolvedClientId } : undefined;
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

  const filteredVehicles = useMemo(() => {
    if (!query.trim()) return vehicles;
    const term = query.trim().toLowerCase();
    return vehicles.filter((vehicle) =>
      [vehicle.name, vehicle.plate, vehicle.driver, vehicle.group, vehicle.device?.uniqueId]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [vehicles, query]);

  const telemetryColumns = useMemo(() => {
    const keys = ["plate", "vehicle", "deviceId", "protocol", "status", "serverTime"];
    return keys
      .map((key) => getTelemetryColumnByKey(key))
      .filter(Boolean)
      .map((column) => ({
        ...column,
        label: t(column.labelKey),
        render: (row) => column.getValue(row, { t, locale }),
      }));
  }, [locale, t]);

  const tableColumns = useMemo(
    () => [
      ...telemetryColumns,
      { key: "driver", label: t("monitoring.columns.driver") || "Motorista", render: (row) => row.driver || "—" },
      {
        key: "actions",
        label: t("monitoring.columns.actions"),
        render: (row) => (
          <Button onClick={() => openModal("edit", row.raw)} className="border border-white/10 bg-white/10 hover:bg-white/20">
            {t("common.edit") || "Editar"}
          </Button>
        ),
      },
    ],
    [openModal, t, telemetryColumns],
  );

  const availableDevices = useMemo(() => {
    const currentDeviceId = form.deviceId;
    return devices.filter((device) => {
      if (!device.vehicleId) return true;
      if (!currentDeviceId) return false;
      return device.vehicleId === currentDeviceId || device.internalId === currentDeviceId;
    });
  }, [devices, form.deviceId]);

  function openModal(modeType, vehicle = null) {
    setMode(modeType);
    if (modeType === "edit" && vehicle) {
      setSelected(vehicle);
      setForm({
        name: vehicle.name || "",
        plate: vehicle.plate || "",
        driver: vehicle.driver || "",
        group: vehicle.group || "",
        type: vehicle.type || "",
        status: vehicle.status || "ativo",
        notes: vehicle.notes || "",
        deviceId: vehicle.device?.id || "",
      });
    } else {
      setSelected(null);
      setForm({ name: "", plate: "", driver: "", group: "", type: "", status: "ativo", notes: "", deviceId: "" });
    }
    setOpen(true);
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!form.plate.trim()) {
      alert("Informe a placa do veículo");
      return;
    }
    setSaving(true);
    try {
      if (mode === "edit" && selected) {
        await CoreApi.updateVehicle(selected.id, {
          name: form.name?.trim() || undefined,
          plate: form.plate.trim(),
          driver: form.driver?.trim() || undefined,
          group: form.group?.trim() || undefined,
          type: form.type?.trim() || undefined,
          status: form.status || undefined,
          notes: form.notes?.trim() || undefined,
          deviceId: form.deviceId || null,
          clientId: tenantId || user?.clientId,
        });
      } else {
        await CoreApi.createVehicle({
          name: form.name?.trim() || undefined,
          plate: form.plate.trim(),
          driver: form.driver?.trim() || undefined,
          group: form.group?.trim() || undefined,
          type: form.type?.trim() || undefined,
          status: form.status || undefined,
          notes: form.notes?.trim() || undefined,
          deviceId: form.deviceId || undefined,
          clientId: tenantId || user?.clientId,
        });
      }
      setOpen(false);
      await load();
    } catch (requestError) {
      alert(requestError?.message || "Falha ao salvar veículo");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Veículos" right={<Button onClick={() => openModal("new")}>+ Novo veículo</Button>} />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error.message}</div>
      )}

      <Field label="Busca">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Input
            placeholder="Buscar (placa, veículo, motorista, equipamento)"
            icon={Search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button onClick={load}>Atualizar</Button>
        </div>
      </Field>

      <div className="rounded-2xl border border-white/10 bg-white/5">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-white/80">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
              <tr>
                {tableColumns.map((column) => (
                  <th key={column.key} className="px-4 py-3 text-left">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loading && (
                <tr>
                  <td colSpan={tableColumns.length} className="px-4 py-6 text-center text-white/60">
                    Carregando veículos…
                  </td>
                </tr>
              )}
              {!loading && filteredVehicles.length === 0 && (
                <tr>
                  <td colSpan={tableColumns.length} className="px-4 py-6 text-center text-white/60">
                    Nenhum veículo encontrado.
                  </td>
                </tr>
              )}
              {!loading &&
                filteredVehicles.map((vehicle) => (
                  <tr key={vehicle.id} className="hover:bg-white/5">
                    {tableColumns.map((column) => {
                      const row = {
                        vehicleName: vehicle.name,
                        plate: vehicle.plate,
                        vehicle,
                        device: vehicle.device,
                        deviceId: vehicle.device?.traccarId || vehicle.device?.id || vehicle.device?.uniqueId,
                        traccarId: vehicle.device?.traccarId,
                        position: vehicle.device?.position || null,
                        lastCommunication: vehicle.lastCommunication,
                        connectionStatusLabel: vehicle.connectionStatusLabel,
                        driver: vehicle.driver,
                        raw: vehicle,
                      };
                      return (
                        <td key={column.key} className="px-4 py-3 text-left">
                          {column.render ? column.render(row) : column.getValue?.(row, { t, locale })}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={mode === "edit" ? "Editar veículo" : "Novo veículo"} width="max-w-3xl">
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
    </div>
  );
}
