import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import LeafletMap from "../components/LeafletMap";
import PageHeader from "../ui/PageHeader";
import Input from "../ui/Input";
import Button from "../ui/Button";
import { Table, Pager } from "../ui/Table";
import { useTenant } from "../lib/tenant-context";
import { useFleetDevices } from "../lib/useFleetDevices";
import { API } from "../lib/api";
import { trips as mockTrips, vehicles as mockVehicles } from "../mock/fleet";

export default function Trips() {
  const { tenantId } = useTenant();
  const [selectedId, setSelectedId] = useState(null);

  const { devices: fleetDevices } = useFleetDevices({
    autoRefresh: null,
    listRefresh: null,
    positionsRefresh: null,
    enableRealtime: false,
  });

  const tenantVehicles = useMemo(() => {
    if (fleetDevices.length) return fleetDevices;
    return mockVehicles.filter((vehicle) => vehicle.tenantId === tenantId);
  }, [fleetDevices, tenantId]);

  const tripsQuery = useQuery({
    queryKey: ["trips", tenantId],
    queryFn: async () => {
      const { data } = await API.trips.list({ tenantId, limit: 200 });
      return data;
    },
    enabled: Boolean(tenantId),
    staleTime: 120_000,
  });

  const remoteTrips = Array.isArray(tripsQuery.data) ? tripsQuery.data : [];
  const tenantTrips = useMemo(() => {
    if (remoteTrips.length) {
      return remoteTrips.map((trip) => normaliseTrip(trip, tenantId));
    }
    return mockTrips
      .filter((trip) => trip.tenantId === tenantId)
      .map((trip) => normaliseTrip(trip, tenantId));
  }, [remoteTrips, tenantId]);

  const rows = useMemo(
    () =>
      tenantTrips.map((trip) => {
        const vehicle = tenantVehicles.find((item) => String(item.id) === String(trip.vehicleId));
        return [
          vehicle?.name ?? trip.vehicleId,
          formatDateTime(trip.start),
          formatDateTime(trip.end),
          `${trip.distanceKm} km`,
          `${trip.alerts} alertas`,
        ];
      }),
    [tenantTrips, tenantVehicles],
  );

  const activeTrip = useMemo(
    () => tenantTrips.find((trip) => trip.id === selectedId) ?? tenantTrips[0] ?? null,
    [tenantTrips, selectedId],
  );

  const activeVehicle = useMemo(() => {
    if (!activeTrip) return null;
    return tenantVehicles.find((vehicle) => String(vehicle.id) === String(activeTrip.vehicleId)) ?? null;
  }, [activeTrip, tenantVehicles]);

  const markers = useMemo(() => {
    if (!activeTrip || !activeTrip.path?.length) {
      if (!activeVehicle) return [];
      return [
        {
          lat: activeVehicle.lat,
          lng: activeVehicle.lng,
          label: `${activeVehicle.name} · ${activeVehicle.plate ?? activeVehicle.id}`,
        },
      ];
    }
    return activeTrip.path
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
      .map((point, index) => ({
        id: `${activeTrip.id}-${index}`,
        lat: point.lat,
        lng: point.lng,
        label: `${formatDateTime(point.time)} · ${Math.round(point.speed ?? 0)} km/h`,
      }));
  }, [activeTrip, activeVehicle]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Trajetos"
        subtitle="Reproduza percursos completos com métricas de paradas, velocidade e alertas."
        right={<Button>Exportar CSV</Button>}
      />

      <div className="card">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Input placeholder="Buscar veículo ou rota" />
          <Input type="date" />
          <Input type="date" />
          <label className="flex items-center gap-2 text-sm text-white/60">
            <input type="checkbox" className="accent-primary" /> Apenas com alertas
          </label>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="mb-2 font-medium text-white">Resultados</div>
          <Table
            head={["Veículo", "Início", "Fim", "Distância", "Alertas"]}
            rows={rows}
            onRowClick={(index) => setSelectedId(tenantTrips[index]?.id ?? null)}
          />
          <Pager />
        </div>

        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-white">{activeVehicle?.name ?? "Selecione um trajeto"}</div>
              {activeTrip && (
                <div className="text-xs text-white/50">
                  {formatDateTime(activeTrip.start)} → {formatDateTime(activeTrip.end)}
                </div>
              )}
            </div>
            {activeTrip && <div className="text-xs text-white/60">{activeTrip.distanceKm} km</div>}
          </div>

          <LeafletMap markers={markers} autoFit height={320} />

          {activeTrip ? (
            <div className="grid grid-cols-2 gap-3 text-xs text-white/70">
              <Metric label="Tempo total" value={formatDuration(activeTrip.durationMin)} />
              <Metric label="Vel. média" value={`${activeTrip.avgSpeed} km/h`} />
              <Metric label="Paradas" value={activeTrip.stops} />
              <Metric label="Alertas" value={activeTrip.alerts} />
            </div>
          ) : (
            <div className="text-sm text-white/50">Escolha um trajeto para visualizar detalhes.</div>
          )}

          <div className="flex items-center justify-between">
            <Button disabled={!activeTrip}>Reproduzir</Button>
            {activeTrip && <div className="text-xs text-white/50">1x</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <div className="text-white/50">{label}</div>
      <div className="text-white/80">{value}</div>
    </div>
  );
}

function formatDateTime(dateLike) {
  if (!dateLike) return "—";
  try {
    return new Date(dateLike).toLocaleString();
  } catch (error) {
    return String(dateLike);
  }
}

function formatDuration(minutes) {
  if (!minutes) return "0m";
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function normaliseTrip(trip, tenantId) {
  const start = trip.start ?? trip.startTime ?? trip.from ?? trip.begin;
  const end = trip.end ?? trip.endTime ?? trip.to ?? trip.finish;
  const distanceMeters = trip.distanceMeters ?? trip.distance ?? (trip.distanceKm ?? 0) * 1000;
  const distanceKm = Math.max(0, Number((distanceMeters / 1000).toFixed(1)));
  const durationMin =
    trip.durationMin ??
    (typeof trip.duration === "number" ? trip.duration / 60 : null) ??
    (start && end ? Math.max(0, (new Date(end) - new Date(start)) / 60000) : 0);
  const durationHours = durationMin ? durationMin / 60 : null;
  const computedAvg = durationHours ? distanceKm / durationHours : 0;

  return {
    id: trip.id ?? `${trip.deviceId ?? trip.vehicleId}-${start ?? Math.random()}`,
    tenantId: trip.tenantId ?? tenantId,
    vehicleId: trip.vehicleId ?? trip.deviceId ?? trip.device ?? trip.vehicle_id ?? null,
    start,
    end,
    durationMin,
    avgSpeed: Math.round(trip.avgSpeed ?? trip.averageSpeed ?? computedAvg),
    stops: trip.stops ?? trip.stopCount ?? 0,
    alerts: trip.alerts ?? trip.events ?? 0,
    distanceKm,
    path: Array.isArray(trip.path)
      ? trip.path.map((point) => ({
          lat: point.lat ?? point.latitude,
          lng: point.lng ?? point.longitude,
          time: point.time ?? point.deviceTime ?? point.fixTime,
          speed: point.speed,
        }))
      : [],
  };
}
