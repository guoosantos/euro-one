import React from "react";
import { AppDataProviders } from "./contexts/AppDataProviders.jsx";
import { AppRoutes } from "./routes";
import { useTenant } from "./lib/tenant-context";
import ConfirmDialogProvider from "./components/ui/ConfirmDialogProvider.jsx";

export default function App() {
  const { isAuthenticated } = useTenant();

  if (!isAuthenticated) {
    return <AppRoutes />;
  }

  return (
    <ConfirmDialogProvider>
      <AppDataProviders>
        <AppRoutes />
      </AppDataProviders>
    </ConfirmDialogProvider>
  );
}
