import React from "react";
import { Link } from "react-router-dom";

import useTasks from "../lib/hooks/useTasks.js";
import { formatDate } from "../lib/fleet-utils.js";

export default function Tasks() {
  const { tasks, loading, error } = useTasks();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold text-white">Entregas / Coletas</div>
          <p className="text-sm text-white/60">Gerencie as tasks com status e horários previstos.</p>
        </div>
        <Link className="btn btn-primary" to="/tasks/new">
          Nova task
        </Link>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-white/50">
              <tr className="border-b border-white/10 text-left">
                <th className="py-2 pr-4">Endereço</th>
                <th className="py-2 pr-4">Veículo</th>
                <th className="py-2 pr-4">Tipo</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Início</th>
                <th className="py-2 pr-4">Fim</th>
                <th className="py-2 pr-4">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-white/50">
                    Carregando tasks…
                  </td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-red-200/80">
                    Não foi possível carregar tasks.
                  </td>
                </tr>
              )}
              {!loading && !error && tasks.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-white/50">
                    Nenhuma task cadastrada.
                  </td>
                </tr>
              )}
              {tasks.map((task) => (
                <tr key={task.id} className="border-b border-white/5">
                  <td className="py-2 pr-4 text-white/80">{task.address || "—"}</td>
                  <td className="py-2 pr-4 text-white/80">{task.vehicleId || "—"}</td>
                  <td className="py-2 pr-4 text-white/80">{task.type}</td>
                  <td className="py-2 pr-4 text-white/80">{task.status}</td>
                  <td className="py-2 pr-4 text-white/70">{task.startTimeExpected ? formatDate(task.startTimeExpected) : "—"}</td>
                  <td className="py-2 pr-4 text-white/70">{task.endTimeExpected ? formatDate(task.endTimeExpected) : "—"}</td>
                  <td className="py-2 pr-4 text-white/80">
                    <Link className="text-primary" to={`/tasks/${task.id}`}>
                      Detalhes
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
