import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";

export default function TaskForm() {
  const navigate = useNavigate();
  const { tenantId, user } = useTenant();
  const [form, setForm] = useState({ type: "entrega", status: "pendente" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await CoreApi.createTask({ ...form, clientId: tenantId || user?.clientId });
      navigate("/tasks");
    } catch (err) {
      setError(err?.response?.data?.message || "Erro ao salvar task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-lg font-semibold text-white">Nova Task</div>
      <form onSubmit={handleSubmit} className="space-y-3 card p-4">
        {error && <div className="rounded-md bg-red-500/20 p-2 text-sm text-red-100">{error}</div>}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm text-white/70">
            Endereço
            <input
              className="input mt-1"
              name="address"
              placeholder="Endereço"
              value={form.address || ""}
              onChange={handleChange}
            />
          </label>
          <label className="text-sm text-white/70">
            Veículo
            <input
              className="input mt-1"
              name="vehicleId"
              placeholder="ID do veículo"
              value={form.vehicleId || ""}
              onChange={handleChange}
            />
          </label>
          <label className="text-sm text-white/70">
            Tipo
            <select className="input mt-1" name="type" value={form.type} onChange={handleChange}>
              <option value="entrega">Entrega</option>
              <option value="coleta">Coleta</option>
            </select>
          </label>
          <label className="text-sm text-white/70">
            Status
            <select className="input mt-1" name="status" value={form.status} onChange={handleChange}>
              <option value="pendente">Pendente</option>
              <option value="em rota">Em rota</option>
              <option value="em atendimento">Em atendimento</option>
              <option value="finalizada">Finalizada</option>
              <option value="atrasada">Atrasada</option>
              <option value="improdutiva">Improdutiva</option>
            </select>
          </label>
          <label className="text-sm text-white/70">
            Início previsto
            <input
              className="input mt-1"
              type="datetime-local"
              name="startTimeExpected"
              value={form.startTimeExpected || ""}
              onChange={handleChange}
            />
          </label>
          <label className="text-sm text-white/70">
            Fim previsto
            <input
              className="input mt-1"
              type="datetime-local"
              name="endTimeExpected"
              value={form.endTimeExpected || ""}
              onChange={handleChange}
            />
          </label>
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}
