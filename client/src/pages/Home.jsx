import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useTranslation } from "../lib/i18n.js";
import { useTenant } from "../lib/tenant-context";
import { useLivePositions } from "../lib/hooks/useLivePositions";
import useTasks from "../lib/hooks/useTasks";
import { buildFleetState, parsePositionTime } from "../lib/fleet-utils";
import { translateEventType } from "../lib/event-translations.js";
import useVehicles, { formatVehicleLabel, normalizeVehicleDevices } from "../lib/hooks/useVehicles.js";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";
import { resolveAlertSignals } from "../lib/alert-utils.js";
import { usePolling } from "../lib/hooks/usePolling.js";
import { formatAddress } from "../lib/format-address.js";
import { deriveStatus } from "../lib/monitoring-helpers.js";
import api from "../lib/api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import Card from "../ui/Card";
import DataState from "../ui/DataState.jsx";

const COMMUNICATION_BUCKETS = [
  { key: "stale_0_1", label: "0–1h", minMinutes: 0, maxMinutes: 60 },
  { key: "stale_1_6", label: "1–6h", minMinutes: 60, maxMinutes: 360 },
  { key: "stale_6_12", label: "6–12h", minMinutes: 360, maxMinutes: 720 },
  { key: "stale_12_24", label: "12–24h", minMinutes: 720, maxMinutes: 1440 },
  { key: "stale_24_72", label: "24–72h", minMinutes: 1440, maxMinutes: 4320 },
  { key: "stale_72_10d", label: "72h–10d", minMinutes: 4320, maxMinutes: 14400 },
  { key: "stale_10d_30d", label: "10–30d", minMinutes: 14400, maxMinutes: 43200 },
  { key: "stale_30d_plus", label: "30+d", minMinutes: 43200, maxMinutes: Infinity },
];
const HOME_REFRESH_MS = 15_000;
const CRITICAL_WINDOW_HOURS = 3;
const CRITICAL_MIN_EVENTS = 2;

