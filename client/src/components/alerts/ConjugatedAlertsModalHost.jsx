import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import safeApi from "../../lib/safe-api.js";
import { API_ROUTES } from "../../lib/api-routes.js";
import useConjugatedAlerts from "../../lib/hooks/useConjugatedAlerts.js";
import { formatAddress } from "../../lib/format-address.js";

const REMINDER_INTERVAL_MS = 180_000;
const CHECK_INTERVAL_MS = 15_000;

function normalizeDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR");
}

export default function ConjugatedAlertsModalHost() {
  const { alerts, refresh } = useConjugatedAlerts({
    params: { windowHours: 5 },
    refreshInterval: 30_000,
    enabled: true,
  });

  const [isOpen, setIsOpen] = useState(false);
  const [activeAlertId, setActiveAlertId] = useState(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const dismissedAtRef = useRef(new Map());

  const unresolvedAlerts = useMemo(() => {
    const list = Array.isArray(alerts) ? alerts : [];
    return list
      .filter((item) => !item?.resolved)
      .sort((a, b) => Date.parse(b?.eventTime || 0) - Date.parse(a?.eventTime || 0));
  }, [alerts]);

  const unresolvedIds = useMemo(
    () => new Set(unresolvedAlerts.map((item) => String(item.id))),
    [unresolvedAlerts],
  );

  const activeAlert = useMemo(
    () => unresolvedAlerts.find((item) => String(item.id) === String(activeAlertId)) || null,
    [activeAlertId, unresolvedAlerts],
  );

  const nextEligibleAlert = useMemo(() => {
    const now = Date.now();
    return (
      unresolvedAlerts.find((item) => {
        const id = String(item.id);
        const lastDismissedAt = dismissedAtRef.current.get(id);
        if (!lastDismissedAt) return true;
        return now - lastDismissedAt >= REMINDER_INTERVAL_MS;
      }) || null
    );
  }, [tick, unresolvedAlerts]);

  useEffect(() => {
    const keep = new Map();
    unresolvedIds.forEach((id) => {
      const value = dismissedAtRef.current.get(id);
      if (value) keep.set(id, value);
    });
    dismissedAtRef.current = keep;
  }, [unresolvedIds]);

  useEffect(() => {
    if (!unresolvedAlerts.length) {
      setIsOpen(false);
      setActiveAlertId(null);
      setNotes("");
      setError(null);
      return;
    }

    if (activeAlertId && !activeAlert) {
      setIsOpen(false);
      setActiveAlertId(null);
      setNotes("");
      setError(null);
    }
  }, [activeAlert, activeAlertId, unresolvedAlerts.length]);

  useEffect(() => {
    if (!unresolvedAlerts.length) return undefined;
    const timer = setInterval(() => setTick((prev) => prev + 1), CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [unresolvedAlerts.length]);

  useEffect(() => {
    if (isOpen) return;
    if (!nextEligibleAlert) return;
    setActiveAlertId(String(nextEligibleAlert.id));
    setIsOpen(true);
    setNotes("");
    setError(null);
  }, [isOpen, nextEligibleAlert]);

  const handleClose = useCallback(() => {
    if (activeAlertId) {
      dismissedAtRef.current.set(String(activeAlertId), Date.now());
    }
    setIsOpen(false);
    setError(null);
  }, [activeAlertId]);

  const handleResolve = useCallback(async () => {
    if (!activeAlert || saving) return;
    const message = String(notes || "").trim();
    if (!message) {
      setError("Informe uma observação para concluir a tratativa.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        notes: message,
        vehicleId: activeAlert?.vehicleId ?? null,
        deviceId: activeAlert?.deviceId ?? null,
        vehicleLabel: activeAlert?.vehicleLabel ?? null,
        eventLabel: activeAlert?.eventLabel ?? null,
        eventType: activeAlert?.eventType ?? null,
        eventTime: activeAlert?.eventTime ?? null,
      };
      const primary = await safeApi.patch(API_ROUTES.alertsConjugatedResolve(activeAlert.id), payload);
      if (primary?.error) {
        const fallback = await safeApi.patch(API_ROUTES.eventResolve(activeAlert.id), payload);
        if (fallback?.error) {
          throw fallback.error;
        }
      }
      dismissedAtRef.current.delete(String(activeAlert.id));
      setIsOpen(false);
      setActiveAlertId(null);
      setNotes("");
      refresh?.();
    } catch (requestError) {
      const message =
        requestError?.response?.data?.message ||
        requestError?.message ||
        "Falha ao salvar tratativa do alerta conjugado.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [activeAlert, notes, refresh, saving]);

  if (!isOpen || !activeAlert) return null;

  return (
    <div className="fixed inset-0 z-[12010] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-red-500/40 bg-[#0f141c] text-white shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-red-300">Alerta conjugado</p>
            <h2 className="text-lg font-semibold">Tratativa pendente</h2>
            <p className="text-xs text-white/60">Se não tratar, este popup voltará em 3 minutos.</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70 hover:border-white/30"
          >
            Fechar
          </button>
        </div>

        <div className="space-y-2 px-6 py-4 text-sm text-white/80">
          <p>
            <span className="text-white/60">Veículo:</span>{" "}
            {activeAlert.vehicleLabel || activeAlert.plate || activeAlert.vehicleId || "—"}
          </p>
          <p>
            <span className="text-white/60">Evento:</span> {activeAlert.eventLabel || "Alerta crítico"}
          </p>
          <p>
            <span className="text-white/60">Data/Hora:</span> {normalizeDate(activeAlert.eventTime)}
          </p>
          <p>
            <span className="text-white/60">Local:</span> {formatAddress(activeAlert.address) || "—"}
          </p>
        </div>

        <div className="border-t border-white/10 px-6 py-4">
          <label className="text-xs uppercase tracking-[0.12em] text-white/50">Observação obrigatória</label>
          <textarea
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              if (error) setError(null);
            }}
            rows={3}
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            placeholder="Descreva a tratativa aplicada."
          />
          {error ? <p className="mt-2 text-xs text-red-200/90">{error}</p> : null}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70 hover:border-white/30"
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={handleResolve}
              disabled={saving}
              className="rounded-lg border border-red-500/40 bg-red-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-red-100 hover:border-red-400/60 disabled:opacity-60"
            >
              {saving ? "Salvando..." : "Concluir tratativa"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

