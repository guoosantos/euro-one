import React, { useMemo, useState } from "react";

const STATUS_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "SOLICITADA", label: "Solicitada" },
  { value: "AGENDADA", label: "Agendada" },
  { value: "EM_DESLOCAMENTO", label: "Em deslocamento" },
  { value: "EM_EXECUCAO", label: "Em execução" },
  { value: "AGUARDANDO_APROVACAO", label: "Aguardando aprovação" },
  { value: "CONCLUIDA", label: "Concluída" },
  { value: "CANCELADA", label: "Cancelada" },
  { value: "REMANEJADA", label: "Remanejada" },
];

export default function Services() {
  const [filters, setFilters] = useState({
    status: "",
    from: "",
    to: "",
    client: "",
    technician: "",
    vehicle: "",
  });

  const handleFilterChange = (event) => {
    const { name, value } = event.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  };

  const services = useMemo(() => [], []);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold text-white">Ordens de Serviço</div>
        <p className="text-sm text-white/60">
          Acompanhe solicitações, agendamentos e execuções de serviços.
        </p>
      </div>

      <div className="card space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs text-white/60">
            Status
            <select
              name="status"
              value={filters.status}
              onChange={handleFilterChange}
              className="input mt-1"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-white/60">
            Período (de)
            <input
              type="date"
              name="from"
              value={filters.from}
              onChange={handleFilterChange}
              className="input mt-1"
            />
          </label>

          <label className="text-xs text-white/60">
            Período (até)
            <input
              type="date"
              name="to"
              value={filters.to}
              onChange={handleFilterChange}
              className="input mt-1"
            />
          </label>

          <label className="text-xs text-white/60">
            Cliente
            <input
              type="text"
              name="client"
              value={filters.client}
              onChange={handleFilterChange}
              className="input mt-1"
              placeholder="Buscar por cliente"
            />
          </label>

          <label className="text-xs text-white/60">
            Técnico
            <input
              type="text"
              name="technician"
              value={filters.technician}
              onChange={handleFilterChange}
              className="input mt-1"
              placeholder="Buscar por técnico"
            />
          </label>

          <label className="text-xs text-white/60">
            Veículo/Placa
            <input
              type="text"
              name="vehicle"
              value={filters.vehicle}
              onChange={handleFilterChange}
              className="input mt-1"
              placeholder="Buscar por veículo ou placa"
            />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-white/50">
              <tr className="border-b border-white/10 text-left">
                <th className="py-2 pr-4">OS</th>
                <th className="py-2 pr-4">Cliente</th>
                <th className="py-2 pr-4">Veículo</th>
                <th className="py-2 pr-4">Técnico</th>
                <th className="py-2 pr-4">Data</th>
                <th className="py-2 pr-4">Status</th>
              </tr>
            </thead>

            <tbody>
              {services.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-white/50">
                    Nenhuma ordem de serviço encontrada com os filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
