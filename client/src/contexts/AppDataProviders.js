import React from "react";
import { TelemetryProvider } from "./TelemetryContext.js";
import { LivePositionsProvider } from "./LivePositionsContext.js";
import { DevicesProvider } from "./DevicesContext.js";
import { EventsProvider } from "./EventsContext.js";

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
