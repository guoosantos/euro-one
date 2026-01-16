import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import PageHeader from "../components/ui/PageHeader.jsx";
import FilterBar from "../components/ui/FilterBar.jsx";
import DataCard from "../components/ui/DataCard.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import SkeletonTable from "../components/ui/SkeletonTable.jsx";

import { useTranslation } from "../lib/i18n.js";
import { useTenant } from "../lib/tenant-context.jsx";
import useDevices from "../lib/hooks/useDevices.js";
import useDrivers from "../lib/hooks/useDrivers.js";
import useTasks from "../lib/hooks/useTasks.js";
import { CoreApi } from "../lib/coreApi.js";
import { formatDate } from "../lib/fleet-utils.js";
import { formatAddress } from "../lib/format-address.js";

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

  // 👉 CORREÇÃO ESSENCIAL DO LOOP INFINITO
  const taskParams = useMemo(() => {
    return {
      ...filters,
      clientId: tenantId,
      from: filters.from ? new Date(filters.from).toISOString() : undefined,
      to: filters.to ? new Date(filters.to).toISOString() : undefined,
    };
  }, [filters, tenantId]);

  const { tasks, loading, error } = useTasks(taskParams);

  const deviceIndex = useMemo(
    () => Object.fromEntries(devices.map((d) => [String(d.id), d])),
    [devices]
  );

  const driverIndex = useMemo(
    () => Object.fromEntries(drivers.map((d) => [String(d.id), d])),
    [drivers]
  );

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
      <PageHeader
        title={t("tasks.title")}
        subtitle={t("tasks.subtitle")}
        actions={
          <Link
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
            to="/tasks/new"
          >
            {t("tasks.new")}
          </Link>
        }
      />

      <DataCard>
        <FilterBar
          left={
            <>
              <select
                name="status"
                value={filters.status}
                onChange={handleFilterChange}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                <option value="">{t("all")}</option>
                <option value="pendente">{t("tasks.statusPending")}</option>
                <option value="em rota">{t("tasks.statusOnRoute")}</option>
                <option value="em atendimento">{t("tasks.statusInService")}</option>
                <option value="finalizada">{t("tasks.statusDone")}</option>
                <option value="atrasada">{t("tasks.statusLate")}</option>
                <option value="improdutiva">{t("tasks.statusIdle")}</option>
                <option value="cancelada">{t("tasks.statusCancelled")}</option>
              </select>
              <select
                name="driverId"
                value={filters.driverId}
                onChange={handleFilterChange}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                <option value="">{t("all")}</option>
                {drivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.name || driver.email || driver.id}
                  </option>
                ))}
              </select>
              <select
                name="vehicleId"
                value={filters.vehicleId}
                onChange={handleFilterChange}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                <option value="">{t("all")}</option>
                {devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name || device.uniqueId || device.id}
                  </option>
                ))}
              </select>
              <input
                type="datetime-local"
                name="from"
                value={filters.from}
                onChange={handleFilterChange}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
              <input
                type="datetime-local"
                name="to"
                value={filters.to}
                onChange={handleFilterChange}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
              <select
                name="type"
                value={filters.type || ""}
                onChange={handleFilterChange}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                <option value="">{t("all")}</option>
                <option value="entrega">{t("tasks.delivery")}</option>
                <option value="coleta">{t("tasks.pickup")}</option>
              </select>
            </>
          }
        />
      </DataCard>

      <DataCard className="overflow-hidden p-0">
        <DataTable>
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
            <tr className="border-b border-white/10 text-left">
              <th className="px-4 py-3">{t("tasks.code")}</th>
              <th className="px-4 py-3">{t("tasks.type")}</th>
              <th className="px-4 py-3">{t("tasks.vehicle")}</th>
              <th className="px-4 py-3">{t("tasks.driver")}</th>
              <th className="px-4 py-3">{t("tasks.address")}</th>
              <th className="px-4 py-3">{t("tasks.window")}</th>
              <th className="px-4 py-3">{t("tasks.status")}</th>
              <th className="px-4 py-3">{t("tasks.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-6">
                  <SkeletonTable rows={6} columns={8} />
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-red-200/80">
                  {t("tasks.loadError")}
                </td>
              </tr>
            )}
            {!loading && !error && tasks.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6">
                  <EmptyState title={t("tasks.empty")} />
                </td>
              </tr>
            )}
            {tasks.map((task) => (
              <tr key={task.id} className="border-b border-white/5">
                <td className="px-4 py-3 text-white/80">{task.id}</td>
                <td className="px-4 py-3 text-white/80">
                  {t(task.type === "coleta" ? "tasks.pickup" : "tasks.delivery")}
                </td>
                <td className="px-4 py-3 text-white/80">
                  {deviceIndex[task.vehicleId]?.name || task.vehicleId || "—"}
                </td>
                <td className="px-4 py-3 text-white/80">{driverIndex[task.driverId]?.name || "—"}</td>
                <td className="px-4 py-3 text-white/80">{formatAddress(task.address)}</td>
                <td className="px-4 py-3 text-white/70">
                  {task.startTimeExpected ? formatDate(task.startTimeExpected) : "—"} –{" "}
                  {task.endTimeExpected ? formatDate(task.endTimeExpected) : "—"}
                </td>
                <td className="px-4 py-3 text-white/80">
                  <span className="rounded-lg bg-white/10 px-2 py-1 text-xs">
                    {renderStatus(task.status)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2 text-sm text-white/80">
                    <Link className="text-sky-300" to={`/tasks/${task.id}`}>
                      {t("tasks.viewDetails")}
                    </Link>
                    <button
                      type="button"
                      className="text-sky-300"
                      onClick={() => finalizeTask(task.id)}
                      disabled={task.status === "finalizada"}
                    >
                      {t("tasks.finish")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </DataCard>
    </div>
  );
}
