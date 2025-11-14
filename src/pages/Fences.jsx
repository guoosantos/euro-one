import React, { useMemo } from "react";

import Field from "../ui/Field";
import { Table, Pager } from "../ui/Table";
import { useTenant } from "../lib/tenant-context";
import { geofences } from "../mock/fleet";

export default function Fences() {
  const { tenantId } = useTenant();

  const rows = useMemo(
    () =>
      geofences
        .filter((geofence) => geofence.tenantId === tenantId)
        .map((geofence) => [geofence.name, geofence.type, geofence.city, `${geofence.vehicles} veículos`, "Editar"]),
    [tenantId],
  );

  return (
    <div className="space-y-5">
      <Field label="Cercas inteligentes">
        <Table head={["Cerca", "Tipo", "Cidade", "Veículos", "Ações"]} rows={rows} />
        <Pager />
      </Field>
    </div>
  );
}
