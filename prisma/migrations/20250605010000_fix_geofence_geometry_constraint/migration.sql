-- Ensure geofence geometry columns and foreign key exist after previous partial deployment
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'geofence' AND column_name = 'geometryJson'
    ) THEN
        ALTER TABLE "geofence" ADD COLUMN "geometryJson" JSONB;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'geofence' AND column_name = 'kml'
    ) THEN
        ALTER TABLE "geofence" ADD COLUMN "kml" TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'geofence' AND column_name = 'createdByUserId'
    ) THEN
        ALTER TABLE "geofence" ADD COLUMN "createdByUserId" TEXT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_name = 'geofence'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND ccu.column_name = 'createdByUserId'
    ) THEN
        ALTER TABLE "geofence"
        ADD CONSTRAINT "geofence_createdByUserId_fkey"
        FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
