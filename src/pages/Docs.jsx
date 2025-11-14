import React, { useMemo } from "react";

import Field from "../ui/Field";
import { Table, Pager } from "../ui/Table";
import { useTenant } from "../lib/tenant-context";
import { documents, vehicles } from "../mock/fleet";

export default function Docs() {
  const { tenantId } = useTenant();

  const rows = useMemo(
    () =>
      documents
        .filter((document) => document.tenantId === tenantId)
        .map((document) => {
          const vehicle = vehicles.find((item) => item.id === document.vehicleId);
          return [
            document.type,
            vehicle?.plate ?? "—",
            new Date(document.expiresAt).toLocaleDateString(),
            document.status,
            "Download",
          ];
        }),
    [tenantId],
  );

  return (
    <div className="space-y-5">
      <Field label="Documentação da frota">
        <Table head={["Documento", "Placa", "Vencimento", "Status", "Ações"]} rows={rows} />
        <Pager />
      </Field>
    </div>
  );
}
