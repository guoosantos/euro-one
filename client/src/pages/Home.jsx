import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../lib/i18n.js";
import { useTenant } from "../lib/tenant-context";
import { useLivePositions } from "../lib/hooks/useLivePositions";
import useTasks from "../lib/hooks/useTasks";
import { buildFleetState, parsePositionTime } from "../lib/fleet-utils";
import useVehicles, { normalizeVehicleDevices } from "../lib/hooks/useVehicles.js";
import { getDeviceKey, toDeviceKey } from "../lib/hooks/useDevices.helpers.js";
import { formatAddress } from "../lib/format-address.js";
import useAlerts from "../lib/hooks/useAlerts.js";
import useConjugatedAlerts from "../lib/hooks/useConjugatedAlerts.js";
import usePolling from "../lib/hooks/usePolling.js";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { CoreApi } from "../lib/coreApi.js";
import Card from "../ui/Card";
import DataState from "../ui/DataState.jsx";
import PageHeader from "../components/ui/PageHeader.jsx";

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

function normalizePositionsPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.positions)) return payload.positions;
  if (Array.isArray(payload?.data)) return payload.data;
  return payload ? [payload] : [];
}

function normalizeAlertsPayload(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.alerts)) return payload.alerts;
  if (Array.isArray(payload?.events)) return payload.events;
  if (Array.isArray(payload)) return payload;
  return [];
}

function normalizeTasksPayload(payload) {
  if (Array.isArray(payload?.tasks)) return payload.tasks;
  if (Array.isArray(payload)) return payload;
  return [];
}

function dedupeByDevice(positions = []) {
  const latestByDevice = new Map();
  positions.forEach((pos) => {
    const deviceId = pos?.deviceId ?? pos?.device_id ?? pos?.deviceid ?? pos?.deviceID;
    const key = deviceId != null ? String(deviceId) : null;
    if (!key) return;
    const time = Date.parse(pos.fixTime ?? pos.serverTime ?? pos.deviceTime ?? pos.time ?? 0);
    const current = latestByDevice.get(key);
    if (!current || (!Number.isNaN(time) && time > current.time)) {
      latestByDevice.set(key, { pos, time });
    }
  });
  return Array.from(latestByDevice.values())
    .map((entry) => entry.pos)
    .filter(Boolean);
}

function dedupeById(list = [], getId) {
  const map = new Map();
  list.forEach((item) => {
    const key = getId(item);
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, item);
    }
  });
  return Array.from(map.values());
}

function resolveEntityId(entity, fallbackKey) {
  const candidate =
    entity?.id ??
    entity?.alertId ??
    entity?.eventId ??
    entity?.vehicleId ??
    entity?.deviceId ??
    entity?.taskId ??
    null;
  if (candidate) return String(candidate);
  if (fallbackKey) return String(fallbackKey);
  return null;
}

async function fetchMirrorOwnerBundle({
  ownerId,
  canAccessMonitoring,
  canAccessAlerts,
  canAccessConjugatedAlerts,
} = {}) {
  const headers = ownerId ? { "X-Owner-Client-Id": ownerId } : undefined;
  const requests = [
    CoreApi.listVehicles({ params: { accessible: true }, headers }).catch(() => []),
    canAccessMonitoring
      ? safeApi.get(API_ROUTES.lastPositions, {
          headers,
          suppressForbidden: true,
          forbiddenFallbackData: [],
        })
      : Promise.resolve({ data: [] }),
    canAccessMonitoring && canAccessAlerts
      ? safeApi.get(API_ROUTES.alerts, {
          params: { status: "pending" },
          headers,
          suppressForbidden: true,
          forbiddenFallbackData: [],
        })
      : Promise.resolve({ data: [] }),
    canAccessMonitoring && canAccessConjugatedAlerts
      ? safeApi.get(API_ROUTES.alertsConjugated, {
          params: { windowHours: 5 },
          headers,
          suppressForbidden: true,
          forbiddenFallbackData: [],
        })
      : Promise.resolve({ data: [] }),
    canAccessMonitoring
      ? CoreApi.listTasks({ params: {}, headers }).catch(() => [])
      : Promise.resolve([]),
  ];

  const [vehicles, positionsResponse, alertsResponse, conjugatedResponse, tasksResponse] = await Promise.all(requests);
  return {
    vehicles: Array.isArray(vehicles) ? vehicles : [],
    positions: normalizePositionsPayload(positionsResponse?.data),
    alerts: normalizeAlertsPayload(alertsResponse?.data),
    conjugatedAlerts: normalizeAlertsPayload(conjugatedResponse?.data),
    tasks: normalizeTasksPayload(tasksResponse),
  };
}

