import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

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

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export default function ServiceOrdersList() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (q) params.set("q", q);

      const response = await fetch(`/api/core/service-orders?${params.toString()}`, {
        credentials: "include",
      });
      const payload = await response.json();
      setItems(payload?.items || []);
    } catch (error) {
      console.error("Falha ao buscar ordens de serviço", error);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const filtered = useMemo(() => {
    if (!q) return items;
    const term = q.toLowerCase();
    return items.filter((item) => {
      const values = [
        item.osInternalId,
        item.vehicle?.plate,
        item.vehicle?.name,
        item.responsibleName,
        item.responsiblePhone,
        item.technicianName,
        item.reason,
      ];
      return values.some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [items, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-lg font-semibold text-white">Ordens de Serviço</div>
          <p className="text-sm text-white/60">Solicitações, execução e aprovação das OS.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn" to="/services/import">
            Importar XLSX
          </Link>
          <Link className="btn btn-primary" to="/services/new">
            Nova OS
          </Link>
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Buscar por OS, placa, contato, técnico..."
            className="input md:w-96"
          />

          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="input md:w-64"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button type="button" onClick={fetchOrders} className="btn">
            Atualizar
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-white/50">
              <tr className="border-b border-white/10 text-left">
                <th className="py-2 pr-4">OS</th>
                <th className="py-2 pr-4">Placa</th>
                <th className="py-2 pr-4">Responsável</th>
                <th className="py-2 pr-4">Técnico</th>
                <th className="py-2 pr-4">Início</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="py-4 text-white/50" colSpan={7}>
                    Carregando...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-white/50">
                    Nenhuma ordem de serviço encontrada com os filtros atuais.
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.id} className="border-b border-white/5">
                    <td className="py-3 pr-4 font-medium text-white">
                      {item.osInternalId || item.id.slice(0, 8)}
                    </td>
                    <td className="py-3 pr-4">{item.vehicle?.plate || "—"}</td>
                    <td className="py-3 pr-4">
                      <div className="text-white">{item.responsibleName || "—"}</div>
                      <div className="text-xs text-white/50">{item.responsiblePhone || ""}</div>
                    </td>
                    <td className="py-3 pr-4">{item.technicianName || "—"}</td>
                    <td className="py-3 pr-4">{formatDate(item.startAt)}</td>
                    <td className="py-3 pr-4">
                      <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">
                        {item.status || "—"}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <Link className="btn" to={`/services/${item.id}`}>
                        Ver detalhes
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
