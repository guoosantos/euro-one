import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useTranslation } from "../lib/i18n.js";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import useDevices from "../lib/hooks/useDevices.js";
import useDrivers from "../lib/hooks/useDrivers.js";

export default function TaskForm() {
  const navigate = useNavigate();
  const { tenantId, user } = useTenant();
  const { t } = useTranslation();
  const { devices } = useDevices({ tenantId });
  const { drivers } = useDrivers({ params: { clientId: tenantId } });
  const [form, setForm] = useState({ type: "entrega", status: "pendente", geofenceRadius: 150 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await CoreApi.createTask({ ...form, clientId: tenantId || user?.clientId });
      navigate("/tasks");
    } catch (err) {
      setError(err?.response?.data?.message || "Erro ao salvar task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-lg font-semibold text-white">{t("tasks.newTitle")}</div>
      <form onSubmit={handleSubmit} className="space-y-3 card p-4">
        {error && <div className="rounded-md bg-red-500/20 p-2 text-sm text-red-100">{error}</div>}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm text-white/70">
            {t("tasks.address")}
            <input
              className="input mt-1"
              name="address"
              placeholder={t("tasks.addressPlaceholder")}
              value={form.address || ""}
              onChange={handleChange}
            />
          </label>
          <label className="text-sm text-white/70">
            {t("tasks.vehicle")}
            <select className="input mt-1" name="vehicleId" value={form.vehicleId || ""} onChange={handleChange}>
              <option value="">{t("tasks.selectVehicle")}</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name || device.uniqueId || device.id}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-white/70">
            {t("tasks.type")}
            <select className="input mt-1" name="type" value={form.type} onChange={handleChange}>
              <option value="entrega">{t("tasks.delivery")}</option>
              <option value="coleta">{t("tasks.pickup")}</option>
            </select>
          </label>
          <label className="text-sm text-white/70">
            {t("tasks.status")}
            <select className="input mt-1" name="status" value={form.status} onChange={handleChange}>
              <option value="pendente">{t("tasks.statusPending")}</option>
              <option value="em rota">{t("tasks.statusOnRoute")}</option>
              <option value="em atendimento">{t("tasks.statusInService")}</option>
              <option value="finalizada">{t("tasks.statusDone")}</option>
              <option value="atrasada">{t("tasks.statusLate")}</option>
              <option value="improdutiva">{t("tasks.statusIdle")}</option>
              <option value="cancelada">{t("tasks.statusCancelled")}</option>
            </select>
          </label>
          <label className="text-sm text-white/70">
            {t("tasks.driver")}
            <select className="input mt-1" name="driverId" value={form.driverId || ""} onChange={handleChange}>
              <option value="">{t("tasks.selectDriver")}</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name || driver.email || driver.id}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-white/70">
            {t("tasks.expectedStart")}
            <input
              className="input mt-1"
              type="datetime-local"
              name="startTimeExpected"
              value={form.startTimeExpected || ""}
              onChange={handleChange}
            />
          </label>
          <label className="text-sm text-white/70">
            {t("tasks.expectedEnd")}
            <input
              className="input mt-1"
              type="datetime-local"
              name="endTimeExpected"
              value={form.endTimeExpected || ""}
              onChange={handleChange}
            />
          </label>
          <label className="text-sm text-white/70">
            {t("tasks.latitude")}
            <input
              className="input mt-1"
              name="latitude"
              placeholder="-23.5"
              value={form.latitude || ""}
              onChange={handleChange}
            />
          </label>
          <label className="text-sm text-white/70">
            {t("tasks.longitude")}
            <input
              className="input mt-1"
              name="longitude"
              placeholder="-46.6"
              value={form.longitude || ""}
              onChange={handleChange}
            />
          </label>
          <label className="text-sm text-white/70">
            {t("tasks.geofenceRadius")}
            <input
              className="input mt-1"
              name="geofenceRadius"
              type="number"
              min={20}
              value={form.geofenceRadius || ""}
              onChange={handleChange}
            />
          </label>
          <label className="text-sm text-white/70 md:col-span-2">
            {t("tasks.attachments")}
            <textarea
              className="input mt-1"
              name="attachments"
              placeholder={t("tasks.attachmentsHint")}
              value={Array.isArray(form.attachments) ? form.attachments.join("\n") : form.attachments || ""}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, attachments: event.target.value.split("\n").filter(Boolean) }))
              }
            />
          </label>
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </form>
    </div>
  );
}