async function fetchMirrorAllBundle({
  ownerIds,
  canAccessMonitoring,
  canAccessAlerts,
  canAccessConjugatedAlerts,
} = {}) {
  if (!Array.isArray(ownerIds) || ownerIds.length === 0) {
    return {
      vehicles: [],
      positions: [],
      alerts: [],
      conjugatedAlerts: [],
      tasks: [],
      partial: false,
    };
  }

  const results = await Promise.allSettled(
    ownerIds.map((ownerId) =>
      fetchMirrorOwnerBundle({
        ownerId,
        canAccessMonitoring,
        canAccessAlerts,
        canAccessConjugatedAlerts,
      }),
    ),
  );

  const bundles = [];
  let failed = 0;
  results.forEach((result) => {
    if (result.status === "fulfilled" && result.value) {
      bundles.push(result.value);
    } else {
      failed += 1;
    }
  });

  const vehicles = dedupeById(
    bundles.flatMap((bundle) => bundle.vehicles || []),
    (item) => resolveEntityId(item),
  );
  const positions = dedupeByDevice(bundles.flatMap((bundle) => bundle.positions || []));
  const alerts = dedupeById(
    bundles.flatMap((bundle) => bundle.alerts || []),
    (item, index) => resolveEntityId(item, `alert-${index}`),
  );
  const conjugatedAlerts = dedupeById(
    bundles.flatMap((bundle) => bundle.conjugatedAlerts || []),
    (item, index) => resolveEntityId(item, `conj-${index}`),
  );
  const tasks = dedupeById(
    bundles.flatMap((bundle) => bundle.tasks || []),
    (item, index) => resolveEntityId(item, `task-${index}`),
  );

  return {
    vehicles,
    positions,
    alerts,
    conjugatedAlerts,
    tasks,
    partial: failed > 0,
  };
}

