import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bell, ExternalLink } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import useDevices from "../../lib/hooks/useDevices";
import { useEvents } from "../../lib/hooks/useEvents";
import { translateEventType } from "../../lib/event-translations.js";
import { formatDate } from "../../lib/fleet-utils";
import { useTranslation } from "../../lib/i18n.js";

const SEVERITY_STYLES = {
  critical: "border-red/40 text-red",
  high: "border-orange-400/40 text-orange-400",
  medium: "border-yellow-400/40 text-yellow-400",
  low: "border-emerald-400/40 text-emerald-400",
  info: "border-sky-400/40 text-sky-400",
};

const SECURITY_EVENT_HINTS = [
  "ignition",
  "ignição",
  "ignicao",
  "speed",
  "overspeed",
  "speeding",
  "excesso",
  "geofence",
  "cerca",
  "fence",
  "offline",
  "online",
  "sem sinal",
  "gps",
  "sat",
  "jammer",
  "jamming",
  "tamper",
  "viol",
  "panic",
  "sos",
  "power",
  "bateria",
  "battery",
  "porta",
  "door",
  "towing",
  "reboque",
  "theft",
  "assault",
  "crime",
  "crash",
  "colis",
  "harsh",
];

const AUDIT_HINTS = [
  "audit",
  "auditoria",
  "command",
  "comando",
  "login",
  "logout",
  "usuario",
  "usuário",
  "user",
];

const SERVICE_HINTS = [
  "atendimento",
  "servico",
  "serviço",
  "ordem de serviço",
  "os ",
  "service order",
  "service",
  "task",
  "agendamento",
  "appointment",
  "chamado",
  "solicit",
];

const CONJUGATED_HINTS = ["conjugad", "conjugated", "combined alert"];

function resolveSeverity(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw >= 4) return "critical";
    if (raw === 3) return "high";
    if (raw === 2) return "medium";
    if (raw === 1) return "low";
    return "info";
  }
  const normalized = String(raw).trim().toLowerCase();
  if (normalized.startsWith("crit")) return "critical";
  if (normalized.startsWith("high")) return "high";
  if (normalized.startsWith("med")) return "medium";
  if (normalized.startsWith("low")) return "low";
  if (normalized.startsWith("info")) return "info";
  return null;
}

