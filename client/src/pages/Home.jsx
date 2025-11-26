import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { useTranslation } from "../lib/i18n.js";
import { useTenant } from "../lib/tenant-context";
import useDevices from "../lib/hooks/useDevices";
import { useLivePositions } from "../lib/hooks/useLivePositions";
import { useEvents } from "../lib/hooks/useEvents";
import { useTrips } from "../lib/hooks/useTrips";
import useTasks from "../lib/hooks/useTasks";
import { useHeatmapEvents } from "../lib/hooks/useHeatmapEvents";
import { buildFleetState, parsePositionTime } from "../lib/fleet-utils";
import { translateEventType } from "../lib/event-translations.js";
import { formatAddress } from "../lib/format-address.js";
import Card from "../ui/Card.jsx";

const FALLBACK_ANALYTICS = [
  { month: "Jan", distance: 0, alerts: 0, deliveriesOnTime: 100 },
  { month: "Fev", distance: 0, alerts: 0, deliveriesOnTime: 100 },
  { month: "Mar", distance: 0, alerts: 0, deliveriesOnTime: 100 },
  { month: "Abr", distance: 0, alerts: 0, deliveriesOnTime: 100 },
  { month: "Mai", distance: 0, alerts: 0, deliveriesOnTime: 100 },
  { month: "Jun", distance: 0, alerts: 0, deliveriesOnTime: 100 },
];

const RISK_EVENT_TYPES = "crime,theft,assalto";

function HeatCircles({ points }) {
  const map = useMap();
  const layers = useMemo(() => L.layerGroup(), []);

  useEffect(() => {
    if (!map) return undefined;
    layers.addTo(map);
    layers.clearLayers();

    if (points?.length) {
      points.forEach((point) => {
        const intensity = Math.max(1, Math.min(point.count || 1, 20));
        const radius = 120 * intensity;
        const opacity = Math.min(0.15 + intensity * 0.03, 0.8);
        L.circle([point.lat, point.lng], {
          radius,
          color: "#ef4444",
          fillColor: "#ef4444",
          weight: 0,
          fillOpacity: opacity,
        }).addTo(layers);
      });
    }

    return () => {
      layers.clearLayers();
      layers.removeFrom(map);
    };
  }, [map, layers, points]);

  return null;
}

