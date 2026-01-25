import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";

import App from "./App";
import { queryClient } from "./lib/query";
import { TenantProvider } from "./lib/tenant-context";
import { installFiltersPolish } from "./lib/filters-polish";
import ConfirmDialogProvider from "./components/ui/ConfirmDialogProvider.jsx";

import "./styles.css";
import "./styles/euro-ui.css";

installFiltersPolish();

const root = document.getElementById("root");

if (!root) {
  throw new Error("Elemento root não encontrado");
}

createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <ConfirmDialogProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ConfirmDialogProvider>
      </TenantProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
