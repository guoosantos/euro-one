-- CreateTable
CREATE TABLE IF NOT EXISTS "nt407_positions" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT,
  "terminalId" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "speedKmh" DOUBLE PRECISION,
  "altitude" INTEGER,
  "direction" INTEGER,
  "alarmFlags" INTEGER,
  "statusFlags" INTEGER,
  "extras" JSONB,
  "protocol" TEXT DEFAULT 'jt808',
  "timestamp" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nt407_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "nt407_events" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT,
  "terminalId" TEXT NOT NULL,
  "msgId" TEXT,
  "eventType" TEXT NOT NULL,
  "severity" TEXT,
  "source" TEXT,
  "cameraChannel" INTEGER,
  "fatigueScore" INTEGER,
  "durationSec" INTEGER,
  "metadata" JSONB,
  "timestamp" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nt407_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "nt407_media" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT,
  "terminalId" TEXT NOT NULL,
  "cameraChannel" INTEGER,
  "mediaType" TEXT NOT NULL,
  "mediaFormat" TEXT,
  "eventType" TEXT,
  "source" TEXT,
  "filePath" TEXT,
  "fileSize" INTEGER,
  "metadata" JSONB,
  "startTime" TIMESTAMP(3) NOT NULL,
  "endTime" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nt407_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "nt407_positions_deviceId_timestamp_idx" ON "nt407_positions" ("deviceId", "timestamp");
CREATE INDEX IF NOT EXISTS "nt407_positions_terminalId_timestamp_idx" ON "nt407_positions" ("terminalId", "timestamp");

CREATE INDEX IF NOT EXISTS "nt407_events_deviceId_timestamp_idx" ON "nt407_events" ("deviceId", "timestamp");
CREATE INDEX IF NOT EXISTS "nt407_events_terminalId_timestamp_idx" ON "nt407_events" ("terminalId", "timestamp");
CREATE INDEX IF NOT EXISTS "nt407_events_eventType_timestamp_idx" ON "nt407_events" ("eventType", "timestamp");

CREATE INDEX IF NOT EXISTS "nt407_media_deviceId_startTime_idx" ON "nt407_media" ("deviceId", "startTime");
CREATE INDEX IF NOT EXISTS "nt407_media_terminalId_startTime_idx" ON "nt407_media" ("terminalId", "startTime");
CREATE INDEX IF NOT EXISTS "nt407_media_eventType_startTime_idx" ON "nt407_media" ("eventType", "startTime");

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "nt407_positions"
    ADD CONSTRAINT "nt407_positions_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "nt407_events"
    ADD CONSTRAINT "nt407_events_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "nt407_media"
    ADD CONSTRAINT "nt407_media_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
