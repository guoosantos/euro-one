-- Extend service order metadata
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "clientName" TEXT;
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "crmClientId" TEXT;
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "checklist" JSONB;
