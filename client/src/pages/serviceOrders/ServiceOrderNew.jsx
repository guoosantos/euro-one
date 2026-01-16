import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

import PageHeader from "../../components/ui/PageHeader.jsx";
import DataCard from "../../components/ui/DataCard.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";

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
    addressComplement: "",
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
    <div className="space-y-6">
      <PageHeader
        title="Nova OS"
        subtitle="Solicite o serviço e acompanhe o status."
        actions={
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-60"
          >
            {saving ? "Salvando..." : "Criar OS"}
          </button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <DataCard className="space-y-3">
          <h2 className="text-sm font-semibold text-white">Dados do agendamento</h2>
          <label className="block text-xs text-white/60">
            OS (ID interno)
            <input
              value={form.osInternalId}
              onChange={(event) => setField("osInternalId", event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              placeholder="Ex: OS-000123"
            />
          </label>
          <label className="block text-xs text-white/60">
            Data/hora pretendida
            <input
              type="datetime-local"
              value={form.startAt}
              onChange={(event) => setField("startAt", event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            />
          </label>
          <label className="block text-xs text-white/60">
            Técnico responsável
            <input
              value={form.technicianName}
              onChange={(event) => setField("technicianName", event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              placeholder="Ex: Lucas Lima"
            />
          </label>
          <label className="block text-xs text-white/60">
            Tipo
            <input
              value={form.type}
              onChange={(event) => setField("type", event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              placeholder="Instalação, manutenção, retirada..."
            />
          </label>
          <label className="block text-xs text-white/60">
            Observação do cliente
            <textarea
              value={form.reason}
              onChange={(event) => setField("reason", event.target.value)}
              className="mt-2 min-h-[120px] w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              placeholder="Detalhes importantes para a execução."
            />
          </label>
        </DataCard>

        <DataCard className="space-y-3">
          <h2 className="text-sm font-semibold text-white">Responsável no local</h2>
          <label className="block text-xs text-white/60">
            Nome
            <input
              value={form.responsibleName}
              onChange={(event) => setField("responsibleName", event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              placeholder="Nome do responsável"
            />
          </label>
          <label className="block text-xs text-white/60">
            Telefone/WhatsApp
            <input
              value={form.responsiblePhone}
              onChange={(event) => setField("responsiblePhone", event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              placeholder="(31) 99999-9999"
            />
          </label>
        </DataCard>

        <DataCard className="space-y-3">
          <h2 className="text-sm font-semibold text-white">Endereço</h2>
          <label className="block text-xs text-white/60">
            Endereço completo
            <input
              value={form.address}
              onChange={(event) => setField("address", event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              placeholder="Rua, número, bairro, cidade/UF"
            />
          </label>
          <label className="block text-xs text-white/60">
            Complemento (opcional)
            <input
              value={form.addressComplement}
              onChange={(event) => setField("addressComplement", event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              placeholder="Apto, bloco, referência"
            />
          </label>
        </DataCard>

        <DataCard className="space-y-3">
          <h2 className="text-sm font-semibold text-white">Veículo</h2>
          <label className="block text-xs text-white/60">
            Busca/seleção do veículo
            <input
              value={form.vehiclePlate}
              onChange={(event) => setField("vehiclePlate", event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              placeholder="Placa ou identificação"
            />
          </label>
          {form.vehiclePlate ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/70">
              <div className="font-semibold text-white">Placa informada</div>
              <div className="text-xs text-white/60">{form.vehiclePlate}</div>
            </div>
          ) : (
            <EmptyState title="Selecione um veículo para visualizar os equipamentos vinculados." />
          )}
          <label className="block text-xs text-white/60">
            Equipamentos vinculados (texto livre)
            <textarea
              value={form.equipmentsText}
              onChange={(event) => setField("equipmentsText", event.target.value)}
              className="mt-2 min-h-[100px] w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              placeholder="IDs, modelos, observações..."
            />
          </label>
        </DataCard>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-60"
        >
          {saving ? "Salvando..." : "Criar OS"}
        </button>
      </div>
    </div>
  );
}
