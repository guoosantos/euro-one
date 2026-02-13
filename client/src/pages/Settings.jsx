import React, { useEffect, useMemo, useState } from "react";

import PageHeader from "../components/ui/PageHeader.jsx";
import Card from "../ui/Card";
import Button from "../ui/Button";
import { useTenant } from "../lib/tenant-context";
import { useUI } from "../lib/store";
import useVehicles from "../lib/hooks/useVehicles.js";
import { usePermissionGate } from "../lib/permissions/permission-gate.js";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";

const CHANNELS = [
  { key: "email", label: "E-mail", description: "Alertas em tempo real e resumos." },
  { key: "sms", label: "SMS", description: "Alertas críticos no celular.", comingSoon: true },
  { key: "whatsapp", label: "WhatsApp", description: "Notificações ricas e interativas.", comingSoon: true },
];

const FREQUENCY_OPTIONS = [
  { value: "immediate", label: "Imediato" },
  { value: "hourly", label: "Max. 10 alertas por hora" },
  { value: "daily", label: "Resumo diário" },
];

const LANGUAGE_OPTIONS = [
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "en-US", label: "English (US)" },
];

const TIMEZONE_OPTIONS = [
  { value: "America/Sao_Paulo", label: "America/Sao_Paulo (BRT)" },
  { value: "America/Recife", label: "America/Recife (BRT)" },
  { value: "America/Manaus", label: "America/Manaus (AMT)" },
  { value: "America/Porto_Velho", label: "America/Porto_Velho (AMT)" },
  { value: "America/Boa_Vista", label: "America/Boa_Vista (AMT)" },
  { value: "UTC", label: "UTC" },
];

const UNIT_OPTIONS = [
  { value: "km", label: "Métricas (km, km/h)" },
  { value: "mi", label: "Imperial (mi, mph)" },
];

function formatLimitValue(value) {
  if (value === null || value === undefined) return "—";
  if (Number.isFinite(Number(value))) return Number(value);
  return value || "—";
}

function LimitRow({ label, used, total, hint }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-xs text-white/50">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <div className="text-2xl font-semibold text-white">{used ?? "—"}</div>
        <div className="text-xs text-white/50">/ {formatLimitValue(total)}</div>
      </div>
      {hint && <div className="mt-1 text-[11px] text-white/40">{hint}</div>}
    </div>
  );
}

