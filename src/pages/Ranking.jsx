import React, { useMemo } from "react";

import { useTenant } from "../lib/tenant-context";
import { vehicles } from "../mock/fleet";

export default function Ranking() {
  const { tenantId } = useTenant();

  const ranking = useMemo(
    () =>
      vehicles
        .filter((vehicle) => vehicle.tenantId === tenantId)
        .map((vehicle) => ({
          id: vehicle.id,
          name: vehicle.name,
          plate: vehicle.plate,
          km: vehicle.odometerKm,
          alerts: vehicle.alerts?.length ?? 0,
          status: vehicle.status,
        }))
        .sort((a, b) => b.km - a.km)
        .slice(0, 5),
    [tenantId],
  );

  return (
    <div className="space-y-3">
      {ranking.map((item, index) => (
        <div key={item.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-xl font-semibold text-white/70">#{index + 1}</span>
            <div>
              <div className="text-sm font-medium text-white">{item.name}</div>
              <div className="text-xs text-white/50">{item.plate}</div>
            </div>
          </div>
          <div className="text-xs text-white/60">{item.km.toLocaleString()} km · {item.alerts} alertas</div>
        </div>
      ))}
      {!ranking.length && <div className="text-sm text-white/50">Sem veículos classificados.</div>}
    </div>
  );
}
