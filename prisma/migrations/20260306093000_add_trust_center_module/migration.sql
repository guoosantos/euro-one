-- CreateTable
CREATE TABLE IF NOT EXISTS "trust_center_user_state" (
  "id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "vehicle_id" TEXT,
  "esp32_device_id" TEXT NOT NULL,
  "status_state" TEXT NOT NULL,
  "challenge" TEXT,
  "validation_method" TEXT,
  "last_result" TEXT,
  "last_action_type" TEXT,
  "last_password_last6" TEXT,
  "last_heartbeat_at" TIMESTAMP(3),
  "last_attempt_at" TIMESTAMP(3),
  "last_access_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trust_center_user_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "trust_center_event" (
  "id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "user_id" TEXT,
  "vehicle_id" TEXT,
  "esp32_device_id" TEXT,
  "state" TEXT,
  "method" TEXT,
  "action" TEXT NOT NULL,
  "result" TEXT,
  "created_by" TEXT,
  "used_by" TEXT,
  "ip_address" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trust_center_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "trust_center_counter_key" (
  "id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "vehicle_id" TEXT,
  "esp32_device_id" TEXT NOT NULL,
  "base_password_hash" TEXT NOT NULL,
  "base_password_salt" TEXT NOT NULL,
  "counter_key" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "uses_count" INTEGER NOT NULL DEFAULT 0,
  "max_uses" INTEGER NOT NULL DEFAULT 1,
  "expires_at" TIMESTAMP(3),
  "first_used_at" TIMESTAMP(3),
  "last_used_at" TIMESTAMP(3),
  "created_by" TEXT,
  "used_by" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trust_center_counter_key_pkey" PRIMARY KEY ("id")
);

-- Constraints
DO $$
BEGIN
  ALTER TABLE "trust_center_user_state"
    ADD CONSTRAINT "trust_center_user_state_client_user_device_key"
    UNIQUE ("client_id", "user_id", "esp32_device_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "trust_center_user_state_client_status_idx"
  ON "trust_center_user_state" ("client_id", "status_state");
CREATE INDEX IF NOT EXISTS "trust_center_user_state_client_device_idx"
  ON "trust_center_user_state" ("client_id", "esp32_device_id");
CREATE INDEX IF NOT EXISTS "trust_center_user_state_heartbeat_idx"
  ON "trust_center_user_state" ("last_heartbeat_at");
CREATE INDEX IF NOT EXISTS "trust_center_user_state_attempt_idx"
  ON "trust_center_user_state" ("last_attempt_at");
CREATE INDEX IF NOT EXISTS "trust_center_user_state_access_idx"
  ON "trust_center_user_state" ("last_access_at");

CREATE INDEX IF NOT EXISTS "trust_center_event_client_created_idx"
  ON "trust_center_event" ("client_id", "created_at");
CREATE INDEX IF NOT EXISTS "trust_center_event_client_user_created_idx"
  ON "trust_center_event" ("client_id", "user_id", "created_at");
CREATE INDEX IF NOT EXISTS "trust_center_event_client_device_created_idx"
  ON "trust_center_event" ("client_id", "esp32_device_id", "created_at");
CREATE INDEX IF NOT EXISTS "trust_center_event_action_created_idx"
  ON "trust_center_event" ("action", "created_at");
CREATE INDEX IF NOT EXISTS "trust_center_event_result_created_idx"
  ON "trust_center_event" ("result", "created_at");

CREATE INDEX IF NOT EXISTS "trust_center_counter_key_client_created_idx"
  ON "trust_center_counter_key" ("client_id", "created_at");
CREATE INDEX IF NOT EXISTS "trust_center_counter_key_client_status_created_idx"
  ON "trust_center_counter_key" ("client_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "trust_center_counter_key_client_user_created_idx"
  ON "trust_center_counter_key" ("client_id", "user_id", "created_at");
CREATE INDEX IF NOT EXISTS "trust_center_counter_key_value_idx"
  ON "trust_center_counter_key" ("counter_key");

-- Foreign keys
DO $$
BEGIN
  ALTER TABLE "trust_center_user_state"
    ADD CONSTRAINT "trust_center_user_state_client_fkey"
    FOREIGN KEY ("client_id") REFERENCES "Client"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "trust_center_user_state"
    ADD CONSTRAINT "trust_center_user_state_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "trust_center_user_state"
    ADD CONSTRAINT "trust_center_user_state_vehicle_fkey"
    FOREIGN KEY ("vehicle_id") REFERENCES "Vehicle"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "trust_center_event"
    ADD CONSTRAINT "trust_center_event_client_fkey"
    FOREIGN KEY ("client_id") REFERENCES "Client"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "trust_center_event"
    ADD CONSTRAINT "trust_center_event_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "trust_center_event"
    ADD CONSTRAINT "trust_center_event_vehicle_fkey"
    FOREIGN KEY ("vehicle_id") REFERENCES "Vehicle"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "trust_center_counter_key"
    ADD CONSTRAINT "trust_center_counter_key_client_fkey"
    FOREIGN KEY ("client_id") REFERENCES "Client"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "trust_center_counter_key"
    ADD CONSTRAINT "trust_center_counter_key_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "trust_center_counter_key"
    ADD CONSTRAINT "trust_center_counter_key_vehicle_fkey"
    FOREIGN KEY ("vehicle_id") REFERENCES "Vehicle"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
