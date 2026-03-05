-- CreateTable
CREATE TABLE IF NOT EXISTS "trust_center_user_states" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "userId" TEXT,
  "userName" TEXT,
  "profile" TEXT,
  "clientName" TEXT,
  "vehicleId" TEXT,
  "vehicleLabel" TEXT,
  "esp32Device" TEXT,
  "actionType" TEXT,
  "result" TEXT,
  "state" TEXT NOT NULL,
  "challenge" TEXT,
  "validationMethod" TEXT,
  "lastHeartbeatAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "lastAccessAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trust_center_user_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "trust_center_activity_events" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "userId" TEXT,
  "userName" TEXT,
  "profile" TEXT,
  "clientName" TEXT,
  "vehicleId" TEXT,
  "vehicleLabel" TEXT,
  "esp32Device" TEXT,
  "method" TEXT,
  "action" TEXT NOT NULL,
  "result" TEXT,
  "state" TEXT,
  "eventType" TEXT NOT NULL DEFAULT 'activity',
  "payload" JSONB,
  "createdBy" TEXT,
  "usedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trust_center_activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "trust_center_counter_keys" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userName" TEXT,
  "targetUserId" TEXT,
  "targetUserName" TEXT,
  "clientName" TEXT,
  "vehicleId" TEXT,
  "vehicleLabel" TEXT,
  "esp32Device" TEXT,
  "basePinHash" TEXT NOT NULL,
  "challenge" TEXT,
  "counterKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ATIVA',
  "usesCount" INTEGER NOT NULL DEFAULT 0,
  "maxUses" INTEGER,
  "expiresAt" TIMESTAMP(3),
  "firstUsedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "usedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trust_center_counter_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "trust_center_user_states_client_state_idx"
  ON "trust_center_user_states" ("clientId", "state");

CREATE INDEX IF NOT EXISTS "trust_center_user_states_client_user_idx"
  ON "trust_center_user_states" ("clientId", "userId");

CREATE INDEX IF NOT EXISTS "trust_center_user_states_client_device_idx"
  ON "trust_center_user_states" ("clientId", "esp32Device");

CREATE INDEX IF NOT EXISTS "trust_center_user_states_heartbeat_idx"
  ON "trust_center_user_states" ("lastHeartbeatAt");

CREATE INDEX IF NOT EXISTS "trust_center_activity_client_created_idx"
  ON "trust_center_activity_events" ("clientId", "createdAt");

CREATE INDEX IF NOT EXISTS "trust_center_activity_client_user_created_idx"
  ON "trust_center_activity_events" ("clientId", "userId", "createdAt");

CREATE INDEX IF NOT EXISTS "trust_center_activity_client_device_created_idx"
  ON "trust_center_activity_events" ("clientId", "esp32Device", "createdAt");

CREATE INDEX IF NOT EXISTS "trust_center_counter_keys_client_status_created_idx"
  ON "trust_center_counter_keys" ("clientId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "trust_center_counter_keys_client_user_created_idx"
  ON "trust_center_counter_keys" ("clientId", "userId", "createdAt");

CREATE INDEX IF NOT EXISTS "trust_center_counter_keys_client_target_created_idx"
  ON "trust_center_counter_keys" ("clientId", "targetUserId", "createdAt");
