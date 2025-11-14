import React, { useMemo } from "react";

import LeafletMap from "../components/LeafletMap";
import { useTenant } from "../lib/tenant-context";
import { vehicles } from "../mock/fleet";

export default function Monitoramento() {
  const { tenantId } = useTenant();

  const markers = useMemo(
    () =>
      vehicles
        .filter((vehicle) => vehicle.tenantId === tenantId)
        .map((vehicle) => ({ lat: vehicle.lat, lng: vehicle.lng, label: `${vehicle.name} (${vehicle.plate})` })),
    [tenantId],
  );

  return <LeafletMap markers={markers} />;
}