export default function Home() {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const [showCommunicationModal, setShowCommunicationModal] = useState(false);

  const heatmapRange = useMemo(() => {
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: now.toISOString() };
  }, []);

  const { data: devices = [], loading: loadingDevices } = useDevices({ tenantId });
  const { data: positions = [], loading: loadingPositions, fetchedAt: telemetryFetchedAt } = useLivePositions({
    tenantId,
    refreshInterval: 60 * 1000,
  });

  const { events, loading: loadingEvents, error: eventsError } = useEvents({
    tenantId,
    limit: 10,
    autoRefreshMs: 60 * 1000,
  });
  const { trips, loading: loadingTrips, error: tripsError } = useTrips({
    tenantId,
    limit: 6,
    autoRefreshMs: 5 * 60 * 1000,
  });
  const { tasks } = useTasks({ clientId: tenantId });

  const { points, topZones, loading: loadingHeatmap } = useHeatmapEvents({
    tenantId,
    from: heatmapRange.from,
    to: heatmapRange.to,
  });

  const { points: riskPoints, total: riskTotal } = useHeatmapEvents({
    tenantId,
    eventType: RISK_EVENT_TYPES,
    from: heatmapRange.from,
    to: heatmapRange.to,
  });

  const { summary, table } = useMemo(() => {
    const { rows, stats } = buildFleetState(devices, positions, { tenantId });
    return { summary: stats, table: rows };
  }, [devices, positions, tenantId]);

  const onlineVehicles = useMemo(
    () => table.filter((vehicle) => vehicle.status === "online" && vehicle.speed > 5).slice(0, 3),
    [table],
  );

  const vehicleIndex = useMemo(() => {
    const index = new Map();
    for (const item of table) {
      index.set(String(item.id), item);
    }
    return index;
  }, [table]);

  const analyticsData = useMemo(() => buildAnalytics(trips), [trips]);
  const taskMetrics = useMemo(() => buildTaskMetrics(tasks), [tasks]);
  const routeMetrics = useMemo(() => buildRouteMetrics(table, tasks), [table, tasks]);
  const communicationBuckets = useMemo(() => buildOfflineBuckets(table), [table]);

  const criticalEvents = useMemo(
    () => events.filter((event) => String(event.severity ?? event.level ?? "").toLowerCase() === "critical"),
    [events],
  );

  const heatmapCenter = useMemo(() => {
    if (points.length) return [points[0].lat, points[0].lng];
    return [-23.5505, -46.6333];
  }, [points]);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title={t("home.vehiclesMonitored")}
          value={loadingDevices ? "…" : summary.total}
          hint={t("home.syncedAt", {
            time: telemetryFetchedAt ? new Date(telemetryFetchedAt).toLocaleTimeString(locale) : "—",
          })}
          action={{ label: t("home.communicationStatus"), onClick: () => setShowCommunicationModal(true) }}
        />
        <StatCard
          title={t("home.inRoute")}
          value={loadingPositions ? "…" : routeMetrics.onRoute}
          hint={t("home.onRouteHint", { percent: percentage(routeMetrics.onRoute, summary.total) })}
        />
        <StatCard
          title={t("home.inAlertTitle")}
          value={loadingPositions ? "…" : criticalEvents.length || summary.alert}
          hint={t("home.inAlertHint")}
          variant="alert"
          onClick={() => navigate("/events?severity=critical")}
        />
        <StatCard
          title={t("home.dangerousRoutes")}
          value={riskPoints.length || riskTotal || 0}
          hint={t("home.dangerousRoutesHint")}
          onClick={() => navigate("/analytics/events?filter=crime")}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title={t("home.recentEvents")}
          subtitle={
            telemetryFetchedAt
              ? t("home.updatedAt", { time: new Date(telemetryFetchedAt).toLocaleTimeString(locale) })
              : t("home.syncing")
          }
          actions={
            <Link to="/events" className="text-xs font-semibold text-primary">
              {t("home.viewAll")}
            </Link>
          }
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-white/40">
                <tr className="border-b border-white/10 text-left">
                  <th className="py-2 pr-6">{t("home.time")}</th>
                  <th className="py-2 pr-6">{t("home.type")}</th>
                  <th className="py-2 pr-6">{t("home.vehicleDriver")}</th>
                  <th className="py-2 pr-6">{t("home.severity")}</th>
                  <th className="py-2 pr-6">{t("home.location")}</th>
                </tr>
              </thead>
              <tbody>
                {loadingEvents && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-white/40">
                      {t("home.loadingEvents")}
                    </td>
                  </tr>
                )}
                {!loadingEvents && eventsError && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-red-200/80">
                      {t("home.eventsError")}
                    </td>
                  </tr>
                )}
                {!loadingEvents && !eventsError && events.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-white/40">
                      {t("home.noRecentEvents")}
                    </td>
                  </tr>
                )}
                {events.map((event) => {
                  const vehicle = resolveVehicle(event, vehicleIndex);
                  const address = formatAddress(event.address || event.attributes?.address);
                  return (
                    <tr
                      key={event.id ?? `${event.deviceId}-${event.time}`}
                      className="cursor-pointer border-b border-white/5 hover:bg-white/5"
                      onClick={() => navigate("/events")}
                    >
                      <td className="py-2 pr-6 text-white/70">{formatDate(event.time ?? event.eventTime ?? event.serverTime, locale)}</td>
                      <td className="py-2 pr-6 text-white/80">{translateEventType(event.type ?? event.event, locale, t)}</td>
                      <td className="py-2 pr-6 text-white/70">
                        {vehicle?.name ?? vehicle?.plate ?? event.deviceName ?? "—"}
                        {event.driverName ? ` · ${event.driverName}` : ""}
                      </td>
                      <td className="py-2 pr-6">
                        <SeverityBadge severity={event.severity ?? event.level ?? "low"} />
                      </td>
                      <td className="py-2 pr-6 text-white/70">{address || t("home.locationUnavailable")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title={t("home.vehiclesOnRoute")}
          subtitle={t("home.liveTelemetry")}
          actions={
            <Link to="/monitoring" className="text-xs font-semibold text-primary">
              {t("home.openMonitoring")}
            </Link>
          }
        >
          <ul className="space-y-3 text-sm text-white/80">
            {onlineVehicles.length === 0 && <li className="text-white/50">{t("home.noVehiclesMoving")}</li>}
            {onlineVehicles.map((vehicle) => (
              <li key={vehicle.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{vehicle.name}</div>
                  <span className="text-xs text-white/40">{formatSpeed(vehicle.speed)}</span>
                </div>
                <div className="mt-1 text-xs text-white/50">{formatAddress(vehicle.address) || t("home.locationUnavailable")}</div>
                <div className="mt-1 text-xs text-white/40">
                  {t("home.updatedRelative", { time: formatRelativeTime(vehicle.lastUpdate) })}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-white/70">
            <div className="rounded-lg bg-white/5 p-2">
              <div className="text-white/50">{t("home.collecting")}</div>
              <div className="text-xl font-semibold text-white">{routeMetrics.collecting}</div>
            </div>
            <div className="rounded-lg bg-white/5 p-2">
              <div className="text-white/50">{t("home.delivering")}</div>
              <div className="text-xl font-semibold text-white">{routeMetrics.delivering}</div>
            </div>
            <div className="rounded-lg bg-white/5 p-2">
              <div className="text-white/50">{t("home.routeDelay")}</div>
              <div className="text-xl font-semibold text-white">{routeMetrics.routeDelay}</div>
            </div>
            <div className="rounded-lg bg-white/5 p-2">
              <div className="text-white/50">{t("home.serviceDelay")}</div>
              <div className="text-xl font-semibold text-white">{routeMetrics.serviceDelay}</div>
            </div>
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title={t("home.tripPerformance")}
          actions={
            <Link to="/trips" className="text-xs font-semibold text-primary">
              {t("home.openTrips")}
            </Link>
          }
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-white/40">
                <tr className="border-b border-white/10 text-left">
                  <th className="py-2 pr-6">{t("home.vehicle")}</th>
                  <th className="py-2 pr-6">{t("home.start")}</th>
                  <th className="py-2 pr-6">{t("home.end")}</th>
                  <th className="py-2 pr-6">{t("home.distance")}</th>
                  <th className="py-2 pr-6">{t("home.avgSpeed")}</th>
                  <th className="py-2 pr-6">{t("home.alerts")}</th>
                </tr>
              </thead>
              <tbody>
                {loadingTrips && (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-white/40">
                      {t("home.loadingTrips")}
                    </td>
                  </tr>
                )}
                {!loadingTrips && tripsError && (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-red-200/80">
                      {t("home.tripsError")}
                    </td>
                  </tr>
                )}
                {!loadingTrips && !tripsError && trips.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-white/40">
                      {t("home.noTrips")}
                    </td>
                  </tr>
                )}
                {trips.map((trip) => {
                  const vehicle = resolveVehicle(trip, vehicleIndex);
                  return (
                    <tr key={trip.id ?? `${trip.deviceId}-${trip.start}`} className="border-b border-white/5">
                      <td className="py-2 pr-6 text-white/80">{vehicle?.name ?? vehicle?.plate ?? trip.deviceName ?? "—"}</td>
                      <td className="py-2 pr-6 text-white/60">{formatDate(trip.start ?? trip.startTime ?? trip.from, locale)}</td>
                      <td className="py-2 pr-6 text-white/60">{formatDate(trip.end ?? trip.endTime ?? trip.to, locale)}</td>
                      <td className="py-2 pr-6 text-white/80">{formatDistance(trip.distanceKm ?? trip.distance ?? trip.totalDistance)}</td>
                      <td className="py-2 pr-6 text-white/80">{formatSpeed(trip.avgSpeed ?? trip.averageSpeed)}</td>
                      <td className="py-2 pr-6 text-white/80">{trip.alerts ?? trip.eventCount ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-white/70">
            <MetricBadge label={t("home.tasksOnTime")} value={taskMetrics.onTimePercent} />
            <MetricBadge label={t("home.arrivalDelay")} value={taskMetrics.arrivalDelayPercent} variant="warning" />
            <MetricBadge label={t("home.serviceDelayLabel")} value={taskMetrics.serviceDelayPercent} variant="warning" />
            <MetricBadge label={t("home.noChecklist")} value={taskMetrics.noChecklistPercent} variant="muted" />
            <Link to="/tasks" className="col-span-2 text-right text-primary">
              {t("home.viewTasks")}
            </Link>
          </div>
        </Card>

        <Card
          title={t("home.analyticsHeatmapCard")}
          subtitle={t("home.last24h")}
          actions={
            <Link to="/analytics/events" className="text-xs font-semibold text-primary">
              {t("home.viewFullAnalysis")}
            </Link>
          }
        >
          <div className="overflow-hidden rounded-lg border border-white/10 bg-white/5">
            <MapContainer
              center={heatmapCenter}
              zoom={points.length ? 10 : 4}
              style={{ height: 220 }}
              scrollWheelZoom={false}
              dragging={!loadingHeatmap}
              className="h-56"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <HeatCircles points={points} />
            </MapContainer>
          </div>
          <div className="space-y-2 text-xs text-white/80">
            <div className="text-white/50">{t("home.topRegions")}</div>
            {topZones.slice(0, 5).map((zone, index) => (
              <div key={`${zone.lat}-${zone.lng}`} className="flex items-center justify-between rounded-lg bg-white/5 p-2">
                <div>
                  <div className="text-sm font-semibold text-white">#{index + 1}</div>
                  <div className="text-xs text-white/60">
                    {zone.name || `${zone.lat.toFixed(4)}, ${zone.lng.toFixed(4)}`}
                  </div>
                </div>
                <span className="rounded-full bg-red-500/20 px-3 py-1 text-[11px] font-semibold text-red-200">
                  {zone.count} {t("home.events")}
                </span>
              </div>
            ))}
            {topZones.length === 0 && <div className="text-white/50">{t("home.noHeatmapData")}</div>}
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card
            className="space-y-2"
            title={t("home.dangerousRoutes")}
            subtitle={t("home.dangerousRoutesHint")}
            actions={
              <Link to="/analytics/events?filter=crime" className="text-xs font-semibold text-primary">
                {t("home.viewMore")}
              </Link>
            }
          >
            <div className="grid grid-cols-2 gap-3 text-sm text-white/80">
              <div className="rounded-lg bg-white/5 p-3">
                <div className="text-xs text-white/50">{t("home.vehiclesInRisk")}</div>
                <div className="text-2xl font-semibold text-white">{riskPoints.length}</div>
              </div>
              <div className="rounded-lg bg-white/5 p-3">
                <div className="text-xs text-white/50">{t("home.averageStay")}</div>
                <div className="text-2xl font-semibold text-white">~{Math.max(1, riskTotal || 1)}m</div>
              </div>
            </div>
          </Card>

          <Card
            className="space-y-2"
            title={t("home.alertsInProgress")}
            subtitle={t("home.criticalEventsOngoing")}
            actions={
              <Link to="/events?severity=critical" className="text-xs font-semibold text-primary">
                {t("home.viewAll")}
              </Link>
            }
          >
            <div className="text-4xl font-semibold text-red-200">{criticalEvents.length || summary.alert}</div>
          </Card>

          <Card
            className="space-y-2"
            title={t("home.services")}
            subtitle={t("home.servicesThisMonth")}
            actions={
              <Link to="/services" className="text-xs font-semibold text-primary">
                {t("home.viewServices")}
              </Link>
            }
          >
            <div className="grid grid-cols-2 gap-3 text-sm text-white/80">
              <div className="rounded-lg bg-white/5 p-3">
                <div className="text-xs text-white/50">{t("home.total")}</div>
                <div className="text-2xl font-semibold text-white">{taskMetrics.totalServices}</div>
              </div>
              <div className="rounded-lg bg-white/5 p-3">
                <div className="text-xs text-white/50">{t("home.closed")}</div>
                <div className="text-2xl font-semibold text-white">{taskMetrics.closedServices}</div>
              </div>
              <div className="rounded-lg bg-white/5 p-3">
                <div className="text-xs text-white/50">{t("home.idle")}</div>
                <div className="text-2xl font-semibold text-white">{taskMetrics.idleServices}</div>
              </div>
              <div className="rounded-lg bg-white/5 p-3">
                <div className="text-xs text-white/50">{t("home.cancelled")}</div>
                <div className="text-2xl font-semibold text-white">{taskMetrics.cancelledServices}</div>
              </div>
            </div>
          </Card>
      </section>

      <Card
        title={t("home.analyticsTitle")}
        subtitle={t("home.analyticsDescription")}
        actions={<span className="text-xs text-white/60">{t("home.tripsBased", { count: trips.length })}</span>}
      >
        <AnalyticsChart data={analyticsData.length ? analyticsData : FALLBACK_ANALYTICS} />
      </Card>

      {showCommunicationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-[#111827] p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold text-white">{t("home.communicationStatus")}</div>
                <div className="text-xs text-white/50">{t("home.communicationStatusHint")}</div>
              </div>
              <button
                type="button"
                className="text-white/60 hover:text-white"
                onClick={() => setShowCommunicationModal(false)}
              >
                {t("home.close")}
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {communicationBuckets.map((bucket) => (
                <div key={bucket.label} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-xs text-white/50">{bucket.label}</div>
                  <div className="text-2xl font-semibold text-white">{bucket.vehicles.length}</div>
                  <div className="mt-2 space-y-1 text-[11px] text-white/60">
                    {bucket.vehicles.slice(0, 4).map((vehicle) => (
                      <div key={vehicle.id} className="flex justify-between">
                        <span>{vehicle.plate ?? vehicle.name}</span>
                        <span>{formatDate(vehicle.lastUpdate, locale)}</span>
                      </div>
                    ))}
                    {bucket.vehicles.length === 0 && <div className="text-white/40">{t("home.noVehicles")}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, hint, variant = "default", onClick, action }) {
  const palette = {
    default: "bg-[#12161f] border border-white/5",
    alert: "bg-red-500/10 border border-red-500/30",
  };

  return (
    <div className={`rounded-2xl p-4 ${palette[variant]}`} onClick={onClick} role={onClick ? "button" : undefined}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-white/50">{title}</div>
          <div className="mt-1 text-3xl font-semibold text-white">{value}</div>
          {hint && <div className="mt-1 text-[11px] text-white/40">{hint}</div>}
        </div>
        {action ? (
          <button
            type="button"
            className="rounded-full bg-white/10 px-3 py-1 text-[11px] text-white hover:bg-white/20"
            onClick={(event) => {
              event.stopPropagation();
              action.onClick?.();
            }}
          >
            {action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SeverityBadge({ severity }) {
  const { t } = useTranslation();
  const normalized = String(severity ?? "").toLowerCase();
  const palette = {
    critical: "bg-red-500/20 text-red-200 border border-red-500/40",
    high: "bg-red-500/20 text-red-200 border border-red-500/40",
    medium: "bg-yellow-500/20 text-yellow-200 border border-yellow-500/40",
    low: "bg-green-500/20 text-green-200 border border-green-500/40",
    info: "bg-blue-500/20 text-blue-200 border border-blue-500/40",
  };
  const label =
    normalized === "critical"
      ? t("severity.critical")
      : normalized === "high"
      ? t("severity.high")
      : normalized === "medium"
      ? t("severity.medium")
      : normalized === "info"
      ? t("severity.info")
      : t("severity.low");
  return <span className={`rounded-full px-3 py-1 text-xs ${palette[normalized] ?? palette.low}`}>{label}</span>;
}

function AnalyticsChart({ data }) {
  const maxDistance = Math.max(...data.map((item) => item.distance || 0), 1);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-3">
        {data.map((item) => (
          <div key={item.month} className="flex items-center gap-3">
            <div className="w-12 text-sm text-white/60">{item.month}</div>
            <div className="flex-1 rounded-full bg-white/10">
              <div
                className="h-3 rounded-full bg-primary"
                style={{ width: `${Math.round(((item.distance || 0) / maxDistance) * 100)}%` }}
              />
            </div>
            <div className="w-20 text-right text-xs text-white/50">{formatDistance(item.distance)}</div>
          </div>
        ))}
      </div>
      <div className="space-y-3">
        {data.map((item) => (
          <div key={`${item.month}-alerts`} className="flex items-center justify-between text-sm text-white/70">
            <span>{item.month}</span>
            <span>
              {item.alerts ?? 0} alertas · {item.deliveriesOnTime ?? 0}% SLA
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricBadge({ label, value, variant = "default" }) {
  const palette = {
    default: "bg-green-500/10 text-green-200",
    warning: "bg-yellow-500/10 text-yellow-200",
    muted: "bg-white/5 text-white/70",
  };
  return (
    <div className={`rounded-full px-3 py-2 text-xs font-semibold ${palette[variant] ?? palette.default}`}>
      {label}: {Math.round(value)}%
    </div>
  );
}

function percentage(partial, total) {
  if (!total) return 0;
  return Math.round((partial / total) * 100);
}

function resolveVehicle(item, vehicleIndex) {
  if (!item) return null;
  const candidates = [
    item.deviceId,
    item.device?.id,
    item.vehicleId,
    item.vehicle?.id,
    item.uniqueId,
    item.device?.uniqueId,
    item.id,
  ];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const key = String(candidate);
    if (vehicleIndex.has(key)) return vehicleIndex.get(key);
  }
  return null;
}

function formatDate(value, locale = undefined) {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString(locale ?? undefined);
  } catch (error) {
    return "—";
  }
}

function formatDistance(value) {
  if (!Number.isFinite(Number(value))) return "0 km";
  const numeric = Number(value);
  const km = numeric > 1000 ? numeric / 1000 : numeric;
  return `${(Math.round(km * 10) / 10).toLocaleString()} km`;
}

function formatSpeed(value) {
  if (!Number.isFinite(Number(value))) return "—";
  const numeric = Number(value);
  const speed = numeric > 300 ? numeric * 1.852 : numeric; // fallback caso venha em nós
  return `${Math.round(speed)} km/h`;
}

function formatRelativeTime(value) {
  const timestamp = typeof value === "number" ? value : parsePositionTime({ fixTime: value });
  if (!timestamp) return "há pouco";
  const diff = Date.now() - timestamp;
  if (diff < 60 * 1000) return "há instantes";
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.round(diff / (60 * 1000));
    return `há ${minutes} min`;
  }
  const hours = Math.round(diff / (60 * 60 * 1000));
  return `há ${hours} h`;
}

function buildAnalytics(trips) {
  if (!Array.isArray(trips) || trips.length === 0) return [];
  const map = new Map();
  for (const trip of trips) {
    const timestamp = parsePositionTime({ fixTime: trip.start ?? trip.startTime ?? trip.from });
    if (!timestamp) continue;
    const date = new Date(timestamp);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const monthLabel = date.toLocaleString("pt-BR", { month: "short" });
    if (!map.has(key)) {
      map.set(key, { month: capitalize(monthLabel), distance: 0, alerts: 0, deliveriesOnTime: 100, order: timestamp });
    }
    const entry = map.get(key);
    entry.order = Math.min(entry.order, timestamp);
    const distanceValue = Number(trip.distanceKm ?? trip.distance ?? trip.totalDistance ?? 0);
    const normalizedDistance = distanceValue > 1000 ? distanceValue / 1000 : distanceValue;
    entry.distance += Number.isFinite(normalizedDistance) ? normalizedDistance : 0;
    entry.alerts += Number(trip.alerts ?? trip.eventCount ?? 0) || 0;
  }
  return Array.from(map.values())
    .sort((a, b) => a.order - b.order)
    .slice(0, 6);
}

function buildTaskMetrics(tasks = []) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return {
      onTimePercent: 0,
      arrivalDelayPercent: 0,
      serviceDelayPercent: 0,
      noChecklistPercent: 0,
      totalServices: 0,
      closedServices: 0,
      idleServices: 0,
      cancelledServices: 0,
    };
  }

  const now = Date.now();
  let onTime = 0;
  let arrivalDelay = 0;
  let serviceDelay = 0;
  let noChecklist = 0;
  let closed = 0;
  let idle = 0;
  let cancelled = 0;

  for (const task of tasks) {
    const startExpected = task.startTimeExpected ? Date.parse(task.startTimeExpected) : null;
    const endExpected = task.endTimeExpected ? Date.parse(task.endTimeExpected) : null;
    const updated = task.updatedAt ? Date.parse(task.updatedAt) : null;

    if (String(task.status).toLowerCase().includes("final")) {
      closed += 1;
    } else if (String(task.status).toLowerCase().includes("cancel")) {
      cancelled += 1;
    } else if (String(task.status).toLowerCase().includes("improdut")) {
      idle += 1;
    }

    if (!task.attachments || task.attachments.length === 0) {
      noChecklist += 1;
    }

    if (startExpected && updated && updated <= startExpected && String(task.status).toLowerCase().includes("final")) {
      onTime += 1;
    }

    if (startExpected && now > startExpected && !String(task.status).toLowerCase().includes("final")) {
      arrivalDelay += 1;
    }

    if (endExpected && now > endExpected && String(task.status).toLowerCase().includes("em atendimento")) {
      serviceDelay += 1;
    }
  }

  const total = tasks.length || 1;

  return {
    onTimePercent: (onTime / total) * 100,
    arrivalDelayPercent: (arrivalDelay / total) * 100,
    serviceDelayPercent: (serviceDelay / total) * 100,
    noChecklistPercent: (noChecklist / total) * 100,
    totalServices: tasks.length,
    closedServices: closed,
    idleServices: idle,
    cancelledServices: cancelled,
  };
}

function buildRouteMetrics(table = [], tasks = []) {
  const activeTasks = Array.isArray(tasks) ? tasks : [];
  const online = Array.isArray(table) ? table : [];

  const onRoute = online.filter((vehicle) => vehicle.status === "online" && Number(vehicle.speed) > 5).length;

  let collecting = 0;
  let delivering = 0;
  let routeDelay = 0;
  let serviceDelay = 0;
  const now = Date.now();

  for (const task of activeTasks) {
    const vehicle = online.find((item) => String(item.id) === String(task.vehicleId));
    const normalizedStatus = String(task.status || "").toLowerCase();
    const startExpected = task.startTimeExpected ? Date.parse(task.startTimeExpected) : null;
    const endExpected = task.endTimeExpected ? Date.parse(task.endTimeExpected) : null;

    if (normalizedStatus.includes("atendimento")) {
      if (String(task.type || "").toLowerCase().includes("colet")) collecting += 1;
      if (String(task.type || "").toLowerCase().includes("entreg")) delivering += 1;
      if (endExpected && now > endExpected) serviceDelay += 1;
    }

    if (!normalizedStatus.includes("final") && startExpected && now > startExpected) {
      routeDelay += 1;
    }

    if (vehicle && vehicle.speed > 5 && !normalizedStatus.includes("final")) {
      // already counted as onRoute
    }
  }

  return { onRoute, collecting, delivering, routeDelay, serviceDelay };
}

function buildOfflineBuckets(table = []) {
  const now = Date.now();
  const offlineVehicles = table.filter((item) => item.status === "offline");
  const buckets = [
    { label: "0-1h", min: 0, max: 1 },
    { label: "1-6h", min: 1, max: 6 },
    { label: "6-12h", min: 6, max: 12 },
    { label: "12-24h", min: 12, max: 24 },
    { label: "24-72h", min: 24, max: 72 },
    { label: "72h-10d", min: 72, max: 240 },
    { label: "10-30d", min: 240, max: 720 },
    { label: "30+d", min: 720, max: Infinity },
  ];

  const withLast = offlineVehicles.map((vehicle) => {
    const lastUpdate = vehicle.lastUpdate ? Date.parse(vehicle.lastUpdate) : null;
    const hours = lastUpdate ? (now - lastUpdate) / (1000 * 60 * 60) : Infinity;
    return { ...vehicle, offlineHours: hours };
  });

  return buckets.map((bucket) => ({
    ...bucket,
    vehicles: withLast.filter((vehicle) => vehicle.offlineHours >= bucket.min && vehicle.offlineHours < bucket.max),
  }));
}

function capitalize(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
