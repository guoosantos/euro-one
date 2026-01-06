ALTER TABLE tc_positions ADD COLUMN IF NOT EXISTS address_status VARCHAR(20);
ALTER TABLE tc_positions ADD COLUMN IF NOT EXISTS address_provider VARCHAR(50);
ALTER TABLE tc_positions ADD COLUMN IF NOT EXISTS address_updated_at TIMESTAMP;
ALTER TABLE tc_positions ADD COLUMN IF NOT EXISTS address_error VARCHAR(200);

CREATE INDEX idx_tc_positions_address_status ON tc_positions (address_status);
CREATE INDEX idx_tc_positions_deviceid_fixtime ON tc_positions (deviceid, fixtime);
