import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useTenant } from "../lib/tenant-context";
import { useTranslation } from "../lib/i18n";
import EagleSprite from "../components/eagle/EagleSprite";
import useEagleLoader from "../lib/hooks/useEagleLoader";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, loading, error } = useTenant();
  const { t } = useTranslation();
  const { register } = useEagleLoader();
  const loaderRef = useRef(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      const status = Number(submitError?.status || submitError?.response?.status);
      const payload = submitError?.response?.data || {};
      if (payload?.errorCode) {
        console.error("Falha no login", { errorCode: payload.errorCode, error: payload.error });
      }
      if (status === 401) {
        setFormError("Usuário ou senha inválidos");
        return;
      }
      if (status === 403) {
        setFormError(
          payload?.error || payload?.message || "Acesso não autorizado. Solicite permissão ao administrador.",
        );
        return;
      }
      setFormError(
        payload?.error ||
          payload?.message ||
          submitError?.message ||
          "Não foi possível autenticar. Verifique suas credenciais e tente novamente.",
      );
    }
  }

  useEffect(() => {
    if (loading && !loaderRef.current) {
      loaderRef.current = register("Validando acesso...");
    }

    if (!loading && loaderRef.current) {
      loaderRef.current();
      loaderRef.current = null;
    }

    return () => {
      if (loaderRef.current) {
        loaderRef.current();
        loaderRef.current = null;
      }
    };
  }, [loading, register]);

  return (
    <div className="eagle-login">
      <div className="eagle-bg" />
      <div className="eagle-grid" />
      <div className="eagle-noise" />

      <div className="eagle-card">
        <div className="eagle-inner">
          <div className="eagle-brand-row">
            <EagleSprite className="eagle-sprite eagle-sprite--mark" />
            <div className="eagle-titles">
              <h1>{t("loginTitle")}</h1>
              <p>Acesse sua conta para acompanhar a operação em tempo real.</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="eagle-form">
            <label className="eagle-field">
              <span className="eagle-label">{t("username")} (e-mail)</span>
              <div className="eagle-input">
                <Mail />
                <input
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                  autoComplete="username"
                  placeholder="usuario@empresa.com"
                />
              </div>
            </label>

            <label className="eagle-field">
              <span className="eagle-label">{t("password")}</span>
              <div className="eagle-input">
                <Lock />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  className="eagle-toggle"
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <div className="eagle-row">
              <label className="eagle-check">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                {t("rememberMe")}
              </label>
              <a className="eagle-link" href="#">
                Precisa de ajuda?
              </a>
            </div>

            {(formError || error) && <div className="eagle-error">{formError || error?.message}</div>}

            <button type="submit" disabled={loading} className="eagle-btn">
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>

          <div className="eagle-meta">
            <span className="eagle-chip">
              <span className="eagle-dot" />
              Ambiente seguro
            </span>
            <span>Suas credenciais permanecem protegidas.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
