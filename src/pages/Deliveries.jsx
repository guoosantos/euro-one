import React, { useMemo } from "react";

import Field from "../ui/Field";
import { Table, Pager } from "../ui/Table";
import { useTenant } from "../lib/tenant-context";
import { deliveries, vehicles } from "../mock/fleet";

export default function Deliveries() {
  const { tenantId } = useTenant();

  const rows = useMemo(
    () =>
      deliveries
        .filter((delivery) => delivery.tenantId === tenantId)
        .map((delivery) => {
          const vehicle = vehicles.find((item) => item.id === delivery.vehicleId);
          return [
            delivery.route,
            delivery.status,
            `${delivery.completed}/${delivery.total}`,
            vehicle?.plate ?? "—",
            new Date(delivery.eta).toLocaleString(),
          ];
        }),
    [tenantId],
  );

  return (
    <div className="space-y-5">
      <Field label="Rotas e entregas">
        <Table head={["Rota", "Status", "Concluído", "Veículo", "ETA"]} rows={rows} />
        <Pager />
      </Field>
    </div>
  );
}
