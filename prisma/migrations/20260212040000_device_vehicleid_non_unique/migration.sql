-- Permite múltiplos equipamentos vinculados ao mesmo veículo.
DROP INDEX IF EXISTS "Device_vehicleId_key";

CREATE INDEX IF NOT EXISTS "Device_vehicleId_idx" ON "Device" ("vehicleId");
