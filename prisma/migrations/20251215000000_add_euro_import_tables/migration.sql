-- Add Euro import tables and vehicle external reference
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "externalRef" TEXT;

CREATE TABLE IF NOT EXISTS "EquipmentProduct" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameNormalized" TEXT NOT NULL,
  "isNonTracked" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EquipmentProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Equipment" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "vehicleId" TEXT,
  "productId" TEXT,
  "internalId" TEXT NOT NULL,
  "status" TEXT,
  "condition" TEXT,
  "location" TEXT,
  "warrantyDays" INTEGER,
  "priceValue" DOUBLE PRECISION,
  "externalRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ServiceOrder" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "vehicleId" TEXT,
  "osInternalId" TEXT NOT NULL,
  "type" TEXT,
  "status" TEXT,
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "technicianName" TEXT,
  "address" TEXT,
  "addressStart" TEXT,
  "addressReturn" TEXT,
  "km" DOUBLE PRECISION,
  "reason" TEXT,
  "notes" TEXT,
  "responsibleName" TEXT,
  "responsiblePhone" TEXT,
  "clientValue" DOUBLE PRECISION,
  "technicianValue" DOUBLE PRECISION,
  "serial" TEXT,
  "externalRef" TEXT,
  "equipmentsText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EuroImportLog" (
  "id" TEXT NOT NULL,
  "clientId" TEXT,
  "userId" TEXT,
  "fileName" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "importMode" TEXT NOT NULL,
  "summary" JSONB,
  "warnings" JSONB,
  "errors" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EuroImportLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EquipmentProduct_clientId_nameNormalized_key" ON "EquipmentProduct"("clientId", "nameNormalized");
CREATE UNIQUE INDEX IF NOT EXISTS "Equipment_clientId_internalId_key" ON "Equipment"("clientId", "internalId");
CREATE UNIQUE INDEX IF NOT EXISTS "ServiceOrder_clientId_osInternalId_key" ON "ServiceOrder"("clientId", "osInternalId");

CREATE INDEX IF NOT EXISTS "EquipmentProduct_clientId_idx" ON "EquipmentProduct"("clientId");
CREATE INDEX IF NOT EXISTS "Equipment_clientId_vehicleId_idx" ON "Equipment"("clientId", "vehicleId");
CREATE INDEX IF NOT EXISTS "ServiceOrder_clientId_vehicleId_idx" ON "ServiceOrder"("clientId", "vehicleId");
CREATE INDEX IF NOT EXISTS "EuroImportLog_clientId_createdAt_idx" ON "EuroImportLog"("clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "EuroImportLog_userId_createdAt_idx" ON "EuroImportLog"("userId", "createdAt");

ALTER TABLE "EquipmentProduct" ADD CONSTRAINT "EquipmentProduct_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "EquipmentProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EuroImportLog" ADD CONSTRAINT "EuroImportLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EuroImportLog" ADD CONSTRAINT "EuroImportLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
