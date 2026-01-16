import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

const STATUS_OPTIONS = [
  "SOLICITADA",
  "AGENDADA",
  "EM_DESLOCAMENTO",
  "EM_EXECUCAO",
  "AGUARDANDO_APROVACAO",
  "CONCLUIDA",
  "CANCELADA",
  "REMANEJADA",
];

const QUICK_ACTIONS = [
  { label: "Marcar como AGENDADA", status: "AGENDADA" },
  { label: "Marcar como EM DESLOCAMENTO", status: "EM_DESLOCAMENTO" },
  { label: "Marcar como EM EXECUÇÃO", status: "EM_EXECUCAO" },
  { label: "Marcar como CONCLUÍDA", status: "CONCLUIDA" },
  { label: "Cancelar OS", status: "CANCELADA", tone: "danger" },
];

function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function mapPayload(formState) {
  return {
    osInternalId: formState.osInternalId,
    vehiclePlate: formState.vehiclePlate,
    type: formState.type,
    status: formState.status,
    startAt: formState.startAt ? new Date(formState.startAt).toISOString() : null,
    endAt: formState.endAt ? new Date(formState.endAt).toISOString() : null,
    technicianName: formState.technicianName,
    responsibleName: formState.responsibleName,
    responsiblePhone: formState.responsiblePhone,
    address: formState.address,
    reason: formState.reason,
    notes: formState.notes,
    equipmentsText: formState.equipmentsText,
    serial: formState.serial,
    externalRef: formState.externalRef,
    km: formState.km,
  };
}

export default function ServiceOrderDetails() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [item, setItem] = useState(null);
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/core/service-orders/${id}`, { credentials: "include" });
      const payload = await response.json();
      setItem(payload?.item || null);
    } catch (error) {
      console.error("Falha ao carregar OS", error);
      setItem(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!item) return;
    setForm({
      osInternalId: item.osInternalId || "",
      vehiclePlate: item.vehicle?.plate || "",
      type: item.type || "",
      status: item.status || "",
      startAt: toLocalInput(item.startAt),
      endAt: toLocalInput(item.endAt),
      technicianName: item.technicianName || "",
      responsibleName: item.responsibleName || "",
      responsiblePhone: item.responsiblePhone || "",
      address: item.address || "",
      reason: item.reason || "",
      notes: item.notes || "",
      equipmentsText: item.equipmentsText || "",
      serial: item.serial || "",
      externalRef: item.externalRef || "",
      km: item.km ?? "",
    });
  }, [item]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const save = async (overrides = null) => {
    if (!form) return;
    setSaving(true);
    try {
      const payload = mapPayload({ ...form, ...overrides });
      const response = await fetch(`/api/core/service-orders/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!data?.ok) {
        throw new Error(data?.error || "Falha ao atualizar OS");
      }
      setItem(data.item);
    } catch (error) {
      console.error("Falha ao atualizar OS", error);
      alert("Falha ao atualizar OS.");
    } finally {
      setSaving(false);
    }
  };

  const headline = useMemo(() => {
    if (!item) return "";
    return item.osInternalId || item.id.slice(0, 8);
  }, [item]);

  if (loading) {
    return <div className="text-white/60">Carregando...</div>;
  }

  if (!item || !form) {
    return <div className="text-white/60">OS não encontrada.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-lg font-semibold text-white">OS {headline}</div>
          <p className="text-sm text-white/60">
            Placa: <span className="text-white">{item.vehicle?.plate || "—"}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn" to={`/services/${item.id}/execute`}>
            Executar (Técnico)
          </Link>
          <button type="button" className="btn btn-primary" onClick={() => save()} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2 space-y-4">
          <div className="text-sm font-semibold text-white">Dados principais</div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Status">
              <select
                value={form.status}
                onChange={(event) => handleChange("status", event.target.value)}
                className="input"
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Tipo">
              <input
                value={form.type}
                onChange={(event) => handleChange("type", event.target.value)}
                className="input"
              />
            </Field>

            <Field label="OS (ID interno)">
              <input
                value={form.osInternalId}
                onChange={(event) => handleChange("osInternalId", event.target.value)}
                className="input"
              />
            </Field>

            <Field label="Placa do veículo">
              <input
                value={form.vehiclePlate}
                onChange={(event) => handleChange("vehiclePlate", event.target.value)}
                className="input"
              />
            </Field>

            <Field label="Início">
              <input
                type="datetime-local"
                value={form.startAt}
                onChange={(event) => handleChange("startAt", event.target.value)}
                className="input"
              />
            </Field>

            <Field label="Fim">
              <input
                type="datetime-local"
                value={form.endAt}
                onChange={(event) => handleChange("endAt", event.target.value)}
                className="input"
              />
            </Field>

            <Field label="Técnico">
              <input
                value={form.technicianName}
                onChange={(event) => handleChange("technicianName", event.target.value)}
                className="input"
              />
            </Field>

            <Field label="Contato (responsável)">
              <input
                value={form.responsibleName}
                onChange={(event) => handleChange("responsibleName", event.target.value)}
                className="input"
              />
            </Field>

            <Field label="Telefone">
              <input
                value={form.responsiblePhone}
                onChange={(event) => handleChange("responsiblePhone", event.target.value)}
                className="input"
              />
            </Field>

            <Field label="KM (total)">
              <input
                value={form.km}
                onChange={(event) => handleChange("km", event.target.value)}
                className="input"
              />
            </Field>

            <Field label="Endereço" full>
              <input
                value={form.address}
                onChange={(event) => handleChange("address", event.target.value)}
                className="input"
              />
            </Field>

            <Field label="Descrição do serviço" full>
              <textarea
                value={form.reason}
                onChange={(event) => handleChange("reason", event.target.value)}
                className="input min-h-[120px]"
              />
            </Field>

            <Field label="Observações" full>
              <textarea
                value={form.notes}
                onChange={(event) => handleChange("notes", event.target.value)}
                className="input min-h-[100px]"
              />
            </Field>

            <Field label="Equipamentos" full>
              <textarea
                value={form.equipmentsText}
                onChange={(event) => handleChange("equipmentsText", event.target.value)}
                className="input min-h-[100px]"
              />
            </Field>

            <Field label="Serial" full>
              <input
                value={form.serial}
                onChange={(event) => handleChange("serial", event.target.value)}
                className="input"
              />
            </Field>

            <Field label="Referência externa" full>
              <input
                value={form.externalRef}
                onChange={(event) => handleChange("externalRef", event.target.value)}
                className="input"
              />
            </Field>
          </div>
        </div>

        <div className="card space-y-3">
          <div className="text-sm font-semibold text-white">Ações rápidas</div>
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.status}
              type="button"
              onClick={() => save({ status: action.status })}
              className={
                action.tone === "danger"
                  ? "btn bg-red-500/20 text-red-100 hover:bg-red-500/30"
                  : "btn"
              }
              disabled={saving}
            >
              {action.label}
            </button>
          ))}
          <div className="text-xs text-white/50">
            As ações rápidas atualizam o status e já salvam a OS.
          </div>
        </div>
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
