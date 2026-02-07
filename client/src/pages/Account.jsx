import React, { useEffect, useMemo, useRef, useState } from "react";

import { useTenant } from "../lib/tenant-context";
import { useUI } from "../lib/store";
import safeApi from "../lib/safe-api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { setStoredSession } from "../lib/api.js";
import PageHeader from "../components/ui/PageHeader.jsx";
import Card from "../ui/Card";
import Input from "../ui/Input";
import Button from "../ui/Button";

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

const emptyPasswordState = { current: "", next: "", confirm: "" };

function buildProfileState(user) {
  const attributes = user?.attributes || {};
  return {
    name: user?.name || "",
    email: user?.email || "",
    phone: attributes.phone || "",
    jobTitle: attributes.jobTitle || attributes.title || "",
    description: attributes.description || attributes.roleDescription || "",
  };
}

function buildPreferencesState(user, ui) {
  const attributes = user?.attributes || {};
  return {
    locale: attributes.locale || ui?.locale || "pt-BR",
    timezone: attributes.timezone || "America/Sao_Paulo",
    theme: attributes.theme || ui?.theme || "dark",
  };
}

function normalizeValue(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

export default function Account() {
  const { tenant, tenants, setTenantId, user, role, canSwitchTenant, isReadOnly, mirrorContextMode } = useTenant();
  const { theme, locale, setTheme, setLocale } = useUI((state) => ({
    theme: state.theme,
    locale: state.locale,
    setTheme: state.setTheme,
    setLocale: state.setLocale,
  }));
  const [profile, setProfile] = useState(() => buildProfileState(user));
  const [preferences, setPreferences] = useState(() => buildPreferencesState(user, { theme, locale }));
  const [passwords, setPasswords] = useState(emptyPasswordState);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const initialRef = useRef({
    profile: buildProfileState(user),
    preferences: buildPreferencesState(user, { theme, locale }),
  });
  const isAdmin = role === "admin";
  const isMirrorTarget = mirrorContextMode === "target";
  const tenantList = Array.isArray(tenants) ? tenants : [];
  const canEditEmail = !user?.attributes?.emailLocked && !user?.attributes?.lockEmail;

  useEffect(() => {
    const nextProfile = buildProfileState(user);
    const nextPreferences = buildPreferencesState(user, { theme, locale });
    setProfile(nextProfile);
    setPreferences(nextPreferences);
    setPasswords(emptyPasswordState);
    initialRef.current = { profile: nextProfile, preferences: nextPreferences };
    setFeedback(null);
  }, [user?.id]);

  const hasProfileChanges = useMemo(() => {
    const snapshot = initialRef.current;
    if (!snapshot) return false;
    return (
      JSON.stringify(snapshot.profile) !== JSON.stringify(profile) ||
      JSON.stringify(snapshot.preferences) !== JSON.stringify(preferences)
    );
  }, [profile, preferences]);

  const hasPasswordChanges = useMemo(
    () => Boolean(passwords.current || passwords.next || passwords.confirm),
    [passwords.current, passwords.next, passwords.confirm],
  );

  const canSave = Boolean(user?.id) && (hasProfileChanges || hasPasswordChanges) && !saving;

  const handleCancel = () => {
    const snapshot = initialRef.current;
    if (snapshot) {
      setProfile(snapshot.profile);
      setPreferences(snapshot.preferences);
      setTheme(snapshot.preferences.theme);
      setLocale(snapshot.preferences.locale);
    }
    setPasswords(emptyPasswordState);
    setFeedback(null);
  };

  const handleSave = async () => {
    if (!user?.id) return;

    const trimmedName = normalizeValue(profile.name) || user?.name || "";
    const trimmedEmail = normalizeValue(profile.email) || user?.email || "";
    const trimmedPhone = normalizeValue(profile.phone);
    const trimmedJobTitle = normalizeValue(profile.jobTitle);
    const trimmedDescription = normalizeValue(profile.description);

    if (!trimmedName) {
      setFeedback({ type: "error", message: "Informe o nome completo." });
      return;
    }
    if (canEditEmail && !trimmedEmail) {
      setFeedback({ type: "error", message: "Informe um e-mail válido." });
      return;
    }

    if (hasPasswordChanges) {
      if (!passwords.current || !passwords.next || !passwords.confirm) {
        setFeedback({ type: "error", message: "Preencha senha atual, nova e confirmação." });
        return;
      }
      if (passwords.next !== passwords.confirm) {
        setFeedback({ type: "error", message: "A confirmação de senha não confere." });
        return;
      }
    }

    setSaving(true);
    setFeedback(null);

    try {
      const nextAttributes = {
        ...(user?.attributes || {}),
        phone: trimmedPhone || null,
        jobTitle: trimmedJobTitle || null,
        description: trimmedDescription || null,
        timezone: preferences.timezone || null,
        locale: preferences.locale || null,
        theme: preferences.theme || null,
      };

      const payload = {
        name: trimmedName,
        attributes: nextAttributes,
      };

      if (canEditEmail) {
        payload.email = trimmedEmail;
      }

      if (hasPasswordChanges) {
        payload.password = passwords.next;
      }

      const { data, error } = await safeApi.put(`${API_ROUTES.users}/${user.id}`, payload);
      if (error) {
        throw error;
      }

      const updatedUser = data?.user || { ...user, ...payload, attributes: nextAttributes };
      setStoredSession({ token: null, user: updatedUser });
      setProfile(buildProfileState(updatedUser));
      setPreferences(buildPreferencesState(updatedUser, { theme: preferences.theme, locale: preferences.locale }));
      initialRef.current = {
        profile: buildProfileState(updatedUser),
        preferences: buildPreferencesState(updatedUser, { theme: preferences.theme, locale: preferences.locale }),
      };
      setPasswords(emptyPasswordState);
      setTheme(preferences.theme);
      setLocale(preferences.locale);
      setFeedback({ type: "success", message: "Perfil atualizado com sucesso." });
    } catch (saveError) {
      setFeedback({ type: "error", message: saveError?.message || "Falha ao salvar perfil." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Perfil do usuário"
        subtitle="Atualize seus dados, preferências e segurança da conta."
        actions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={handleCancel} disabled={saving}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleSave} disabled={!canSave}>
              {saving ? "Salvando..." : "Salvar alterações"}
            </Button>
          </div>
        }
      />

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs ${
            feedback.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
              : "border-rose-500/30 bg-rose-500/10 text-rose-100"
          }`}
        >
          {feedback.message}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Informações pessoais" subtitle="Dados principais do seu perfil">
          <div className="grid gap-4">
            <div className="space-y-2">
              <div className="text-xs font-medium text-white/70">Nome completo</div>
              <Input
                value={profile.name}
                onChange={(event) => setProfile((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Seu nome"
              />
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium text-white/70">E-mail</div>
              <Input
                value={profile.email}
                onChange={(event) => setProfile((prev) => ({ ...prev, email: event.target.value }))}
                placeholder="email@empresa.com"
                disabled={!canEditEmail}
              />
              {!canEditEmail && <div className="text-[11px] text-white/40">E-mail bloqueado para edição.</div>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="text-xs font-medium text-white/70">Telefone</div>
                <Input
                  value={profile.phone}
                  onChange={(event) => setProfile((prev) => ({ ...prev, phone: event.target.value }))}
                  placeholder="(00) 00000-0000"
                />
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium text-white/70">Cargo/descrição</div>
                <Input
                  value={profile.jobTitle}
                  onChange={(event) => setProfile((prev) => ({ ...prev, jobTitle: event.target.value }))}
                  placeholder="Ex.: Coordenador de operações"
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium text-white/70">Descrição</div>
              <textarea
                className="w-full rounded-xl border border-stroke bg-card/60 px-3 py-2 text-sm text-white/80 focus:outline-none focus:ring-2 focus:ring-primary/30"
                rows={3}
                value={profile.description}
                onChange={(event) => setProfile((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Escreva uma breve descrição sobre sua função."
              />
            </div>
          </div>
        </Card>

        <Card title="Preferências básicas" subtitle="Idioma, fuso horário e tema">
          <div className="grid gap-4">
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
        </Card>
      </div>

      <Card title="Segurança" subtitle="Atualize sua senha de acesso">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <div className="text-xs font-medium text-white/70">Senha atual</div>
            <Input
              type="password"
              value={passwords.current}
              onChange={(event) => setPasswords((prev) => ({ ...prev, current: event.target.value }))}
              placeholder="********"
            />
          </div>
          <div className="space-y-2">
            <div className="text-xs font-medium text-white/70">Nova senha</div>
            <Input
              type="password"
              value={passwords.next}
              onChange={(event) => setPasswords((prev) => ({ ...prev, next: event.target.value }))}
              placeholder="********"
            />
          </div>
          <div className="space-y-2">
            <div className="text-xs font-medium text-white/70">Confirmar nova senha</div>
            <Input
              type="password"
              value={passwords.confirm}
              onChange={(event) => setPasswords((prev) => ({ ...prev, confirm: event.target.value }))}
              placeholder="********"
            />
          </div>
        </div>
        <div className="mt-3 text-[11px] text-white/50">
          Use uma senha forte e atualize sempre que necessário.
        </div>
      </Card>

      {isReadOnly || isMirrorTarget ? (
        <Card title="Organização/Cliente" subtitle="Acesso espelhado somente leitura">
          <div className="space-y-2">
            <div className="text-xs text-white/60">Cliente ativo</div>
            <div className="text-sm text-white/80">{tenant?.name ?? "Nenhum"}</div>
            <div className="text-xs text-white/40">Perfil: {role}</div>
          </div>
        </Card>
      ) : (
        <details className="card p-5 md:p-6">
          <summary className="cursor-pointer text-sm font-semibold text-white">Organização/Cliente</summary>
          <div className="mt-4 space-y-3">
            <div className="text-xs text-white/60">Cliente ativo</div>
            <div className="text-sm text-white/80">{tenant?.name ?? "Nenhum"}</div>
            <div className="text-xs text-white/40">Perfil: {role}</div>
          </div>
          <div className="mt-4">
            <div className="text-sm font-medium text-white">Alternar cliente</div>
            <p className="mt-1 text-xs text-white/50">
              {isAdmin || canSwitchTenant
                ? "Selecione um cliente para visualizar seus dispositivos, usuários e telemetria."
                : "Sua conta está vinculada ao cliente abaixo."}
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {tenantList.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTenantId(item.id)}
                  className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                    tenant?.id === item.id
                      ? "border-primary/40 bg-primary/10"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="font-medium text-white">{item.name}</div>
                  <div className="text-xs text-white/50">
                    Limites: {item.deviceLimit ?? "∞"} dispositivos · {item.userLimit ?? "∞"} usuários
                  </div>
                </button>
              ))}
              {!tenantList.length && (
                <div className="rounded-xl border border-dashed border-white/20 p-4 text-sm text-white/50">
                  Nenhum cliente disponível.
                </div>
              )}
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
