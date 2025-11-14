import React, { useMemo } from "react";

import { useTenant } from "../lib/tenant-context";
import { euroViewFaces, vehicles } from "../mock/fleet";

export default function Face() {
  const { tenantId } = useTenant();

  const list = useMemo(
    () =>
      euroViewFaces
        .filter((face) => face.tenantId === tenantId)
        .map((face) => ({
          ...face,
          vehicle: vehicles.find((item) => item.id === face.vehicleId),
        })),
    [tenantId],
  );

  return (
    <div className="space-y-3">
      {list.map((face) => (
        <article key={face.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-white">{face.subject}</div>
              <div className="text-xs text-white/50">
                {face.vehicle?.name ?? face.vehicleId} · {new Date(face.capturedAt).toLocaleString()}
              </div>
            </div>
            <div className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">Match {face.match}%</div>
          </div>
          <div className="mt-3 text-xs text-white/60">Status: {face.status}</div>
        </article>
      ))}
      {!list.length && <div className="text-sm text-white/50">Nenhum reconhecimento registrado.</div>}
    </div>
  );
}
