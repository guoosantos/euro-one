-- Add command dispatch tracking and custom commands
CREATE TABLE IF NOT EXISTS "command_dispatches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clientId" UUID,
    "vehicleId" UUID NOT NULL,
    "traccarId" INTEGER NOT NULL,
    "commandKey" TEXT,
    "commandName" TEXT,
    "payloadSummary" JSONB,
    "sentAt" TIMESTAMPTZ NOT NULL,
    "status" TEXT NOT NULL,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "command_dispatches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "custom_commands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clientId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "custom_commands_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "command_dispatches_vehicleId_sentAt_idx"
    ON "command_dispatches"("vehicleId", "sentAt");
CREATE INDEX IF NOT EXISTS "command_dispatches_clientId_vehicleId_sentAt_idx"
    ON "command_dispatches"("clientId", "vehicleId", "sentAt");
CREATE INDEX IF NOT EXISTS "custom_commands_clientId_visible_idx"
    ON "custom_commands"("clientId", "visible");
