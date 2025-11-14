import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import PageHeader from "../ui/PageHeader";
import Input from "../ui/Input";
import Button from "../ui/Button";
import Field from "../ui/Field";
import { Table, Pager } from "../ui/Table";
import VehicleModal from "../components/VehicleModal";
import { Search } from "lucide-react";
import { useTenant } from "../lib/tenant-context";
import { API } from "../lib/api";
import { vehicles as mockVehicles } from "../mock/fleet";

export default function Vehicles() {
  const { tenantId, tenant } = useTenant();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  const vehiclesQuery = useQuery({
    queryKey: ["vehicles", tenantId],
    queryFn: async () => {
      const { data } = await API.vehicles.list({ tenantId, limit: 500 });
      return data;
    },
    enabled: Boolean(tenantId),
    staleTime: 180_000,
  });

  const remoteVehicles = Array.isArray(vehiclesQuery.data) ? vehiclesQuery.data : [];
  const allVehicles = useMemo(() => {
    if (remoteVehicles.length) {
      return remoteVehicles.map(normaliseVehicle);
    }
    return mockVehicles.filter((vehicle) => vehicle.tenantId === tenantId).map(normaliseVehicle);
  }, [remoteVehicles, tenantId]);

  const filtered = useMemo(() => {
    if (!query.trim()) return allVehicles;
    const term = query.trim().toLowerCase();
    return allVehicles.filter((vehicle) =>
      [vehicle.name, vehicle.plate, vehicle.driver, vehicle.group, vehicle.brand, vehicle.model]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(term)),
    );
  }, [allVehicles, query]);

  const rows = filtered.map((vehicle) => [
    vehicle.plate ?? "—",
    vehicle.name ?? "—",
    vehicle.driver ?? "—",
    vehicle.group ?? "—",
    vehicle.status ?? "—",
    vehicle.lastUpdate ? formatDateTime(vehicle.lastUpdate) : "—",
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
        modelo: selected.model ?? "",
        grupo: selected.group ?? "",
        classificacao: selected.segment ?? "Operação",
        anoModelo: selected.modelYear ?? "2024",
        anoFabricacao: selected.year ?? "2023",
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
        <Field label={`Resultados (${filtered.length})`}>
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
        linkedDevice={selected?.deviceId ?? ""}
      />
    </div>
  );
}

function normaliseVehicle(vehicle) {
  if (!vehicle) return {};
  return {
    id: String(vehicle.id ?? vehicle.vehicleId ?? vehicle.deviceId ?? Math.random()),
    tenantId: vehicle.tenantId,
    plate: vehicle.plate ?? vehicle.registration ?? vehicle.licensePlate ?? null,
    name: vehicle.name ?? vehicle.label ?? vehicle.alias ?? null,
    driver: vehicle.driver ?? vehicle.driverName ?? vehicle.operator ?? null,
    group: vehicle.group ?? vehicle.groupName ?? vehicle.segment ?? null,
    status: (vehicle.status ?? vehicle.deviceStatus ?? "").toString().toUpperCase(),
    lastUpdate: vehicle.lastUpdate ?? vehicle.updatedAt ?? vehicle.deviceLastUpdate ?? null,
    type: vehicle.type ?? vehicle.category ?? null,
    model: vehicle.model ?? vehicle.vehicleModel ?? null,
    brand: vehicle.brand ?? vehicle.manufacturer ?? null,
    segment: vehicle.segment ?? vehicle.group ?? null,
    address: vehicle.address ?? vehicle.lastAddress ?? null,
    modelYear: vehicle.modelYear ?? vehicle.year ?? null,
    year: vehicle.year ?? vehicle.manufactureYear ?? null,
    deviceId: vehicle.deviceId ?? vehicle.device?.id ?? null,
  };
}

function formatDateTime(dateLike) {
  if (!dateLike) return "—";
  try {
    return new Date(dateLike).toLocaleString();
  } catch (error) {
    return String(dateLike);
  }
}
