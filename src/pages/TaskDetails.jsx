import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { CoreApi } from "../lib/coreApi.js";
import { formatDate } from "../lib/fleet-utils.js";

export default function TaskDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    CoreApi.listTasks({ id })
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.tasks) ? data.tasks : [];
        setTask(list.find((item) => String(item.id) === String(id)) || null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <div className="text-white">Carregando…</div>;
  if (error) return <div className="text-red-200">Erro ao carregar task.</div>;
  if (!task) return <div className="text-white">Task não encontrada.</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold text-white">Detalhes da Task</div>
          <div className="text-sm text-white/60">{task.address || "Sem endereço"}</div>
        </div>
        <button className="btn" onClick={() => navigate("/tasks")}>Voltar</button>
      </div>

      <div className="card space-y-2">
        <Detail label="Veículo" value={task.vehicleId || "—"} />
        <Detail label="Tipo" value={task.type} />
        <Detail label="Status" value={task.status} />
        <Detail label="Início previsto" value={task.startTimeExpected ? formatDate(task.startTimeExpected) : "—"} />
        <Detail label="Fim previsto" value={task.endTimeExpected ? formatDate(task.endTimeExpected) : "—"} />
        <Detail label="Criado em" value={task.createdAt ? formatDate(task.createdAt) : "—"} />
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="flex justify-between text-sm text-white/80">
      <span className="text-white/60">{label}</span>
      <span>{value}</span>
    </div>
  );
}
