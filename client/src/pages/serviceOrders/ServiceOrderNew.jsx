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
    status: "SOLICITADA",
    addressStreet: "",
    addressNumber: "",
    addressNeighborhood: "",
    addressCity: "",
    addressState: "",
    addressComplement: "",
    addressReference: "",
    type: "",
    reason: "",
    equipmentsText: "",
    startAt: "",
    notes: "",
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
          address: [
            form.addressStreet,
            form.addressNumber,
            form.addressNeighborhood,
            form.addressCity,
            form.addressState,
            form.addressReference,
          ]
            .filter(Boolean)
            .join(", "),
          notes: form.notes,
          startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
          status: form.status || "SOLICITADA",
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

      <DataCard className="space-y-6">
        <div>
          <h2 className="text-sm font-semibold text-white">Dados básicos</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
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
              Data/hora
              <input
                type="datetime-local"
                value={form.startAt}
                onChange={(event) => setField("startAt", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-white/60">
              Status
              <select
                value={form.status}
                onChange={(event) => setField("status", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                <option value="SOLICITADA">Solicitada</option>
                <option value="AGENDADA">Agendada</option>
                <option value="EM_DESLOCAMENTO">Em deslocamento</option>
                <option value="EM_EXECUCAO">Em execução</option>
                <option value="AGUARDANDO_APROVACAO">Aguardando aprovação</option>
              </select>
            </label>
            <label className="block text-xs text-white/60 md:col-span-2">
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
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-white">Responsável</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
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
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-white">Veículo & Equipamentos</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="block text-xs text-white/60">
              Busca/seleção do veículo
              <input
                value={form.vehiclePlate}
                onChange={(event) => setField("vehiclePlate", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                placeholder="Placa ou identificação"
              />
            </label>
            <label className="block text-xs text-white/60">
              Equipamentos (IDs/modelos)
              <textarea
                value={form.equipmentsText}
                onChange={(event) => setField("equipmentsText", event.target.value)}
                className="mt-2 min-h-[90px] w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                placeholder="IDs, modelos, observações..."
              />
            </label>
          </div>
          {form.vehiclePlate ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/70">
              <div className="font-semibold text-white">Placa informada</div>
              <div className="text-xs text-white/60">{form.vehiclePlate}</div>
            </div>
          ) : (
            <div className="mt-3">
              <EmptyState title="Selecione um veículo para visualizar os equipamentos vinculados." />
            </div>
          )}
        </div>

        <div>
          <h2 className="text-sm font-semibold text-white">Checklist</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {["Alarme ativo", "Fiação ok", "GPS fix", "Antena ok", "Bloqueio testado", "Etiqueta instalada"].map((item) => (
              <label
                key={item}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80"
              >
                <span>{item}</span>
                <div className="flex items-center gap-2 text-xs text-white/60">
                  <button type="button" className="rounded-lg bg-white/10 px-2 py-1">
                    OK
                  </button>
                  <button type="button" className="rounded-lg bg-white/5 px-2 py-1">
                    N/A
                  </button>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-white">Endereço</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <label className="block text-xs text-white/60 md:col-span-2">
              Logradouro
              <input
                value={form.addressStreet}
                onChange={(event) => setField("addressStreet", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                placeholder="Rua, avenida..."
              />
            </label>
            <label className="block text-xs text-white/60">
              Número
              <input
                value={form.addressNumber}
                onChange={(event) => setField("addressNumber", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                placeholder="123"
              />
            </label>
            <label className="block text-xs text-white/60">
              Bairro
              <input
                value={form.addressNeighborhood}
                onChange={(event) => setField("addressNeighborhood", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-white/60">
              Cidade
              <input
                value={form.addressCity}
                onChange={(event) => setField("addressCity", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-white/60">
              UF
              <input
                value={form.addressState}
                onChange={(event) => setField("addressState", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                placeholder="MG"
              />
            </label>
            <label className="block text-xs text-white/60">
              Complemento
              <input
                value={form.addressComplement}
                onChange={(event) => setField("addressComplement", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                placeholder="Apto, bloco..."
              />
            </label>
            <label className="block text-xs text-white/60 md:col-span-2">
              Referência
              <input
                value={form.addressReference}
                onChange={(event) => setField("addressReference", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                placeholder="Ponto de referência"
              />
            </label>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-white">Observações</h2>
          <textarea
            value={form.notes}
            onChange={(event) => setField("notes", event.target.value)}
            className="mt-3 min-h-[120px] w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            placeholder="Detalhes importantes para a execução."
          />
        </div>
      </DataCard>

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
