import React, { useMemo, useState } from "react";

import PageHeader from "../ui/PageHeader";
import Input from "../ui/Input";
import Button from "../ui/Button";
import Field from "../ui/Field";
import { Table, Pager } from "../ui/Table";
import VehicleModal from "../components/VehicleModal";
import { Search } from "lucide-react";
import { useTenant } from "../lib/tenant-context";
import { vehicles as fleetVehicles } from "../mock/fleet";

export default function Vehicles() {
  const { tenantId, tenant } = useTenant();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  const tenantVehicles = useMemo(() => fleetVehicles.filter((vehicle) => vehicle.tenantId === tenantId), [tenantId]);
  const filtered = useMemo(() => {
    if (!query.trim()) return tenantVehicles;
    const term = query.trim().toLowerCase();
    return tenantVehicles.filter((vehicle) =>
      [vehicle.name, vehicle.plate, vehicle.driver, vehicle.group]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(term)),
    );
  }, [query, tenantVehicles]);

  const rows = filtered.map((vehicle) => [
    vehicle.plate,
    vehicle.name,
    vehicle.driver ?? "—",
    vehicle.group ?? "—",
    vehicle.status,
    new Date(vehicle.lastUpdate).toLocaleString(),
    <div key={vehicle.id} className="flex justify-end gap-2">
      <Button
        onClick={() => {
          setSelected(vehicle);
          setOpen(true);
        }}
      >
        Detalhes
      </Button>
    </div>,
  ]);

  const modalData = selected
    ? {
        id: selected.id,
        cliente: tenant?.name ?? "",
        tipo: selected.type ?? "",
        placa: selected.plate ?? "",
        modelo: selected.name ?? "",
        grupo: selected.group ?? "",
        classificacao: "Operação",
        anoModelo: "2024",
        anoFabricacao: "2023",
        observacoes: selected.address ?? "",
      }
    : null;

  return (
    <div className="space-y-5">
      <PageHeader title="Veículos Euro" right={<Button onClick={() => setOpen(true)}>+ Novo veículo</Button>} />

      <Field label="Busca">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Input
            placeholder="Buscar (placa, VIN, marca, modelo, proprietário, grupo)"
            icon={Search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </Field>

      <div className="mt-3">
        <Field label="Resultados">
          <Table
            head={["PLACA", "VEÍCULO", "MOTORISTA", "GRUPO", "STATUS", "ATUALIZADO EM", "AÇÕES"]}
            rows={rows}
          />
          <Pager />
        </Field>
      </div>

      <VehicleModal
        open={open}
        mode={selected ? "edit" : "new"}
        initialData={modalData}
        onClose={() => {
          setOpen(false);
          setSelected(null);
        }}
        onSave={(payload) => {
          console.log("Salvar veículo", payload);
          setOpen(false);
        }}
        onLinkDevice={(vehicleId, imei) => console.log("Vincular", vehicleId, imei)}
        linkedDevice={""}
      />
    </div>
  );
}
