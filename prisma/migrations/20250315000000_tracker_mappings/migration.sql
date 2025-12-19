-- Telemetry and event mappings for tracker customization
CREATE TABLE IF NOT EXISTS "TelemetryFieldMapping" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "clientId" TEXT NOT NULL,
  "deviceId" TEXT,
  "protocol" TEXT,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "dataType" TEXT NOT NULL DEFAULT 'string',
  "unit" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelemetryFieldMapping_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TelemetryFieldMapping_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TelemetryFieldMapping_unique_key" UNIQUE ("clientId", "deviceId", "protocol", "key")
);

CREATE TABLE IF NOT EXISTS "EventMapping" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "clientId" TEXT NOT NULL,
  "deviceId" TEXT,
  "protocol" TEXT,
  "eventKey" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventMapping_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EventMapping_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "EventMapping_unique_key" UNIQUE ("clientId", "deviceId", "protocol", "eventKey")
);
