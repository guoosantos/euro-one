import React, { useMemo } from "react";

import Field from "../ui/Field";
import { Table, Pager } from "../ui/Table";
import { useTenant } from "../lib/tenant-context";
import { events, vehicles } from "../mock/fleet";

export default function Events() {
  const { tenantId } = useTenant();

  const rows = useMemo(
    () =>
      events
        .filter((event) => event.tenantId === tenantId)
        .map((event) => {
          const vehicle = vehicles.find((item) => item.id === event.deviceId);
          return [
            new Date(event.time).toLocaleString(),
            event.type,
            vehicle?.name ?? event.deviceId,
            event.severity,
          ];
        }),
    [tenantId],
  );

  return (
    <div className="space-y-5">
      <Field label="Eventos Euro View">
        <Table head={["Horário", "Evento", "Veículo", "Severidade"]} rows={rows} />
        <Pager />
      </Field>
    </div>
  );
}
