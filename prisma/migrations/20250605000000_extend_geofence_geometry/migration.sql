-- Extend geofence schema to support geometry metadata and audit
ALTER TABLE "geofence"
ADD COLUMN IF NOT EXISTS "geometryJson" JSONB,
ADD COLUMN IF NOT EXISTS "kml" TEXT,
ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
        WHERE table_name = 'geofence' AND column_name = 'createdByUserId'
    ) THEN
        ALTER TABLE "geofence"
        ADD CONSTRAINT "geofence_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
