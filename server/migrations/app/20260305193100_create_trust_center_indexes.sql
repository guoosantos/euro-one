CREATE INDEX IF NOT EXISTS idx_tc_user_access_client_state
  ON trust_center_user_access (client_id, state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tc_user_access_client_user
  ON trust_center_user_access (client_id, user_id);

CREATE INDEX IF NOT EXISTS idx_tc_activity_client_date
  ON trust_center_activity (client_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_tc_activity_client_user
  ON trust_center_activity (client_id, user_id);

CREATE INDEX IF NOT EXISTS idx_tc_activity_client_device
  ON trust_center_activity (client_id, device_id);

CREATE INDEX IF NOT EXISTS idx_tc_counter_key_client_status
  ON trust_center_counter_key (client_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tc_counter_key_client_target_user
  ON trust_center_counter_key (client_id, target_user_id);

CREATE INDEX IF NOT EXISTS idx_tc_audit_client_created
  ON trust_center_audit (client_id, created_at DESC);
