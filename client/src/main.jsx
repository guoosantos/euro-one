import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";

import App from "./App";
import { queryClient } from "./lib/query";
import { TenantProvider } from "./lib/tenant-context";
import { installFiltersPolish } from "./lib/filters-polish";
import ConfirmDialogProvider from "./components/ui/ConfirmDialogProvider.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";

import "./styles.css";
import "./styles/euro-ui.css";
import "./lib/map/leaflet-default-icon.js";

installFiltersPolish();

const root = document.getElementById("root");

if (!root) {
  throw new Error("Elemento root não encontrado");
}

if (typeof window !== "undefined" && !window.__euroOneGlobalErrors) {
  window.__euroOneGlobalErrors = true;
  window.addEventListener("error", (event) => {
    const message = event?.error?.message || event?.message || "Erro desconhecido";
    console.error("[global-error]", message, event?.error || event);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const message = reason?.message || String(reason || "Promise rejeitada");
    console.error("[global-rejection]", message, reason);
  });
}

if (typeof window !== "undefined" && !window.__euroOneHistoryGuardInstalled) {
  window.__euroOneHistoryGuardInstalled = true;
  const originalReplaceState = window.history.replaceState.bind(window.history);
  let burstCount = 0;
  let lastTarget = "";
  let lastAt = 0;
  let lastWarnAt = 0;

  window.history.replaceState = function patchedReplaceState(state, unused, url) {
    try {
      const currentHref = window.location.href;
      const resolved = url == null ? new URL(currentHref) : new URL(String(url), currentHref);
      const nextTarget = `${resolved.pathname}${resolved.search}${resolved.hash}`;
      const now = Date.now();
      if (nextTarget === lastTarget && now - lastAt <= 400) {
        burstCount += 1;
      } else {
        burstCount = 1;
        lastTarget = nextTarget;
      }
      lastAt = now;
      if (burstCount > 20) {
        if (now - lastWarnAt > 1500) {
          lastWarnAt = now;
          console.warn("[history-guard] replaceState flood bloqueado", { target: nextTarget, burstCount });
        }
        return;
      }
    } catch (_error) {
      // fallback: sempre delega ao original
    }

    return originalReplaceState(state, unused, url);
  };
}

createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <ConfirmDialogProvider>
          <BrowserRouter>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </BrowserRouter>
        </ConfirmDialogProvider>
      </TenantProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
