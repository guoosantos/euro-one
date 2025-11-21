import React from "react";
import { Link } from "react-router-dom";
import { useTenant } from "../lib/tenant-context";

export default function NotFound() {
  const { isAuthenticated } = useTenant();
  const primaryCta = isAuthenticated ? "/dashboard" : "/login";
  const primaryLabel = isAuthenticated ? "Voltar ao painel" : "Ir para login";

  return (
    <div className="flex min-h-[70vh] items-center justify-center bg-bg text-text">
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-6 text-center">
        <div className="text-6xl font-extrabold text-primary">404</div>
        <h1 className="text-2xl font-semibold">Página não encontrada</h1>
        <p className="text-sm text-gray-500">
          O endereço acessado não existe ou pode ter sido movido. Verifique a URL ou retorne para uma
          página segura do sistema.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            to={primaryCta}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90"
          >
            {primaryLabel}
          </Link>
          {isAuthenticated ? (
            <Link
              to="/monitoring"
              className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:border-primary hover:text-primary"
            >
              Abrir monitoramento
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