function resolveEventTime(event) {
  return (
    event?.time ||
    event?.eventTime ||
    event?.serverTime ||
    event?.deviceTime ||
    event?.timestamp ||
    null
  );
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function includesHint(haystack, hints) {
  return hints.some((hint) => haystack.includes(hint));
}

function resolveEventDescription(event) {
  return (
    event?.description ||
    event?.attributes?.description ||
    event?.attributes?.message ||
    event?.attributes?.text ||
    event?.message ||
    event?.attributes?.alarm ||
    event?.attributes?.event ||
    event?.attributes?.geofence ||
    event?.geofence ||
    null
  );
}

function resolveEventIdentifier(event, device) {
  const plate =
    device?.plate ||
    device?.attributes?.plate ||
    event?.attributes?.plate ||
    event?.vehicle?.plate ||
    null;
  if (plate) return `Placa ${plate}`;
  const imei =
    device?.uniqueId ||
    device?.imei ||
    device?.attributes?.uniqueId ||
    event?.attributes?.uniqueId ||
    event?.deviceId ||
    event?.attributes?.deviceId ||
    null;
  if (imei) return `IMEI ${imei}`;
  return null;
}

function isRelevantNotification(event, label) {
  const category = normalizeText(event?.category || event?.attributes?.category || event?.attributes?.eventCategory);
  const type = normalizeText(event?.type || event?.event || event?.attributes?.event || event?.attributes?.type);
  const description = normalizeText(resolveEventDescription(event));
  const haystack = `${type} ${label} ${category} ${description}`;
  const requiresHandling = Boolean(event?.requiresHandling || event?.attributes?.requiresHandling);

  if (requiresHandling) return true;
  if (includesHint(haystack, CONJUGATED_HINTS)) return true;
  if (includesHint(haystack, SERVICE_HINTS)) return true;
  if (includesHint(haystack, AUDIT_HINTS)) return true;
  if (category.includes("segurança") || category.includes("security")) return true;
  if (includesHint(haystack, SECURITY_EVENT_HINTS)) return true;
  if (haystack.includes("alert") || haystack.includes("alarme") || haystack.includes("alarm")) return true;
  return false;
}

export default function NotificationsPopover({ onSelectDevice, limit = 8 }) {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const { data: devices = [] } = useDevices();
  // Primeira versão: usa eventos recentes como feed de notificações.
  const { events: rawEvents = [], loading, error } = useEvents({ limit: limit * 3 });
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const deviceById = useMemo(() => {
    const entries = (devices || [])
      .map((device) => {
        const key = device?.deviceId ?? device?.id ?? device?.uniqueId ?? null;
        return key ? [String(key), device] : null;
      })
      .filter(Boolean);
    return new Map(entries);
  }, [devices]);

  const deviceByVehicleId = useMemo(() => {
    const entries = (devices || [])
      .map((device) => {
        const vehicleId = device?.vehicleId ?? device?.vehicle?.id ?? null;
        const deviceId = device?.deviceId ?? device?.id ?? device?.uniqueId ?? null;
        if (!vehicleId || !deviceId) return null;
        return [String(vehicleId), String(deviceId)];
      })
      .filter(Boolean);
    return new Map(entries);
  }, [devices]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target)) return;
      setOpen(false);
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const events = useMemo(() => {
    return rawEvents
      .map((event) => {
        const label = translateEventType(
          event?.type ?? event?.event,
          locale,
          t,
          event?.protocol || event?.attributes?.protocol || null,
          event,
        );
        return { event, label };
      })
      .filter(({ event, label }) => isRelevantNotification(event, normalizeText(label)))
      .slice(0, limit);
  }, [limit, locale, rawEvents, t]);

  const handleItemClick = ({ deviceId, route }) => {
    if (route) {
      navigate(route);
      setOpen(false);
      return;
    }
    if (deviceId) {
      onSelectDevice?.(deviceId);
      setOpen(false);
      return;
    }
    navigate("/notifications");
    setOpen(false);
  };

  const countLabel = events.length > 99 ? "99+" : String(events.length);

  return (
    <div ref={containerRef} className="relative">
      <button
        className="btn"
        type="button"
        aria-label={t("notifications.trigger")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((state) => !state)}
      >
        <Bell size={18} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-[480px] max-w-[92vw] overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-text">{t("notifications.title")}</span>
                <span className="rounded-full border border-border bg-layer px-2 py-0.5 text-[11px] text-sub">
                  {countLabel}
                </span>
              </div>
              <p className="text-xs text-sub">{t("notifications.subtitle", { count: events.length })}</p>
            </div>
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:opacity-80"
            >
              {t("notifications.viewAll")}
              <ExternalLink size={12} />
            </Link>
          </div>

          <div className="max-h-[70vh] overflow-y-auto">
            {loading && (
              <div className="px-4 py-6 text-sm text-sub">{t("notifications.loading")}</div>
            )}
            {!loading && error && (
              <div className="px-4 py-6 text-sm text-sub">{t("notifications.error")}</div>
            )}
            {!loading && !error && events.length === 0 && (
              <div className="px-4 py-6 text-sm text-sub">{t("notifications.empty")}</div>
            )}
            {!loading && !error && events.length > 0 && (
              <ul className="divide-y divide-border">
                {events.map(({ event, label }) => {
                  const deviceId = event?.deviceId ?? event?.device?.id ?? null;
                  const vehicleId = event?.vehicleId ?? event?.vehicle?.id ?? null;
                  const normalizedDeviceId = deviceId
                    ? String(deviceId)
                    : (vehicleId ? deviceByVehicleId.get(String(vehicleId)) : null);
                  const device = normalizedDeviceId ? deviceById.get(normalizedDeviceId) : null;
                  const name =
                    device?.name ||
                    event?.deviceName ||
                    event?.device?.name ||
                    event?.attributes?.deviceName ||
                    t("notifications.unknownVehicle");
                  const plate =
                    device?.plate ||
                    device?.attributes?.plate ||
                    event?.attributes?.plate ||
                    event?.vehicle?.plate ||
                    null;
                  const typeLabel = label;
                  const eventTime = resolveEventTime(event);
                  const formattedTime = eventTime
                    ? formatDate(eventTime, locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                    : "—";
                  const severity = resolveSeverity(event?.severity ?? event?.attributes?.severity ?? event?.attributes?.alarmSeverity);
                  const severityLabel = severity ? t(`severity.${severity}`) : null;
                  const severityClass = severity ? SEVERITY_STYLES[severity] : null;
                  const identifier = resolveEventIdentifier(event, device);
                  const description = resolveEventDescription(event) || "Sem descrição adicional.";
                  const directRoute =
                    event?.route ||
                    event?.attributes?.route ||
                    event?.attributes?.url ||
                    event?.attributes?.link ||
                    null;
                  const route = typeof directRoute === "string" && directRoute.startsWith("/") ? directRoute : null;
                  const fallbackLabel = identifier || (plate ? `Placa ${plate}` : null) || name;

                  return (
                    <li key={event.id ?? `${event.type}-${eventTime}`}> 
                      <button
                        type="button"
                        className="flex w-full flex-col gap-3 px-4 py-4 text-left transition hover:bg-layer"
                        onClick={() => handleItemClick({ deviceId: normalizedDeviceId, route })}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-semibold text-text">{typeLabel}</span>
                          {severityLabel && (
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${severityClass || "border-border text-sub"}`}>
                              {severityLabel}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-sub">
                          <span>{formattedTime}</span>
                          {fallbackLabel && (
                            <span className="flex items-center gap-1">
                              <span className="truncate">{fallbackLabel}</span>
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-sub">
                          {description}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
