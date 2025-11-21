import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../lib/i18n.js";
import { useTenant } from "../lib/tenant-context.jsx";
import useDevices from "../lib/hooks/useDevices.js";
import useDrivers from "../lib/hooks/useDrivers.js";
import useTasks from "../lib/hooks/useTasks.js";
import { CoreApi } from "../lib/coreApi.js";
import { formatDate } from "../lib/fleet-utils.js";

export default function Tasks() {
  const { t } = useTranslation();
  const { tenantId } = useTenant();
  const [filters, setFilters] = useState({
    clientId: tenantId,
    status: "",
    vehicleId: "",
    driverId: "",
    from: "",
    to: "",
    type: "",
  });
  const { devices } = useDevices({ tenantId });
  const { drivers } = useDrivers({ params: { clientId: tenantId } });
  const { tasks, loading, error } = useTasks({
    ...filters,
    from: filters.from ? new Date(filters.from).toISOString() : undefined,
    to: filters.to ? new Date(filters.to).toISOString() : undefined,
  });

  const deviceIndex = useMemo(() => Object.fromEntries(devices.map((d) => [String(d.id), d])), [devices]);
  const driverIndex = useMemo(() => Object.fromEntries(drivers.map((d) => [String(d.id), d])), [drivers]);

  const handleFilterChange = (event) => {
    const { name, value } = event.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  };

  const finalizeTask = async (taskId) => {
    try {
      await CoreApi.updateTask(taskId, { status: "finalizada" });
    } catch (requestError) {
      console.error("Failed to finalize task", requestError);
    }
  };

  const renderStatus = (status) => {
    const map = {
      pendente: t("tasks.statusPending"),
      "em rota": t("tasks.statusOnRoute"),
      "em atendimento": t("tasks.statusInService"),
      finalizada: t("tasks.statusDone"),
      atrasada: t("tasks.statusLate"),
      improdutiva: t("tasks.statusIdle"),
      cancelada: t("tasks.statusCancelled"),
    };
    return map[status] || status;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold text-white">{t("tasks.title")}</div>
          <p className="text-sm text-white/60">{t("tasks.subtitle")}</p>
        </div>
        <Link className="btn btn-primary" to="/tasks/new">
          {t("tasks.new")}
        </Link>
      </div>

      <div className="card space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs text-white/60">
            {t("tasks.status")}
            <select name="status" value={filters.status} onChange={handleFilterChange} className="input mt-1">
              <option value="">{t("all")}</option>
              <option value="pendente">{t("tasks.statusPending")}</option>
              <option value="em rota">{t("tasks.statusOnRoute")}</option>
              <option value="em atendimento">{t("tasks.statusInService")}</option>
              <option value="finalizada">{t("tasks.statusDone")}</option>
              <option value="atrasada">{t("tasks.statusLate")}</option>
              <option value="improdutiva">{t("tasks.statusIdle")}</option>
              <option value="cancelada">{t("tasks.statusCancelled")}</option>
            </select>
          </label>
          <label className="text-xs text-white/60">
            {t("tasks.driver")}
            <select name="driverId" value={filters.driverId} onChange={handleFilterChange} className="input mt-1">
              <option value="">{t("all")}</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name || driver.email || driver.id}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-white/60">
            {t("tasks.vehicle")}
            <select name="vehicleId" value={filters.vehicleId} onChange={handleFilterChange} className="input mt-1">
              <option value="">{t("all")}</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name || device.uniqueId || device.id}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-white/60">
            {t("from")}
            <input type="datetime-local" name="from" value={filters.from} onChange={handleFilterChange} className="input mt-1" />
          </label>
          <label className="text-xs text-white/60">
            {t("to")}
            <input type="datetime-local" name="to" value={filters.to} onChange={handleFilterChange} className="input mt-1" />
          </label>
          <label className="text-xs text-white/60">
            {t("tasks.type")}
            <select name="type" value={filters.type || ""} onChange={handleFilterChange} className="input mt-1">
              <option value="">{t("all")}</option>
              <option value="entrega">{t("tasks.delivery")}</option>
              <option value="coleta">{t("tasks.pickup")}</option>
            </select>
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-white/50">
              <tr className="border-b border-white/10 text-left">
                <th className="py-2 pr-4">{t("tasks.code")}</th>
                <th className="py-2 pr-4">{t("tasks.type")}</th>
                <th className="py-2 pr-4">{t("tasks.vehicle")}</th>
                <th className="py-2 pr-4">{t("tasks.driver")}</th>
                <th className="py-2 pr-4">{t("tasks.address")}</th>
                <th className="py-2 pr-4">{t("tasks.window")}</th>
                <th className="py-2 pr-4">{t("tasks.status")}</th>
                <th className="py-2 pr-4">{t("tasks.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-white/50">
                    {t("tasks.loading")}
                  </td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-red-200/80">
                    {t("tasks.loadError")}
                  </td>
                </tr>
              )}
              {!loading && !error && tasks.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-white/50">
                    {t("tasks.empty")}
                  </td>
                </tr>
              )}
              {tasks.map((task) => (
                <tr key={task.id} className="border-b border-white/5">
                  <td className="py-2 pr-4 text-white/80">{task.id}</td>
                  <td className="py-2 pr-4 text-white/80">{t(task.type === "coleta" ? "tasks.pickup" : "tasks.delivery")}</td>
                  <td className="py-2 pr-4 text-white/80">
                    {deviceIndex[task.vehicleId]?.name || task.vehicleId || "—"}
                  </td>
                  <td className="py-2 pr-4 text-white/80">{driverIndex[task.driverId]?.name || "—"}</td>
                  <td className="py-2 pr-4 text-white/80">{task.address || "—"}</td>
                  <td className="py-2 pr-4 text-white/70">
                    {task.startTimeExpected ? formatDate(task.startTimeExpected) : "—"} –
                    {task.endTimeExpected ? formatDate(task.endTimeExpected) : "—"}
                  </td>
                  <td className="py-2 pr-4 text-white/80">
                    <span className="rounded bg-white/10 px-2 py-1 text-xs">{renderStatus(task.status)}</span>
                  </td>
                  <td className="flex flex-wrap gap-2 py-2 pr-4 text-white/80">
                    <Link className="text-primary" to={`/tasks/${task.id}`}>
                      {t("tasks.viewDetails")}
                    </Link>
                    <button
                      type="button"
                      className="text-primary"
                      onClick={() => finalizeTask(task.id)}
                      disabled={task.status === "finalizada"}
                    >
                      {t("tasks.finish")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
