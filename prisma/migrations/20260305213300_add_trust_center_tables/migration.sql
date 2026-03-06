CREATE TABLE IF NOT EXISTS "trust_center_user_access" (
  "id" UUID PRIMARY KEY,
  "client_id" UUID,
  "user_id" UUID,
  "user_name" TEXT NOT NULL,
  "profile" TEXT,
  "vehicle" TEXT,
  "device_name" TEXT,
  "state" TEXT NOT NULL,
  "challenge" TEXT,
  "validation_method" TEXT,
  "action_type" TEXT,
  "result" TEXT,
  "last_heartbeat_at" TIMESTAMP(3),
  "last_attempt_at" TIMESTAMP(3),
  "last_access_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "trust_center_user_access_client_state_idx"
  ON "trust_center_user_access" ("client_id", "state");

CREATE INDEX IF NOT EXISTS "trust_center_user_access_user_idx"
  ON "trust_center_user_access" ("user_id");

CREATE TABLE IF NOT EXISTS "trust_center_activity" (
  "id" UUID PRIMARY KEY,
  "client_id" UUID,
  "user_id" UUID,
  "date" TIMESTAMP(3) NOT NULL,
  "user_name" TEXT,
  "profile" TEXT,
  "client_name" TEXT,
  "vehicle" TEXT,
  "device_name" TEXT,
  "method" TEXT,
  "action" TEXT,
  "result" TEXT,
  "created_by" TEXT,
  "used_by" TEXT,
  "extra" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "trust_center_activity_client_date_idx"
  ON "trust_center_activity" ("client_id", "date");

CREATE INDEX IF NOT EXISTS "trust_center_activity_user_date_idx"
  ON "trust_center_activity" ("user_id", "date");

CREATE TABLE IF NOT EXISTS "trust_center_counter_keys" (
  "id" UUID PRIMARY KEY,
  "client_id" UUID,
  "target_user_id" UUID,
  "target_user_name" TEXT NOT NULL,
  "client_name" TEXT,
  "vehicle" TEXT,
  "device_name" TEXT,
  "base_password_hash" TEXT NOT NULL,
  "counter_key" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "uses_count" INTEGER NOT NULL DEFAULT 0,
  "max_uses" INTEGER NOT NULL DEFAULT 1,
  "created_by" JSONB,
  "used_by" JSONB,
  "first_used_at" TIMESTAMP(3),
  "last_used_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "trust_center_counter_keys_client_status_idx"
  ON "trust_center_counter_keys" ("client_id", "status");

CREATE INDEX IF NOT EXISTS "trust_center_counter_keys_target_user_idx"
  ON "trust_center_counter_keys" ("target_user_id");
