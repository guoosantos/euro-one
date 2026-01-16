import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import PageHeader from "../../components/ui/PageHeader.jsx";
import DataCard from "../../components/ui/DataCard.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import api from "../../lib/api.js";

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

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function mapPayload(formState) {
  return {
    osInternalId: formState.osInternalId,
    vehiclePlate: formState.vehiclePlate,
    clientName: formState.clientName,
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
  const [showActions, setShowActions] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get(`core/service-orders/${id}`);
      setItem(response?.data?.item || null);
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
      clientName: item.clientName || "",
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
      const nextForm = { ...form, ...overrides };
      const payload = mapPayload(nextForm);
      const response = await api.patch(`core/service-orders/${id}`, payload);
      if (!response?.data?.ok) {
        throw new Error(response?.data?.error || "Falha ao atualizar OS");
      }
      setItem(response.data.item);
      const resolvedStatus = response?.data?.item?.status || nextForm.status;
      if (resolvedStatus === "CONCLUIDA" && response?.data?.equipmentsLinked !== undefined) {
        alert("Equipamentos vinculados ao veículo automaticamente.");
      }
    } catch (error) {
      console.error("Falha ao atualizar OS", error);
      alert("Falha ao atualizar OS.");
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPdf = async () => {
    try {
      const response = await api.get(`core/service-orders/${id}/pdf`, { responseType: "blob" });
      if (!response?.data) {
        throw new Error("Falha ao gerar PDF");
      }
      const blob = response.data;
      const url = window.URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => window.URL.revokeObjectURL(url), 5000);
    } catch (error) {
      console.error("Falha ao exportar PDF", error);
      alert("Não foi possível exportar o PDF agora.");
    }
  };

  const headline = useMemo(() => {
    if (!item) return "";
    return item.osInternalId || item.id.slice(0, 8);
  }, [item]);

  const checklistItems = useMemo(() => {
    if (!Array.isArray(item?.checklistItems)) return [];
    return item.checklistItems;
  }, [item]);

  if (loading) {
    return (
      <div className="space-y-4">
        <DataCard className="animate-pulse">
          <div className="h-6 w-48 rounded-full bg-white/10" />
          <div className="mt-3 h-4 w-64 rounded-full bg-white/10" />
        </DataCard>
      </div>
    );
  }

  if (!item || !form) {
    return (
      <DataCard>
        <EmptyState title="OS não encontrada." subtitle="Verifique o código e tente novamente." />
      </DataCard>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>OS {headline}</span>
            <span className="rounded-xl bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.1em] text-white/80">
              {item.status || "—"}
            </span>
          </span>
        }
        subtitle={`Placa ${item.vehicle?.plate || "—"} • Cliente ${item.clientName || "—"} • Técnico ${
          item.technicianName || "—"
        }`}
        actions={
          <>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
            >
              Exportar PDF
            </button>
            <Link
              className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
              to={`/services/${item.id}/execute`}
            >
              Executar (técnico)
            </Link>
            <button
              type="button"
              onClick={() => setShowActions((prev) => !prev)}
              className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
            >
              Agendar / Remanejar / Cancelar
            </button>
            <button
              type="button"
              onClick={() => save({ status: "CONCLUIDA" })}
              disabled={item.status !== "AGUARDANDO_APROVACAO" || saving}
              className="rounded-xl bg-sky-500 px-3 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-50"
            >
              Aprovar OS
            </button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Timeline</h2>
            <div className="space-y-2 text-sm text-white/70">
              {STATUS_OPTIONS.map((status) => (
                <div
                  key={status}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2"
                >
                  <span className="text-white">{status}</span>
                  <span className="text-xs text-white/50">
                    {status === item.status ? formatDateTime(item.updatedAt || item.startAt) : "—"}
                  </span>
                </div>
              ))}
            </div>
          </DataCard>

          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Checklist</h2>
            {checklistItems.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-white/10">
                <table className="min-w-full text-left text-xs text-white/70">
                  <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-white/60">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2">Antes</th>
                      <th className="px-3 py-2">Depois</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {checklistItems.map((entry) => (
                      <tr key={entry.item}>
                        <td className="px-3 py-2 text-white">{entry.item}</td>
                        <td className="px-3 py-2">{entry.before || "—"}</td>
                        <td className="px-3 py-2">{entry.after || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-white/60">
                {form.notes ? form.notes : "Nenhum checklist registrado até o momento."}
              </div>
            )}
          </DataCard>

          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Mídias</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`media-${index}`} className="aspect-video rounded-xl border border-white/10 bg-black/30" />
              ))}
            </div>
          </DataCard>

          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Assinaturas</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-6 text-center text-sm text-white/60">
                Técnico
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-6 text-center text-sm text-white/60">
                Responsável
              </div>
            </div>
          </DataCard>
        </div>

        <div className="space-y-4">
          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Dados do serviço</h2>
            <label className="block text-xs text-white/60">
              Status
              <select
                value={form.status}
                onChange={(event) => handleChange("status", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-white/60">
              Endereço
              <input
                value={form.address}
                onChange={(event) => handleChange("address", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-white/60">
              Contato
              <input
                value={form.responsibleName}
                onChange={(event) => handleChange("responsibleName", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-white/60">
              Telefone
              <input
                value={form.responsiblePhone}
                onChange={(event) => handleChange("responsiblePhone", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => save()}
              disabled={saving}
              className="w-full rounded-xl bg-sky-500 px-3 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-60"
            >
              {saving ? "Salvando..." : "Salvar alterações"}
            </button>
          </DataCard>

          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Veículo</h2>
            <div className="text-sm text-white/70">
              <div className="font-semibold text-white">{form.vehiclePlate || item.vehicle?.plate || "—"}</div>
              <div className="text-xs text-white/50">{item.vehicle?.name || item.vehicle?.model || "—"}</div>
              {item.vehicle?.id && (
                <Link className="mt-2 inline-flex text-xs text-sky-300" to={`/vehicles/${item.vehicle?.id}`}>
                  Ver veículo
                </Link>
              )}
            </div>
          </DataCard>

          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Equipamentos vinculados</h2>
            {form.equipmentsText ? (
              <ul className="space-y-2 text-sm text-white/70">
                {form.equipmentsText
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line, index) => (
                    <li key={`eq-${index}`} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                      {line}
                    </li>
                  ))}
              </ul>
            ) : (
              <EmptyState title="Nenhum equipamento informado." />
            )}
          </DataCard>

          <DataCard className="space-y-3">
            <h2 className="text-sm font-semibold text-white">KM</h2>
            <input
              value={form.km}
              onChange={(event) => handleChange("km", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              placeholder="KM total"
            />
          </DataCard>

          {showActions && (
            <DataCard className="space-y-3">
              <h2 className="text-sm font-semibold text-white">Ações rápidas</h2>
              <div className="flex flex-col gap-2">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.status}
                    type="button"
                    className={`rounded-xl px-3 py-2 text-sm transition ${
                      action.tone === "danger"
                        ? "bg-red-500/10 text-red-200 hover:bg-red-500/20"
                        : "bg-white/10 text-white hover:bg-white/15"
                    }`}
                    onClick={() => save({ status: action.status })}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </DataCard>
          )}
        </div>
      </div>
    </div>
  );
}
