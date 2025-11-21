import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTenant } from "../lib/tenant-context";
import { useTranslation } from "../lib/i18n";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, loading, error } = useTenant();
  const { t } = useTranslation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [formError, setFormError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);
    try {
      await login({ username, password, remember });
      const redirectTo = location.state?.from?.pathname || "/home";
      navigate(redirectTo, { replace: true });
    } catch (submitError) {
      setFormError(
        submitError?.response?.data?.message ||
          submitError?.message ||
          "Não foi possível autenticar. Verifique suas credenciais e tente novamente.",
      );
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface text-text">
      <div className="w-full max-w-md rounded-2xl border border-border bg-layer/80 p-8 shadow-2xl backdrop-blur">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold">{t("loginTitle")}</h1>
          <p className="mt-2 text-sm opacity-80">
            Utilize suas credenciais do Traccar para acessar monitoramento, telemetria e dashboards.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-left">
            <span className="text-sm font-medium">{t("username")} (e-mail)</span>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              autoComplete="username"
              className="mt-1 w-full rounded-lg border border-border bg-layer px-4 py-2 text-sm focus:border-primary focus:outline-none"
              placeholder="usuario@empresa.com"
            />
          </label>

          <label className="block text-left">
            <span className="text-sm font-medium">{t("password")}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
              className="mt-1 w-full rounded-lg border border-border bg-layer px-4 py-2 text-sm focus:border-primary focus:outline-none"
              placeholder="••••••••"
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            {t("rememberMe")}
          </label>

          {(formError || error) && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {formError || error?.message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <div className="mt-6 text-center text-xs opacity-70">
          <p>
            Servidor Traccar configurado via variáveis de ambiente. Consulte o README para detalhes de configuração
            da API e criação de usuários.
          </p>
        </div>
      </div>
    </div>
  );
}