async function fetchMirrorOwnerBundleSafe({
  ownerId,
  canAccessMonitoring,
  canAccessAlerts,
  canAccessConjugatedAlerts,
} = {}) {
  if (!ownerId) {
    return {
      vehicles: [],
      positions: [],
      alerts: [],
      conjugatedAlerts: [],
      tasks: [],
      partial: false,
    };
  }
  const bundle = await fetchMirrorOwnerBundle({
    ownerId,
    canAccessMonitoring,
    canAccessAlerts,
    canAccessConjugatedAlerts,
  });
  return { ...bundle, partial: false };
}
export default function Home() {
  const { t, locale } = useTranslation();
  const {
    tenantId,
    tenant,
    canAccess,
    mirrorContextMode,
    activeMirrorOwnerClientId,
    mirrorOwners,
  } = useTenant();
  const [selectedCard, setSelectedCard] = useState(null);
  const canAccessMonitoring = canAccess("primary", "monitoring");
  const canAccessAlerts = canAccess("primary", "monitoring", "alerts");
  const canAccessConjugatedAlerts = canAccess("primary", "monitoring", "alerts-conjugated");
  const mirrorOwnerIds = useMemo(
    () =>
      Array.isArray(mirrorOwners)
        ? mirrorOwners.map((owner) => String(owner.id)).filter(Boolean)
        : [],
    [mirrorOwners],
  );
  const mirrorOwnersKey = useMemo(() => mirrorOwnerIds.join("|"), [mirrorOwnerIds]);
  const isMirrorAll =
    mirrorContextMode === "target" &&
    String(activeMirrorOwnerClientId ?? "") === "all";
  const mirrorOwnerTenantId =
    mirrorContextMode === "target" &&
    activeMirrorOwnerClientId &&
    String(activeMirrorOwnerClientId) !== "all"
      ? String(activeMirrorOwnerClientId)
      : null;
  const canAggregateMirrorAll = isMirrorAll && mirrorOwnerIds.length > 0;
  const canAggregateMirrorOwner = Boolean(
    mirrorContextMode === "target" && mirrorOwnerTenantId && !isMirrorAll,
  );
  const effectiveTenantId = isMirrorAll ? null : (mirrorOwnerTenantId || tenantId);
  const tasksTenantOverride = isMirrorAll ? null : undefined;
  const pendingAlertParams = useMemo(() => ({ status: "pending" }), []);
  const conjugatedAlertParams = useMemo(() => ({ windowHours: 5 }), []);

  const { vehicles, loading: loadingVehicles } = useVehicles({ enabled: canAccessMonitoring });
  const { data: positions = [], loading: loadingPositions, fetchedAt: telemetryFetchedAt } = useLivePositions({
    enabled: canAccessMonitoring,
  });
  const taskParams = useMemo(
    () => (effectiveTenantId ? { clientId: effectiveTenantId } : {}),
    [effectiveTenantId],
  );
  const { tasks } = useTasks(taskParams, {
    enabled: canAccessMonitoring,
    tenantIdOverride: tasksTenantOverride,
  });
  const { alerts: pendingAlerts, loading: pendingAlertsLoading } = useAlerts({
    params: pendingAlertParams,
    enabled: canAccessMonitoring && canAccessAlerts,
  });
  const { alerts: conjugatedAlerts, loading: conjugatedAlertsLoading } = useConjugatedAlerts({
    params: conjugatedAlertParams,
    enabled: canAccessMonitoring && canAccessConjugatedAlerts,
  });
  const mirrorAllPolling = usePolling(
    useCallback(
      () =>
        fetchMirrorAllBundle({
          ownerIds: mirrorOwnerIds,
          canAccessMonitoring,
          canAccessAlerts,
          canAccessConjugatedAlerts,
        }),
      [mirrorOwnerIds, canAccessMonitoring, canAccessAlerts, canAccessConjugatedAlerts],
    ),
    {
      enabled: canAggregateMirrorAll && canAccessMonitoring,
      intervalMs: 60_000,
      dependencies: [
        canAggregateMirrorAll,
        canAccessMonitoring,
        mirrorOwnersKey,
        canAccessAlerts,
        canAccessConjugatedAlerts,
      ],
      resetOnChange: true,
    },
  );
  const mirrorOwnerPolling = usePolling(
    useCallback(
      () =>
        fetchMirrorOwnerBundleSafe({
          ownerId: mirrorOwnerTenantId,
          canAccessMonitoring,
          canAccessAlerts,
          canAccessConjugatedAlerts,
        }),
      [mirrorOwnerTenantId, canAccessMonitoring, canAccessAlerts, canAccessConjugatedAlerts],
    ),
    {
      enabled: canAggregateMirrorOwner && canAccessMonitoring,
      intervalMs: 60_000,
      dependencies: [
        canAggregateMirrorOwner,
        mirrorOwnerTenantId,
        canAccessMonitoring,
        canAccessAlerts,
        canAccessConjugatedAlerts,
      ],
      resetOnChange: true,
    },
  );
  const activeMirrorPolling = isMirrorAll ? mirrorAllPolling : mirrorOwnerPolling;
  const mirrorBundle = activeMirrorPolling.data;
  const hasMirrorBundle = Boolean(
    (isMirrorAll ? canAggregateMirrorAll : canAggregateMirrorOwner) &&
      mirrorBundle &&
      !activeMirrorPolling.error,
  );
  const mirrorPartial = Boolean(
    (canAggregateMirrorAll || canAggregateMirrorOwner) &&
      (activeMirrorPolling.error || mirrorBundle?.partial),
  );
  const effectiveVehicles = hasMirrorBundle ? mirrorBundle.vehicles : vehicles;
  const effectivePositions = hasMirrorBundle ? mirrorBundle.positions : positions;
  const effectiveTasks = hasMirrorBundle ? mirrorBundle.tasks : tasks;
  const effectivePendingAlerts = hasMirrorBundle ? mirrorBundle.alerts : pendingAlerts;
  const effectiveConjugatedAlerts = hasMirrorBundle
    ? mirrorBundle.conjugatedAlerts
    : conjugatedAlerts;
  const effectiveTelemetryFetchedAt = hasMirrorBundle
    ? activeMirrorPolling.lastUpdated
    : telemetryFetchedAt;
  const effectiveVehiclesLoading = (canAggregateMirrorAll || canAggregateMirrorOwner)
    ? activeMirrorPolling.loading
    : loadingVehicles;
  const effectivePositionsLoading = (canAggregateMirrorAll || canAggregateMirrorOwner)
    ? activeMirrorPolling.loading
    : loadingPositions;
  const effectiveAlertsLoading = (canAggregateMirrorAll || canAggregateMirrorOwner)
    ? activeMirrorPolling.loading
    : pendingAlertsLoading;
  const effectiveConjugatedLoading = (canAggregateMirrorAll || canAggregateMirrorOwner)
    ? activeMirrorPolling.loading
    : conjugatedAlertsLoading;

  const positionByDevice = useMemo(() => {
    const map = new Map();
    effectivePositions.forEach((position) => {
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
  }, [effectivePositions]);

  const vehicleByDeviceId = useMemo(() => {
    const map = new Map();
    effectiveVehicles.forEach((vehicle) => {
      normalizeVehicleDevices(vehicle).forEach((device) => {
        const key = getDeviceKey(device);
        if (key) map.set(String(key), vehicle);
      });
    });
    return map;
  }, [effectiveVehicles]);

  const vehicleTelemetry = useMemo(
    () =>
      effectiveVehicles.map((vehicle) => {
        const devices = normalizeVehicleDevices(vehicle);
        const primaryKey = vehicle.primaryDeviceId ? String(vehicle.primaryDeviceId) : null;
        let primaryDevice = primaryKey
          ? devices.find((device) => getDeviceKey(device) === primaryKey)
          : null;

        if (!primaryDevice && devices.length) {
          let newestDevice = null;
          let newestTime = null;
          devices.forEach((device) => {
            const key = getDeviceKey(device);
            if (!key) return;
            const position = positionByDevice.get(String(key));
            const timestamp = parsePositionTime(position);
            if (!timestamp) return;
            if (!newestTime || timestamp > newestTime) {
              newestTime = timestamp;
              newestDevice = device;
            }
          });
          primaryDevice = newestDevice ?? devices[0] ?? null;
        }

        const deviceKey = primaryDevice ? getDeviceKey(primaryDevice) : null;
        const position = deviceKey ? positionByDevice.get(String(deviceKey)) : null;
        return { vehicle, device: primaryDevice, deviceKey, position };
      }),
    [effectiveVehicles, positionByDevice],
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

  const tenantFallbackId = effectiveTenantId ?? null;

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
    return effectivePositions
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
  }, [deviceTenantMap, effectivePositions, linkedVehicles, tenantFallbackId]);

  const { summary, table } = useMemo(() => {
    const { rows, stats } = buildFleetState(fleetDevices, fleetPositions, { tenantId: effectiveTenantId });
    return { summary: stats, table: rows };
  }, [effectiveTenantId, fleetDevices, fleetPositions]);

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
    () => buildRouteMetrics(decoratedTable, effectiveTasks, vehicleByDeviceId),
    [decoratedTable, effectiveTasks, vehicleByDeviceId],
  );

  const showTelemetryWarning = useMemo(
    () =>
      canAccessMonitoring &&
      !effectivePositionsLoading &&
      Array.isArray(effectiveVehicles) &&
      effectiveVehicles.length > 0 &&
      (!Array.isArray(effectivePositions) || effectivePositions.length === 0),
    [canAccessMonitoring, effectivePositions, effectivePositionsLoading, effectiveVehicles],
  );
  const telemetryAlert = useMemo(() => {
    if (!showTelemetryWarning) return null;
    const tenantLabel = tenant?.name || "cliente";
    return {
      id: `telemetry-missing:${tenantId ?? "all"}`,
      deviceId: null,
      vehicleLabel: tenantLabel,
      vehicleId: tenantId ?? null,
      plate: null,
      createdAt: new Date().toISOString(),
      eventLabel: "Sem telemetria recente",
      address: "Sem posição disponível",
      severity: "Info",
      system: true,
    };
  }, [showTelemetryWarning, tenant?.name, tenantId]);
  const alertRows = useMemo(() => {
    const base = Array.isArray(effectivePendingAlerts) ? effectivePendingAlerts : [];
    if (!telemetryAlert || !canAccessAlerts) return base;
    return [telemetryAlert, ...base];
  }, [canAccessAlerts, effectivePendingAlerts, telemetryAlert]);
  const conjugatedAlertRows = useMemo(() => effectiveConjugatedAlerts, [effectiveConjugatedAlerts]);


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
      {!canAccessMonitoring ? (
        <div className="py-6">
          <DataState state="info" tone="muted" title="Sem permissão para monitoramento" />
        </div>
      ) : (
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
                  <td className="py-2 pr-4 text-white">{bucket.vehicles.length === 0 ? "0" : bucket.vehicles.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
      {!canAccessMonitoring ? (
        <div className="py-6">
          <DataState state="info" tone="muted" title="Sem permissão para monitoramento" />
        </div>
      ) : (
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
      )}
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
        <Link to="/monitoring?filter=alerts" className="text-xs font-semibold text-primary">
          Ver no monitoramento
        </Link>
      )}
      className={expanded ? "xl:col-span-2" : ""}
    >
      {!canAccessMonitoring ? (
        <div className="py-6">
          <DataState state="info" tone="muted" title="Sem permissão para ver alertas" />
        </div>
      ) : alertRows.length === 0 ? (
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
                  onClick={() =>
                    window.open(
                      `/monitoring?filter=alerts&deviceId=${row.deviceId ?? ""}`,
                      "_blank",
                    )
                  }
                >
                  <td className="py-2 pr-4 text-white/80">
                    {row.vehicleLabel || row.plate || row.vehicleId || "—"}
                  </td>
                  <td className="py-2 pr-4 text-white/70">{formatDate(row.createdAt, locale)}</td>
                  <td className="py-2 pr-4 text-white/70">
                    {row.eventLabel || "Alerta pendente"}
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

  const renderCriticalSummary = (expanded = false) => (
    <Card
      title="Alertas conjugados"
      subtitle="Alertas graves/críticos das últimas 5 horas"
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
      {!canAccessMonitoring ? (
        <div className="py-6">
          <DataState state="info" tone="muted" title="Sem permissão para ver alertas conjugados" />
        </div>
      ) : conjugatedAlertRows.length === 0 ? (
        <div className="py-6">
          <DataState state="empty" tone="muted" title="Nenhum alerta crítico nas últimas 5 horas" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-white/40">
              <tr className="border-b border-white/10 text-left">
                <th className="py-2 pr-4">Veículo</th>
                <th className="py-2 pr-4">Data/Hora</th>
                <th className="py-2 pr-4">Evento</th>
                <th className="py-2 pr-4">Local</th>
                <th className="py-2 pr-4">Severidade</th>
              </tr>
            </thead>
            <tbody>
              {conjugatedAlertRows.slice(0, expanded ? conjugatedAlertRows.length : 8).map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-b border-white/5 hover:bg-white/5"
                  onClick={() =>
                    window.open(
                      `/monitoring?filter=conjugated&deviceId=${row.deviceId ?? ""}`,
                      "_blank",
                    )
                  }
                >
                  <td className="py-2 pr-4 text-white/80">
                    {row.vehicleLabel || row.plate || row.vehicleId || "—"}
                  </td>
                  <td className="py-2 pr-4 text-white/70">{formatDate(row.eventTime, locale)}</td>
                  <td className="py-2 pr-4 text-white/70">{row.eventLabel || "—"}</td>
                  <td className="py-2 pr-4 text-white/70">{formatAddress(row.address)}</td>
                  <td className="py-2 pr-4 text-white/70">{row.severity || "Crítica"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );

  const renderSummaries = () => {
    if (selectedCard === "monitored") return renderCommunicationSummary(true);
    if (selectedCard === "route") return renderRouteSummary(true);
    if (selectedCard === "alert") return renderAlertSummary(true);
    if (selectedCard === "critical") return renderCriticalSummary(true);

    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {renderCommunicationSummary()}
        {renderRouteSummary()}
        {renderAlertSummary()}
        {renderCriticalSummary()}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader />
      {mirrorPartial && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Alguns espelhados nao responderam. Os totais exibidos podem estar incompletos.
        </div>
      )}
      {showTelemetryWarning && (
        <div className="rounded-2xl border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          Sem telemetria recente para {tenant?.name || "este cliente"}. Os veículos podem aparecer como offline.
        </div>
      )}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("home.vehiclesMonitored")}
          value={effectiveVehiclesLoading ? "…" : summary.total}
          hint={t("home.syncedAt", {
            time: effectiveTelemetryFetchedAt
              ? new Date(effectiveTelemetryFetchedAt).toLocaleTimeString(locale)
              : "—",
          })}
          onClick={() => setSelectedCard("monitored")}
        />
        <StatCard
          title={t("home.inRoute")}
          value={!canAccessMonitoring ? "—" : effectivePositionsLoading ? "…" : routeMetrics.totalWithRoute}
          hint={t("home.onRouteHint", { percent: percentage(routeMetrics.totalWithRoute, summary.total) })}
          onClick={canAccessMonitoring ? () => setSelectedCard("route") : undefined}
        />
        <StatCard
          title={t("home.inAlertTitle")}
          value={!canAccessMonitoring ? "—" : effectiveAlertsLoading ? "…" : alertRows.length}
          hint="Alertas ativos no monitoramento"
          variant="alert"
          onClick={canAccessMonitoring ? () => setSelectedCard("alert") : undefined}
        />
        <StatCard
          title="Alertas conjugados"
          value={!canAccessMonitoring ? "—" : effectiveConjugatedLoading ? "…" : conjugatedAlertRows.length}
          hint="Alertas graves/críticos nas últimas 5 horas"
          variant="alert"
          onClick={canAccessMonitoring ? () => setSelectedCard("critical") : undefined}
        />
      </section>

      {renderSummaries()}
    </div>
  );

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