export default function Home() {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const [selectedCard, setSelectedCard] = useState(null);

  const { vehicles, loading: loadingVehicles } = useVehicles();
  const { data: positions = [], loading: loadingPositions, fetchedAt: telemetryFetchedAt } = useLivePositions();
  const {
    data: criticalVehiclesData,
    loading: loadingCriticalVehicles,
  } = usePolling(
    async () => {
      const params = {
        windowHours: CRITICAL_WINDOW_HOURS,
        minEvents: CRITICAL_MIN_EVENTS,
      };
      if (tenantId) params.clientId = tenantId;
      const response = await api.get(API_ROUTES.homeCriticalVehicles, { params });
      return response?.data?.data ?? response?.data ?? [];
    },
    { intervalMs: HOME_REFRESH_MS, dependencies: [tenantId] },
  );
  const { tasks } = useTasks(useMemo(() => ({ clientId: tenantId }), [tenantId]));

  const vehicleById = useMemo(() => new Map(vehicles.map((vehicle) => [String(vehicle.id), vehicle])), [vehicles]);

  const positionByDevice = useMemo(() => {
    const map = new Map();
    positions.forEach((position) => {
      const key = toDeviceKey(
        position?.deviceId ??
          position?.device?.id ??
          position?.uniqueId ??
          position?.id ??
          position?.device?.deviceId,
      );
      if (!key) return;
      map.set(String(key), position);
    });
    return map;
  }, [positions]);

  const vehicleByDeviceId = useMemo(() => {
    const map = new Map();
    vehicles.forEach((vehicle) => {
      normalizeVehicleDevices(vehicle).forEach((device) => {
        const key = toDeviceKey(device?.id ?? device?.deviceId ?? device?.uniqueId ?? device?.traccarId);
        if (key) map.set(String(key), vehicle);
      });
    });
    return map;
  }, [vehicles]);

  const vehicleTelemetry = useMemo(
    () =>
      vehicles.map((vehicle) => {
        const devices = normalizeVehicleDevices(vehicle);
        const primaryKey = vehicle.primaryDeviceId ? String(vehicle.primaryDeviceId) : null;
        let primaryDevice = primaryKey
          ? devices.find((device) => toDeviceKey(device?.id ?? device?.deviceId ?? device?.uniqueId ?? device?.traccarId) === primaryKey)
          : null;

        if (!primaryDevice && devices.length) {
          let newestDevice = null;
          let newestTime = null;
          devices.forEach((device) => {
            const key = toDeviceKey(device?.id ?? device?.deviceId ?? device?.uniqueId ?? device?.traccarId);
            if (!key) return;
            const position = positionByDevice.get(String(key));
            const timestamp = parsePositionTime(position);
            if (!timestamp) return;
            if (!newestTime || timestamp > newestTime) {
              newestTime = timestamp;
              newestDevice = device;
            }
          });
          primaryDevice = newestDevice ?? null;
        }

        const deviceKey = primaryDevice
          ? toDeviceKey(primaryDevice?.id ?? primaryDevice?.deviceId ?? primaryDevice?.uniqueId ?? primaryDevice?.traccarId)
          : null;
        const position = deviceKey ? positionByDevice.get(String(deviceKey)) : null;
        return { vehicle, device: primaryDevice, deviceKey, position };
      }),
    [positionByDevice, vehicles],
  );

  const linkedVehicles = useMemo(
    () => vehicleTelemetry.filter((item) => Boolean(item.deviceKey)),
    [vehicleTelemetry],
  );

  const deviceTenantMap = useMemo(() => {
    const map = new Map();
    linkedVehicles.forEach((entry) => {
      const tenant =
        entry.vehicle?.clientId ??
        entry.vehicle?.client?.id ??
        entry.vehicle?.tenantId ??
        entry.vehicle?.tenant?.id ??
        entry.device?.clientId ??
        entry.device?.tenantId ??
        null;
      if (tenant && entry.deviceKey) {
        map.set(String(entry.deviceKey), tenant);
      }
    });
    return map;
  }, [linkedVehicles]);

  const tenantFallbackId = tenantId ?? null;

  const fleetDevices = useMemo(
    () =>
      linkedVehicles.map((entry) => ({
        ...entry.device,
        id: entry.deviceKey,
        deviceId: entry.deviceKey,
        uniqueId: entry.device?.uniqueId ?? entry.deviceKey,
        name: entry.vehicle?.name ?? entry.device?.name,
        plate: entry.vehicle?.plate ?? entry.device?.plate,
        vehicleId: entry.vehicle?.id ?? entry.device?.vehicleId,
        clientId:
          entry.vehicle?.clientId ??
          entry.vehicle?.client?.id ??
          entry.vehicle?.tenantId ??
          entry.device?.clientId ??
          entry.device?.tenantId ??
          tenantFallbackId,
      })),
    [linkedVehicles, tenantFallbackId],
  );

  const fleetPositions = useMemo(() => {
    const keys = new Set(linkedVehicles.map((entry) => String(entry.deviceKey)));
    return positions
      .map((position) => {
        const key = toDeviceKey(
          position?.deviceId ??
            position?.device?.id ??
            position?.uniqueId ??
            position?.id ??
            position?.device?.deviceId,
        );
        if (!key || !keys.has(String(key))) return null;
        const tenant = deviceTenantMap.get(String(key)) ?? position?.clientId ?? position?.tenantId ?? null;
        if (!tenant && !tenantFallbackId) return position;
        const resolvedTenant = tenant ?? tenantFallbackId;
        return {
          ...position,
          clientId: position?.clientId ?? resolvedTenant,
          tenantId: position?.tenantId ?? resolvedTenant,
        };
      })
      .filter(Boolean);
  }, [deviceTenantMap, linkedVehicles, positions, tenantFallbackId]);

  const { summary, table } = useMemo(() => {
    const { rows, stats } = buildFleetState(fleetDevices, fleetPositions, { tenantId });
    return { summary: stats, table: rows };
  }, [fleetDevices, fleetPositions, tenantId]);

  const decoratedTable = useMemo(
    () =>
      table.map((row) => {
        const vehicle = vehicleByDeviceId.get(String(row.id)) || null;
        return {
          ...row,
          vehicle,
          vehicleId: vehicle?.id ?? row.device?.vehicleId ?? row.vehicleId ?? null,
        };
      }),
    [table, vehicleByDeviceId],
  );

  const communicationBuckets = useMemo(() => buildOfflineBuckets(decoratedTable), [decoratedTable]);
  const routeMetrics = useMemo(
    () => buildRouteMetrics(decoratedTable, tasks, vehicleByDeviceId),
    [decoratedTable, tasks, vehicleByDeviceId],
  );

  const alertRows = useMemo(() => (
    decoratedTable
      .map((row) => {
        const alertSignals = resolveAlertSignals({ position: row.position, device: row.device });
        return { ...row, alertSignals };
      })
      .filter((row) => deriveStatus(row.position) === "alert")
  ), [decoratedTable]);

  const conjugatedAlertRows = useMemo(
    () => alertRows.filter((row) => row.alertSignals.length >= 2),
    [alertRows],
  );

  const criticalByVehicle = useMemo(() => {
    const list = Array.isArray(criticalVehiclesData) ? criticalVehiclesData : [];
    return list.map((entry) => {
      const vehicle = vehicleById.get(String(entry.vehicleId)) || null;
      return {
        ...entry,
        vehicle,
        vehicleName: vehicle ? formatVehicleLabel(vehicle) : entry.plate || entry.vehicleId,
        events: Array.isArray(entry.events) ? entry.events : [],
      };
    });
  }, [criticalVehiclesData, vehicleById]);


  const renderCommunicationSummary = (expanded = false) => (
    <Card
      title={t("home.communicationStatus")}
      subtitle={t("home.communicationStatusHint")}
      actions={expanded ? (
        <button
          type="button"
          className="text-xs font-semibold text-primary"
          onClick={() => setSelectedCard(null)}
        >
          {t("home.close")}
        </button>
      ) : null}
      className={expanded ? "xl:col-span-2" : ""}
    >
      <div className="overflow-x-auto text-sm">
        <table className="min-w-full">
          <thead className="text-white/50">
            <tr className="border-b border-white/10 text-left">
              <th className="py-2 pr-4">Faixa</th>
              <th className="py-2 pr-4">Quantidade</th>
            </tr>
          </thead>
          <tbody>
            {communicationBuckets.map((bucket) => (
              <tr
                key={bucket.label}
                className="cursor-pointer border-b border-white/5 transition hover:bg-white/5"
                onClick={() => window.open(`/monitoring?filter=${bucket.filterKey}`, "_blank")}
              >
                <td className="py-2 pr-4 text-white/80">{bucket.label}</td>
                <td className="py-2 pr-4 text-white">{bucket.vehicles.length === 0 ? "No vehicles" : bucket.vehicles.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );

  const renderRouteSummary = (expanded = false) => (
    <Card
      title="Veículos em rota"
      subtitle="Status dos veículos com rota ativa"
      actions={expanded ? (
        <button type="button" className="text-xs font-semibold text-primary" onClick={() => setSelectedCard(null)}>
          Fechar
        </button>
      ) : null}
      className={expanded ? "xl:col-span-2" : ""}
    >
      <div className={`grid gap-3 ${expanded ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        <Metric
          label="Com rota embarcada"
          value={routeMetrics.totalWithRoute}
          onClick={() => window.open("/monitoring?routeFilter=active", "_blank")}
        />
        <Metric
          label="Com sinal + rota"
          value={routeMetrics.withSignal}
          onClick={() => window.open("/monitoring?routeFilter=with_signal", "_blank")}
        />
        <Metric
          label="Sem sinal + rota"
          value={routeMetrics.withoutSignal}
          onClick={() => window.open("/monitoring?routeFilter=without_signal", "_blank")}
        />
        <Metric
          label="Bloqueados + rota"
          value={routeMetrics.blocked.total}
          onClick={() => window.open("/monitoring?routeFilter=active&securityFilter=blocked", "_blank")}
        />
        <Metric
          label="Bloqueado (Jammer)"
          value={routeMetrics.blocked.jammer}
          onClick={() => window.open("/monitoring?routeFilter=active&securityFilter=jammer", "_blank")}
        />
        <Metric
          label="Bloqueado (Violação)"
          value={routeMetrics.blocked.violation}
          onClick={() => window.open("/monitoring?routeFilter=active&securityFilter=violation", "_blank")}
        />
        <Metric
          label="Bloqueado (Reconhecimento facial)"
          value={routeMetrics.blocked.face}
          onClick={() => window.open("/monitoring?routeFilter=active&securityFilter=face", "_blank")}
        />
        <Metric
          label="Desvio de rota"
          value={routeMetrics.routeDeviation}
          onClick={() => window.open("/monitoring?routeFilter=active&securityFilter=routeDeviation", "_blank")}
        />
        <Metric
          label="Atraso na rota"
          value={routeMetrics.routeDelay}
          onClick={() => window.open("/monitoring?routeFilter=active&securityFilter=routeDelay", "_blank")}
        />
      </div>
    </Card>
  );

  const renderAlertSummary = (expanded = false) => (
    <Card
      title="Alertas"
      subtitle="Veículos com alerta ativo no monitoramento"
      actions={expanded ? (
        <button type="button" className="text-xs font-semibold text-primary" onClick={() => setSelectedCard(null)}>
          Fechar
        </button>
      ) : (
        <Link to="/monitoring?filter=critical" className="text-xs font-semibold text-primary">
          Ver no monitoramento
        </Link>
      )}
      className={expanded ? "xl:col-span-2" : ""}
    >
      {alertRows.length === 0 ? (
        <div className="py-6">
          <DataState state="empty" tone="muted" title="Nenhum alerta ativo" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-white/40">
              <tr className="border-b border-white/10 text-left">
                <th className="py-2 pr-4">Veículo</th>
                <th className="py-2 pr-4">Última atualização</th>
                <th className="py-2 pr-4">Alertas</th>
                <th className="py-2 pr-4">Local</th>
              </tr>
            </thead>
            <tbody>
              {alertRows.slice(0, expanded ? alertRows.length : 8).map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-b border-white/5 hover:bg-white/5"
                  onClick={() => window.open(`/monitoring?filter=critical&deviceId=${row.id}`, "_blank")}
                >
                  <td className="py-2 pr-4 text-white/80">
                    {row.vehicle ? formatVehicleLabel(row.vehicle) : row.name ?? row.plate ?? row.id}
                  </td>
                  <td className="py-2 pr-4 text-white/70">{formatDate(row.lastUpdate, locale)}</td>
                  <td className="py-2 pr-4 text-white/70">
                    {row.alertSignals.length ? row.alertSignals.join(" · ") : "Alerta ativo"}
                  </td>
                  <td className="py-2 pr-4 text-white/70">{formatAddress(row.address)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );

  const renderConjugatedAlertsSummary = (expanded = false) => (
    <Card
      title="Alertas conjugados"
      subtitle="Veículos com múltiplos alertas ativos"
      actions={expanded ? (
        <button type="button" className="text-xs font-semibold text-primary" onClick={() => setSelectedCard(null)}>
          Fechar
        </button>
      ) : (
        <Link to="/monitoring?filter=conjugated" className="text-xs font-semibold text-primary">
          Ver no monitoramento
        </Link>
      )}
      className={expanded ? "xl:col-span-2" : ""}
    >
      {conjugatedAlertRows.length === 0 ? (
        <div className="py-6">
          <DataState state="empty" tone="muted" title="Nenhum alerta conjugado" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-white/40">
              <tr className="border-b border-white/10 text-left">
                <th className="py-2 pr-4">Veículo</th>
                <th className="py-2 pr-4">Última atualização</th>
                <th className="py-2 pr-4">Alertas combinados</th>
              </tr>
            </thead>
            <tbody>
              {conjugatedAlertRows.slice(0, expanded ? conjugatedAlertRows.length : 8).map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-b border-white/5 hover:bg-white/5"
                  onClick={() => window.open(`/monitoring?filter=conjugated&deviceId=${row.id}`, "_blank")}
                >
                  <td className="py-2 pr-4 text-white/80">
                    {row.vehicle ? formatVehicleLabel(row.vehicle) : row.name ?? row.plate ?? row.id}
                  </td>
                  <td className="py-2 pr-4 text-white/70">{formatDate(row.lastUpdate, locale)}</td>
                  <td className="py-2 pr-4 text-white/70">{row.alertSignals.join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );

  const renderCriticalSummary = (expanded = false) => (
    <Card
      title="Eventos críticos"
      subtitle="Veículos com 2+ alertas graves em curto intervalo"
      actions={expanded ? (
        <button type="button" className="text-xs font-semibold text-primary" onClick={() => setSelectedCard(null)}>
          Fechar
        </button>
      ) : null}
      className={expanded ? "xl:col-span-2" : ""}
    >
      {loadingCriticalVehicles && criticalByVehicle.length === 0 ? (
        <div className="py-6">
          <p className="text-sm text-white/60">Atualizando eventos críticos…</p>
        </div>
      ) : criticalByVehicle.length === 0 ? (
        <div className="py-6">
          <DataState state="empty" tone="muted" title="Nenhum veículo crítico" />
        </div>
      ) : (
        <div className="space-y-3">
          {criticalByVehicle.map((group) => (
            <div
              key={group.vehicleId}
              className="cursor-pointer rounded-xl border border-white/10 bg-white/5 p-3 hover:border-primary/40"
              onClick={() => openEventsForVehicle(group.vehicleId)}
            >
              <div className="flex items-center justify-between text-sm text-white">
                <div className="font-semibold">{group.vehicleName ?? group.vehicleId}</div>
                <span className="rounded-full bg-red-500/20 px-3 py-1 text-[11px] font-semibold text-red-200">
                  {group.count} eventos
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/70">
                <span>Último evento:</span>
                <span className="text-white/90">{formatDate(group.lastEventAt, locale)}</span>
              </div>
              {group.events.length > 0 && (
                <div className="mt-2 text-xs text-white/60">
                  Tipos:{" "}
                  {group.events
                    .slice(0, expanded ? 6 : 3)
                    .map((event) =>
                      translateEventType(
                        event.type,
                        locale,
                        t,
                        event.protocol || event.attributes?.protocol || null,
                        event,
                      ),
                    )
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );

  const renderSummaries = () => {
    if (selectedCard === "monitored") return renderCommunicationSummary(true);
    if (selectedCard === "route") return renderRouteSummary(true);
    if (selectedCard === "alert") return renderAlertSummary(true);
    if (selectedCard === "conjugated") return renderConjugatedAlertsSummary(true);
    if (selectedCard === "critical") return renderCriticalSummary(true);

    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {renderCommunicationSummary()}
        {renderRouteSummary()}
        {renderAlertSummary()}
        {renderConjugatedAlertsSummary()}
        {renderCriticalSummary()}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          title={t("home.vehiclesMonitored")}
          value={loadingVehicles ? "…" : summary.total}
          hint={t("home.syncedAt", {
            time: telemetryFetchedAt ? new Date(telemetryFetchedAt).toLocaleTimeString(locale) : "—",
          })}
          onClick={() => setSelectedCard("monitored")}
        />
        <StatCard
          title={t("home.inRoute")}
          value={loadingPositions ? "…" : routeMetrics.totalWithRoute}
          hint={t("home.onRouteHint", { percent: percentage(routeMetrics.totalWithRoute, summary.total) })}
          onClick={() => setSelectedCard("route")}
        />
        <StatCard
          title={t("home.inAlertTitle")}
          value={loadingPositions ? "…" : alertRows.length}
          hint="Alertas ativos no monitoramento"
          variant="alert"
          onClick={() => setSelectedCard("alert")}
        />
        <StatCard
          title="Alertas conjugados"
          value={loadingPositions ? "…" : conjugatedAlertRows.length}
          hint="Múltiplos alertas simultâneos"
          variant="alert"
          onClick={() => setSelectedCard("conjugated")}
        />
        <StatCard
          title="Eventos críticos"
          value={loadingCriticalVehicles ? "…" : criticalByVehicle.length}
          hint="Veículos com múltiplos eventos graves"
          variant="alert"
          onClick={() => setSelectedCard("critical")}
        />
      </section>

      {renderSummaries()}
    </div>
  );

  function openEventsForVehicle(vehicleId) {
    if (!vehicleId) return;
    const search = new URLSearchParams();
    search.set("vehicleId", vehicleId);
    navigate(`/events?${search.toString()}`);
  }
}

function StatCard({ title, value, hint, variant = "default", onClick }) {
  const palette = {
    default: "bg-[#12161f] border border-white/5",
    alert: "bg-red-500/10 border border-red-500/30",
  };

  return (
    <div
      className={`rounded-2xl p-4 transition duration-200 hover:-translate-y-0.5 hover:border-primary/40 ${palette[variant]}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-white/50">{title}</div>
          <div className="mt-1 text-3xl font-semibold text-white">{value}</div>
          {hint && <div className="mt-1 text-[11px] text-white/40">{hint}</div>}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, onClick }) {
  return (
    <div
      className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80 transition hover:border-primary/40"
      role={onClick ? "button" : undefined}
      onClick={onClick}
    >
      <div className="text-xs text-white/50">{label}</div>
      <div className="text-2xl font-semibold text-white">{value ?? 0}</div>
    </div>
  );
}

function buildRouteMetrics(table = [], tasks = [], vehicleByDeviceId = new Map()) {
  const activeTasks = Array.isArray(tasks)
    ? tasks.filter((task) => !String(task.status || "").toLowerCase().includes("final"))
    : [];
  const routesByVehicle = new Map();
  activeTasks.forEach((task) => {
    const deviceKey = toDeviceKey(task.deviceId ?? task.device?.id ?? task.device?.deviceId ?? "");
    const resolvedVehicleId = task.vehicleId ?? (deviceKey ? vehicleByDeviceId.get(String(deviceKey))?.id : null);
    const key = resolvedVehicleId ? String(resolvedVehicleId) : "";
    if (key) routesByVehicle.set(key, task);
  });

  let totalWithRoute = 0;
  let withoutSignal = 0;
  let withSignal = 0;
  let routeDelay = 0;
  let routeDeviation = 0;
  const blocked = { total: 0, jammer: 0, violation: 0, face: 0 };

  const now = Date.now();

  for (const vehicle of table) {
    const key = String(vehicle.vehicleId ?? vehicle.vehicle?.id ?? vehicle.device?.vehicleId ?? vehicle.id ?? "");
    if (!key || !routesByVehicle.has(key)) continue;
    totalWithRoute += 1;
    const online = vehicle.status === "online";
    if (online) withSignal += 1;
    else withoutSignal += 1;

    const reason = String(vehicle.position?.attributes?.alarm ?? vehicle.alerts?.[0] ?? "").toLowerCase();
    const isBlocked = Boolean(vehicle.device?.blocked || vehicle.position?.blocked || vehicle.status === "blocked");
    if (isBlocked) {
      blocked.total += 1;
      if (reason.includes("jam")) blocked.jammer += 1;
      if (reason.includes("viol")) blocked.violation += 1;
      if (reason.includes("face")) blocked.face += 1;
    }

    const task = routesByVehicle.get(key);
    const startExpected = task?.startTimeExpected ? Date.parse(task.startTimeExpected) : null;
    const endExpected = task?.endTimeExpected ? Date.parse(task.endTimeExpected) : null;
    const statusText = String(task?.status || "").toLowerCase();
    if (startExpected && now > startExpected && !statusText.includes("final")) routeDelay += 1;
    if (endExpected && now > endExpected && !statusText.includes("final")) routeDeviation += 1;
  }

  return { totalWithRoute, withoutSignal, withSignal, routeDelay, routeDeviation, blocked };
}

function buildOfflineBuckets(table = []) {
  const now = Date.now();
  const offlineVehicles = table.filter((item) => item.status === "offline" || item.status === "blocked");

  const withLast = offlineVehicles.map((vehicle) => {
    const lastUpdate = vehicle.lastUpdate ? Date.parse(vehicle.lastUpdate) : null;
    const minutes = lastUpdate ? (now - lastUpdate) / (1000 * 60) : Infinity;
    return { ...vehicle, offlineMinutes: minutes };
  });

  return COMMUNICATION_BUCKETS.map((bucket) => ({
    label: bucket.label,
    filterKey: bucket.key,
    vehicles: withLast.filter(
      (vehicle) => vehicle.offlineMinutes >= bucket.minMinutes && vehicle.offlineMinutes < bucket.maxMinutes,
    ),
  }));
}

function percentage(value, total) {
  if (!total) return "0%";
  return `${Math.round((Number(value || 0) / total) * 100)}%`;
}

function formatDate(value, locale = "pt-BR") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(locale);
}
