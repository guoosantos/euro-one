import React, { useMemo } from "react";

import Field from "../ui/Field";
import { Table, Pager } from "../ui/Table";
import { useTenant } from "../lib/tenant-context";
import { services, vehicles } from "../mock/fleet";

export default function Services() {
  const { tenantId } = useTenant();

  const rows = useMemo(
    () =>
      services
        .filter((service) => service.tenantId === tenantId)
        .map((service) => {
          const vehicle = vehicles.find((item) => item.id === service.vehicleId);
          return [
            service.type,
            vehicle?.plate ?? "—",
            service.status,
            service.workshop,
            service.dueDate,
          ];
        }),
    [tenantId],
  );

  return (
    <div className="space-y-5">
      <Field label="Manutenções e serviços">
        <Table head={["Serviço", "Placa", "Status", "Oficina", "Agendado para"]} rows={rows} />
        <Pager />
      </Field>
    </div>
  );
}