export default function Settings() {
  const { tenant, tenantId, tenantScope, tenants, user, isReadOnly, mirrorContextMode } = useTenant();
  const { theme, locale, setTheme, setLocale } = useUI((state) => ({
    theme: state.theme,
    locale: state.locale,
    setTheme: state.setTheme,
    setLocale: state.setLocale,
  }));
  const isAllTenants = tenantScope === "ALL";
  const isMirrorTarget = mirrorContextMode === "target";
  const vehiclesState = useVehicles({ enabled: !isAllTenants, includeTelemetry: false });
  const usersPermission = usePermissionGate({ menuKey: "admin", pageKey: "users" });
  const [userCount, setUserCount] = useState(null);
  const [userCountLoading, setUserCountLoading] = useState(false);
  const [preferences, setPreferences] = useState(() => {
    const attributes = user?.attributes || {};
    return {
      locale: attributes.locale || locale || "pt-BR",
      timezone: attributes.timezone || "America/Sao_Paulo",
      units: attributes.units || "km",
      theme: attributes.theme || theme || "dark",
    };
  });
  const [notifications, setNotifications] = useState(() => ({
    email: { enabled: true, quietHours: "22:00-06:00", frequency: "immediate" },
    sms: { enabled: false, quietHours: "", frequency: "immediate" },
    whatsapp: { enabled: false, quietHours: "", frequency: "immediate" },
  }));
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsFeedback, setPrefsFeedback] = useState(null);

  useEffect(() => {
    const attributes = user?.attributes || {};
    setPreferences((prev) => ({
      ...prev,
      locale: attributes.locale || locale || prev.locale,
      timezone: attributes.timezone || prev.timezone,
      units: attributes.units || prev.units,
      theme: attributes.theme || theme || prev.theme,
    }));
  }, [user?.id]);

  useEffect(() => {
    if (isAllTenants || !tenantId || !usersPermission.isFull || isReadOnly || isMirrorTarget) {
      setUserCount(null);
      return;
    }
    let active = true;
    setUserCountLoading(true);
    safeApi
      .get(API_ROUTES.users, { params: { clientId: tenantId } })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setUserCount(null);
          return;
        }
        const list = Array.isArray(data?.users) ? data.users : [];
        setUserCount(list.length);
      })
      .finally(() => {
        if (active) setUserCountLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isAllTenants, tenantId, usersPermission.isFull, isReadOnly, isMirrorTarget]);

  const vehicleLimit = tenant?.deviceLimit ?? tenant?.attributes?.vehicleLimit ?? null;
  const userLimit = tenant?.userLimit ?? tenant?.attributes?.userLimit ?? null;
  const vehicleUsed = !isAllTenants ? vehiclesState.vehicles.length : null;

  const totalLimits = useMemo(() => {
    if (!isAllTenants || !Array.isArray(tenants)) return null;
    const deviceTotal = tenants.reduce((acc, item) => acc + (Number(item.deviceLimit) || 0), 0);
    const userTotal = tenants.reduce((acc, item) => acc + (Number(item.userLimit) || 0), 0);
    return { deviceTotal: deviceTotal || null, userTotal: userTotal || null };
  }, [isAllTenants, tenants]);

  const handlePreferencesSave = async () => {
    if (!user?.id) return;
    setSavingPrefs(true);
    setPrefsFeedback(null);
    try {
      const nextAttributes = {
        ...(user?.attributes || {}),
        locale: preferences.locale,
        timezone: preferences.timezone,
        units: preferences.units,
        theme: preferences.theme,
      };
      const { error } = await safeApi.put(`${API_ROUTES.users}/${user.id}`, { attributes: nextAttributes });
      if (error) throw error;
      setTheme(preferences.theme);
      setLocale(preferences.locale);
      setPrefsFeedback({ type: "success", message: "Preferências atualizadas." });
    } catch (saveError) {
      setPrefsFeedback({ type: "error", message: saveError?.message || "Falha ao salvar preferências." });
    } finally {
      setSavingPrefs(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações"
        subtitle="Ajuste notificações, limites e preferências da plataforma Euro One."
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Notificações" subtitle="Controle canais e limites de alertas">
          <div className="space-y-4">
            {CHANNELS.map((channel) => {
              const state = notifications[channel.key];
              const disabled = channel.comingSoon;
              return (
                <div key={channel.key} className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">{channel.label}</div>
                      <div className="text-xs text-white/50">{channel.description}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      {channel.comingSoon && (
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase text-white/40">
                          Em breve
                        </span>
                      )}
                      <label className="flex items-center gap-2 text-xs text-white/70">
                        <span>{state?.enabled ? "Ativo" : "Desativado"}</span>
                        <input
                          type="checkbox"
                          checked={Boolean(state?.enabled)}
                          disabled={disabled}
                          onChange={(event) =>
                            setNotifications((prev) => ({
                              ...prev,
                              [channel.key]: { ...prev[channel.key], enabled: event.target.checked },
                            }))
                          }
                        />
                      </label>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="space-y-1">
                      <div className="text-xs text-white/50">Horário de silêncio</div>
                      <input
                        className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
                        value={state?.quietHours || ""}
                        placeholder="22:00-06:00"
                        disabled={disabled}
                        onChange={(event) =>
                          setNotifications((prev) => ({
                            ...prev,
                            [channel.key]: { ...prev[channel.key], quietHours: event.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <div className="text-xs text-white/50">Frequência/Limite</div>
                      <select
                        className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
                        value={state?.frequency || "immediate"}
                        disabled={disabled}
                        onChange={(event) =>
                          setNotifications((prev) => ({
                            ...prev,
                            [channel.key]: { ...prev[channel.key], frequency: event.target.value },
                          }))
                        }
                      >
                        {FREQUENCY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="text-[11px] text-white/40">
              Ajustes de SMS e WhatsApp serão liberados assim que os canais estiverem ativos.
            </div>
          </div>
        </Card>

        <Card title="Limites da conta / plano" subtitle="Uso do cliente ativo">
          {isAllTenants ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
                Selecione um cliente para visualizar limites e consumo detalhado.
              </div>
              {totalLimits && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <LimitRow label="Limite de veículos (soma)" used={"—"} total={totalLimits.deviceTotal} />
                  <LimitRow label="Limite de usuários (soma)" used={"—"} total={totalLimits.userTotal} />
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <LimitRow
                label="Veículos"
                used={vehiclesState.loading ? "..." : vehicleUsed}
                total={vehicleLimit}
                hint={vehicleLimit ? "Limite contratado" : "Sem limite configurado"}
              />
              <LimitRow
                label="Usuários"
                used={userCountLoading ? "..." : userCount}
                total={userLimit}
                hint={usersPermission.isFull ? "" : "Sem permissão para detalhar usuários"}
              />
            </div>
          )}
        </Card>

        <Card
          title="Preferências da plataforma"
          subtitle="Idioma, fuso horário, unidades e tema"
          actions={
            <Button type="button" onClick={handlePreferencesSave} disabled={savingPrefs}>
              {savingPrefs ? "Salvando..." : "Salvar preferências"}
            </Button>
          }
        >
          <div className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="text-xs font-medium text-white/70">Idioma</div>
                <select
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  value={preferences.locale}
                  onChange={(event) => setPreferences((prev) => ({ ...prev, locale: event.target.value }))}
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium text-white/70">Fuso horário</div>
                <select
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  value={preferences.timezone}
                  onChange={(event) => setPreferences((prev) => ({ ...prev, timezone: event.target.value }))}
                >
                  {TIMEZONE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="text-xs font-medium text-white/70">Unidades</div>
                <select
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  value={preferences.units}
                  onChange={(event) => setPreferences((prev) => ({ ...prev, units: event.target.value }))}
                >
                  {UNIT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80">
                <span>Tema escuro</span>
                <input
                  type="checkbox"
                  checked={preferences.theme === "dark"}
                  onChange={(event) =>
                    setPreferences((prev) => ({ ...prev, theme: event.target.checked ? "dark" : "light" }))
                  }
                />
              </label>
            </div>

            {prefsFeedback && (
              <div
                className={`rounded-xl border px-4 py-3 text-xs ${
                  prefsFeedback.type === "success"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                    : "border-rose-500/30 bg-rose-500/10 text-rose-100"
                }`}
              >
                {prefsFeedback.message}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
