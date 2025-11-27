import React from "react";
import { TelemetryProvider } from "./TelemetryContext.jsx";
import { LivePositionsProvider } from "./LivePositionsContext.jsx";
import { DevicesProvider } from "./DevicesContext.jsx";
import { EventsProvider } from "./EventsContext.jsx";

export function AppDataProviders({ children }) {
  return (
    <TelemetryProvider>
      <LivePositionsProvider>
        <DevicesProvider>
          <EventsProvider>{children}</EventsProvider>
        </DevicesProvider>
      </LivePositionsProvider>
    </TelemetryProvider>
  );
}

export default AppDataProviders;
