import React from "react";
import { TelemetryProvider } from "./TelemetryContext.jsx";
import { LivePositionsProvider } from "./LivePositionsContext.jsx";
import { DevicesProvider } from "./DevicesContext.jsx";
import { EventsProvider } from "./EventsContext.jsx";
import { VehicleAccessProvider } from "./VehicleAccessContext.jsx";

export function AppDataProviders({ children }) {
  return (
    <VehicleAccessProvider>
      <TelemetryProvider>
        <LivePositionsProvider>
          <DevicesProvider>
            <EventsProvider>{children}</EventsProvider>
          </DevicesProvider>
        </LivePositionsProvider>
      </TelemetryProvider>
    </VehicleAccessProvider>
  );
}

export default AppDataProviders;
