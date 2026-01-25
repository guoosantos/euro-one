import React from "react";
import { AppDataProviders } from "./contexts/AppDataProviders.jsx";
import { AppRoutes } from "./routes";
import { useTenant } from "./lib/tenant-context";

export default function App() {
  const { isAuthenticated } = useTenant();

  if (!isAuthenticated) {
    return <AppRoutes />;
  }

  return (
    <AppDataProviders>
      <AppRoutes />
    </AppDataProviders>
  );
}
