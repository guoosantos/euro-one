import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import PageHeader from "../../components/ui/PageHeader.jsx";
import DataCard from "../../components/ui/DataCard.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";

const DEFAULT_CHECKLIST = [
  { key: "foto_local", label: "Foto do local" },
  { key: "foto_painel", label: "Foto do painel após instalação" },
  { key: "foto_frente", label: "Foto do veículo (frente)" },
  { key: "foto_lado", label: "Foto do veículo (lado)" },
  { key: "foto_tras", label: "Foto do veículo (trás)" },
];

function buildChecklistNotes(items) {
  return items
    .map((item) => `- ${item.label}: ${item.done ? "OK" : "pendente"}`)
    .join("\n");
}

export default function ServiceOrderExecute() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [item, setItem] = useState(null);
  const [saving, setSaving] = useState(false);
  const [checklist, setChecklist] = useState(() =>
    DEFAULT_CHECKLIST.map((entry) => ({ ...entry, done: false })),
  );
  const [activeStep, setActiveStep] = useState(0);
  const [startConfirmed, setStartConfirmed] = useState(false);
  const [addressConfirmed, setAddressConfirmed] = useState(false);
  const [equipmentLinked, setEquipmentLinked] = useState(false);
  const [mediaUploaded, setMediaUploaded] = useState(false);
  const [signatures, setSignatures] = useState({ technician: false, responsible: false });
  const [km, setKm] = useState("");
  const [notes, setNotes] = useState("");

  const headline = useMemo(() => {
    if (!item) return "";
    return item.osInternalId || item.id.slice(0, 8);
  }, [item]);

  const steps = useMemo(
    () => [
      { key: "start", label: "Início (GPS partida)", pending: !startConfirmed },
      { key: "address", label: "Confirmar endereço", pending: !addressConfirmed },
      { key: "equipment", label: "Vincular equipamentos", pending: !equipmentLinked },
      { key: "checklist", label: "Checklist", pending: checklist.some((entry) => !entry.done) },
      { key: "media", label: "Mídias", pending: !mediaUploaded },
      { key: "signatures", label: "Assinaturas", pending: !signatures.technician || !signatures.responsible },
      { key: "km", label: "KM + Finalizar", pending: !km },
    ],
    [addressConfirmed, checklist, equipmentLinked, km, mediaUploaded, signatures, startConfirmed],
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/core/service-orders/${id}`, {
          credentials: "include",
        });
        const payload = await response.json();
        const serviceOrder = payload?.item || null;
        setItem(serviceOrder);
        setKm(serviceOrder?.km ? String(serviceOrder.km) : "");
        setNotes(serviceOrder?.notes || "");
      } catch (error) {
        console.error("Falha ao carregar OS", error);
        setItem(null);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  const toggleChecklist = (index) => {
    setChecklist((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], done: !updated[index].done };
      return updated;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const checklistNotes = buildChecklistNotes(checklist);
      const mergedNotes = [
        checklistNotes ? `Checklist:\n${checklistNotes}` : null,
        notes ? `Observações:\n${notes}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");

      const response = await fetch(`/api/core/service-orders/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          km: km === "" ? null : Number(km),
          notes: mergedNotes,
          status: "EM_EXECUCAO",
        }),
      });

      const payload = await response.json();
      if (!payload?.ok) {
        throw new Error(payload?.error || "Falha ao salvar execução");
      }
      setItem(payload.item);
      alert("Execução salva.");
    } catch (error) {
      console.error("Falha ao salvar execução", error);
      alert("Falha ao salvar execução.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <DataCard className="animate-pulse">
          <div className="h-6 w-52 rounded-full bg-white/10" />
          <div className="mt-3 h-4 w-64 rounded-full bg-white/10" />
        </DataCard>
      </div>
    );
  }

  if (!item) {
    return (
      <DataCard>
        <EmptyState title="OS não encontrada." subtitle="Verifique o código e tente novamente." />
      </DataCard>
    );
  }

  const active = steps[activeStep];
  const hasPending = active?.pending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Execução da OS (técnico)"
        subtitle={`OS ${headline} • ${item.vehicle?.plate || "—"}`}
        actions={
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-60"
          >
            {saving ? "Salvando..." : "Salvar execução"}
          </button>
        }
      />

      <div className="flex flex-wrap gap-2">
        {steps.map((step, index) => (
          <button
            key={step.key}
            type="button"
            onClick={() => setActiveStep(index)}
            className={`rounded-xl px-3 py-2 text-xs font-medium uppercase tracking-[0.08em] transition ${
              index === activeStep ? "bg-sky-500 text-black" : "bg-white/10 text-white/70 hover:bg-white/15"
            }`}
          >
            {index + 1}. {step.label}
            {step.pending && <span className="ml-2 text-[10px] text-amber-200">pendente</span>}
          </button>
        ))}
      </div>

      <DataCard className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">{active?.label}</h2>
            <p className="text-xs text-white/60">Pendências obrigatórias: {hasPending ? "Sim" : "Não"}</p>
          </div>
          <button
            type="button"
            onClick={() => setActiveStep((prev) => Math.min(prev + 1, steps.length - 1))}
            className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
            disabled={activeStep === steps.length - 1}
          >
            Salvar e continuar
          </button>
        </div>

        {active?.key === "start" && (
          <div className="space-y-3">
            <div className="text-sm text-white/70">Confirme o início do atendimento via GPS.</div>
            <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80">
              <input type="checkbox" checked={startConfirmed} onChange={() => setStartConfirmed((prev) => !prev)} />
              Início registrado
            </label>
          </div>
        )}

        {active?.key === "address" && (
          <div className="space-y-3">
            <div className="text-sm text-white/70">Endereço informado: {item.address || "—"}</div>
            <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80">
              <input
                type="checkbox"
                checked={addressConfirmed}
                onChange={() => setAddressConfirmed((prev) => !prev)}
              />
              Endereço confirmado
            </label>
          </div>
        )}

        {active?.key === "equipment" && (
          <div className="space-y-3">
            <div className="text-sm text-white/70">Selecione os equipamentos disponíveis para vincular.</div>
            <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80">
              <input
                type="checkbox"
                checked={equipmentLinked}
                onChange={() => setEquipmentLinked((prev) => !prev)}
              />
              Equipamentos vinculados
            </label>
          </div>
        )}

        {active?.key === "checklist" && (
          <div className="space-y-3">
            {checklist.map((itemEntry, index) => (
              <label
                key={itemEntry.key}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2"
              >
                <input type="checkbox" checked={itemEntry.done} onChange={() => toggleChecklist(index)} />
                <span className="text-sm text-white/90">{itemEntry.label}</span>
              </label>
            ))}
          </div>
        )}

        {active?.key === "media" && (
          <div className="space-y-3">
            <div className="text-sm text-white/70">Fotos/vídeos obrigatórios da execução.</div>
            <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80">
              <input type="checkbox" checked={mediaUploaded} onChange={() => setMediaUploaded((prev) => !prev)} />
              Mídias anexadas
            </label>
          </div>
        )}

        {active?.key === "signatures" && (
          <div className="space-y-3">
            <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80">
              <input
                type="checkbox"
                checked={signatures.technician}
                onChange={() => setSignatures((prev) => ({ ...prev, technician: !prev.technician }))}
              />
              Assinatura do técnico coletada
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80">
              <input
                type="checkbox"
                checked={signatures.responsible}
                onChange={() => setSignatures((prev) => ({ ...prev, responsible: !prev.responsible }))}
              />
              Assinatura do responsável coletada
            </label>
          </div>
        )}

        {active?.key === "km" && (
          <div className="space-y-3">
            <label className="block text-xs text-white/60">
              KM total
              <input
                value={km}
                onChange={(event) => setKm(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-white/60">
              Observações finais
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="mt-2 min-h-[120px] w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
          <span className="text-xs text-white/50">
            Pendências obrigatórias: {hasPending ? "faltam itens" : "tudo pronto"}
          </span>
          <button
            type="button"
            onClick={() => setActiveStep((prev) => Math.min(prev + 1, steps.length - 1))}
            className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
            disabled={activeStep === steps.length - 1}
          >
            Salvar e continuar
          </button>
        </div>
      </DataCard>
    </div>
  );
}
