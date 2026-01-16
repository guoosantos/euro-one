import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function ServiceOrderNew() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    osInternalId: "",
    vehiclePlate: "",
    technicianName: "",
    responsibleName: "",
    responsiblePhone: "",
    address: "",
    type: "",
    reason: "",
    equipmentsText: "",
    startAt: "",
  });

  const setField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const submit = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/core/service-orders", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
          status: "SOLICITADA",
        }),
      });

      const payload = await response.json();
      if (!payload?.ok) {
        throw new Error(payload?.error || "Falha ao criar OS");
      }

      navigate(`/services/${payload.item.id}`);
    } catch (error) {
      console.error("Falha ao criar ordem de serviço", error);
      alert("Falha ao criar OS.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-lg font-semibold text-white">Nova OS</div>
          <p className="text-sm text-white/60">
            Crie a solicitação e avance o status conforme a execução.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>
          {saving ? "Salvando..." : "Criar OS"}
        </button>
      </div>

      <div className="card grid gap-4 md:grid-cols-2">
        <Field label="OS (ID interno)">
          <input
            value={form.osInternalId}
            onChange={(event) => setField("osInternalId", event.target.value)}
            className="input"
            placeholder="Ex: OS-000123"
          />
        </Field>

        <Field label="Placa do veículo">
          <input
            value={form.vehiclePlate}
            onChange={(event) => setField("vehiclePlate", event.target.value)}
            className="input"
            placeholder="Ex: RNV5F12"
          />
        </Field>

        <Field label="Técnico responsável">
          <input
            value={form.technicianName}
            onChange={(event) => setField("technicianName", event.target.value)}
            className="input"
            placeholder="Ex: Lucas Lima"
          />
        </Field>

        <Field label="Tipo">
          <input
            value={form.type}
            onChange={(event) => setField("type", event.target.value)}
            className="input"
            placeholder="Instalação, manutenção, retirada..."
          />
        </Field>

        <Field label="Contato (responsável)">
          <input
            value={form.responsibleName}
            onChange={(event) => setField("responsibleName", event.target.value)}
            className="input"
            placeholder="Nome do responsável"
          />
        </Field>

        <Field label="Telefone">
          <input
            value={form.responsiblePhone}
            onChange={(event) => setField("responsiblePhone", event.target.value)}
            className="input"
            placeholder="(31) 99999-9999"
          />
        </Field>

        <Field label="Data/Hora (início)">
          <input
            type="datetime-local"
            value={form.startAt}
            onChange={(event) => setField("startAt", event.target.value)}
            className="input"
          />
        </Field>

        <Field label="Endereço">
          <input
            value={form.address}
            onChange={(event) => setField("address", event.target.value)}
            className="input"
            placeholder="Rua, número, bairro, cidade/UF"
          />
        </Field>

        <Field label="Descrição do serviço" full>
          <textarea
            value={form.reason}
            onChange={(event) => setField("reason", event.target.value)}
            className="input min-h-[120px]"
            placeholder="Instalação / manutenção / retirada..."
          />
        </Field>

        <Field label="Equipamentos (texto livre)" full>
          <textarea
            value={form.equipmentsText}
            onChange={(event) => setField("equipmentsText", event.target.value)}
            className="input min-h-[100px]"
            placeholder="IDs, modelos, observações..."
          />
        </Field>
      </div>
    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <label className={full ? "md:col-span-2" : ""}>
      <div className="text-xs text-white/60 mb-2">{label}</div>
      {children}
    </label>
  );
}
