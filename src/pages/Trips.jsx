import React, { useMemo, useState } from "react";

import LeafletMap from "../components/LeafletMap";
import PageHeader from "../ui/PageHeader";
import Input from "../ui/Input";
import Button from "../ui/Button";
import { Table, Pager } from "../ui/Table";
import { useTenant } from "../lib/tenant-context";
import { trips, vehicles } from "../mock/fleet";

export default function Trips() {
  const { tenantId } = useTenant();
  const [selectedId, setSelectedId] = useState(null);

  const tenantTrips = useMemo(() => trips.filter((trip) => trip.tenantId === tenantId), [tenantId]);
  const rows = useMemo(
    () =>
      tenantTrips.map((trip) => {
        const vehicle = vehicles.find((item) => item.id === trip.vehicleId);
        return [
          vehicle?.name ?? trip.vehicleId,
          new Date(trip.start).toLocaleString(),
          new Date(trip.end).toLocaleString(),
          `${trip.distanceKm} km`,
          `${trip.alerts} alertas`,
        ];
      }),
    [tenantTrips],
  );

  const activeTrip = useMemo(() => tenantTrips.find((trip) => trip.id === selectedId) ?? tenantTrips[0] ?? null, [tenantTrips, selectedId]);
  const activeVehicle = useMemo(
    () => (activeTrip ? vehicles.find((vehicle) => vehicle.id === activeTrip.vehicleId) ?? null : null),
    [activeTrip],
  );

  const markers = useMemo(() => {
    if (!activeVehicle) return [];
    return [
      {
        lat: activeVehicle.lat,
        lng: activeVehicle.lng,
        label: `${activeVehicle.name} · ${activeVehicle.plate}`,
      },
    ];
  }, [activeVehicle]);

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
                  {new Date(activeTrip.start).toLocaleString()} → {new Date(activeTrip.end).toLocaleString()}
                </div>
              )}
            </div>
            {activeTrip && <div className="text-xs text-white/60">{activeTrip.distanceKm} km</div>}
          </div>

          <LeafletMap markers={markers} />

          {activeTrip ? (
            <div className="grid grid-cols-2 gap-3 text-xs text-white/70">
              <div>
                <div className="text-white/50">Tempo total</div>
                <div className="text-white/80">{Math.round(activeTrip.durationMin / 60)}h</div>
              </div>
              <div>
                <div className="text-white/50">Vel. média</div>
                <div className="text-white/80">{activeTrip.avgSpeed} km/h</div>
              </div>
              <div>
                <div className="text-white/50">Paradas</div>
                <div className="text-white/80">{activeTrip.stops}</div>
              </div>
              <div>
                <div className="text-white/50">Alertas</div>
                <div className="text-white/80">{activeTrip.alerts}</div>
              </div>
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
