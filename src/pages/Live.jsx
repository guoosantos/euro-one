import React, { useMemo } from "react";

import { useTenant } from "../lib/tenant-context";
import { euroViewLive, vehicles } from "../mock/fleet";

export default function Live() {
  const { tenantId } = useTenant();

  const list = useMemo(
    () =>
      euroViewLive
        .filter((stream) => stream.tenantId === tenantId)
        .map((stream) => ({
          ...stream,
          vehicle: vehicles.find((item) => item.id === stream.vehicleId),
        })),
    [tenantId],
  );

  return (
    <div className="space-y-3">
      {list.map((stream) => (
        <article key={stream.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-white">{stream.title}</div>
              <div className="text-xs text-white/50">{stream.vehicle?.name ?? stream.vehicleId}</div>
            </div>
            <div className="rounded-full px-3 py-1 text-xs" data-status={stream.status}>
              {stream.status === "online" ? "Ao vivo" : "Offline"}
            </div>
          </div>
          <div className="mt-2 text-xs text-white/60">Bitrate atual: {stream.bitrate}</div>
          <button type="button" className="mt-3 rounded-xl border border-white/20 px-3 py-2 text-xs text-white/80">
            Abrir player
          </button>
        </article>
      ))}
      {!list.length && <div className="text-sm text-white/50">Nenhuma câmera conectada.</div>}
    </div>
  );
}
