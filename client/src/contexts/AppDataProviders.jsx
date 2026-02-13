import React from "react";
import { TelemetryProvider } from "./TelemetryContext.jsx";
import { LivePositionsProvider } from "./LivePositionsContext.jsx";
import { DevicesProvider } from "./DevicesContext.jsx";
import { EventsProvider } from "./EventsContext.jsx";
import { VehicleAccessProvider } from "./VehicleAccessContext.jsx";
import ConjugatedAlertsModalHost from "../components/alerts/ConjugatedAlertsModalHost.jsx";

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const MIN_POLL_INTERVAL_MS = 3_000;
const MAX_POLL_INTERVAL_MS = 120_000;

function resolvePollInterval(rawValue, fallback = DEFAULT_POLL_INTERVAL_MS) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, parsed));
}

export function AppDataProviders({ children }) {
  const telemetryInterval = resolvePollInterval(import.meta.env?.VITE_TELEMETRY_POLL_INTERVAL_MS);
  const livePositionsInterval = resolvePollInterval(import.meta.env?.VITE_LIVE_POSITIONS_POLL_INTERVAL_MS);

  return (
    <VehicleAccessProvider>
      <TelemetryProvider interval={telemetryInterval}>
        <LivePositionsProvider interval={livePositionsInterval}>
          <DevicesProvider>
            <EventsProvider>
              {children}
              <ConjugatedAlertsModalHost />
            </EventsProvider>
          </DevicesProvider>
        </LivePositionsProvider>
      </TelemetryProvider>
    </VehicleAccessProvider>
  );
}

export default AppDataProviders;
