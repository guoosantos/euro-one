import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

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
  const [km, setKm] = useState("");
  const [notes, setNotes] = useState("");

  const headline = useMemo(() => {
    if (!item) return "";
    return item.osInternalId || item.id.slice(0, 8);
  }, [item]);

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
    return <div className="text-white/60">Carregando...</div>;
  }

  if (!item) {
    return <div className="text-white/60">OS não encontrada.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-lg font-semibold text-white">Execução (Técnico)</div>
          <p className="text-sm text-white/60">
            OS {headline} — <span className="text-white">{item.vehicle?.plate || "—"}</span>
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? "Salvando..." : "Salvar execução"}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2 space-y-4">
          <div className="text-sm font-semibold text-white">Checklist</div>
          <div className="space-y-2">
            {checklist.map((itemEntry, index) => (
              <label
                key={itemEntry.key}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2"
              >
                <input
                  type="checkbox"
                  checked={itemEntry.done}
                  onChange={() => toggleChecklist(index)}
                />
                <span className="text-sm text-white/90">{itemEntry.label}</span>
              </label>
            ))}
          </div>

          <div>
            <div className="text-xs text-white/60 mb-2">Observações</div>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="input min-h-[120px]"
              placeholder="Descreva o que foi feito, antes/depois, ocorrências..."
            />
          </div>
        </div>

        <div className="card space-y-3">
          <div className="text-sm font-semibold text-white">KM</div>
          <div>
            <div className="text-xs text-white/60 mb-2">KM total</div>
            <input value={km} onChange={(event) => setKm(event.target.value)} className="input" />
          </div>
          <div className="text-xs text-white/50">
            Campo pronto para integrar GPS/anexos conforme evolução do fluxo.
          </div>
        </div>
      </div>
    </div>
  );
}
