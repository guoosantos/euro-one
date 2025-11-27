import React from "react";
import { AppDataProviders } from "./contexts/AppDataProviders.jsx";
import { AppRoutes } from "./routes";

export default function App() {
  return (
    <AppDataProviders>
      <AppRoutes />
    </AppDataProviders>
  );
}
